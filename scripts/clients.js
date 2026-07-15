// Client registry — the 13 active clients from the lead-pipeline-analysis roster.
// Single source of truth the refresh pipeline iterates over. Account IDs come
// from Reporting Ninja `list_connections`. `ghlLocationId` is reserved for when
// an agency-level GoHighLevel token is added, to pull per-client CRM data.
//
// Connection keys:
//   meta:   "mumesh72@gmail.com" or "Alex Serrano (9100303526651742)"
//   google: "alex@caalanodigital.com.au"
//
// trackingStatus: full | wins_no_value | intelligence_only | no_outcome_tracking

export const META_CONN = 'mumesh72@gmail.com'
export const META_CONN_ALT = 'Alex Serrano (9100303526651742)'
export const GOOGLE_CONN = 'alex@caalanodigital.com.au'

export const clients = [
  { id: 'ablycalm',        name: 'ablycalm',            vertical: 'ADHD telehealth assessments',        meta: { conn: META_CONN,     id: '2531025873751747' }, google: null,                                              trackingStatus: 'full' },
  { id: 'finr-advisory',   name: 'Finr Advisory',       vertical: 'Mortgage broking + buyers advocacy', meta: { conn: META_CONN,     id: '562656435170426' },  google: null,                                              trackingStatus: 'full' },
  { id: 'nexia-health',    name: 'Nexia Health Care',   vertical: 'ADHD + Allied Health',               meta: { conn: META_CONN,     id: '538799668712983' },  google: { conn: GOOGLE_CONN, id: '7742763045' },           trackingStatus: 'full' },
  { id: 'pool-haus',       name: 'Pool Haus',           vertical: 'Pool builder (trades)',              meta: { conn: META_CONN,     id: '722206724104428' },  google: { conn: GOOGLE_CONN, id: '8811208709' },           trackingStatus: 'full' },
  { id: 'healan-centre',   name: 'Healan Centre',       vertical: 'ADHD/autism assessments',            meta: { conn: META_CONN,     id: '1332047794857601' }, google: { conn: GOOGLE_CONN, id: '7090212791' },           trackingStatus: 'full' },
  { id: 'simchat',         name: 'Simchat',             vertical: 'ADHD/ASD clinic',                    meta: { conn: META_CONN,     id: '3329764523983981' }, google: { conn: GOOGLE_CONN, id: '2246720300' },           trackingStatus: 'full' },
  { id: 'swift-emergency', name: 'Swift Emergency',     vertical: 'Urgent care / infusion',             meta: { conn: META_CONN,     id: '1080637839761918' }, google: { conn: GOOGLE_CONN, id: '3884940021' },           trackingStatus: 'full' },
  { id: 'ido-ido',         name: 'IDO IDO',             vertical: 'Stationery / wedding invitations',   meta: { conn: META_CONN_ALT, id: '1446200046468733' }, google: null,                                             trackingStatus: 'full' },
  { id: 'owl-psa',         name: 'Owl PSA',             vertical: 'Health / psychosocial assessments',  meta: { conn: META_CONN,     id: '24559773240339868' }, google: null,                                            trackingStatus: 'full' },
  { id: 'psychology-hub',  name: 'The Psychology Hub',  vertical: 'Psychology assessments',             meta: { conn: META_CONN,     id: '1849212035791025' }, google: { conn: GOOGLE_CONN, id: '6078216945' },           trackingStatus: 'wins_no_value' },
  { id: 'a2z',             name: 'A2Z',                 vertical: 'Wedding video / photography',         meta: { conn: META_CONN,     id: '3872288763038641' }, google: null,                                              trackingStatus: 'intelligence_only' },
  { id: 'book-a-midwife',  name: 'Book a Midwife',      vertical: 'Midwife consults',                   meta: { conn: META_CONN_ALT, id: '1234556101481974' }, google: null,                                             trackingStatus: 'no_outcome_tracking' },
  { id: 'rlm-telehealth',  name: 'RLM Telehealth',      vertical: 'Menopause / metabolic telehealth',   meta: { conn: META_CONN,     id: '1179972323913025' }, google: null,                                              trackingStatus: 'no_outcome_tracking' },
]
