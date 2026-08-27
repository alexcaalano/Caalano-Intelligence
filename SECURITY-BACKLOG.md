# Security backlog

Deferred security work, with enough detail to pick up cold. Each item states what
the exposure actually is, why it wasn't done at the time, and what doing it
involves — so the decision can be re-made on evidence rather than re-derived.

Current posture is recorded at the bottom, so a future change can be judged
against what was already true.

---

## 1. Serve the frontend bundle only to signed-in sessions

**Status:** BUILT, 2026-08-20 (v3.388.0) — shipped with the flag **off**, so
production behaviour is unchanged. Steps 3–5 of the rollout below need a human
with access to a preview deploy; they cannot be done from an agent session,
which cannot reach the deployed domain.

### The exposure

The edge gate (`netlify/edge-functions/auth.js`) deliberately lets unauthenticated
page loads through so the SPA can render its own login screen. That means
`index.html` and `/assets/index-*.js` — the entire compiled frontend — are served
to any request that isn't a known crawler user-agent.

The bundle is minified, which is not protection: de-minifiers are trivial and an
LLM reads minified JS perfectly well. Anyone who can reach the URL can read the
whole React app: every view, every calculation done client-side, every label.

**What is NOT exposed, and stays that way regardless of this item:**
- All backend code (Netlify Functions are server-side only) — the GHL integration,
  clinic aggregation, PVA/cohort maths, attribution model
- All data — `/.netlify/functions/*`, `/api/*` and `/data/*` already 401 without a
  session
- All secrets — no build-time env vars reach the bundle, no source maps published

So this is an IP-exposure item, not a data-breach item. Worth doing; worth doing
carefully rather than quickly.

### Why it wasn't done in the same pass

It changes the login path, and the login path is the one thing that can lock the
whole team out. It could not be verified against the live deploy from the session
where it came up (the agent proxy blocks the deployed domain), and
`SITE_PASSWORD` break-glass is a thin net to stake the team's access on.

### What was built

`netlify/edge-functions/auth.js` — approach (a), the edge-served login page.
Deliberately kept in the one file rather than a shared module: Netlify
auto-discovers every top-level file in `netlify/edge-functions/` as a function,
and a helper file with no default export is a deploy-time question nobody wants
to answer while locked out. 314 lines total.

When `GATE_ASSETS=1` and there is no session:
- `/assets/*` and `/data/*` are refused outright (404 / the existing 401)
- any HTML request gets a self-contained login page — inline CSS and one
  nonce'd inline script, no bundle, no external origin
- anything not asking for HTML gets 404 rather than the page

The page carries **all three** signed-out flows and routes between them itself
by calling `?action=me` and `?action=invite-info` (both on `excludedPath`):
sign in, accept an invite, first-admin bootstrap, plus request-access. That
self-routing is what removes the need for edge exceptions — an earlier sketch
let `?invite=` through to the bundle, which would have handed the whole app to
anyone who appended it.

The page sets its own CSP (`script-src 'nonce-…'`) because the site policy is
`script-src 'self'` and would otherwise block it. A fresh nonce per request; no
`unsafe-inline`.

**Verified (27 edge assertions + 17 browser assertions, all passing):** with the
flag off every path behaves exactly as before, including assets passing through;
with it on the bundle is refused while a valid session, an expired one, a
tampered signature, the `SITE_PASSWORD` break-glass, legacy mode and the crawler
block all behave correctly. In a real browser under a real nonce CSP header, all
four flows submit the right payloads to the right actions and an expired invite
dead-ends instead of falling through.

### The approach

The login UI currently lives *inside* the main bundle, which is the whole reason
the shell has to be public. Two ways out:

**(a) Edge-served login page — preferred.** The edge function already runs on
every request and can return a Response directly. For an unauthenticated HTML
request it returns a small self-contained login page (inline HTML/CSS/JS, no
bundle) that posts to `/.netlify/functions/auth`, which is already on
`excludedPath`. On success the cookie is set, the page reloads, and the real app
is served. No build changes, no routing changes, no second entry point to keep in
sync.

**(b) Separate `/login` entry point.** A second Vite entry, gate everything else.
More conventional, but adds a build target and a second place for login UI to
drift.

### What must not break

The login path carries more than sign-in, and each of these has to keep working
for an unauthenticated visitor:

- invite acceptance (`?invite=<token>`) — a new person has no session by definition
- signup / request-access
- first-admin bootstrap (`needsSetup`) — no users exist yet
- the GoHighLevel OAuth callback and the Meta webhook (already on `excludedPath`)
- `SITE_PASSWORD` Basic-Auth break-glass (`basicOk`) must keep passing through

### Rollout

1. ~~Build the edge login page behind an env flag (`GATE_ASSETS=1`), default
   off.~~ **Done, v3.388.0.**
2. ~~Deploy with the flag off — zero behaviour change.~~ **Done** — the flag is
   unset in production, so this deploy changed nothing. Worth a glance to
   confirm.
3. Turn it on in a preview deploy. Walk every path above, including an invite link
   in a clean browser profile and a fresh bootstrap.
4. Turn it on in production during a window when someone can flip the flag back.
5. Keep `SITE_PASSWORD` set throughout as the break-glass, and only consider
   removing it well after.

**Estimate:** a few hours including the walkthrough. The build is small; the
verification is the work, and the verification is the point.

---

## Current posture (verified 2026-08-25)

Recorded so a later change can be judged against what was already true, and so
the same review isn't repeated from scratch.

**Verified sound:**
- Per-client authorization enforced **server-side** — a viewer cannot reach
  another client's data by crafting a request, and viewers are additionally
  limited to the scopes their allocated tabs fetch. (The classic failure here is
  a UI that hides tabs while the API returns everything; that is not the case.)
- Settings writes admin-only; client add/remove/relink Super-Admin-only
- Passwords: PBKDF2-SHA256, 150k iterations, timing-safe comparison
- Sessions: HMAC-SHA256 signed, timing-safe signature check, HttpOnly + Secure +
  SameSite=Lax, 14-day expiry, epoch-invalidated (see below)
- Login throttle with escalating lockout
- Disabling a user kills their session on the next request; a role change takes
  effect on the next request
- No source maps published; no secrets reachable from the client bundle
- CSP enforcing, HSTS preloaded, `frame-ancestors 'self'`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`
- AI/scraper user-agents refused 403 at the edge; robots.txt names them
  individually (a courtesy fence — a user-agent is self-declared, so this stops
  well-behaved bulk crawlers and nothing more)

**Fixed 2026-08-25 (v3.358.0):** a password change did not invalidate existing
sessions — tokens are stateless and lived 14 days, so a stolen cookie survived
the exact action taken in response to suspecting it. Sessions now carry an epoch
inside the signed payload.

**Known and accepted:**
- The frontend bundle is public (item 1 above)
- The edge gate validates signature + expiry only, not the session epoch — it has
  no store read. A revoked token therefore passes the edge but is rejected by
  `currentUser` on every data call and by `/auth?action=me`, so the app signs the
  person out. The edge is a coarse gate; authorization lives in the functions.
