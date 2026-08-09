// GoHighLevel agency OAuth - two jobs:
//   ?start=1  → redirect the agency admin to GoHighLevel's consent screen
//   ?code=... → GoHighLevel redirects back here; we exchange the code for an
//               agency (company) token and store it in Netlify Blobs.
// Scopes requested are read-only. The redirect URI is derived from this
// function's own URL, so it works on any domain without hard-coding.
import { exchangeCode, isConnected, loadTokens } from '../lib/ghl.mjs'
import { currentUser, isAdminish, signSession, verifySession } from '../lib/auth.mjs'

// Exactly the read scopes the dashboard uses. locations.readonly is the one
// that works at agency level (to mint sub-account tokens); opportunities +
// contacts cover CRM + attribution; calendars + calendars/events let us count
// real booked calls against a creative even when the pipeline stage was never
// advanced. forms + surveys give form/survey submission analytics (which form /
// friction level converts); locations/customFields labels the answers; users
// gives real sales-rep names for per-rep performance; conversations/message
// unlocks speed-to-lead and engagement. Keep the GoHighLevel app scope set
// matched to this list so the token and app scopes agree and every scope
// requested here is actually enabled on the marketplace app (an un-enabled
// scope makes the whole re-authorisation fail).
const SCOPES = [
  'contacts.readonly', 'opportunities.readonly', 'locations.readonly',
  'calendars.readonly', 'calendars/events.readonly',
  'forms.readonly', 'locations/customFields.readonly', 'users.readonly',
  'conversations/message.readonly',
]
const AUTH = 'https://marketplace.gohighlevel.com/oauth/chooselocation'

const page = (title, body) => new Response(
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font-family:system-ui;background:#0a0c12;color:#eef1f7;display:grid;place-items:center;height:100vh;margin:0;text-align:center">` +
  `<div style="max-width:520px;padding:32px"><h2>${title}</h2>${body}</div></body>`,
  { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } },
)

// Basic-Auth check for the legacy (shared-password) mode — mirrors the edge gate.
function basicOk(req) {
  const pass = process.env.SITE_PASSWORD
  if (!pass) return false
  const user = process.env.SITE_USER || 'caalano'
  return (req.headers.get('authorization') || '') === 'Basic ' + btoa(`${user}:${pass}`)
}
// Who's calling, and may they administer the GHL connection? This function is
// excluded from the edge gate (so the OAuth redirect is always reachable), so it
// must authorise itself. Multi-user mode → require an admin session; legacy mode
// → require the shared Basic-Auth password; neither configured → open (no auth
// set up on the site at all). A GHL redirect back is a top-level GET, so the
// SameSite=Lax session cookie / cached Basic creds are sent with it.
async function gate(req) {
  const secret = process.env.AUTH_SECRET
  if (secret) { const u = await currentUser(req, secret).catch(() => null); return { ok: !!(u && isAdminish(u.role)), mode: 'session' } }
  if (process.env.SITE_PASSWORD) return { ok: basicOk(req), mode: 'basic' }
  return { ok: true, mode: 'open' }
}
// HMAC key for the CSRF `state` nonce. Prefer AUTH_SECRET, then the shared
// password, then the GHL client secret (always present when OAuth is set up),
// so a signed state is always possible regardless of auth mode.
const stateSecret = () => process.env.AUTH_SECRET || process.env.SITE_PASSWORD || process.env.GHL_CLIENT_SECRET || ''
const STATE_KIND = 'ghl-oauth'

export default async (req) => {
  const url = new URL(req.url)
  const redirectUri = `${url.origin}/.netlify/functions/caalano-connect`
  const clientId = process.env.GHL_CLIENT_ID
  const g = await gate(req)
  const denied = (extra) => {
    if (g.mode === 'basic') return new Response('Authentication required.', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Caalano 360", charset="UTF-8"', 'cache-control': 'no-store' } })
    return page('Admin sign-in required', `<p>Connecting Caalano Systems is an admin-only action. Sign in to the dashboard as an admin, then reopen this page.</p>${extra || ''}<p><a style="color:#9b8cff" href="/">Go to the dashboard</a></p>`)
  }

  if (url.searchParams.get('status') === '1') {
    if (!g.ok) return new Response(JSON.stringify({ error: 'Not authorised' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    const t = await loadTokens().catch(() => null)
    return new Response(JSON.stringify({
      connected: !!t, hasClientId: !!clientId,
      tokenType: t ? (t.userType || 'unknown') : null,
      hasCompanyId: t ? !!t.companyId : null,
      companyId: t && t.companyId ? String(t.companyId).slice(0, 6) + '…' : null,
    }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  }

  if (!clientId) return page('Not configured', '<p>Set <code>GHL_CLIENT_ID</code> and <code>GHL_CLIENT_SECRET</code> in Netlify, then reload.</p>')

  if (!g.ok) return denied()

  if (url.searchParams.get('start') === '1') {
    // Signed, short-lived CSRF token round-tripped through GoHighLevel.
    const state = await signSession({ k: STATE_KIND, exp: Date.now() + 15 * 60 * 1000 }, stateSecret())
    const a = new URL(AUTH)
    a.searchParams.set('response_type', 'code')
    a.searchParams.set('redirect_uri', redirectUri)
    a.searchParams.set('client_id', clientId)
    a.searchParams.set('scope', SCOPES.join(' '))
    a.searchParams.set('state', state)
    return Response.redirect(a.toString(), 302)
  }

  const code = url.searchParams.get('code')
  if (code) {
    // Reject any callback whose state we didn't mint (or that has expired) — this
    // is what stops a forged/CSRF callback from overwriting the agency token. The
    // admin session was already required above.
    const st = url.searchParams.get('state')
    const okState = st ? await verifySession(st, stateSecret()).catch(() => null) : null
    if (!okState || okState.k !== STATE_KIND) {
      return page('Connection blocked', '<p style="color:#f0435b">This authorisation link is invalid or has expired. For security, start the connection again from the dashboard.</p><p><a style="color:#9b8cff" href="/.netlify/functions/caalano-connect?start=1">Start over</a></p>')
    }
    try {
      const t = await exchangeCode(code, redirectUri)
      const isCompany = String(t.userType || '').toLowerCase() === 'company' && !!t.companyId
      const badge = isCompany
        ? '<p style="color:#12b886;font-weight:700">✅ Agency (Company) token - this can read every sub-account.</p>'
        : `<p style="color:#f5a524;font-weight:700">⚠️ This is a <b>${t.userType || 'Location'}</b> token${t.companyId ? '' : ' (no companyId)'} - it can only read ONE sub-account. Re-authorise and pick your <b>Agency</b> (not a single location).</p>`
      return page('Caalano Systems connected', `${badge}<p><a style="color:#9b8cff" href="/.netlify/functions/caalano-connect?start=1">Re-authorise</a> · <a style="color:#9b8cff" href="/">Back to dashboard</a></p>`)
    } catch (e) {
      return page('Connection failed', `<p style="color:#f0435b">${String(e.message || e)}</p><p><a style="color:#9b8cff" href="/.netlify/functions/caalano-connect?start=1">Try again</a></p>`)
    }
  }

  const connected = await isConnected().catch(() => false)
  return page('Connect Caalano Systems', `<p>${connected ? 'Already connected. Re-authorise to refresh access.' : 'Authorise agency access to unlock UTM attribution.'}</p><p><a style="display:inline-block;margin-top:12px;background:#6d5efc;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700" href="/.netlify/functions/caalano-connect?start=1">${connected ? 'Re-authorise' : 'Connect Caalano Systems'}</a></p>`)
}
