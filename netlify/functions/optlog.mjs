// Fetch a client's Optimisation Log Google Sheet live and return it as JSON.
// The sheet must be shared "Anyone with the link → Viewer" (or published to web).
// We only ever build a docs.google.com URL from a validated spreadsheet id + gid,
// so this endpoint can't be pointed at an arbitrary host (no SSRF surface).
import { requireSession } from '../lib/auth.mjs'
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

// Minimal RFC-4180 CSV parser: handles quoted fields, escaped quotes ("") and
// commas / newlines inside quoted cells.
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c === '\r') { /* ignore CR */ }
    else cell += c
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row) }
  return rows
}

// The demo account's change log. It has no sheet behind it; the seeded link
// carries a "demo-" id and the entries are generated here in the same shape a
// real sheet comes back in - a date, a platform, what was changed, where, and a
// note initialled by whoever did it - dated relative to today so they always
// sit inside the period being looked at.
function demoLog() {
  const d = (daysAgo) => { const t = new Date(Date.now() - daysAgo * 86400000); return `${t.getDate()}/${t.getMonth() + 1}/${t.getFullYear()}` }
  const rows = [
    [2, 'Meta', 'Budget', 'NW_Physio_Leads_Hills', 'A - Lifted daily budget 20% after CPL held under $45 for a fortnight.'],
    [4, 'Google', 'Keyword', 'Physio - Exact', 'J - Added "physio norwest business park" as exact; paused "physio near me open now" (no conversions in 30 days).'],
    [6, 'Meta', 'Creative', 'NW_Retarget_SiteVisitors_30d', 'U - Swapped the back-pain static for the reel; frequency was 4.1x.'],
    [9, 'Google', 'Bid', 'Psychologist - Exact', 'J - Moved to Maximise conversions with a $60 tCPA.'],
    [12, 'Meta', 'Audience', 'NW_Lookalike_Patients_3pc', 'A - Refreshed the seed list from the last 90 days of attended patients.'],
    [15, 'Google', 'Negative', 'Back Pain - Phrase', 'J - Negatives: "exercises", "youtube", "free". Search terms were eating 18% of spend.'],
    [19, 'Meta', 'Landing page', 'NW_Psych_Intake', 'U - Lead form now asks "Do you have a referral?" up front; expect fewer, better leads.'],
    [23, 'Google', 'Extension', 'All campaigns', 'A - Call extension set to the tracking number; call-only hours 8am to 6pm.'],
    [27, 'Meta', 'Budget', 'NW_Chiro_Leads', 'U - Cut budget 30%; chiro CPL running 2x physio. Review in two weeks.'],
    [33, 'Google', 'Structure', 'Chiro - Exact', 'J - Split chiro out of the physio campaign so it can carry its own tCPA.'],
    [38, 'Meta', 'Creative', 'NW_Physio_Leads_Hills', 'A - Launched three new hooks: desk pain, weekend sport, post-op rehab.'],
    [45, 'Google', 'Budget', 'NW_Search_Physio_Norwest', 'J - Budget +15% after impression share lost to budget hit 31%.'],
  ]
  const columns = ['Date', 'Platform', 'Optimisation type', 'Campaign / Ad set', 'Notes']
  return { ok: true, columns, rows: rows.map(([ago, p, t, c, n]) => ({ Date: d(ago), Platform: p, 'Optimisation type': t, 'Campaign / Ad set': c, Notes: n })), fetchedAt: new Date().toISOString() }
}

export default async (req) => {
  // Makes an outbound fetch to Google Sheets on the caller’s say-so.
  const deny = await requireSession(req); if (deny) return deny
  try {
    const u = new URL(req.url)
    const id = (u.searchParams.get('id') || '').trim()
    const gid = (u.searchParams.get('gid') || '0').trim()
    if (/^demo-[a-z0-9-]{16,}$/.test(id)) return json(demoLog())
    if (!/^[a-zA-Z0-9\-_]{20,}$/.test(id)) return json({ ok: false, error: 'Invalid or missing sheet id.' }, 400)
    if (!/^\d+$/.test(gid)) return json({ ok: false, error: 'Invalid gid.' }, 400)
    // gviz CSV export works for link-shared sheets without an OAuth token.
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`
    const r = await fetch(url, { redirect: 'follow' })
    const text = await r.text()
    // Google serves an HTML sign-in / error page (not CSV) when the sheet isn't
    // viewable by link - detect that so we can give a clear instruction.
    if (!r.ok || /^\s*</.test(text) || /accounts\.google\.com|google-site-verification/i.test(text.slice(0, 600))) {
      return json({ ok: false, error: 'Could not read this sheet. In Google Sheets: Share → General access → Anyone with the link → Viewer, then try again.' }, 403)
    }
    const matrix = parseCsv(text).filter((r2) => r2.some((c) => String(c).trim() !== ''))
    if (!matrix.length) return json({ ok: true, columns: [], rows: [], fetchedAt: new Date().toISOString() })
    const columns = matrix[0].map((c, i) => String(c).trim() || `Column ${i + 1}`)
    const rows = matrix.slice(1).map((r2) => {
      const o = {}; columns.forEach((c, i) => { o[c] = r2[i] != null ? String(r2[i]).trim() : '' }); return o
    })
    return json({ ok: true, columns, rows, fetchedAt: new Date().toISOString() })
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500)
  }
}
