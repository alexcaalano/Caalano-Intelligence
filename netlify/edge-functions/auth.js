// Site-wide password gate (HTTP Basic Auth) — protects every page AND the
// serverless data endpoints, so a stranger who finds the domain sees nothing.
// The password lives in the SITE_PASSWORD env var (never in code). Until it's
// set, the gate is inactive so we can't lock ourselves out before configuring.
// The OAuth callback is excluded so GoHighLevel can always redirect back.
export default async (request, context) => {
  const pass = Netlify.env.get('SITE_PASSWORD')
  if (!pass) return // not configured yet → allow through
  const user = Netlify.env.get('SITE_USER') || 'caalano'
  const expected = 'Basic ' + btoa(`${user}:${pass}`)
  const got = request.headers.get('authorization') || ''
  if (got === expected) return // authorised → continue to the app / function
  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Caalano 360", charset="UTF-8"' },
  })
}

export const config = {
  path: '/*',
  // Let the GoHighLevel OAuth callback through without a password prompt.
  excludedPath: '/.netlify/functions/caalano-connect',
}
