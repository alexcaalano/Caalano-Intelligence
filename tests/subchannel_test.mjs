// @needs-fake-blobs
// The non-paid ("Organic, referral, direct") leads split into the channel they
// came from, for the Key event reach hover. The CRM's own session-source label
// wins, then utm_source / utm_medium, then the referrer host; leads the CRM
// created itself are their own bucket; no attribution at all is "unknown".
process.env.AUTH_SECRET = 'test-secret'
import assert from 'node:assert/strict'
const { subChannelOf, SUB_CHANNELS, SUB_CHANNEL_LABELS } = await import('../netlify/lib/ghl.mjs')

// Mirror of utmOf's output for one attribution record, so the cases below read
// as the CRM sends them.
const u = (a = {}, tagged = true) => ({
  source: a.utmSessionSource || a.sessionSource || a.utmSource || null, medium: a.utmMedium || a.medium || null,
  sessionSource: a.utmSessionSource || a.sessionSource || null, utmSource: a.utmSource || null, referrer: a.referrer ?? null,
  url: a.url || null, tagged,
})
const cases = [
  [{ sessionSource: 'Organic search', referrer: 'https://www.google.com/' }, 'organic'],
  [{ sessionSource: 'Organic', medium: 'organic', referrer: 'https://norwestmdc.com.au' }, 'organic'],
  [{ utmSource: 'bing', medium: 'organic' }, 'organic'],
  [{ sessionSource: 'Social media', referrer: 'https://l.instagram.com/' }, 'social'],
  [{ utmSource: 'tiktok', medium: 'social' }, 'social'],
  [{ sessionSource: 'Referral', medium: 'referral', referrer: 'https://healthdirect.gov.au' }, 'referral'],
  [{ sessionSource: 'Direct traffic', medium: 'form' }, 'direct'],
  [{ utmSource: '(direct)', medium: '(none)' }, 'direct'],
  [{ sessionSource: 'Email', utmSource: 'newsletter' }, 'email'],
  [{ sessionSource: 'SMS' }, 'email'],
  [{ sessionSource: 'CRM UI', medium: 'manual' }, 'crm'],
  [{ sessionSource: 'Third party', medium: 'integration' }, 'crm'],
  [{ medium: 'import' }, 'crm'],
  [{ sessionSource: 'Chat widget' }, 'crm'],
  // No label: the referrer host decides.
  [{ referrer: 'https://duckduckgo.com/?q=physio' }, 'organic'],
  [{ referrer: 'https://www.facebook.com/' }, 'social'],
  [{ referrer: 'https://healthdirect.gov.au/x' }, 'referral'],
  [{ referrer: 'https://norwestmdc.com.au/blog', url: 'https://www.norwestmdc.com.au/book' }, 'direct'],
  [{ referrer: '', url: 'https://norwestmdc.com.au/book' }, 'direct'],
  // A label that means nothing to us stays unknown rather than reading as direct.
  [{ sessionSource: 'Other' }, 'unknown'],
  [{}, 'unknown'],
]
for (const [a, want] of cases) assert.equal(subChannelOf(u(a)), want, JSON.stringify(a))
assert.equal(subChannelOf(u({ sessionSource: 'Referral' }, false)), 'unknown', 'no attribution record at all')
assert.equal(subChannelOf(null), 'unknown')
// Every bucket the drill can emit has a label the hover can show.
for (const k of SUB_CHANNELS) assert.ok(SUB_CHANNEL_LABELS[k], k)
assert.ok(SUB_CHANNELS.includes('unknown'))
console.log('subchannel_test ok:', cases.length, 'cases')
