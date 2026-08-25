// Auth API for Caalano360 - login, logout, session check, invites and user
// management. Fronted by the edge gate (which lets this endpoint through so the
// login screen can reach it); every privileged action re-checks the caller's
// session + role here, so the open door only leads to the login desk.
import {
  bootstrapAdmin, authenticate, createInvite, inviteInfo, acceptInvite,
  listUsers, updateUser, deleteUser, changePassword, currentUser, countUsers,
  signupRequest, approveUser, ensureSuperadmin, isAdminish, signSession, sessionCookie, clearCookie, COOKIE,
  checkLoginAllowed, recordLoginResult, revokeSessions, getUser,
} from '../lib/auth.mjs'

const SESSION_MS = 14 * 86400 * 1000
const secret = () => process.env.AUTH_SECRET || ''
const json = (obj, status = 200, cookie = null) => {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' }
  if (cookie) headers['set-cookie'] = cookie
  return new Response(JSON.stringify(obj), { status, headers })
}
// `v` is the user's session epoch. Bumping it on the user record invalidates
// every token carrying an older value, which is how a password change or an
// explicit sign-out-everywhere takes effect against stateless tokens.
const mint = async (user) => signSession({ e: user.email, r: user.role, n: user.name, v: user.tokenEpoch || 0, exp: Date.now() + SESSION_MS }, secret())

export default async (req) => {
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || ''
  const S = secret()
  // Feature flag: without AUTH_SECRET the login system is dormant. Report that
  // so the app keeps its legacy behaviour instead of showing a broken login.
  if (!S) return json({ ok: false, enabled: false, error: 'Login system not enabled (AUTH_SECRET unset).' }, 200)

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}

    // ---- public, unauthenticated actions ----
    if (action === 'me') {
      await ensureSuperadmin().catch(() => {}) // one-time: promote the founding admin
      // The app's own session check - genuine usage, so it counts toward activity.
      const user = await currentUser(req, S, { track: true })
      const needsSetup = (await countUsers()) === 0
      return json({ ok: true, enabled: true, user: user || null, needsSetup })
    }
    if (action === 'bootstrap' && req.method === 'POST') {
      const r = await bootstrapAdmin(body)
      if (r.error) return json({ ok: false, error: r.error }, 400)
      return json({ ok: true, user: r.user }, 200, sessionCookie(await mint(r.user)))
    }
    if (action === 'login' && req.method === 'POST') {
      const gate = await checkLoginAllowed(body.email)
      if (!gate.ok) return json({ ok: false, error: `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(gate.retryMs / 60000))} min.` }, 429)
      const user = await authenticate(body.email, body.password)
      await recordLoginResult(body.email, !!user)
      if (!user) return json({ ok: false, error: 'Wrong email or password, or the account isn’t active.' }, 401)
      return json({ ok: true, user }, 200, sessionCookie(await mint(user)))
    }
    if (action === 'logout') {
      return json({ ok: true }, 200, clearCookie())
    }
    if (action === 'invite-info') {
      return json({ ok: true, ...(await inviteInfo(url.searchParams.get('token') || '')) })
    }
    if (action === 'accept' && req.method === 'POST') {
      const r = await acceptInvite(body)
      if (r.error) return json({ ok: false, error: r.error }, 400)
      return json({ ok: true, user: r.user }, 200, sessionCookie(await mint(r.user)))
    }
    if (action === 'signup' && req.method === 'POST') {
      const r = await signupRequest(body)
      if (r.error) return json({ ok: false, error: r.error }, 400)
      return json({ ok: true, pending: true })
    }

    // ---- authenticated actions (any signed-in user) ----
    const me = await currentUser(req, S)
    if (!me) return json({ ok: false, error: 'Not signed in.' }, 401)

    if (action === 'change-password' && req.method === 'POST') {
      const r = await changePassword(me.email, body.current, body.next)
      if (r.error) return json({ ok: false, error: r.error }, 400)
      // The change just invalidated every existing session, including this one -
      // re-issue the current device's cookie so the person who made the change
      // stays signed in while everyone else's session dies.
      const fresh = await mint({ ...me, tokenEpoch: r.tokenEpoch })
      return new Response(JSON.stringify({ ok: true, signedOutOtherDevices: true }), {
        status: 200, headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(fresh) },
      })
    }

    // Sign out of every device - the immediate response to a lost laptop or a
    // session you think has been copied, without waiting out the token's life.
    if (action === 'signout-everywhere' && req.method === 'POST') {
      const r = await revokeSessions(me.email)
      if (r.error) return json({ ok: false, error: r.error }, 400)
      const fresh = await mint({ ...me, tokenEpoch: r.tokenEpoch })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(fresh) },
      })
    }

    // ---- admin + super-admin actions ----
    if (!isAdminish(me.role)) return json({ ok: false, error: 'Admins only.' }, 403)

    if (action === 'users') return json({ ok: true, users: await listUsers(), me })
    if (action === 'invite' && req.method === 'POST') {
      const r = await createInvite({ email: body.email, name: body.name, role: body.role, clients: body.clients, allClients: body.allClients, tabs: body.tabs, reports: body.reports, actor: me })
      if (r.error) return json({ ok: false, error: r.error }, 400)
      const link = `${url.origin}/?invite=${encodeURIComponent(r.token)}`
      return json({ ok: true, user: r.user, token: r.token, inviteUrl: link, expires: r.expires })
    }
    if (action === 'resend-invite' && req.method === 'POST') {
      const r = await createInvite({ email: body.email, name: body.name, role: body.role, clients: body.clients, allClients: body.allClients, tabs: body.tabs, reports: body.reports, actor: me })
      if (r.error) return json({ ok: false, error: r.error }, 400)
      const link = `${url.origin}/?invite=${encodeURIComponent(r.token)}`
      return json({ ok: true, user: r.user, inviteUrl: link, expires: r.expires })
    }
    if (action === 'approve' && req.method === 'POST') {
      const r = await approveUser(body.email, { role: body.role, clients: body.clients, allClients: body.allClients, tabs: body.tabs, reports: body.reports }, me)
      return r.error ? json({ ok: false, error: r.error }, 400) : json({ ok: true, user: r.user })
    }
    if (action === 'update-user' && req.method === 'POST') {
      const r = await updateUser(body.email, { role: body.role, status: body.status, name: body.name, clients: body.clients, allClients: body.allClients, tabs: body.tabs, reports: body.reports }, me)
      return r.error ? json({ ok: false, error: r.error }, 400) : json({ ok: true, user: r.user })
    }
    // Force another account off every device. The case this exists for: someone
    // leaves, or a laptop goes missing, and you want their open sessions gone now
    // rather than in two weeks. Guarded by the same rule as any other change to
    // that account, so an Admin can't revoke a Super Admin.
    if (action === 'revoke-sessions' && req.method === 'POST') {
      const target = await getUser(String(body.email || '').toLowerCase().trim())
      if (!target) return json({ ok: false, error: 'No such user.' }, 400)
      if (target.role === 'superadmin' && me.role !== 'superadmin') return json({ ok: false, error: 'Only a Super Admin can do that to a Super Admin.' }, 403)
      const r = await revokeSessions(target.email)
      return r.error ? json({ ok: false, error: r.error }, 400) : json({ ok: true })
    }
    if (action === 'delete-user' && req.method === 'POST') {
      const r = await deleteUser(body.email, me)
      return r.error ? json({ ok: false, error: r.error }, 400) : json({ ok: true })
    }

    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500)
  }
}
