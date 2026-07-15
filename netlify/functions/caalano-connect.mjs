// GoHighLevel agency OAuth — two jobs:
//   ?start=1  → redirect the agency admin to GoHighLevel's consent screen
//   ?code=... → GoHighLevel redirects back here; we exchange the code for an
//               agency (company) token and store it in Netlify Blobs.
// Scopes requested are read-only. The redirect URI is derived from this
// function's own URL, so it works on any domain without hard-coding.
import { exchangeCode, isConnected } from '../lib/ghl.mjs'

// Must match the scopes configured on the GoHighLevel app. If the app has
// more scopes than the stored token was authorised with, GHL refuses to mint
// location tokens ("not authorized for this scope") — so re-authorising with
// the full set fixes it.
const SCOPES = ['contacts.readonly', 'opportunities.readonly', 'locations.readonly', 'users.readonly', 'conversations.readonly']
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
    return new Response(JSON.stringify({ connected: await isConnected().catch(() => false), hasClientId: !!clientId }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
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
      await exchangeCode(code, redirectUri)
      return page('✅ Caalano Systems connected', '<p>UTM attribution is now live in the dashboard. You can close this tab.</p><p><a style="color:#9b8cff" href="/">Back to dashboard</a></p>')
    } catch (e) {
      return page('Connection failed', `<p style="color:#f0435b">${String(e.message || e)}</p><p><a style="color:#9b8cff" href="/.netlify/functions/caalano-connect?start=1">Try again</a></p>`)
    }
  }

  const connected = await isConnected().catch(() => false)
  return page('Connect Caalano Systems', `<p>${connected ? 'Already connected. Re-authorise to refresh access.' : 'Authorise agency access to unlock UTM attribution.'}</p><p><a style="display:inline-block;margin-top:12px;background:#6d5efc;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700" href="/.netlify/functions/caalano-connect?start=1">${connected ? 'Re-authorise' : 'Connect Caalano Systems'}</a></p>`)
}
