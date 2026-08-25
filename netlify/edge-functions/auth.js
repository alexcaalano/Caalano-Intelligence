// Site gate. Two modes, chosen by whether AUTH_SECRET is set:
//
//  • AUTH_SECRET UNSET  → legacy mode: the old single shared password
//    (HTTP Basic Auth via SITE_PASSWORD). Nothing changes until you opt in.
//
//  • AUTH_SECRET SET    → multi-user mode: requests carrying a valid signed
//    session cookie pass; data/API calls without one get 401; page loads
//    without one are allowed through so the app can render its own login
//    screen. The old Basic Auth password still works as a break-glass
//    fallback for as long as SITE_PASSWORD stays set, so you can never lock
//    yourself out mid-migration. Remove SITE_PASSWORD once everyone's in.
//
// The /auth and OAuth-callback functions are excluded entirely (below) so the
// login desk and GoHighLevel redirect are always reachable.
const COOKIE = 'c360_session'
// Known AI training / answer-engine crawlers and the generic scraping stacks.
// Named explicitly rather than matched loosely, so a real browser is never
// caught by an over-broad pattern like /bot/.
const CRAWLER_UA = /(GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|Claude-SearchBot|PerplexityBot|Perplexity-User|Google-Extended|GoogleOther|Applebot-Extended|Bytespider|CCBot|Diffbot|Omgilibot|ImagesiftBot|FacebookBot|Meta-ExternalAgent|Amazonbot|cohere-ai|YouBot|Timpibot|Webzio|magpie-crawler|Scrapy|python-requests|python-urllib|node-fetch|Go-http-client|libwww-perl|HTTrack|Wget|curl\/)/i
const enc = new TextEncoder()

function bytesFromB64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '==='.slice((s.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function b64urlFromBytes(bytes) {
  let s = ''
  const b = new Uint8Array(bytes)
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function validSession(token, secret) {
  if (!token || token.indexOf('.') < 0) return false
  const [body, sig] = token.split('.')
  if (!body || !sig) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = b64urlFromBytes(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
  if (expected.length !== sig.length || expected !== sig) return false
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(body)))
    return payload && typeof payload.exp === 'number' && payload.exp > Date.now()
  } catch { return false }
}
function readCookie(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'))
  return m ? m[1] : null
}
function basicOk(req) {
  const pass = Netlify.env.get('SITE_PASSWORD')
  if (!pass) return false
  const user = Netlify.env.get('SITE_USER') || 'caalano'
  return (req.headers.get('authorization') || '') === 'Basic ' + btoa(`${user}:${pass}`)
}

export default async (request, context) => {
  const secret = Netlify.env.get('AUTH_SECRET')
  const url = new URL(request.url)

  // ---- automated crawlers -------------------------------------------------
  // Refused before anything else, including the SPA shell. robots.txt asks
  // politely and a well-behaved crawler obeys it; this is the part that
  // actually returns nothing, which is what produces the "couldn't access this
  // site" result rather than a page of scraped markup.
  //
  // This is a courtesy fence, not a security control: a user-agent is
  // self-declared and anyone determined can simply send a browser's. It stops
  // the well-behaved bulk crawlers - which is most of them - and nothing more.
  // The real boundary is the session gate below.
  const ua = request.headers.get('user-agent') || ''
  if (CRAWLER_UA.test(ua)) {
    return new Response('This is a private application. Automated access is not permitted.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
    })
  }

  // Legacy mode - behave exactly as before.
  if (!secret) {
    const pass = Netlify.env.get('SITE_PASSWORD')
    if (!pass) return
    if (basicOk(request)) return
    return new Response('Authentication required.', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Caalano 360", charset="UTF-8"' },
    })
  }

  // Multi-user mode.
  if (await validSession(readCookie(request), secret)) return // signed in
  if (basicOk(request)) return // break-glass fallback while SITE_PASSWORD remains

  // Not authenticated. Block data + serverless calls (including the baked
  // client JSON under /data), but let the SPA shell and its assets through so
  // the app can render its own login screen.
  const p = url.pathname
  if (p.startsWith('/.netlify/functions/') || p.startsWith('/api/') || p.startsWith('/data/')) {
    return new Response(JSON.stringify({ error: 'Not authenticated', auth: 'required' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    })
  }
  return // allow the SPA shell / static assets through
}

export const config = {
  path: '/*',
  // Always-public endpoints: the login API, the GoHighLevel OAuth callback, and
  // the Meta Ads webhook receiver (Meta calls it server-side with no cookie; it
  // secures itself with the X-Hub-Signature-256 HMAC check instead).
  excludedPath: ['/.netlify/functions/auth', '/.netlify/functions/caalano-connect', '/.netlify/functions/meta-webhook'],
}
