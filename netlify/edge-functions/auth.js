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
// ---------------------------------------------------------------------------
// The front door: what a signed-out visitor sees when GATE_ASSETS is on.
//
// It is the login page and the product's landing page in one. That is not a
// shortcut - it falls out of the gate. Once the compiled app is withheld until
// there is a session, this page IS the only public surface, so it may as well
// say what the product is rather than showing a bare form to someone who was
// sent a link and has no idea what they are looking at.
//
// Self-contained on purpose: inline CSS, inline SVG, one nonce'd script, no
// bundle, no external font or image. It sets its own CSP (the site policy is
// script-src 'self' and would block it dead), so widening anything here never
// touches the policy protecting the app.
//
// It carries every flow a signed-out person legitimately needs - sign in,
// accept an invite, first-admin bootstrap, request access - and routes between
// them itself via ?action=me and ?action=invite-info, both always reachable.
// That self-routing is what removes the need for edge exceptions: letting
// ?invite= through to the bundle would hand the whole app to anyone appending
// it.
//
// NOT indexed, deliberately: robots.txt disallows everything on this host and
// the edge refuses crawler user-agents. If the product ever wants a page Google
// can see, that belongs on a separate public site, not here.
// ---------------------------------------------------------------------------
export function loginPage(nonce) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#10121b">
<title>Caalano360 &middot; Client Reporting</title>
<style>
:root{
  --ink:#0f1220;--ink-2:#1b2033;--paper:#fff;--text:#141a2e;--muted:#6b7488;--faint:#98a0b5;
  --line:#e5e8f0;--field:#f7f8fc;--brand:#5b6ff5;--brand-2:#8d5bf5;--neg:#d64562;--pos:#0f9e6e;
}
@media(prefers-color-scheme:dark){
  :root{--paper:#151827;--text:#eef1f8;--muted:#98a0b5;--faint:#767f96;--line:#262b3d;--field:#1c2032}
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--ink);color:var(--text);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{min-height:100%;display:grid;grid-template-columns:1.05fr .95fr}

/* ---- left: the product ---- */
.tell{position:relative;overflow:hidden;padding:56px 56px 48px;display:flex;flex-direction:column;
  justify-content:space-between;background:
  radial-gradient(900px 620px at 12% 4%,rgba(91,111,245,.34),transparent 62%),
  radial-gradient(760px 560px at 92% 92%,rgba(141,91,245,.28),transparent 60%),
  linear-gradient(158deg,#10121b 0%,#161a2b 58%,#12141f 100%)}
.tell:after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
  background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),
  linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px);background-size:52px 52px}
.tell>*{position:relative;z-index:1}
.mark{display:flex;align-items:center;gap:13px}
.badge{width:46px;height:46px;border-radius:14px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;line-height:1;
  font-size:14px;font-weight:800;letter-spacing:-.02em;color:#fff;
  background:linear-gradient(140deg,var(--brand),var(--brand-2));
  box-shadow:0 8px 22px rgba(91,111,245,.42)}
.mark b{display:block;font-size:19px;letter-spacing:-.02em;color:#fff}
.mark b i{font-style:normal;color:#a9b4ff}
.mark>div>span{display:block;font-size:11.5px;color:#8b93ad;letter-spacing:.06em;text-transform:uppercase}
.pitch{margin:52px 0}
.pitch h1{margin:0 0 16px;font-size:35px;line-height:1.16;letter-spacing:-.028em;color:#fff;max-width:14ch}
.pitch h1 em{font-style:normal;background:linear-gradient(96deg,#9fb0ff,#c9a6ff);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pitch p{margin:0;font-size:14.5px;line-height:1.65;color:#98a1bb;max-width:44ch}
.pts{list-style:none;margin:30px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:20px 30px}
.pts li{display:flex;gap:9px;align-items:flex-start}
.pts svg{flex:0 0 auto;margin-top:3px}
.pts b{display:block;color:#eef1f8;font-size:13px;font-weight:650;letter-spacing:-.005em;margin-bottom:3px}
.pts span{display:block;font-size:12.5px;line-height:1.5;color:#98a1bb}
@media(max-width:1240px){.pts{grid-template-columns:1fr;max-width:46ch}}
.foot{font-size:11.5px;color:#6d7590;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.foot a{color:#8b93ad}
.lock{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#8b93ad;font-size:11px}

/* ---- right: the desk ---- */
.desk{background:var(--paper);display:flex;align-items:center;justify-content:center;padding:48px 40px}
.form-col{width:100%;max-width:352px}
h2{margin:0 0 5px;font-size:23px;letter-spacing:-.02em}
.sub{margin:0 0 24px;font-size:13px;color:var(--muted)}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:14px}
input{display:block;width:100%;margin-top:6px;padding:11px 13px;font:inherit;color:var(--text);
  background:var(--field);border:1px solid var(--line);border-radius:10px;transition:border-color .12s}
input:hover{border-color:#cdd3e2}
input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(91,111,245,.16)}
button.go{width:100%;padding:12px;margin-top:6px;font:inherit;font-weight:700;color:#fff;border:0;
  border-radius:10px;cursor:pointer;background:linear-gradient(135deg,var(--brand),#6b56f0);
  box-shadow:0 6px 18px rgba(91,111,245,.32)}
button.go:hover{filter:brightness(1.06)}
button.go[disabled]{opacity:.55;cursor:default;box-shadow:none}
button.link{width:100%;margin-top:14px;padding:6px;font:inherit;font-size:12.5px;color:var(--muted);
  background:none;border:0;cursor:pointer}
button.link:hover{color:var(--brand)}
.err{margin:0 0 14px;padding:10px 12px;font-size:12.5px;border-radius:9px;
  background:rgba(214,69,98,.11);color:var(--neg);border:1px solid rgba(214,69,98,.2)}
.ok{margin:0;padding:11px 13px;font-size:13px;border-radius:9px;
  background:rgba(15,158,110,.11);color:var(--pos);border:1px solid rgba(15,158,110,.2)}
.hint{margin:16px 0 0;font-size:11.5px;color:var(--faint);text-align:center}

@media(max-width:900px){
  .wrap{grid-template-columns:1fr}
  .tell{padding:34px 26px 30px}
  .pitch{margin:30px 0}
  .pitch h1{font-size:27px;max-width:none}
  .pts{display:none}
  .desk{padding:34px 26px 48px}
  .form-col{max-width:none}
}
</style></head><body>
<div class="wrap">
  <section class="tell">
    <div class="mark">
      <span class="badge">360</span>
      <div><b>Caalano<i>360</i></b><span>Client Reporting</span></div>
    </div>
    <div class="pitch">
      <h1>From lead to <em>closed deal</em>.</h1>
      <p>Ad platforms can tell you what a lead cost. They cannot tell you which leads became clients,
         because that happens in your CRM weeks later. Caalano360 joins the two, so you can back what
         brings in revenue and stop paying for what only brings in forms.</p>
      <ul class="pts">
        <li><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.6 8.4l3 3 5.8-6.4" stroke="#9fb0ff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>Know which ad brought the client</b><span>Performance down to the campaign, ad set, creative or keyword, scored on deals won rather than forms filled in.</span></div></li>
        <li><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.6 8.4l3 3 5.8-6.4" stroke="#9fb0ff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>Cost per the thing you care about</b><span>Cost per meeting booked, per call attended, per quote sent, per new client. You set the steps your business runs on.</span></div></li>
        <li><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.6 8.4l3 3 5.8-6.4" stroke="#9fb0ff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>See where deals stall</b><span>Speed to lead and sales cycle length by rep, so slow follow up stops being invisible and starts being fixable.</span></div></li>
        <li><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.6 8.4l3 3 5.8-6.4" stroke="#9fb0ff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>Catch revenue before it slips</b><span>Aged opportunities and deals going quiet, flagged while there is still time to do something about them.</span></div></li>
        <li><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.6 8.4l3 3 5.8-6.4" stroke="#9fb0ff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>Spend where the good clients are</b><span>Location and deal value read together, so budget follows the areas that pay rather than the ones that just enquire.</span></div></li>
        <li><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.6 8.4l3 3 5.8-6.4" stroke="#9fb0ff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>Learn what a good lead sounds like</b><span>Qualification answers matched against what actually closed, so you can go and find more of the same.</span></div></li>
      </ul>
    </div>
    <div class="foot">
      <span class="lock"><svg width="10" height="11" viewBox="0 0 12 13" fill="none" aria-hidden="true"><rect x="1.6" y="5.4" width="8.8" height="6.6" rx="1.8" stroke="#8b93ad" stroke-width="1.1"/><path d="M3.9 5.2V3.7a2.1 2.1 0 014.2 0v1.5" stroke="#8b93ad" stroke-width="1.1" stroke-linecap="round"/></svg> Private &middot; invitation only</span>
      <span>&copy; Caalano Digital</span>
    </div>
  </section>
  <section class="desk">
    <div class="form-col" id="app"><p class="sub">Loading&hellip;</p></div>
  </section>
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
    done:function(){ app.innerHTML = '<h2>Request sent</h2><p class="ok">Thanks. We\\u2019ll be in touch once your access is set up.</p>' },
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
