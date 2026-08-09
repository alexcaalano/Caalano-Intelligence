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

