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
// Anything that is part of the compiled app rather than a page someone typed.
// Under GATE_ASSETS these are refused outright to a signed-out visitor: serving
// them is the whole exposure, and a login page in their place would only confuse
// a script tag.
const ASSET_RE = /^\/(assets|data)\//
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
  // client JSON under /data) either way.
  const p = url.pathname
  if (p.startsWith('/.netlify/functions/') || p.startsWith('/api/') || p.startsWith('/data/')) {
    return new Response(JSON.stringify({ error: 'Not authenticated', auth: 'required' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    })
  }

  // GATE_ASSETS off (the default): behave exactly as before - let the SPA shell
  // and its assets through so the bundled login screen can render. This is the
  // switch, and it is off until someone turns it on, so deploying this file
  // changes nothing.
  if (Netlify.env.get('GATE_ASSETS') !== '1') return

  // GATE_ASSETS on: the compiled app is not public. Assets are refused, and any
  // page request gets the standalone login page instead - which handles signing
  // in, accepting an invite and first-admin setup on its own, so nothing that a
  // signed-out person legitimately does needs the bundle.
  if (ASSET_RE.test(p)) return new Response('Not found', { status: 404 })
  if (!(request.headers.get('accept') || '').includes('text/html')) {
    return new Response('Not found', { status: 404 })
  }
  const nonce = b64urlFromBytes(crypto.getRandomValues(new Uint8Array(16)))
  return new Response(loginPage(nonce), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      // This page carries one inline script, so it needs its own policy - the
      // site's `script-src 'self'` would block it. A per-request nonce keeps the
      // grant to exactly that script rather than opening 'unsafe-inline'.
      'content-security-policy': [
        "default-src 'none'", "base-uri 'none'", "object-src 'none'",
        "frame-ancestors 'self'", "form-action 'self'",
        `script-src 'nonce-${nonce}'`, "style-src 'unsafe-inline'",
        "img-src 'self' data:", "connect-src 'self'",
      ].join('; '),
    },
  })
}

// ---------------------------------------------------------------------------
// Standalone login page, served from the edge when GATE_ASSETS is on.
//
// The whole reason the app shell has to be public today is that the login UI
// lives inside the bundle: to show someone a sign-in box we have to hand them
// the entire compiled frontend first. This page breaks that circularity - it is
// self-contained HTML with no bundle behind it, so the real app can be withheld
// until there is a session.
//
// It covers all three things a signed-out visitor legitimately does, and routes
// between them itself by asking `?action=me` (which is on excludedPath and so is
// always reachable). That means the edge needs no query-string exceptions - and
// an exception like "let ?invite= through" would have handed the bundle to
// anyone who appended it.
//
// Every form posts to /.netlify/functions/auth, which sets the session cookie;
// the page then reloads and the edge serves the real app.
//
// Error strings are whatever the server returned, verbatim - the login error is
// deliberately vague about whether an account exists, and rewording it here
// would undo that.
// ---------------------------------------------------------------------------
export function loginPage(nonce) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Caalano360</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--text:#141a2e;--muted:#6b7488;--line:#e3e6ef;--brand:#5b6ff5;--neg:#e0566c}
@media(prefers-color-scheme:dark){:root{--bg:#0e1017;--card:#161a26;--text:#eef1f8;--muted:#98a0b5;--line:#252a3a;--brand:#7d8cff}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);
font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;
box-shadow:0 12px 40px rgba(16,20,40,.10)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:22px}
.dot{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#5b6ff5,#8d5bf5);flex:0 0 auto}
.brand b{font-size:16px;letter-spacing:-.01em}.brand span{display:block;font-size:11.5px;color:var(--muted);font-weight:400}
h2{margin:0 0 4px;font-size:19px;letter-spacing:-.01em}
.sub{margin:0 0 18px;font-size:12.5px;color:var(--muted)}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:12px}
input{display:block;width:100%;margin-top:5px;padding:10px 12px;font:inherit;color:var(--text);
background:var(--bg);border:1px solid var(--line);border-radius:9px}
input:focus{outline:2px solid var(--brand);outline-offset:1px;border-color:transparent}
button.go{width:100%;padding:11px;font:inherit;font-weight:700;color:#fff;background:var(--brand);
border:0;border-radius:9px;cursor:pointer;margin-top:4px}
button.go[disabled]{opacity:.55;cursor:default}
button.link{width:100%;margin-top:12px;padding:6px;font:inherit;font-size:12.5px;color:var(--muted);
background:none;border:0;cursor:pointer;text-decoration:underline}
.err{margin:0 0 12px;padding:9px 11px;font-size:12.5px;border-radius:8px;
background:rgba(224,86,108,.12);color:var(--neg)}
.ok{margin:0;padding:9px 11px;font-size:12.5px;border-radius:8px;
background:rgba(18,184,134,.12);color:#0f9e6e}
.hint{margin:14px 0 0;font-size:11.5px;color:var(--muted);text-align:center}
</style></head><body>
<div class="card">
  <div class="brand"><span class="dot"></span><div><b>Caalano360</b><span>360&deg; Reporting</span></div></div>
  <div id="app"><p class="sub">Loading&hellip;</p></div>
</div>
<script nonce="${nonce}">
(function(){
var app = document.getElementById('app');
var API = '/.netlify/functions/auth';
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
  return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c] }) }
function qs(k){ try { return new URLSearchParams(location.search).get(k) } catch(e){ return null } }
function post(action, body){
  return fetch(API + '?action=' + action, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify(body) }).then(function(r){ return r.json().catch(function(){ return { ok:false,
    error:'Something went wrong. Try again.' } }) })
}
// A form the three modes share. Each field entry is
// [name, label, inputType, autocomplete, optional].
function form(opts){
  app.innerHTML = '<h2>' + esc(opts.title) + '</h2>'
    + (opts.sub ? '<p class="sub">' + opts.sub + '</p>' : '')
    + '<form id="f" novalidate>'
    + '<div id="err"></div>'
    + opts.fields.map(function(f, i){
        return '<label>' + esc(f[1]) + '<input name="' + f[0] + '" type="' + f[2] + '"'
          + (f[3] ? ' autocomplete="' + f[3] + '"' : '')
          + (i === 0 ? ' autofocus' : '') + (f[4] ? '' : ' required') + '></label>' }).join('')
    + '<button class="go" type="submit">' + esc(opts.cta) + '</button>'
    + (opts.alt ? '<button class="link" type="button" id="alt">' + esc(opts.alt) + '</button>' : '')
    + '</form>'
    + (opts.hint ? '<p class="hint">' + opts.hint + '</p>' : '')
  var f = document.getElementById('f'), errBox = document.getElementById('err')
  var btn = f.querySelector('button.go')
  if (opts.alt) document.getElementById('alt').onclick = opts.onAlt
  f.onsubmit = function(e){
    e.preventDefault()
    var body = {}, missing = false
    opts.fields.forEach(function(fd){
      var v = f.elements[fd[0]].value.trim()
      if (!v && !fd[4]) missing = true
      body[fd[0]] = v
    })
    if (missing) { errBox.innerHTML = '<div class="err">Please fill in every field.</div>'; return }
    errBox.innerHTML = ''; btn.disabled = true; btn.textContent = opts.busy
    opts.submit(body).then(function(r){
      if (r && r.ok) { opts.done(r); return }
      btn.disabled = false; btn.textContent = opts.cta
      errBox.innerHTML = '<div class="err">' + esc((r && r.error) || 'That did not work.') + '</div>'
    })
  }
}
function enter(){ location.replace(location.pathname) }   // drop ?invite= etc, reload into the app

function signIn(){
  form({ title:'Sign in', cta:'Sign in', busy:'Signing in…',
    fields:[['email','Email','email','username'],['password','Password','password','current-password']],
    submit:function(b){ return post('login', b) }, done:enter,
    alt:'Are you a client? Request access →', onAlt:requestAccess })
}
function requestAccess(){
  form({ title:'Request access', sub:'We\\u2019ll review it and email you when your account is ready.',
    cta:'Request access', busy:'Sending…',
    fields:[['name','Your name','text','name'],['email','Email','email','username'],
            ['password','Choose a password','password','new-password'],['note','Anything we should know? (optional)','text','',true]],
    submit:function(b){ return post('signup', b) },
    done:function(){ app.innerHTML = '<h2>Request sent</h2><p class="ok">Thanks — we\\u2019ll be in touch once your access is set up.</p>' },
    alt:'← Back to sign in', onAlt:signIn })
}
function acceptInvite(token, info){
  form({ title:'Set your password', sub:'Invited as <b>' + esc(info.email) + '</b>',
    cta:'Create my account', busy:'Setting up…',
    fields:[['name','Your name','text','name'],['password','Choose a password','password','new-password']],
    submit:function(b){ return post('accept', { token:token, password:b.password, name:b.name }) },
    done:enter, hint:'Passwords must be at least 8 characters.' })
}
function firstAdmin(){
  form({ title:'Create the first account', sub:'No accounts exist yet. This one becomes the Super Admin.',
    cta:'Create account', busy:'Creating…',
    fields:[['name','Your name','text','name'],['email','Email','email','username'],
            ['password','Choose a password','password','new-password']],
    submit:function(b){ return post('bootstrap', b) }, done:enter,
    hint:'Passwords must be at least 8 characters.' })
}

// Route. An invite link wins; otherwise ask whether the site still needs its
// first account. Any failure falls back to the sign-in form, which is the one
// that works without knowing anything.
var token = qs('invite')
if (token) {
  fetch(API + '?action=invite-info&token=' + encodeURIComponent(token))
    .then(function(r){ return r.json() })
    .then(function(j){
      if (j && j.ok && j.valid) return acceptInvite(token, j)
      app.innerHTML = '<h2>Invite not valid</h2><p class="err">'
        + (j && j.expired ? 'This invite has expired. Ask an admin to resend it.'
                          : 'This invite link is invalid or has already been used.')
        + '</p><button class="link" id="alt">← Go to sign in</button>'
      document.getElementById('alt').onclick = signIn
    })
    .catch(signIn)
} else {
  fetch(API + '?action=me').then(function(r){ return r.json() })
    .then(function(j){ if (j && j.needsSetup) firstAdmin(); else signIn() })
    .catch(signIn)
}
})();
</script></body></html>`
}

export const config = {
  path: '/*',
  // Always-public endpoints: the login API, the GoHighLevel OAuth callback, and
  // the Meta Ads webhook receiver (Meta calls it server-side with no cookie; it
  // secures itself with the X-Hub-Signature-256 HMAC check instead).
  excludedPath: ['/.netlify/functions/auth', '/.netlify/functions/caalano-connect', '/.netlify/functions/meta-webhook'],
}
