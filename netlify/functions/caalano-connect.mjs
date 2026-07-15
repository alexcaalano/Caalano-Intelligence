// GoHighLevel agency OAuth — two jobs:
//   ?start=1  → redirect the agency admin to GoHighLevel's consent screen
//   ?code=... → GoHighLevel redirects back here; we exchange the code for an
//               agency (company) token and store it in Netlify Blobs.
// Scopes requested are read-only. The redirect URI is derived from this
// function's own URL, so it works on any domain without hard-coding.
import { exchangeCode, isConnected, loadTokens } from '../lib/ghl.mjs'

// Exactly the read scopes the dashboard uses. locations.readonly is the one
// that works at agency level (to mint sub-account tokens); opportunities +
// contacts cover CRM + attribution. Keep the GoHighLevel app trimmed to these
// three so the token and app scope sets match and location-token minting works.
const SCOPES = ['contacts.readonly', 'opportunities.readonly', 'locations.readonly']
const AUTH = 'https://marketplace.gohighlevel.com/oauth/chooselocation'

const page = (title, body) => new Response(
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font-family:system-ui;background:#0a0c12;color:#eef1f7;display:grid;place-items:center;height:100vh;margin:0;text-align:center">` +
  `<div style="max-width:520px;padding:32px"><h2>${title}</h2>${body}</div></body>`,
  { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } },
)

export default async (req) => {
  const url = new URL(req.url)
  const redirectUri = `${url.origin}/.netlify/functions/caalano-connect`
  const clientId = process.env.GHL_CLIENT_ID

  if (url.searchParams.get('status') === '1') {
    const t = await loadTokens().catch(() => null)
    return new Response(JSON.stringify({
      connected: !!t, hasClientId: !!clientId,
      tokenType: t ? (t.userType || 'unknown') : null,
      hasCompanyId: t ? !!t.companyId : null,
      companyId: t && t.companyId ? String(t.companyId).slice(0, 6) + '…' : null,
    }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  }

  if (!clientId) return page('Not configured', '<p>Set <code>GHL_CLIENT_ID</code> and <code>GHL_CLIENT_SECRET</code> in Netlify, then reload.</p>')

  if (url.searchParams.get('start') === '1') {
    const a = new URL(AUTH)
    a.searchParams.set('response_type', 'code')
    a.searchParams.set('redirect_uri', redirectUri)
    a.searchParams.set('client_id', clientId)
    a.searchParams.set('scope', SCOPES.join(' '))
    return Response.redirect(a.toString(), 302)
  }

  const code = url.searchParams.get('code')
  if (code) {
    try {
      const t = await exchangeCode(code, redirectUri)
      const isCompany = String(t.userType || '').toLowerCase() === 'company' && !!t.companyId
      const badge = isCompany
        ? '<p style="color:#12b886;font-weight:700">✅ Agency (Company) token — this can read every sub-account.</p>'
        : `<p style="color:#f5a524;font-weight:700">⚠️ This is a <b>${t.userType || 'Location'}</b> token${t.companyId ? '' : ' (no companyId)'} — it can only read ONE sub-account. Re-authorise and pick your <b>Agency</b> (not a single location).</p>`
      return page('Caalano Systems connected', `${badge}<p><a style="color:#9b8cff" href="/.netlify/functions/caalano-connect?start=1">Re-authorise</a> · <a style="color:#9b8cff" href="/">Back to dashboard</a></p>`)
    } catch (e) {
      return page('Connection failed', `<p style="color:#f0435b">${String(e.message || e)}</p><p><a style="color:#9b8cff" href="/.netlify/functions/caalano-connect?start=1">Try again</a></p>`)
    }
  }

  const connected = await isConnected().catch(() => false)
  return page('Connect Caalano Systems', `<p>${connected ? 'Already connected. Re-authorise to refresh access.' : 'Authorise agency access to unlock UTM attribution.'}</p><p><a style="display:inline-block;margin-top:12px;background:#6d5efc;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700" href="/.netlify/functions/caalano-connect?start=1">${connected ? 'Re-authorise' : 'Connect Caalano Systems'}</a></p>`)
}
