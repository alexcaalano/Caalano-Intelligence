// Client registry — maps each Caalano client to their platform account IDs.
// This is the single source of truth the refresh pipeline iterates over.
// To onboard a new client, add a row here (account IDs come from
// Reporting Ninja `list_connections`). `ghlLocationId` is reserved for when an
// agency-level GHL API token is added, letting us pull per-client CRM data.
//
// Connection keys (from list_connections):
//   meta:   "mumesh72@gmail.com" (69 accts) or "Alex Serrano (9100303526651742)" (58 accts)
//   google: "alex@caalanodigital.com.au"
//   ga4:    "marketing@caalanodigital.com.au"

export const META_CONN = 'mumesh72@gmail.com'
export const META_CONN_ALT = 'Alex Serrano (9100303526651742)'
export const GOOGLE_CONN = 'alex@caalanodigital.com.au'
export const GA4_CONN = 'marketing@caalanodigital.com.au'

export const clients = [
  {
    id: 'healan-centre',
    name: 'Healan Centre',
    industry: 'Healthcare',
    meta: '1332047794857601',
    google: '7090212791',
    ga4: 'properties/446540673',
    ghlLocationId: null,
  },
  {
    id: 'hustle-house-prints',
    name: 'Hustle House Prints',
    industry: 'E-commerce',
    meta: '694085275530212',
    google: '6532006660',
    ga4: 'properties/350433038',
    ghlLocationId: null,
  },
  {
    id: 'pool-haus',
    name: 'Pool Haus',
    industry: 'Home & Trade',
    meta: '722206724104428',
    google: '8811208709',
    ga4: null,
    ghlLocationId: null,
  },
  {
    id: 'scuba-beer',
    name: 'Scuba Beer',
    industry: 'E-commerce',
    meta: '2233938090242230',
    google: '6823983388',
    ga4: null,
    ghlLocationId: null,
  },
  {
    id: 'nexia-health',
    name: 'Nexia Health Care',
    industry: 'Healthcare',
    meta: '538799668712983',
    google: '7742763045',
    ga4: null,
    ghlLocationId: null,
  },
  {
    id: 'psychology-hub',
    name: 'The Psychology Hub',
    industry: 'Healthcare',
    meta: '1849212035791025',
    google: '6078216945',
    ga4: null,
    ghlLocationId: null,
  },
  {
    id: 'rugby-dc',
    name: 'Rugby Development Coach',
    industry: 'Sport & Education',
    meta: '559062384635517',
    google: '1219407448',
    ga4: 'properties/310741796',
    ghlLocationId: null,
  },
  {
    id: 'idental',
    name: 'iDental',
    industry: 'Healthcare',
    meta: '1118012539159307',
    google: '7157355667',
    ga4: null,
    ghlLocationId: null,
  },
  {
    id: 'simchat',
    name: 'Simchat Health Centre',
    industry: 'Healthcare',
    meta: '3329764523983981',
    google: '2246720300',
    ga4: 'properties/457215254',
    ghlLocationId: null,
  },
  {
    id: 'combined-demolition',
    name: 'Combined Demolition Services',
    industry: 'Home & Trade',
    meta: null,
    google: '5813571037',
    ga4: 'properties/439931299',
    ghlLocationId: null,
  },
  {
    id: 'caalano-systems',
    name: 'Caalano Systems',
    industry: 'Agency (internal)',
    meta: '1096287804632611',
    google: '9456090666',
    ga4: 'properties/454898177',
    ghlLocationId: null,
  },
  {
    id: 'caalano-digital',
    name: 'Caalano Digital',
    industry: 'Agency (internal)',
    meta: '1893184807550187',
    google: '3531265660',
    ga4: 'properties/316323266',
    ghlLocationId: null,
  },
]
