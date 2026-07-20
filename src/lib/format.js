// Formatting + metric helpers shared across the dashboard.

export const fmtCurrency = (n, currency = 'AUD') =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n || 0)

export const fmtNumber = (n) =>
  new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(n || 0)

export const fmtCompact = (n) =>
  new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0)

export const fmtPct = (n, digits = 1) =>
  `${(n || 0).toFixed(digits)}%`

export const pctChange = (cur, prev) => {
  if (!prev) return cur ? 100 : 0
  return ((cur - prev) / prev) * 100
}

// A client's combined (Meta + Google) totals for a given side ("cur" | "prev").
export function clientTotals(client) {
  // meta/google are the baked metrics OBJECTS on snapshot clients, but only the
  // account-id string on UI-added clients (which have no baked snapshot) - guard
  // so a string never gets treated as metrics.
  const m = client.meta && typeof client.meta === 'object' ? client.meta : null
  const g = client.google && typeof client.google === 'object' ? client.google : null
  const n = (v) => (typeof v === 'number' ? v : 0)
  const cur = { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
  const prev = { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
  if (m) {
    cur.spend += n(m.spend); cur.impressions += n(m.impressions); cur.clicks += n(m.clicks); cur.conversions += n(m.leads)
    if (m.prev) { prev.spend += n(m.prev.spend); prev.impressions += n(m.prev.impressions); prev.clicks += n(m.prev.clicks); prev.conversions += n(m.prev.leads) }
  }
  if (g) {
    cur.spend += n(g.cost); cur.impressions += n(g.impressions); cur.clicks += n(g.clicks); cur.conversions += n(g.conversions)
    if (g.prev) { prev.spend += n(g.prev.cost); prev.impressions += n(g.prev.impressions); prev.clicks += n(g.prev.clicks); prev.conversions += n(g.prev.conversions) }
  }
  cur.cpl = cur.conversions ? cur.spend / cur.conversions : 0
  prev.cpl = prev.conversions ? prev.spend / prev.conversions : 0
  cur.ctr = cur.impressions ? (cur.clicks / cur.impressions) * 100 : 0
  prev.ctr = prev.impressions ? (prev.clicks / prev.impressions) * 100 : 0
  return { cur, prev }
}

// Agency-wide roll-up across all clients.
export function agencyTotals(clients) {
  const acc = {
    cur: { spend: 0, impressions: 0, clicks: 0, conversions: 0, metaSpend: 0, googleSpend: 0 },
    prev: { spend: 0, impressions: 0, clicks: 0, conversions: 0, metaSpend: 0, googleSpend: 0 },
  }
  for (const c of clients) {
    const { cur, prev } = clientTotals(c)
    for (const k of ['spend', 'impressions', 'clicks', 'conversions']) {
      acc.cur[k] += cur[k]; acc.prev[k] += prev[k]
    }
    if (c.meta) { acc.cur.metaSpend += c.meta.spend; acc.prev.metaSpend += c.meta.prev.spend }
    if (c.google) { acc.cur.googleSpend += c.google.cost; acc.prev.googleSpend += c.google.prev.cost }
  }
  for (const side of ['cur', 'prev']) {
    acc[side].cpl = acc[side].conversions ? acc[side].spend / acc[side].conversions : 0
    acc[side].ctr = acc[side].impressions ? (acc[side].clicks / acc[side].impressions) * 100 : 0
  }
  return acc
}
