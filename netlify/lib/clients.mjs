// The built-in client registry: today's Caalano Digital accounts, keyed by the
// client id used everywhere (URLs, settings sections, Blob keys). The functions
// merge Settings -> Clients (custom accounts, deletions) over this at request
// time; the Blobs-to-Postgres migration reads it to create one workspace per
// client. Ad account ids are Windsor account ids; ghl is the CRM location id.
import { DEMO_CLIENT_ID, DEMO_LOCATION, DEMO_META_ACCT, DEMO_GOOGLE_ACCT, DEMO_GA4_PROP } from './demo.mjs'

export const BUILTIN_CLIENTS = {
  // Demo account - no real integrations behind it; every response is generated.
  // Registered like any other client so it flows through the same access control,
  // caching and scope handling as the rest.
  [DEMO_CLIENT_ID]: { meta: DEMO_META_ACCT, google: DEMO_GOOGLE_ACCT, ghl: DEMO_LOCATION, ga4: DEMO_GA4_PROP, name: 'Norwest Multi-Disciplinary', demo: true },
  'ablycalm':        { meta: '2531025873751747', google: null, ghl: 'KQtHuOcsMrdrADDBl7vD' },
  'finr-advisory':   { meta: '562656435170426',  google: null, ghl: 'A2lu96mobIYMdB9gcHte' },
  'nexia-health':    { meta: '538799668712983',  google: '774-276-3045', ghl: 'rQJAY6L6qt1JJfj16fZ8' },
  'pool-haus':       { meta: '722206724104428',  google: '881-120-8709', ghl: 'bKfWIXrhM5jei4QV5KXs' },
  'healan-centre':   { meta: '1332047794857601', google: '709-021-2791', ghl: 'wjqXt6asni9BYa2UxdrE' },
  'simchat':         { meta: '3329764523983981', google: '224-672-0300', ghl: 'DuAQ1SCknvlMWBV0M3YZ' },
  'swift-emergency': { meta: '1080637839761918', google: '388-494-0021', ghl: 'o7egUI0G0Zg7fUOiYqv1' },
  'ido-ido':         { meta: '1446200046468733', google: null, ghl: '6SmZLew5uXimr99jbuId' },
  'owl-psa':         { meta: '24559773240339868', google: null, ghl: '6hgW5WnFz8drlch9qJzg' },
  'psychology-hub':  { meta: '1849212035791025', google: '607-821-6945', ghl: 'U1Q0S61tIEvrzM4hdZSV' },
  'a2z':             { meta: '3872288763038641', google: null, ghl: 'cwJOi5EYLe2AzYjHmOWk' },
  'book-a-midwife':  { meta: '1234556101481974', google: null, ghl: null },
  'rlm-telehealth':  { meta: '1179972323913025', google: null, ghl: 'jZxjJ53Xz6JW2Cgn7Fv7' },
}
