// Sales Hub, Goals and Deals & Actions. Carved out of App.jsx so it loads on first open; the
// helpers it shares with the rest of the app are imported from there.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { GOALS_KEY, REPKPI_KEY, SETTINGS, Spinner, WON_RE, bumpSettings, fmtDMY, hoursQuery, isAdminishFE, isClientRoleFE, loadCashOn, loadHours, loadKeyEvents, mergeCalKeyEvents, normKeyEvents, presetRange, rangeQuery, saveSettingsRemote, tzTodayStr, usePipeState, useSettingsSync, writeLS } from '../App.jsx'
import { fmtCurrency, fmtNumber } from '../lib/format.js'
import { GOAL_METRICS, RATE_METRICS, SPLITS, goalActual, goalLevel, goalMetric, goalShares, goalTargetFor, goalWindow, migrateRepKpis, monthKeysFrom, newGoalId, normGoals, quarterKeysFrom, repTargetsFromGoals, repValue, validateGoal } from '../lib/goals.js'

// ---- Sales Hub: the manager's view --------------------------------------------
// One tab for whoever runs the team: the month against the summed rep targets,
// the rep board with attainment and a status chip, the leaderboard and the wins
// feed (with a celebration when a new one lands), the pipeline by stage and who
// is sitting on stuck deals, appointments per calendar per rep, speed to lead
// per rep, lost reasons per rep, and coaching flags that say who needs help and
// on what. TV mode is the same data full screen for a wall. Reads one scope,
// built from the same code as Users, Timing, Appointments and Call Reporting.
export const HUB_PERIODS = [['this_month', 'This month'], ['last_month', 'Last month'], ['last_7d', 'Last 7 days'], ['last_30d', 'Last 30 days'], ['last_90d', 'Last 90 days']]
export const HUB_PREFS_KEY = 'caalano_hub_prefs'
// Sounds each have their own switch (gong on a win, lead, booking); the win
// animation itself always plays. An older single 'activity' switch carries
// over to both the lead and booking sounds.
export const HUB_PREFS_DEFAULT = { confetti: true, sound: true, leadSound: true, bookSound: true }
export function hubPrefs() {
  try { const v = JSON.parse(localStorage.getItem(HUB_PREFS_KEY) || '{}'); const p = { ...HUB_PREFS_DEFAULT, ...v }; if (v.activity === false) { if (v.leadSound == null) p.leadSound = false; if (v.bookSound == null) p.bookSound = false } delete p.activity; return p } catch { return { ...HUB_PREFS_DEFAULT } }
}
export function saveHubPrefs(p) { try { localStorage.setItem(HUB_PREFS_KEY, JSON.stringify(p)) } catch { /* private mode */ } }
// A short rising chime from the browser's own synth: no file, no download.
// The gong. A real recording wins if the site ships one at /gong.mp3 (drop
// it in public/); otherwise the crash is synthesised: broadband noise through
// a bank of resonant filters for the wash, forty detuned inharmonic partials
// that bloom just after the hit for the metal, and a low thump for the mallet.
export let hubGongFile = null // null = not checked yet, true = plays, false = missing
export let hubGongAudio = null
// Fetch the recording once when the hub opens so the first strike is not late.
export function hubGongPreload() {
  if (hubGongAudio || hubGongFile === false) return
  try { hubGongAudio = new Audio('/gong.mp3'); hubGongAudio.preload = 'auto'; hubGongAudio.load() } catch { hubGongFile = false }
}
export function hubChime() {
  if (hubGongFile === false) return hubGongSynth()
  try {
    hubGongPreload(); const a = hubGongAudio; a.currentTime = 0; a.volume = 1
    a.play().then(() => { hubGongFile = true }).catch(() => { hubGongFile = false; hubGongSynth() })
  } catch { hubGongFile = false; hubGongSynth() }
}
export function hubGongSynth() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return
    const ac = new AC(); const t0 = ac.currentTime
    const master = ac.createGain(); master.gain.value = 0.4
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.4
    master.connect(comp); comp.connect(ac.destination)
    // 1. The crash: noise through resonant bands. Hits hard, dips, swells back
    //    (the gong's "waaah") and washes out over three seconds.
    const N = 3.6
    const nb = ac.createBuffer(1, Math.floor(ac.sampleRate * N), ac.sampleRate); const nd = nb.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
    const src = ac.createBufferSource(); src.buffer = nb
    const wash = ac.createGain()
    wash.gain.setValueAtTime(0.0001, t0); wash.gain.exponentialRampToValueAtTime(1, t0 + 0.012); wash.gain.exponentialRampToValueAtTime(0.45, t0 + 0.14); wash.gain.exponentialRampToValueAtTime(0.75, t0 + 0.4); wash.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.4)
    for (const [f, q, g] of [[600, 2, 0.5], [1300, 2.5, 0.6], [2400, 3, 0.6], [3900, 3, 0.5], [6200, 2.5, 0.35], [9000, 2, 0.2]]) {
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q
      const gg = ac.createGain(); gg.gain.value = g; src.connect(bp); bp.connect(gg); gg.connect(wash)
    }
    wash.connect(master); src.start(t0); src.stop(t0 + N)
    // 2. The metal: inharmonic partials in detuned pairs so they beat and
    //    shimmer. The lows ring longest; the highs bloom in after the hit.
    const base = 130; let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let i = 0; i < 40; i++) {
      const r = 1 + i * 0.42 + rnd() * 0.35; const f = base * r; if (f > 9000) break
      const lvl = (0.32 / Math.pow(r, 0.55)) * (0.7 + rnd() * 0.6)
      const dec = Math.max(1.2, 6.5 / Math.pow(r, 0.45))
      const bloom = i > 4 ? 0.05 + rnd() * 0.3 : 0.006
      for (const det of [-4, 4]) {
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = det + (rnd() - 0.5) * 6
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(lvl, t0 + bloom); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec)
        o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dec + 0.1)
      }
    }
    // 3. The body: the mallet's thump, a short low sweep.
    const th = ac.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(140, t0); th.frequency.exponentialRampToValueAtTime(55, t0 + 0.25)
    const tg = ac.createGain(); tg.gain.setValueAtTime(0.0001, t0); tg.gain.exponentialRampToValueAtTime(0.9, t0 + 0.006); tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4)
    th.connect(tg); tg.connect(master); th.start(t0); th.stop(t0 + 0.45)
    setTimeout(() => { try { ac.close() } catch { /* ignore */ } }, 7500)
  } catch { /* no audio */ }
}
// Activity cues for the TV: short synthesised sounds, well under the gong,
// for a new lead (a bright two-note ding) and a booked appointment (a rising
// three-note chime). Nothing takes over the screen; a small chip in the corner
// says what happened and fades. One shared audio context, resumed on use.
export let _hubAC = null
export function hubAC() {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null
  if (!_hubAC || _hubAC.state === 'closed') _hubAC = new AC()
  if (_hubAC.state === 'suspended') _hubAC.resume().catch(() => {})
  return _hubAC
}
export function hubPing(kind) {
  try {
    const ac = hubAC(); if (!ac) return
    const t0 = ac.currentTime + 0.02
    const master = ac.createGain(); master.gain.value = 0.22; master.connect(ac.destination)
    const notes = kind === 'booked' ? [[523.25, 0], [659.25, 0.11], [783.99, 0.22]] : [[880, 0], [1318.5, 0.09]]
    const tail = kind === 'booked' ? 0.5 : 0.7
    for (const [f, dt] of notes) {
      for (const [type, mul, lvl] of [['sine', 1, 1], ['triangle', 2, 0.25]]) {
        const o = ac.createOscillator(); o.type = type; o.frequency.value = f * mul
        const g = ac.createGain(); const t = t0 + dt
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(lvl, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + tail)
        o.connect(g); g.connect(master); o.start(t); o.stop(t + tail + 0.1)
      }
    }
  } catch { /* no audio */ }
}
// The gong strike on screen: mallet swings in, the gong shudders and rings
// out in shock waves, then the rep's name and the deal value land.
export const HUB_GONG_HIT_MS = 450
export function HubGong({ win, currency, onDone }) {
  if (!win) return null
  return (
    <div className="hub-gong" role="status" onClick={onDone}>
      <div className="hub-gong-stage">
        <svg className="hub-gong-svg" viewBox="0 0 400 400" aria-hidden="true">
          <defs>
            <radialGradient id="hubGongFace" cx="42%" cy="38%" r="65%"><stop offset="0" stopColor="#ffe9a3" /><stop offset="0.35" stopColor="#e6b84a" /><stop offset="0.75" stopColor="#a8741c" /><stop offset="1" stopColor="#6b4610" /></radialGradient>
            <radialGradient id="hubGongBoss" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#fff4c8" /><stop offset="0.6" stopColor="#d9a63a" /><stop offset="1" stopColor="#8a5d16" /></radialGradient>
            <radialGradient id="hubGongGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#fff8dc" stopOpacity="1" /><stop offset="0.45" stopColor="#ffe08a" stopOpacity="0.55" /><stop offset="1" stopColor="#ffd166" stopOpacity="0" /></radialGradient>
          </defs>
          <g className="hub-gong-frame"><rect x="40" y="22" width="320" height="10" rx="5" fill="#3a2a12" /><rect x="52" y="22" width="10" height="360" rx="5" fill="#3a2a12" /><rect x="338" y="22" width="10" height="360" rx="5" fill="#3a2a12" /><line x1="150" y1="32" x2="165" y2="78" stroke="#8b6a2c" strokeWidth="3" /><line x1="250" y1="32" x2="235" y2="78" stroke="#8b6a2c" strokeWidth="3" /></g>
          <g className="hub-gong-rings"><circle className="hub-gong-ring" cx="200" cy="215" r="130" /><circle className="hub-gong-ring r2" cx="200" cy="215" r="130" /><circle className="hub-gong-ring r3" cx="200" cy="215" r="130" /><circle className="hub-gong-ring r4" cx="200" cy="215" r="130" /></g>
          <circle className="hub-gong-flash" cx="200" cy="215" r="170" fill="url(#hubGongGlow)" />
          <g className="hub-gong-disc">
            <circle cx="200" cy="215" r="132" fill="url(#hubGongFace)" stroke="#5a3b0c" strokeWidth="4" />
            <circle cx="200" cy="215" r="112" fill="none" stroke="#7d5717" strokeWidth="2" opacity="0.6" />
            <circle cx="200" cy="215" r="86" fill="none" stroke="#7d5717" strokeWidth="2" opacity="0.5" />
            <circle cx="200" cy="215" r="60" fill="none" stroke="#7d5717" strokeWidth="2" opacity="0.4" />
            <circle cx="200" cy="215" r="30" fill="url(#hubGongBoss)" stroke="#6b4610" strokeWidth="3" />
          </g>
          <g className="hub-gong-mallet"><line x1="330" y1="330" x2="205" y2="222" stroke="#5a3b0c" strokeWidth="9" strokeLinecap="round" /><circle cx="205" cy="222" r="22" fill="#2b1d0b" stroke="#141414" strokeWidth="3" /></g>
        </svg>
        <div className="hub-gong-text">
          <div className="hub-gong-kicker">Deal closed</div>
          <div className="hub-gong-rep">{win.user || 'Someone'}</div>
          {win.value ? <div className="hub-gong-value">{fmtCurrency(win.value, currency)}</div> : null}
          <div className="hub-gong-deal">{win.name}</div>
        </div>
      </div>
    </div>
  )
}
// Confetti on a canvas over the page, two seconds, then gone.
export function hubConfetti() {
  try {
    const c = document.createElement('canvas'); c.className = 'hub-confetti'; c.width = window.innerWidth; c.height = window.innerHeight; document.body.appendChild(c)
    const ctx = c.getContext('2d'); const cols = ['#6c5ce7', '#17b26a', '#f0435b', '#d4a017', '#1f4fbf', '#ff8c42']
    const bits = Array.from({ length: 160 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.4, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, col: cols[Math.floor(Math.random() * cols.length)] }))
    const t0 = performance.now()
    const tick = (t) => {
      ctx.clearRect(0, 0, c.width, c.height)
      for (const b of bits) { b.x += b.vx; b.y += b.vy; b.r += b.vr; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.col; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore() }
      if (t - t0 < 2600) requestAnimationFrame(tick); else c.remove()
    }
    requestAnimationFrame(tick)
  } catch { /* ignore */ }
}
export const hubPct = (v) => (v == null ? '-' : `${v}%`)
export function HubStat({ label, value, sub, tone, big }) {
  return <div className={`hub-stat ${tone || ''} ${big ? 'big' : ''}`}><div className="hub-stat-l">{label}</div><div className="hub-stat-v">{value}</div>{sub ? <div className="hub-stat-s">{sub}</div> : null}</div>
}
// Attainment against the summed rep targets for the month.
// A half-circle dial: the arc fills with attainment, a tick marks where pace
// says it should be today, the number in the middle is the percentage.
export function HubDial({ label, sub, actual, target, fmt, kind = 'count', elapsed, monthly, onClick, open, paced = true }) {
  const a = actual || 0
  const lower = kind === 'lower', rate = kind === 'pct', level = !paced && !rate && !lower // an average: judged against the target itself, never on pace
  const ratio = lower ? (actual == null ? 0 : Math.min(1, target / Math.max(a, 0.01))) : Math.min(1, a / target)
  const need = (rate || lower || level) ? target : target * (monthly ? elapsed : 1)
  const tone = actual == null && (rate || lower || level) ? '' : lower ? (a <= target ? 'good' : a <= target * 1.5 ? 'warn' : 'bad') : a >= need ? 'good' : a >= need * 0.8 ? 'warn' : 'bad'
  const toGo = lower ? (actual == null ? 'not measured yet' : a <= target ? 'Inside target 🎯' : `${repMin(a - target)} over`) : level ? (actual == null ? 'nothing won yet' : a >= target ? 'On target 🎯' : `${fmt(target - a)} under`) : rate ? (actual == null ? 'nothing to rate yet' : a >= target ? 'On target 🎯' : `${Math.round(target - a)} points short`) : (a >= target ? 'Target hit 🎯' : `${fmt(target - a)} to go`)
  const R = 54, C = Math.PI * R, cx = 64, cy = 70
  const th = Math.PI * (1 - (monthly ? elapsed : 1)); const px = cx + Math.cos(th), py = cy - Math.sin(th)
  const p1 = [cx + (R - 9) * Math.cos(th), cy - (R - 9) * Math.sin(th)], p2 = [cx + (R + 9) * Math.cos(th), cy - (R + 9) * Math.sin(th)]
  void px; void py
  return (
    <button type="button" className={`hub-dial ${tone} ${open ? 'open' : ''}`} onClick={onClick} title="Tap for the split by rep">
      <svg viewBox="0 0 128 82" aria-hidden="true">
        <path className="hub-dial-bg" d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} />
        <path className="hub-dial-fg" d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} style={{ strokeDasharray: C, strokeDashoffset: C * (1 - ratio) }} />
        {monthly && !rate && !lower && !level ? <line className="hub-dial-pace" x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} /> : null}
        <text className="hub-dial-pct" x={cx} y={cy - 4}>{Math.round(ratio * 100)}%</text>
      </svg>
      <div className="hub-dial-l">{label}{sub ? <span className="hub-dial-sub">{sub}</span> : null}</div>
      <div className="hub-dial-v">{actual == null ? '-' : fmt(a)} <small>/ {fmt(target)}</small></div>
      <div className="hub-dial-s">{toGo}</div>
    </button>
  )
}
// The hub's funnels chart the client's key-event stages (Settings -> Key
// events), the same forward steps the Caalano360 tab uses, so side branches
// such as "No show" or "Disqualified" are not read as steps everyone passed
// through. Stage order follows the pipeline; the won stage is left out. A
// client with no key events set gets every stage, as before.
export function hubFunnelStages(clientId, p) {
  const all = (p && p.stages) || []
  const ke = normKeyEvents(loadKeyEvents(clientId)).filter((e) => e.kind === 'stage' && !WON_RE.test(e.label || '') && (!e.pipeline || e.pipeline === p.id))
  const wanted = new Map(ke.map((e) => [e.ref, e.label || e.ref]))
  const picked = all.filter((st) => wanted.has(st.name)).map((st) => ({ ...st, label: wanted.get(st.name) }))
  return { stages: picked.length ? picked : all.map((st) => ({ ...st, label: st.name })), keyed: picked.length > 0 }
}
// Month by month: every goal against what happened, past months and the
// current one, with the coming months' targets typed in place (the budget).
// Filter by pipeline to see that pipeline's goals; filter by rep to see each
// goal as that rep's share (an even split of $30,000 between two reps reads
// as $15,000 each) against their own figure. With no filter, an Overall
// business group adds the pipeline goals together per metric. Quarterly goals
// get a quarter grid; custom-dates goals a row each.
// Progress for a set of goals, each in its own current window: one request per
// distinct window (this month, this quarter, each range goal), through the
// same goalhistory route the Month by month board uses, so a window is one
// server-side hub build shared with the hub itself. Two requests in flight at
// a time; each answer fills in as it lands. `refresh` re-reads when it changes.
export function useGoalProgress(clientId, goals, refresh) {
  const [prog, setProg] = useState({})
  useEffect(() => {
    if (!goals.length) { setProg({}); return }
    let dead = false
    const today = tzTodayStr()
    const byKey = new Map()
    for (const g of goals) { const w = goalWindow(g, today); const key = g.period === 'range' ? `range:${g.id}` : w.key; if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(g) }
    const queue = [...byKey.keys()]
    const worker = async () => {
      while (queue.length && !dead) {
        const key = queue.shift(); const list = byKey.get(key)
        let j = null
        try {
          const r = await fetch(`/.netlify/functions/windsor?scope=goalhistory&client=${encodeURIComponent(clientId)}${hoursQuery(loadHours(clientId))}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goals: list, key }) })
          j = await r.json().catch(() => ({ error: `server ${r.status}` }))
        } catch (e) { j = { error: String((e && e.message) || e) } }
        if (dead) return
        setProg((p) => { const n = { ...p }; for (const g of list) { const w = goalWindow(g, today); const c = j && j.cells ? j.cells[g.id] : null; n[g.id] = { id: g.id, window: w, target: c ? c.target : goalTargetFor(g, w.key), actual: c ? c.actual : null, byRep: c ? c.byRep : [], notYet: !!(w.notYet || (j && j.notYet)), error: j && j.error ? j.error : null } } return n })
      }
    }
    worker(); worker()
    return () => { dead = true }
  }, [clientId, goals, refresh]) // eslint-disable-line
  return prog
}
export function HubPlanBoard({ clientId, goals, currency, canEdit, today, pipelines, reps }) {
  const [draft, setDraft] = useState(goals)
  const [dirty, setDirty] = useState(false)
  const [back, setBack] = useState(6)
  const [drill, setDrill] = useState(null)
  const [pipeF, setPipeF] = useState('all')
  const [repF, setRepF] = useState('all')
  useEffect(() => { setDraft(goals); setDirty(false) }, [goals])
  const pastMonths = useMemo(() => { const y = +today.slice(0, 4), m = +today.slice(5, 7); return Array.from({ length: back }, (_, i) => { const mm = m - 1 - (back - 1 - i); const yy = y + Math.floor(mm / 12); return `${yy}-${String(((mm % 12) + 12) % 12 + 1).padStart(2, '0')}` }) }, [today, back])
  const pastQuarters = useMemo(() => { if (!goals.some((g) => g.period === 'quarter')) return []; const n = back > 6 ? 5 : 3; const y = +today.slice(0, 4), q = Math.floor((+today.slice(5, 7) - 1) / 3); return Array.from({ length: n }, (_, i) => { const qq = q - (n - 1 - i); return `${y + Math.floor(qq / 4)}-Q${((qq % 4) + 4) % 4 + 1}` }) }, [goals, today, back])
  const [hist, setHist] = useState({ cells: {}, pending: 0, error: null })
  useEffect(() => {
    if (!goals.length) { setHist({ cells: {}, pending: 0, error: null }); return }
    let dead = false
    const keys = [...pastMonths.slice().reverse(), ...pastQuarters.slice().reverse(), ...goals.filter((g) => g.period === 'range').map((g) => `range:${g.id}`)]
    setHist({ cells: {}, pending: keys.length, error: null })
    const queue = keys.slice()
    const worker = async () => {
      while (queue.length && !dead) {
        const key = queue.shift()
        try {
          const r = await fetch(`/.netlify/functions/windsor?scope=goalhistory&client=${encodeURIComponent(clientId)}${hoursQuery(loadHours(clientId))}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goals, key }) })
          const j = await r.json().catch(() => ({ error: `server ${r.status}` }))
          if (dead) return
          setHist((h) => ({ cells: { ...h.cells, [key]: (j && j.cells) || {} }, pending: h.pending - 1, error: j && j.error ? j.error : h.error }))
        } catch (e) { if (!dead) setHist((h) => ({ ...h, pending: h.pending - 1, error: String((e && e.message) || e) })) }
      }
    }
    worker(); worker()
    return () => { dead = true }
  }, [clientId, goals, pastMonths, pastQuarters]) // eslint-disable-line
  // Names for the row labels and the filter chips: the hub's pipelines and
  // reps plus anything a goal refers to that is not in the current period.
  const pipeName = (id) => ((pipelines || []).find((p) => p.id === id) || {}).name || 'Pipeline'
  const repName = (id) => ((reps || []).find((r) => r.id === id) || {}).name || 'Former rep'
  const pipeIds = useMemo(() => { const ids = (pipelines || []).map((p) => p.id); for (const g of goals) for (const pid of (g.pipelines || [])) if (!ids.includes(pid)) ids.push(pid); return ids }, [pipelines, goals])
  const repIds = useMemo(() => { const ids = (reps || []).filter((r) => r.id !== 'unassigned').map((r) => r.id); for (const g of goals) for (const uid of (g.reps || [])) if (!ids.includes(uid)) ids.push(uid); return ids }, [reps, goals])
  const rawCell = (id, key) => { const per = hist.cells[key] || hist.cells[`range:${id}`]; return per ? per[id] || null : null }
  // The cell for a goal in a period under the current filter: the rep's own
  // share and figure when a rep is chosen, else the goal's total.
  const cellOf = (g, key) => {
    const c = rawCell(g.id, key)
    if (!c) return null
    if (repF === 'all') return c
    const b = (c.byRep || []).find((x) => x.id === repF)
    return b && b.share != null ? { target: b.share, actual: b.actual, byRep: [b] } : null
  }
  const fmtFor = (g) => { const m = goalMetric(g.metric) || []; return (v) => (v == null ? '-' : m[2] === 'money' ? fmtCurrency(v, currency) : m[2] === 'pct' ? `${Math.round(v)}%` : m[2] === 'lower' ? repMin(v) : fmtNumber(v)) }
  const kindOf = (g) => (goalMetric(g.metric) || [])[2]
  const curM = today.slice(0, 7); const curQ = goalWindow({ period: 'quarter' }, today).key
  const tone = (g, cell, key, isCurrent) => {
    if (!cell || cell.actual == null || !cell.target) return ''
    const k = kindOf(g)
    if (k === 'lower') return cell.actual <= cell.target ? 'good' : cell.actual <= cell.target * 1.5 ? 'warn' : 'bad'
    const pct = cell.actual / cell.target; const need = isCurrent && k !== 'pct' && !RATE_METRICS.has(g.metric) ? goalWindow(g, today).elapsed : 1
    return pct >= need ? 'good' : pct >= need * 0.8 ? 'warn' : 'bad'
  }
  const setTarget = (g, map, key, val) => {
    setDirty(true)
    setDraft((cur) => cur.map((x) => { if (x.id !== g.id) return x; const next = { ...(x[map] || {}) }; const n = Number(val); if (!val || !(n > 0) || n === x.target) delete next[key]; else next[key] = n; return { ...x, [map]: next } }))
  }
  // Which goals the filters keep. A rep filter keeps goals the rep has a
  // slice of; a pipeline filter keeps goals scoped to that pipeline.
  const goalShareOk = (g) => repF === 'all' || ((!g.reps || g.reps.includes(repF)) && (g.split !== 'shared' || (g.reps && g.reps.length === 1) || RATE_METRICS.has(g.metric)))
  const visible = draft.filter((g) => (pipeF === 'all' || (g.pipelines || []).includes(pipeF)) && goalShareOk(g))
  // Overall business: with no filters, the pipeline goals added up per metric
  // (money and counts only; a rate cannot be added).
  const overall = (pipeF === 'all' && repF === 'all') ? (() => {
    const byMetric = new Map()
    for (const g of visible) if (g.pipelines && g.period === 'month' && ['money', 'count'].includes(kindOf(g)) && !RATE_METRICS.has(g.metric)) { if (!byMetric.has(g.metric)) byMetric.set(g.metric, []); byMetric.get(g.metric).push(g) }
    return [...byMetric.entries()].filter(([, list]) => list.length >= 1).map(([metric, list]) => ({ id: `sum:${metric}`, synthetic: true, list, metric, name: `${(goalMetric(metric) || [])[1]} · all pipelines`, period: 'month', target: list.reduce((a, g) => a + g.target, 0), pipelines: null, reps: null, split: 'shared', byMonth: {}, byQuarter: {} }))
  })() : []
  const sumCell = (row, key) => { let t = 0, a = 0, n = 0; for (const g of row.list) { const c = rawCell(g.id, key); t += goalTargetFor(g, key); if (c && c.actual != null) { a += c.actual; n++ } } return { target: t, actual: n ? a : null } }
  const futureM = monthKeysFrom(today, 4).slice(1), futureQ = quarterKeysFrom(today, 2).slice(1)
  const monthCols = [...pastMonths, ...futureM], quarterCols = [...pastQuarters, ...futureQ]
  const mLabel = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1).toLocaleString('en-AU', { month: 'short', year: '2-digit' })
  const scopeLine = (g) => {
    if (g.synthetic) return `${g.list.length} pipeline goal${g.list.length > 1 ? 's' : ''} added up: ${g.list.map((x) => (x.pipelines || []).map(pipeName).join(', ')).join(' + ')}`
    const m = goalMetric(g.metric) || []
    const split = (g.reps && g.reps.length === 1) || ['pct', 'lower'].includes(m[2]) || RATE_METRICS.has(g.metric) ? '' : (SPLITS.find(([k]) => k === g.split) || [])[1] || ''
    return [m[1], g.pipelines ? g.pipelines.map(pipeName).join(', ') : 'All pipelines', g.reps ? g.reps.map(repName).join(', ') : 'All reps', split.toLowerCase()].filter(Boolean).join(' · ')
  }
  const groups = [['overall', 'Overall business', 'Pipeline goals added together per metric.'], ['business', 'Business and team', ''], ['pipeline', 'Pipeline', ''], ['rep', 'Rep', '']]
  const grid = (period, cols, map, isCur, label) => {
    const rows = [...(period === 'month' ? overall : []), ...visible.filter((g) => g.period === period)]
    if (!rows.length) return null
    return (
      <div className="card plan-card">
        <div className="rep-lb-head"><h4>{period === 'quarter' ? 'Quarter by quarter' : 'Month by month'}{repF !== 'all' ? <span className="cap"> · {repName(repF)}'s share of each goal</span> : pipeF !== 'all' ? <span className="cap"> · {pipeName(pipeF)}</span> : null}</h4><span className="cap">target on top, what happened underneath · green hit, amber close, red missed · the current period is judged on pace · tap a cell for the split by rep</span>{period === 'month' ? <label className="act-sel">Back<select value={back} onChange={(e) => setBack(Number(e.target.value))}><option value={6}>6 months</option><option value={12}>12 months</option></select></label> : null}</div>
        <div className="table-wrap"><table className="mini-tbl plan-tbl">
          <thead><tr><th className="lft">Goal</th>{cols.map((k) => <th key={k} className={k === isCur ? 'cur' : k > isCur ? 'fut' : ''}>{label(k)}</th>)}<th>Hit</th></tr></thead>
          <tbody>{groups.map(([lvl, title, hint]) => { const list = rows.filter((g) => (lvl === 'overall' ? g.synthetic : !g.synthetic && goalLevel(g) === lvl)); return list.length ? [<tr key={lvl + '-h'} className="plan-grp"><td colSpan={cols.length + 2}>{title}{hint ? <span className="cap"> · {hint}</span> : null}</td></tr>, ...list.map((g) => { const f = fmtFor(g); const editable = canEdit && !g.synthetic && repF === 'all'; let hit = 0, n = 0; return (
            <tr key={g.id}><td className="lft"><b>{g.name || (goalMetric(g.metric) || [])[1]}</b><div className="cap">{scopeLine(g)}</div></td>
              {cols.map((k) => { const cell = g.synthetic ? sumCell(g, k) : cellOf(g, k); const target = g.synthetic ? cell.target : repF !== 'all' ? (cell ? cell.target : null) : goalTargetFor(g, k); const t = k < isCur && cell && cell.actual != null ? tone(g, cell, k, false) : k === isCur ? tone(g, cell, k, true) : ''; if (k < isCur && cell && cell.actual != null) { n++; if (t === 'good') hit++ } const planned = !g.synthetic && (g[map] || {})[k] != null; return (
                <td key={k} className={`plan-cell ${t} ${k === isCur ? 'cur' : k > isCur ? 'fut' : ''}`}>
                  {editable ? <input type="number" min="0" className={`plan-in ${planned ? 'planned' : ''}`} value={planned ? g[map][k] : ''} placeholder={String(g.target)} onChange={(e) => setTarget(g, map, k, e.target.value)} title={planned ? 'Planned for this period' : 'Default target; type to plan this period'} /> : <div className="plan-t">{target == null ? (k > isCur ? f(goalTargetFor(g, k)) : '-') : f(target)}</div>}
                  {k <= isCur ? <button type="button" className={`plan-a plan-drill ${drill && drill.id === g.id && drill.key === k ? 'on' : ''}`} disabled={!cell || g.synthetic} onClick={() => setDrill(drill && drill.id === g.id && drill.key === k ? null : { id: g.id, key: k })}>{cell ? f(cell.actual) : hist.pending > 0 ? '…' : '-'}{cell && cell.actual != null && target && kindOf(g) !== 'lower' ? <small> {Math.round((cell.actual / target) * 100)}%</small> : null}</button> : <div className="plan-a cap">planned</div>}
                </td>) })}
              <td className="plan-hit">{n ? `${hit} / ${n}` : '-'}</td>
            </tr>) })] : null })}</tbody>
        </table></div>
      </div>
    )
  }
  const ranges = visible.filter((g) => g.period === 'range')
  const drillPanel = (() => {
    if (!drill) return null
    const g = draft.find((x) => x.id === drill.id); const cell = g ? rawCell(g.id, drill.key) : null
    if (!g || !cell) return null
    const f = fmtFor(g); const k = kindOf(g); const label = /Q/.test(drill.key) ? drill.key.replace('-', ' ') : /^\d{4}-\d{2}$/.test(drill.key) ? mLabel(drill.key) : goalWindow(g, today).label
    const rows = (cell.byRep || []).map((b) => ({ ...b, v: b.actual == null ? 0 : b.actual })).sort((a, b) => (k === 'lower' ? a.v - b.v : b.v - a.v))
    const max = Math.max(1, ...rows.map((r) => Math.max(r.v, r.share || 0)))
    const isCurrent = drill.key === curM || drill.key === curQ; const need = isCurrent && k !== 'pct' && k !== 'lower' && !RATE_METRICS.has(g.metric) ? goalWindow(g, today).elapsed : 1
    const toneOf = (r) => (!r.share ? '' : k === 'lower' ? (r.v <= r.share ? 'good' : 'bad') : r.v >= r.share * need ? 'good' : r.v >= r.share * need * 0.8 ? 'warn' : 'bad')
    return <div className="card plan-card"><div className="rep-lb-head"><h4>{g.name || (goalMetric(g.metric) || [])[1]} · {label}</h4><span className="cap">{f(cell.actual)} of {f(cell.target)}{g.split === 'shared' && !(g.reps && g.reps.length === 1) && k !== 'pct' && k !== 'lower' ? ' · shared team number, no slices' : ''}</span><button type="button" className="btn-ghost sm" onClick={() => setDrill(null)}>Close</button></div>
      {rows.length ? rows.map((r) => <RepBar key={r.id} label={r.name} value={r.v} max={max} text={r.share ? `${f(r.v)} / ${f(r.share)} · ${Math.round((r.v / r.share) * 100)}%` : f(r.v)} tone={toneOf(r)} />) : <p className="cap">No rep had anything in this period.</p>}
    </div>
  })()
  return (
    <div className="plan-board">
      <div className="plan-filters">
        <div className="hub-chips"><span className="cap plan-fl">Pipeline</span><button type="button" className={`goal-chip ${pipeF === 'all' ? 'on' : ''}`} onClick={() => setPipeF('all')}>All</button>{pipeIds.map((id) => <button type="button" key={id} className={`goal-chip ${pipeF === id ? 'on' : ''}`} onClick={() => setPipeF(pipeF === id ? 'all' : id)}>{pipeName(id)}</button>)}</div>
        <div className="hub-chips"><span className="cap plan-fl">Rep</span><button type="button" className={`goal-chip ${repF === 'all' ? 'on' : ''}`} onClick={() => setRepF('all')}>All</button>{repIds.map((id) => <button type="button" key={id} className={`goal-chip ${repF === id ? 'on' : ''}`} onClick={() => setRepF(repF === id ? 'all' : id)}>{repName(id)}</button>)}</div>
      </div>
      {hist.error ? <p className="cap act-bad">Some periods could not be read: {hist.error}</p> : null}
      {hist.pending > 0 ? <p className="cap">Reading {hist.pending} more period{hist.pending === 1 ? '' : 's'}…</p> : null}
      {canEdit && repF === 'all' ? <div className="act-note-btns plan-save"><button type="button" className="btn-primary act-btn" disabled={!dirty} onClick={() => { saveGoals(clientId, draft); setDirty(false) }}>Save targets</button>{dirty ? <span className="cap">Unsaved changes to the plan.</span> : <span className="cap">Type in a cell to plan that period; blank means the default target.</span>}</div> : repF !== 'all' ? <p className="cap">Showing {repName(repF)}'s share of each goal they are attached to, against their own figures. Shared team numbers with no slices are left out. Targets are edited with the rep filter off.</p> : null}
      {drillPanel}
      {grid('month', monthCols, 'byMonth', curM, mLabel)}
      {grid('quarter', quarterCols, 'byQuarter', curQ, (k) => k.replace('-', ' '))}
      {ranges.length ? <div className="card plan-card"><div className="rep-lb-head"><h4>Custom dates</h4></div>{ranges.map((g) => { const w = goalWindow(g, today); const cell = cellOf(g, w.key); const f = fmtFor(g); const t = cell ? tone(g, cell, w.key, w.active) : ''; return <div className="hub-win" key={g.id}><div><b>{g.name || (goalMetric(g.metric) || [])[1]}</b> <span className="cap">{w.label}{w.notYet ? ' · not started' : w.ended ? ' · ended' : ''} · {scopeLine(g)}</span></div><span className={`plan-range ${t}`}>{cell ? `${f(cell.actual)} of ${f(cell.target)}` : `target ${f(g.target)}`}</span></div> })}</div> : null}
      {!visible.length && !overall.length ? <div className="card rep-cockpit-empty"><b>{draft.length ? 'No goals match this filter.' : 'No goals yet.'}</b> <span className="cap">{draft.length ? 'Clear the pipeline or rep filter above.' : 'Add them in Settings → this client → Goals, then plan them here month by month.'}</span></div> : null}
    </div>
  )
}
export function SalesHubView({ clientId, authUser, currency, nonce, pipe: pipeProp, onPipe, pipes: pipesProp }) {
  // Follows the workspace's pipeline picker like every other tab: one
  // pipeline recalculates everything within it; "All" keeps each pipeline's
  // funnel and lost reasons apart.
  const [pipeSel, setPipeSel] = usePipeState(pipeProp, onPipe, pipesProp)
  const [period, setPeriod] = useState('this_month')
  const [stale, setStale] = useState(7)
  const [tick, setTick] = useState(0)
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [tv, setTv] = useState(false)
  const [prefs, setPrefs] = useState(hubPrefs)
  const [sortKey, setSortKey] = useState('revenue')
  const [openRep, setOpenRep] = useState(null)
  const [openGauge, setOpenGauge] = useState(null)
  const [screen, setScreen] = useState('live')
  const [spot, setSpot] = useState(0)
  const [live, setLive] = useState({ ok: null, latest: 0, wins: [] })
  const [setup, setSetup] = useState(null)
  const liveSeen = useRef(null), liveQueue = useRef([]), celebrated = useRef(new Set()), dRef = useRef({})
  const seenWins = useRef(null)
  const [celebrate, setCelebrate] = useState(null)
  const strikeT = useRef(null)
  // Activity chips for the TV (new leads, bookings), and refs so the live
  // poll always reads the current TV state and preferences.
  const [activity, setActivity] = useState([])
  const tvRef = useRef(tv), prefsRef = useRef(prefs)
  useEffect(() => { tvRef.current = tv }, [tv])
  useEffect(() => { prefsRef.current = prefs }, [prefs])
  useEffect(() => { if (!activity.length) return; const iv = setInterval(() => setActivity((a) => a.filter((x) => Date.now() - x.at < 12000)), 1000); return () => clearInterval(iv) }, [activity.length])
  const hubTestActivity = (kind) => { hubPing(kind); setActivity((a) => [{ id: `test:${Date.now()}`, kind, at: Date.now(), text: kind === 'lead' ? 'New lead · test' : 'Appointment booked · test' }, ...a].slice(0, 6)) }
  // One win at a time: the gong overlay, then confetti and the sound timed to
  // the mallet hitting, then everything clears after ten seconds.
  const hubStrike = (win) => {
    if (win.id && win.id !== 'test') { if (celebrated.current.has(win.id)) return; celebrated.current.add(win.id) }
    clearTimeout(strikeT.current); setCelebrate({ ...win, key: Date.now() })
    setTimeout(() => { if (prefsRef.current.confetti) hubConfetti(); if (prefsRef.current.sound) hubChime() }, HUB_GONG_HIT_MS)
    strikeT.current = setTimeout(() => setCelebrate(null), 10000)
  }
  useSettingsSync()
  useEffect(() => { if (prefs.sound) hubGongPreload() }, [prefs.sound])
  useEffect(() => {
    let dead = false
    setSt((s) => ({ status: s.data ? 'refreshing' : 'loading', data: s.data }))
    const r = presetRange(period)
    fetch(`/.netlify/functions/windsor?scope=saleshub&client=${encodeURIComponent(clientId)}&${rangeQuery(r)}&preset=${period}&stale=${stale}${pipeSel && pipeSel !== 'all' ? `&pipeline=${encodeURIComponent(pipeSel)}` : ''}${hoursQuery(loadHours(clientId))}${tick || nonce ? `&_r=${tick}.${nonce || 0}` : ''}`, { credentials: 'same-origin' })
      .then((x) => x.json().catch(() => ({ error: `server ${x.status}` })))
      .then((j) => {
        if (dead) return
        setSt({ status: j && j.error && !j.team ? 'err' : 'ok', data: j })
        // A win that was not on the last read is worth a party.
        const ids = new Set(((j && j.wins) || []).map((w) => w.id))
        if (seenWins.current) { const fresh = ((j && j.wins) || []).filter((w) => !seenWins.current.has(w.id)); if (fresh.length) hubStrike(fresh[0]) }
        seenWins.current = ids
      })
      .catch((e) => { if (!dead) setSt({ status: 'err', data: { error: String((e && e.message) || e) } }) })
    return () => { dead = true }
  }, [clientId, period, stale, pipeSel, tick, nonce]) // eslint-disable-line
  useEffect(() => { const iv = setInterval(() => { if (document.visibilityState === 'visible') setTick((t) => t + 1) }, tv ? 60000 : 180000); return () => clearInterval(iv) }, [tv])
  useEffect(() => { if (tv && period !== 'this_month') setPeriod('this_month') }, [tv]) // eslint-disable-line
  useEffect(() => { if (!tv) return; const onKey = (e) => { if (e.key === 'Escape') setTv(false) }; window.addEventListener('keydown', onKey); document.body.classList.add('hub-tv-on'); return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('hub-tv-on'); try { if (document.fullscreenElement) document.exitFullscreen() } catch { /* ignore */ } } }, [tv])
  const d = st.data || {}
  const team = d.team || {}
  const reps = d.reps || []
  const money = (v) => fmtCurrency(v || 0, currency)
  const cashOn = !!(d.cashField && loadCashOn(clientId))
  const goalsAll = useMemo(() => loadGoals(clientId), [clientId, SETTINGS.goals, SETTINGS.repkpis]) // eslint-disable-line
  const repIdsAll = useMemo(() => reps.map((r) => r.id), [reps])
  const today = tzTodayStr()
  // Goals on the hub: business and pipeline goals (a single rep's goal lives
  // on My results), each measured by the server in its own window - this
  // month, this quarter, or its dates - whatever period the hub is showing.
  const hubGoalList = useMemo(() => goalsAll.filter((g) => !(g.reps && g.reps.length === 1) && !goalWindow(g, today).ended), [goalsAll, today])
  // Progress re-reads at most every four minutes (the server keeps a live
  // window for three), not on every poll of the board.
  const [progTick, setProgTick] = useState(0)
  const progAt = useRef(0)
  useEffect(() => { if (st.status === 'loading') return; if (Date.now() - progAt.current >= 4 * 60000) { progAt.current = Date.now(); setProgTick((t) => t + 1) } }, [tick, st.status])
  const prog = useGoalProgress(clientId, hubGoalList, progTick)
  const hubGoals = useMemo(() => hubGoalList.map((g) => {
    const m = goalMetric(g.metric) || []; const w = goalWindow(g, today); const p = prog[g.id]
    const scope = [g.pipelines ? g.pipelines.map((pid) => ((d.pipelines || []).find((x) => x.id === pid) || {}).name || 'Pipeline').join(', ') : null, g.reps ? `${g.reps.length} reps` : null].filter(Boolean).join(' · ')
    const fallback = g.period === 'month' && !p ? goalActual({ ...g, target: goalTargetFor(g, w.key) }, reps) : null
    return { goal: g, key: g.id, label: g.name || m[1], sub: [w.label, scope].filter(Boolean).join(' · '), kind: m[2], fmt: m[2] === 'money' ? money : m[2] === 'pct' ? (v) => `${Math.round(v)}%` : m[2] === 'lower' ? repMin : fmtNumber, actual: p ? p.actual : fallback, target: p ? p.target : goalTargetFor(g, w.key), elapsed: w.elapsed, pace: w.active && !w.notYet, byRep: p ? p.byRep : null, notYet: !!w.notYet }
  }), [hubGoalList, prog, reps, d.pipelines, today]) // eslint-disable-line
  const bizRevenue = goalsAll.find((g) => g.metric === 'revenue' && !g.pipelines && !g.reps)
  const targets = { revenue: bizRevenue ? bizRevenue.target : 0 }
  const now = new Date(); const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); const day = now.getDate(); const elapsed = Math.min(1, Math.max(0.03, day / dim))
  const monthly = period === 'this_month'
  const dialDefs = hubGoals.filter((x) => x.kind !== 'money' || x.goal.metric !== 'cash' || cashOn)
  // Mini leaderboards: who leads on each thing a sales floor competes on.
  const boards = [
    ['set', 'Top appointment setter', (r) => r.set, fmtNumber, 'set'],
    ['booked', 'Most appointments', (r) => r.booked, fmtNumber, 'booked'],
    ['showRate', 'Best show rate', (r) => ((r.showed + r.noShow) >= 3 ? r.showRate : null), (v) => `${v}%`, ''],
    ['minutes', 'Most on the phone', (r) => r.minutes, fmtNumber, 'min'],
    ['calls', 'Most calls', (r) => r.calls, fmtNumber, 'calls'],
    ['speed', 'Fastest to lead', (r) => (r.speedMeasured >= 3 && r.speedMin != null ? r.speedMin : null), repMin, '', 'asc'],
    ['showed', 'Most meetings held', (r) => r.showed, fmtNumber, 'held'],
    ['won', 'Most deals closed', (r) => r.won, fmtNumber, 'won'],
    ['avgDeal', 'Biggest average deal', (r) => (r.won >= 2 ? r.avgDeal : null), money, 'per deal'],
    ['resultRate', 'Highest result rate', (r) => (r.decided >= 3 ? r.resultRate : null), (v) => `${v}%`, 'resulted'],
    ['openValue', 'Biggest open pipeline', (r) => r.openValue, money, 'open'],
    ...(cashOn ? [['cash', 'Most cash collected', (r) => r.cash, money, 'collected']] : []),
  ].map(([key, title, get, fmt, unit, dir]) => {
    const rows = reps.filter((r) => r.id !== 'unassigned').map((r) => ({ r, v: get(r) })).filter((x) => x.v != null && (dir === 'asc' || x.v > 0)).sort(dir === 'asc' ? (a, b) => a.v - b.v : (a, b) => b.v - a.v).slice(0, 3)
    return rows.length ? { key, title, rows, fmt, unit } : null
  }).filter(Boolean)
  // Attainment per rep: revenue target first, then deals, then bookings.
  const attain = (r) => { const t = repTargetsFromGoals(goalsAll, r.id, repIdsAll, today); const key = t.revenue > 0 ? 'revenue' : t.won > 0 ? 'won' : t.booked > 0 ? 'booked' : null; if (!key) return null; const a = key === 'revenue' ? r.revenue : key === 'won' ? r.won : r.booked; return { key, pct: Math.round(((a || 0) / t[key]) * 100), need: monthly ? elapsed * 100 : 100 } }
  const status = (r) => { const a = attain(r); if (!a) return null; return a.pct >= a.need ? ['On pace', 'good'] : a.pct >= a.need * 0.8 ? ['At risk', 'warn'] : ['Behind', 'bad'] }
  const sorters = { revenue: (a, b) => b.revenue - a.revenue, won: (a, b) => b.won - a.won, booked: (a, b) => b.booked - a.booked, showed: (a, b) => b.showed - a.showed, showRate: (a, b) => (b.showRate ?? -1) - (a.showRate ?? -1), winRate: (a, b) => (b.winRate ?? -1) - (a.winRate ?? -1), calls: (a, b) => b.calls - a.calls, speed: (a, b) => (a.speedMin ?? 1e9) - (b.speedMin ?? 1e9), stale: (a, b) => b.stale - a.stale, attain: (a, b) => ((attain(b) || {}).pct ?? -1) - ((attain(a) || {}).pct ?? -1), leads: (a, b) => b.leads - a.leads }
  const board = [...reps].sort(sorters[sortKey] || sorters.revenue)
  // Coaching flags: specific, and each one points at a rep.
  const flags = useMemo(() => {
    const out = []
    const teamSpeed = team.speedMin
    for (const r of reps) {
      if (r.speedMin != null && teamSpeed != null && r.speedMeasured >= 3 && r.speedMin > Math.max(teamSpeed * 2, teamSpeed + 30)) out.push({ rep: r, tone: 'bad', text: `Speed to lead ${repMin(r.speedMin)} against the team's ${repMin(teamSpeed)}` })
      if (r.staleTiers && r.staleTiers.t30 >= 3) out.push({ rep: r, tone: 'bad', text: `${r.staleTiers.t30} deals untouched for 30+ days` })
      else if (r.stale >= 8) out.push({ rep: r, tone: 'warn', text: `${r.stale} stale deals` })
      if (r.showRate != null && team.showRate != null && (r.showed + r.noShow) >= 5 && r.showRate < team.showRate - 15) out.push({ rep: r, tone: 'warn', text: `Show rate ${r.showRate}% against the team's ${team.showRate}%` })
      if (r.unresulted >= 3) out.push({ rep: r, tone: 'warn', text: `${r.unresulted} appointments past their time with no result` })
      if (r.leads >= 8 && r.booked === 0 && r.byStaff === 0) out.push({ rep: r, tone: 'warn', text: `${r.leads} leads and no appointment booked` })
      const s = status(r); if (s && s[1] === 'bad') out.push({ rep: r, tone: 'bad', text: `Behind pace on ${(attain(r) || {}).key === 'revenue' ? 'revenue' : (attain(r) || {}).key === 'won' ? 'deals' : 'bookings'}: ${(attain(r) || {}).pct}% of target with ${Math.round(elapsed * 100)}% of the month gone` })
    }
    return out.sort((a, b) => (a.tone === 'bad' ? 0 : 1) - (b.tone === 'bad' ? 0 : 1)).slice(0, 12)
  }, [reps, team]) // eslint-disable-line
  useEffect(() => { if (!tv || boards.length < 2) return; const iv = setInterval(() => setSpot((x) => x + 1), 9000); return () => clearInterval(iv) }, [tv, boards.length])
  // Live events from the CRM webhook: polled every 15 s on a TV, 30 s on the
  // tab. The first read only marks what is already there; after that a new
  // win rings the gong (one per poll at most, so a bulk update is not thirty
  // gongs) and joins the wins feed before the snapshot catches up.
  useEffect(() => {
    let dead = false
    const poll = () => {
      if (document.visibilityState !== 'visible') return
      fetch(`/.netlify/functions/windsor?scope=hublive&client=${encodeURIComponent(clientId)}`, { credentials: 'same-origin' })
        .then((r) => r.json().catch(() => null))
        .then((j) => {
          if (dead || !j) return
          if (j.error) { setLive((l) => ({ ...l, ok: false })); return }
          const evs = j.events || []; const latest = evs.reduce((m, e) => Math.max(m, e.at || 0), 0)
          if (!liveSeen.current) { liveSeen.current = new Set(evs.map((e) => e.id)); setLive({ ok: true, latest, wins: evs.filter((e) => e.kind === 'won').slice(-10).reverse() }); return }
          const fresh = evs.filter((e) => !liveSeen.current.has(e.id)); for (const e of fresh) liveSeen.current.add(e.id)
          liveQueue.current.push(...fresh.filter((e) => e.kind === 'won' && j.now - (e.at || 0) < 10 * 60000))
          setLive((l) => ({ ok: true, latest, wins: [...fresh.filter((e) => e.kind === 'won').reverse(), ...l.wins].slice(0, 10) }))
          strikeNext()
          hubActivity(fresh, j.now)
        })
        .catch(() => { if (!dead) setLive((l) => ({ ...l, ok: false })) })
      strikeNext()
    }
    // New leads and bookings: a sound and a corner chip, only on a TV (the
    // tab stays quiet), only for events from the last ten minutes, and one
    // cue per kind per poll so a bulk import is not thirty dings.
    const hubActivity = (fresh, nowMs) => {
      if (dead || !tvRef.current) return
      const recent = fresh.filter((e) => (e.kind === 'lead' || e.kind === 'booked') && nowMs - (e.at || 0) < 10 * 60000)
      if (!recent.length) return
      const pf = prefsRef.current
      const kinds = [...new Set(recent.map((e) => e.kind))].filter((k) => (k === 'lead' ? pf.leadSound : pf.bookSound))
      kinds.forEach((k, i) => setTimeout(() => { if (!dead) hubPing(k) }, i * 650))
      const dd = dRef.current || {}
      const who = (e) => (dd.users || {})[e.userId] || ((dd.reps || []).find((r) => r.id === e.userId) || {}).name || null
      setActivity((a) => [...recent.slice(-6).reverse().map((e) => ({ id: e.id, kind: e.kind, at: nowMs, text: e.kind === 'lead' ? `New lead${who(e) ? ` · ${who(e)}` : ''}` : `Appointment booked${who(e) ? ` · ${who(e)}` : ''}` })), ...a].slice(0, 6))
    }
    // One gong per poll at most: the first new win rings now, the rest queue.
    const strikeNext = () => {
      if (dead) return
      const next = liveQueue.current.shift(); if (!next) return
      const dd = dRef.current || {}
      hubStrike({ id: next.oppId, user: (dd.users || {})[next.userId] || ((dd.reps || []).find((r) => r.id === next.userId) || {}).name || null, name: next.name || 'Deal', value: next.value })
    }
    poll(); const iv = setInterval(poll, tv ? 15000 : 30000)
    return () => { dead = true; clearInterval(iv) }
  }, [clientId, tv]) // eslint-disable-line
  const pipesAll = d.pipelines || []
  const multi = (pipesProp && pipesProp.length > 1) || pipesAll.length > 1
  const focus = d.pipelineId ? (pipesAll.find((p) => p.id === d.pipelineId) || null) : null
  // A pipeline just chosen (Focus, or the picker) while the hub rebuilds: the
  // old numbers stay but dim, and a bar says what is loading, so the click is
  // plainly doing something during the few seconds a build takes.
  const busy = st.status === 'refreshing'
  const pendingPipe = busy && (pipeSel || 'all') !== (d.pipelineId || 'all') ? (pipeSel && pipeSel !== 'all' ? ((pipesAll.find((p) => p.id === pipeSel) || (pipesProp || []).find((p) => p.id === pipeSel) || {}).name || 'that pipeline') : 'all pipelines') : null
  const periodLabel = ((HUB_PERIODS.find(([id]) => id === period) || [])[1] || '').toLowerCase()
  const head = (
    <div className="act-bar hub-bar">
      <div className="act-filters">
        <div className="act-seg hub-screens"><button type="button" className={screen === 'live' ? 'on' : ''} onClick={() => setScreen('live')}>Live board</button><button type="button" className={screen === 'plan' ? 'on' : ''} onClick={() => setScreen('plan')}>Month by month</button></div>
        <label className="act-sel"><select value={period} onChange={(e) => setPeriod(e.target.value)}>{HUB_PERIODS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        <label className="act-sel"><select value={stale} onChange={(e) => setStale(Number(e.target.value))}><option value={7}>Stale after 7 days</option><option value={14}>Stale after 14 days</option><option value={30}>Stale after 30 days</option></select></label>
        <button type="button" className="btn-ghost sm" disabled={st.status === 'refreshing'} onClick={() => setTick((t) => t + 1)}>{st.status === 'refreshing' ? 'Refreshing…' : 'Refresh'}</button>
        <button type="button" className="btn-primary act-btn" onClick={() => setTv(true)}>📺 TV mode</button>
      </div>
      <div className="hub-tools">
        <label className="alloc-check"><input type="checkbox" checked={prefs.confetti} onChange={(e) => { const p = { ...prefs, confetti: e.target.checked }; setPrefs(p); saveHubPrefs(p) }} /> Confetti</label>
        <label className="alloc-check" title="The gong on a won deal; the animation always plays"><input type="checkbox" checked={prefs.sound} onChange={(e) => { const p = { ...prefs, sound: e.target.checked }; setPrefs(p); saveHubPrefs(p) }} /> Gong sound</label>
        <label className="alloc-check" title="On the TV only: a short ding for each new lead"><input type="checkbox" checked={prefs.leadSound} onChange={(e) => { const p = { ...prefs, leadSound: e.target.checked }; setPrefs(p); saveHubPrefs(p) }} /> Lead sound</label>
        <label className="alloc-check" title="On the TV only: a short chime for each booked appointment"><input type="checkbox" checked={prefs.bookSound} onChange={(e) => { const p = { ...prefs, bookSound: e.target.checked }; setPrefs(p); saveHubPrefs(p) }} /> Booking sound</label>
        {authUser && authUser.role === 'superadmin' ? <><button type="button" className="btn-ghost sm" onClick={() => hubStrike({ id: 'test', user: authUser.name || 'Test rep', name: 'Sample deal', value: 12500 })}>Test the gong</button><button type="button" className="btn-ghost sm" onClick={() => hubTestActivity('lead')}>Test lead sound</button><button type="button" className="btn-ghost sm" onClick={() => hubTestActivity('booked')}>Test booking sound</button></> : null}
        <span className={`hub-livechip ${live.latest ? 'on' : ''}`} title="Live events arrive from the CRM webhook the moment a deal changes; the numbers refresh from the five-minute snapshot">{live.latest ? `● Live · last event ${actHrs(Math.round((Date.now() - live.latest) / 3600000))}` : live.ok === false ? '○ Live unavailable' : '○ Live · no events yet'}</span>
        {authUser && authUser.role === 'superadmin' ? <button type="button" className="btn-ghost sm" onClick={() => { if (setup) return setSetup(null); setSetup({ loading: true }); fetch(`/.netlify/functions/windsor?scope=webhookurl&client=${encodeURIComponent(clientId)}`, { credentials: 'same-origin' }).then((r) => r.json().catch(() => ({}))).then((j) => setSetup(j || {})).catch(() => setSetup({ error: 'Could not load.' })) }}>Live setup</button> : null}
      </div>
    </div>
  )
  const setupPanel = setup ? <div className="card hub-setup">
    <div className="rep-lb-head"><h4>Live setup: the CRM webhook</h4><button type="button" className="btn-ghost sm" onClick={() => setSetup(null)}>Close</button></div>
    {setup.loading ? <p className="cap">Loading…</p> : setup.error ? <p className="cap act-bad">{setup.error}</p> : !setup.url ? <p className="cap">No site secret is set, so no webhook token can be made.</p> : <>
      <p className="cap">In the marketplace app's settings, paste this URL as the webhook URL and tick these events: {(setup.events || []).join(', ')}. One URL serves every connected account; each event names its own location. {setup.signed ? 'Deliveries are signature-checked.' : 'Set GHL_WEBHOOK_PUBLIC_KEY in the site environment to signature-check every delivery as well.'}</p>
      <div className="act-note-btns"><input className="act-in hub-setup-url" type="text" readOnly value={setup.url} onFocus={(e) => e.target.select()} /><button type="button" className="btn-primary act-btn" onClick={() => { try { navigator.clipboard.writeText(setup.url) } catch { /* select and copy by hand */ } }}>Copy</button></div>
    </>}
  </div> : null
  if (st.status === 'loading') return <div className="act-wrap">{head}<div className="card"><Spinner label="Adding up the team…" /></div></div>
  if (st.status === 'err') return <div className="act-wrap">{head}<div className="card"><p className="cap act-bad" style={{ margin: 0 }}>{d.error || 'Could not load.'}</p></div></div>
  if (d.ghl === false) return <div className="card"><p className="cap">{d.error || 'This account has no Caalano Systems connection.'}</p></div>
  const lbTop = [...reps].sort((a, b) => b.revenue - a.revenue || b.won - a.won).slice(0, 3)
  const medal = ['🥇', '🥈', '🥉']
  dRef.current = d
  const liveFeed = (live.wins || []).map((e) => ({ id: e.oppId, name: e.name || 'Deal', value: e.value, user: (d.users || {})[e.userId] || null, at: e.at, pipeline: null, live: true }))
  const allWins = [...liveFeed, ...(d.wins || [])].filter((w, i, arr) => arr.findIndex((x) => x.id === w.id) === i).sort((a, b) => (b.at || 0) - (a.at || 0))
  const winsFeed = (limit) => allWins.slice(0, limit).map((w) => <div className="hub-win" key={w.id}><span className="hub-win-m">🎉</span><div><b>{w.user || 'Someone'}</b> closed <b>{w.name}</b>{w.value ? ` for ${money(w.value)}` : ''}{cashOn && w.cash ? ` · ${money(w.cash)} collected` : ''}{multi && w.pipeline ? <span className="cap"> · {w.pipeline}</span> : null}</div><span className="cap">{actHrs(Math.round((Date.now() - w.at) / 3600000))}</span></div>)
  const leaderboard = (
    <div className="card rep-card hub-lb">
      <div className="rep-lb-head"><h4>Leaderboard</h4><span className="cap">by revenue{periodLabel ? ` · ${periodLabel}` : ''}{focus ? ` · ${focus.name}` : ''}</span></div>
      <div className="rep-podium">{lbTop.map((r, i) => <div key={r.id} className={`rep-pod p${i + 1}`}><div className="rep-pod-m">{medal[i]}</div><b>{r.name}</b><div className="rep-pod-v">{money(r.revenue)}</div><div className="cap">{r.won} won · {r.booked} booked</div></div>)}</div>
      <div className="rep-lb-rows">{[...reps].sort((a, b) => b.revenue - a.revenue || b.won - a.won).map((r, i) => <div key={r.id} className="rep-lb-row hub-lb-row"><span>{i + 1}</span><span className="rep-lb-name">{r.name}</span><span>{money(r.revenue)}</span><span>{r.won} won</span><span>{r.booked} booked</span><span>{r.showed} held</span></div>)}</div>
    </div>
  )
  // The four numbers a sales manager asks for first, then the supporting ones.
  const primary = (
    <div className="hub-stats hub-primary">
      <HubStat label="Revenue" value={money(team.revenue)} sub={targets.revenue ? `of ${money(targets.revenue)} team target` : `${fmtNumber(team.won || 0)} deals`} tone={targets.revenue ? ((team.revenue || 0) >= targets.revenue * (monthly ? elapsed : 1) ? 'good' : 'warn') : ''} big />
      {cashOn ? <HubStat label="Cash collected" value={money(team.cash)} sub={team.revenue ? `${Math.round(((team.cash || 0) / team.revenue) * 100)}% of won value` : null} big /> : null}
      <HubStat label="Deals closed" value={fmtNumber(team.won || 0)} sub={`${fmtNumber(team.lost || 0)} lost · ${hubPct(team.winRate)} win rate of decided`} big />
      <HubStat label="Meetings held" value={fmtNumber(team.showed || 0)} sub={`${fmtNumber(team.booked || 0)} booked · ${fmtNumber(team.noShow || 0)} no-shows · ${hubPct(team.showRate)} show rate`} tone={team.showRate != null ? (team.showRate >= 80 ? 'good' : team.showRate >= 65 ? '' : 'warn') : ''} big />
      <HubStat label="Speed to lead" value={team.speedMin != null ? repMin(team.speedMin) : '-'} sub={`team median, in hours${team.speedAfter ? ` · ${team.speedAfter} after hours` : ''}`} tone={team.speedMin != null ? (team.speedMin <= 15 ? 'good' : team.speedMin <= 60 ? '' : 'warn') : ''} big />
    </div>
  )
  const secondary = (
    <div className="hub-stats hub-secondary">
      <HubStat label="Leads" value={fmtNumber(team.leads || 0)} sub={`${team.reps} reps`} />
      <HubStat label="Booked" value={fmtNumber(team.booked || 0)} sub={`${fmtNumber(team.set || 0)} set by reps · ${fmtNumber(team.byCustomer || 0)} by customers`} />
      <HubStat label="Calls" value={fmtNumber(team.calls || 0)} sub={`${fmtNumber(team.minutes || 0)} minutes`} />
      <HubStat label="Average deal" value={team.avgDeal != null ? money(team.avgDeal) : '-'} sub={team.won ? `per won deal · ${fmtNumber(team.won)} won` : 'nothing won yet'} />
      <HubStat label="Open pipeline" value={money(team.openValue)} sub={`${fmtNumber(team.open || 0)} deals · ${fmtNumber(team.stale || 0)} stale`} tone={team.open && team.stale / team.open > 0.4 ? 'warn' : ''} />
      <HubStat label="Result rate" value={hubPct(team.resultRate)} sub={`${fmtNumber(team.decided || 0)} decided · won or lost, over those plus open`} tone={team.resultRate != null ? (team.resultRate >= 50 ? 'good' : team.resultRate < 20 ? 'warn' : '') : ''} />
    </div>
  )
  // One pipeline at a time: its funnel and its open deals side by side.
  const pipeCard = (p) => {
    const first = (p.stages || [])[0]; const base = first ? first.reached : 0
    const fun = hubFunnelStages(clientId, p)
    const open = (d.stageOpen || []).filter((so) => so.pipelineId === p.id)
    const order = new Map((p.stages || []).map((sdef, i) => [sdef.name, i]))
    open.sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99))
    const openMax = Math.max(1, ...open.map((so) => so.open))
    return (
      <div className="card hub-pipecard" key={p.id}>
        <div className="rep-lb-head"><h4>{multi ? p.name : 'The pipeline'}</h4><span className="cap">{fmtNumber(p.leads)} leads · {fmtNumber(p.won)} won · {money(p.revenue)} · {hubPct(p.winRate)} win rate</span></div>
        <div className="hub-pipe-cols">
          <div><div className="hub-sub">How this period's leads are progressing <span className="cap">· {fmtNumber(base)} leads{fun.keyed ? ' · key events' : ''}</span></div>{base ? fun.stages.map((sdef, i) => <RepBar key={sdef.name} label={sdef.label} value={sdef.reached} max={base} text={`${fmtNumber(sdef.reached)} · ${Math.round((sdef.reached / base) * 100)}%${i ? ` · ${fun.stages[i - 1].reached ? Math.round((sdef.reached / fun.stages[i - 1].reached) * 100) : 0}% of previous` : ''}`} />) : <p className="cap">No leads in this period.</p>}</div>
          <div><div className="hub-sub">Open deals by stage <span className="cap">· {fmtNumber(p.open)} worth {money(p.openValue)}{p.stale ? ` · ${p.stale} stale` : ''}</span></div>{open.length ? open.map((so) => <RepBar key={so.stageId} label={so.stage} value={so.open} max={openMax} text={`${fmtNumber(so.open)} · ${money(so.value)}${so.stale ? ` · ${so.stale} stale` : ''}`} tone={so.stale && so.stale / so.open > 0.5 ? 'warn' : ''} />) : <p className="cap">No open deals.</p>}</div>
        </div>
      </div>
    )
  }
  const lostCard = (
    <div className="card rep-card"><h4>Lost reasons</h4>
      {pipesAll.length > 1 ? pipesAll.map((p) => <div className="hub-lost-grp" key={p.id}><div className="hub-sub">{p.name}</div>{(p.lostReasons || []).length ? p.lostReasons.slice(0, 6).map((x) => <RepBar key={x.reason} label={x.reason} value={x.count} max={p.lostReasons[0].count} tone="bad" />) : <p className="cap">Nothing lost.</p>}</div>)
        : (d.lostByReason || []).length ? d.lostByReason.slice(0, 8).map((x) => <RepBar key={x.reason} label={x.reason} value={x.count} max={d.lostByReason[0].count} tone="bad" text={`${fmtNumber(x.count)} · ${reps.filter((r) => (r.lostReasons || []).some((y) => y.reason === x.reason)).sort((a, b) => ((b.lostReasons.find((y) => y.reason === x.reason) || {}).count || 0) - ((a.lostReasons.find((y) => y.reason === x.reason) || {}).count || 0)).slice(0, 2).map((r) => `${r.name} ${(r.lostReasons.find((y) => y.reason === x.reason) || {}).count}`).join(', ')}`} />) : <p className="cap">Nothing lost in this period.</p>}
    </div>
  )
  const calCard = (
    <div className="card rep-card"><h4>Appointments by calendar</h4>
      {(d.calendars || []).length ? d.calendars.map((c) => {
        const tot = Object.values(c.byRep).reduce((a, b) => ({ booked: a.booked + b.booked, showed: a.showed + b.showed, noShow: a.noShow + b.noShow }), { booked: 0, showed: 0, noShow: 0 })
        const sr = (tot.showed + tot.noShow) ? Math.round((tot.showed / (tot.showed + tot.noShow)) * 100) : null
        return <div className="hub-cal" key={c.id}>
          <div className="hub-cal-h"><b>{c.name}</b><span className="hub-cal-n"><span><b>{tot.booked}</b> booked</span><span><b>{tot.showed}</b> held</span><span className={sr != null && sr < 65 ? 'act-bad' : ''}><b>{hubPct(sr)}</b> show</span></span></div>
          <div className="hub-chips">{Object.entries(c.byRep).sort((x, y) => y[1].booked - x[1].booked).slice(0, 8).map(([uid, b]) => { const rr = reps.find((x) => x.id === uid); const s2 = (b.showed + b.noShow) ? Math.round((b.showed / (b.showed + b.noShow)) * 100) : null; return <span className="hub-chip-rep" key={uid}>{rr ? rr.name : 'Unassigned'} <b>{b.booked}</b>{s2 != null ? <i>{s2}%</i> : null}</span> })}</div>
        </div>
      }) : <p className="cap">No appointments in this period.</p>}
    </div>
  )
  const flagsByRep = []
  for (const f of flags) { let g = flagsByRep.find((x) => x.rep.id === f.rep.id); if (!g) { g = { rep: f.rep, tone: f.tone, items: [] }; flagsByRep.push(g) } g.items.push(f.text); if (f.tone === 'bad') g.tone = 'bad' }
  const dials = dialDefs.length ? <div className="hub-dials">{dialDefs.map((x) => <HubDial key={x.key} label={x.label} sub={x.sub} actual={x.actual} target={x.target} fmt={x.fmt} kind={x.kind} elapsed={x.elapsed} monthly={x.pace} paced={!RATE_METRICS.has(x.goal.metric)} open={openGauge === x.key} onClick={() => setOpenGauge(openGauge === x.key ? null : x.key)} />)}</div> : null
  const gaugeDetail = (() => {
    const x = openGauge ? dialDefs.find((y) => y.key === openGauge) : null
    if (!x) return null
    const g = x.goal; const fmt = x.fmt; const share = x.pace && x.kind !== 'pct' && x.kind !== 'lower' ? x.elapsed : 1
    const rows = (x.byRep ? x.byRep.map((b) => ({ r: { id: b.id, name: b.name }, v: b.actual == null ? 0 : b.actual, t: b.share })) : (() => { const shares = goalShares({ ...g, target: x.target }, repIdsAll); return reps.filter((r) => r.id !== 'unassigned' && (r.id in shares)).map((r) => { const v = repValue(r, g.metric, g.pipelines); return { r, v: v == null ? 0 : v, t: shares[r.id] } }) })()).map((y) => ({ ...y, pct: y.t ? Math.round((y.v / y.t) * 100) : null })).sort((a, b) => (x.kind === 'lower' ? a.v - b.v : b.v - a.v))
    const max = Math.max(1, ...rows.map((y) => Math.max(y.v, y.t || 0)))
    const toneOf = (y) => (!y.t ? '' : x.kind === 'lower' ? (y.v <= y.t ? 'good' : 'bad') : y.v >= y.t * share ? 'good' : y.v >= y.t * share * 0.8 ? 'warn' : 'bad')
    return <div className="hub-gauge-detail"><div className="rep-lb-head"><h4>{x.label} by rep</h4><span className="cap">{x.sub}{g.split === 'shared' && !(g.reps && g.reps.length === 1) && x.kind !== 'pct' && x.kind !== 'lower' ? ' · shared team number, no slices' : x.pace ? ` · ${Math.round(x.elapsed * 100)}% of the window gone` : ''}</span><button type="button" className="btn-ghost sm" onClick={() => setOpenGauge(null)}>Close</button></div>
      {rows.map((y) => <RepBar key={y.r.id} label={y.r.name} value={y.v} max={max} text={y.t ? `${fmt(y.v)} / ${fmt(y.t)} · ${y.pct}%` : fmt(y.v)} tone={toneOf(y)} />)}</div>
  })()
  const gaugeCard = dialDefs.length ? <div className="card rep-cockpit"><div className="rep-cockpit-head"><h4>Goals</h4><span className="cap">Each goal in its own window · day {day} of {dim} · tap a dial for the split by rep</span></div>{dials}{gaugeDetail}</div>
    : (authUser && isAdminishFE(authUser.role) ? <div className="card rep-cockpit-empty"><b>No goals yet.</b> <span className="cap">Set them in Settings → this client → Goals and the gauges light up here.</span></div> : null)
  const boardsGrid = boards.length ? <div className="hub-boards">{boards.map((b) => <div className="card hub-board-card" key={b.key}><div className="hub-board-t">{b.title}</div>{b.rows.map((x, i) => <div className="hub-board-row" key={x.r.id}><span>{medal[i]}</span><span className="hub-board-n">{x.r.name}</span><b>{b.fmt(x.v)}{b.unit ? <small> {b.unit}</small> : null}</b></div>)}</div>)}</div> : null
  const sp = boards.length ? boards[spot % boards.length] : null
  const spotlight = sp ? <div className="card hub-spot" key={sp.key}><div className="hub-spot-k">{sp.title}</div><div className="hub-spot-n">{sp.rows[0].r.name}</div><div className="hub-spot-v">{sp.fmt(sp.rows[0].v)}{sp.unit ? <small> {sp.unit}</small> : null}</div>{sp.rows.length > 1 ? <div className="hub-spot-r">{sp.rows.slice(1).map((x, i) => <span key={x.r.id}>{medal[i + 1]} {x.r.name} <b>{sp.fmt(x.v)}</b></span>)}</div> : null}</div> : null
  const facts = (title, rows) => <div className="hub-facts"><b>{title}</b><dl>{rows.filter((r) => r).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v == null || v === '' ? '-' : v}</dd></React.Fragment>)}</dl></div>
  if (tv) {
    return (
      <div className="hub-tv">
        <div className="hub-tv-head"><div><b>{new Date().toLocaleString('en-AU', { month: 'long', year: 'numeric' })}</b> <span>Sales Hub · month to date{focus ? ` · ${focus.name}` : ''} · day {day} of {dim}</span></div>
          <div className="hub-tv-ctl">
            <label className="alloc-check"><input type="checkbox" checked={prefs.confetti} onChange={(e) => { const p = { ...prefs, confetti: e.target.checked }; setPrefs(p); saveHubPrefs(p) }} /> Confetti</label>
            <label className="alloc-check" title="The gong on a won deal; the animation always plays"><input type="checkbox" checked={prefs.sound} onChange={(e) => { const p = { ...prefs, sound: e.target.checked }; setPrefs(p); saveHubPrefs(p) }} /> Gong</label>
            <label className="alloc-check"><input type="checkbox" checked={prefs.leadSound} onChange={(e) => { const p = { ...prefs, leadSound: e.target.checked }; setPrefs(p); saveHubPrefs(p) }} /> Lead</label>
            <label className="alloc-check"><input type="checkbox" checked={prefs.bookSound} onChange={(e) => { const p = { ...prefs, bookSound: e.target.checked }; setPrefs(p); saveHubPrefs(p) }} /> Booking</label>
            {authUser && authUser.role === 'superadmin' ? <><button type="button" className="btn-ghost sm" onClick={() => hubStrike({ id: 'test', user: authUser.name || 'Test rep', name: 'Sample deal', value: 12500 })}>Test gong</button><button type="button" className="btn-ghost sm" onClick={() => hubTestActivity('lead')}>Test lead</button><button type="button" className="btn-ghost sm" onClick={() => hubTestActivity('booked')}>Test booking</button></> : null}
            <button type="button" className="btn-ghost sm" onClick={() => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen() } catch { /* not allowed */ } }}>Full screen</button>
            <button type="button" className="btn-ghost sm" onClick={() => setTv(false)}>Exit (Esc)</button>
          </div></div>
        {celebrate ? <HubGong key={celebrate.key} win={celebrate} currency={currency} onDone={() => { clearTimeout(strikeT.current); setCelebrate(null) }} /> : null}
        {dialDefs.length ? <div className="hub-tv-dials">{dials}{gaugeDetail}</div> : primary}
        <div className="hub-tv-grid">
          <div className="hub-tv-col">{leaderboard}<div className="card rep-card"><h4>Latest wins</h4>{allWins.length ? winsFeed(6) : <p className="cap">No wins in the last 7 days yet.</p>}</div></div>
          <div className="hub-tv-col">{spotlight}{boardsGrid}{!dialDefs.length && authUser && isAdminishFE(authUser.role) ? <p className="cap">Set goals in Settings and the gauges light up here.</p> : null}</div>
        </div>
        {activity.length ? <div className="hub-tv-activity" role="status" aria-live="polite">{activity.map((x) => <div className={`hub-tv-act ${x.kind}`} key={x.id}>{x.text}</div>)}</div> : null}
        <div className="hub-tv-brand"><span className="hub-tv-brand-p">Powered by</span> <b>Caalano<span>360</span></b></div>
      </div>
    )
  }
  if (screen === 'plan') {
    return (
      <div className="act-wrap hub-wrap">
        {head}
        {celebrate ? <HubGong key={celebrate.key} win={celebrate} currency={currency} onDone={() => { clearTimeout(strikeT.current); setCelebrate(null) }} /> : null}
        <HubPlanBoard clientId={clientId} goals={goalsAll} currency={currency} canEdit={!!(authUser && isAdminishFE(authUser.role))} today={today} pipelines={d.pipelines || []} reps={reps} />
        <p className="cap act-foot">Each period is measured on the same basis as the live board: won, lost and cash by close date, bookings by booking date, held and show rate by appointment date, leads by the date they came in. A blank cell uses the goal's default target; a typed number plans that period.</p>
      </div>
    )
  }
  return (
    <div className={`act-wrap hub-wrap ${busy ? 'hub-busy' : ''}`}>
      {head}
      {busy ? <div className="hub-loading" role="status" aria-live="polite"><span className="hub-loading-bar" /><span>{pendingPipe ? `Loading ${pendingPipe}…` : 'Refreshing the board…'}</span></div> : null}
      {setupPanel}
      {celebrate ? <HubGong key={celebrate.key} win={celebrate} currency={currency} onDone={() => { clearTimeout(strikeT.current); setCelebrate(null) }} /> : null}
      {primary}
      {secondary}
      {d.reach && d.reach.truncated && d.reach.since ? <p className="cap hub-reach">Closed deals are counted from leads created since {fmtDMY(d.reach.since)}: the CRM read holds the newest {fmtNumber(d.reach.opps)} opportunities, so a win on a lead older than that is not in these numbers.</p> : null}
      {multi && !focus && pipesAll.length > 1 ? <div className="hub-pipes">{pipesAll.map((p) => <button type="button" className="hub-pipe" key={p.id} disabled={busy} onClick={() => setPipeSel(p.id)} title="Show this pipeline only">
        <span className="hub-pipe-n">{p.name}</span>
        <span className="hub-pipe-row"><span><b>{money(p.revenue)}</b> revenue</span><span><b>{fmtNumber(p.won)}</b> won</span><span><b>{p.avgDeal != null ? money(p.avgDeal) : '-'}</b> avg deal</span><span><b>{fmtNumber(p.leads)}</b> leads</span><span><b>{hubPct(p.winRate)}</b> win rate</span><span><b>{fmtNumber(p.open)}</b> open{p.stale ? ` · ${p.stale} stale` : ''}</span></span>
        <span className="hub-pipe-go">{pendingPipe && pipeSel === p.id ? 'Loading…' : 'Focus ›'}</span>
      </button>)}</div> : null}
      {focus ? <div className="hub-focus"><span>Showing <b>{focus.name}</b> only. Leads, deals, speed to lead and stages are within it; appointments and calls are per rep across the account.</span><button type="button" className="btn-ghost sm" disabled={busy} onClick={() => setPipeSel('all')}>All pipelines</button></div> : null}
      {gaugeCard}
      {boardsGrid}
      <div className="hub-band">
        {flagsByRep.length ? <div className="card hub-flags"><div className="rep-lb-head"><h4>Coaching flags</h4><span className="cap">{flags.length} to talk about</span></div>{flagsByRep.map((g) => <button type="button" className={`hub-flag ${g.tone}`} key={g.rep.id} onClick={() => setOpenRep(openRep === g.rep.id ? null : g.rep.id)}><b>{g.rep.name}</b><ul>{g.items.map((t, i) => <li key={i}>{t}</li>)}</ul></button>)}</div> : null}
        {leaderboard}
      </div>
      <div className="card hub-board">
        <div className="rep-lb-head"><h4>Rep board</h4><span className="cap">tap a rep for the detail</span><label className="act-sel">Sort<select value={sortKey} onChange={(e) => setSortKey(e.target.value)}><option value="revenue">Revenue</option><option value="attain">Attainment</option><option value="won">Won</option><option value="booked">Booked</option><option value="showed">Held</option><option value="showRate">Show rate</option><option value="winRate">Win rate</option><option value="calls">Calls</option><option value="speed">Speed to lead</option><option value="stale">Stale</option><option value="leads">Leads</option></select></label></div>
        <div className="hub-board-rows">
          <div className="hub-row head"><span>Rep</span><span>Leads</span><span>Booked</span><span>Held</span><span>Show</span><span>Won</span><span>Revenue</span>{cashOn ? <span>Cash</span> : null}<span>Win</span><span>Calls</span><span>Min</span><span>Speed</span><span>Open</span><span>Stale</span><span>Target</span></div>
          {board.map((r) => { const a = attain(r); const s = status(r); return (
            <React.Fragment key={r.id}>
              <button type="button" className={`hub-row ${openRep === r.id ? 'open' : ''}`} onClick={() => setOpenRep(openRep === r.id ? null : r.id)}>
                <span className="hub-row-name"><b>{r.name}</b>{s ? <em className={`hub-chip ${s[1]}`}>{s[0]}</em> : null}</span>
                <span>{fmtNumber(r.leads)}</span><span>{fmtNumber(r.booked)}</span><span>{fmtNumber(r.showed)}</span><span>{hubPct(r.showRate)}</span><span>{fmtNumber(r.won)}</span><span>{money(r.revenue)}</span>{cashOn ? <span>{r.cash == null ? '-' : money(r.cash)}</span> : null}<span>{hubPct(r.winRate)}</span><span>{fmtNumber(r.calls)}</span><span>{fmtNumber(r.minutes)}</span><span>{r.speedMin != null ? repMin(r.speedMin) : '-'}</span><span>{fmtNumber(r.open)}</span><span className={r.staleTiers && r.staleTiers.t30 ? 'act-bad' : ''}>{fmtNumber(r.stale)}</span>
                <span>{a ? <span className="hub-attain"><i style={{ width: `${Math.min(100, a.pct)}%` }} className={s ? s[1] : ''} />{a.pct}%</span> : <span className="cap">-</span>}</span>
              </button>
              {openRep === r.id ? <div className="hub-row-detail">
                <div className="hub-detail-grid">
                  {facts('Appointments', [['Booked (assigned)', fmtNumber(r.booked)], ['Set by the rep', fmtNumber(r.set)], ['By customers', fmtNumber(r.byCustomer)], ['Held', fmtNumber(r.showed)], ['No-show', fmtNumber(r.noShow)], ['Still to come', fmtNumber(r.upcoming)], r.unresulted ? ['Unresulted', <span className="act-bad">{fmtNumber(r.unresulted)}</span>] : null])}
                  {facts('Pipeline now', [['Open deals', fmtNumber(r.open)], ['Open value', money(r.openValue)], ['Stale', <span className={r.stale ? 'act-bad' : ''}>{fmtNumber(r.stale)}</span>], ['7+ · 14+ · 21+ · 30+ days', `${r.staleTiers.t7} · ${r.staleTiers.t14} · ${r.staleTiers.t21} · ${r.staleTiers.t30}`], ['Oldest idle', r.oldestIdle ? `${r.oldestIdle} days` : '-']])}
                  {facts('Speed to lead', r.speedMin != null ? [['Median, in hours', repMin(r.speedMin)], ['Leads measured', fmtNumber(r.speedMeasured)], r.within5Pct != null ? ['Under 5 minutes', `${r.within5Pct}%`] : null, ['After hours', fmtNumber(r.speedAfter || 0)]] : [['Median', 'not measured']])}
                  {facts('Closing', [['Won', fmtNumber(r.won)], ['Lost', fmtNumber(r.lost)], ['Win rate', hubPct(r.winRate)], ['Result rate', r.resultRate != null ? `${r.resultRate}% · ${fmtNumber(r.decided)} decided` : '-'], ['Average deal', r.avgDeal ? money(r.avgDeal) : '-'], ['Days to close', r.avgCloseDays != null ? r.avgCloseDays : '-'], ...((r.lostReasons || []).slice(0, 3).map((x) => [`Lost: ${x.reason}`, fmtNumber(x.count)]))])}
                </div>
                <div className="hub-detail-funnels">{pipesAll.map((p) => {
                  const reach = (r.reachByPipeline || {})[p.id] || {}; const all = p.stages || []; const base = all.length ? (reach[all[0].name] || 0) : 0
                  if (!base) return null
                  const fun = hubFunnelStages(clientId, p); const stages = fun.stages
                  let last = 0; stages.forEach((sdef, i) => { if (reach[sdef.name]) last = i })
                  return <div className="hub-mini-funnel" key={p.id}><div className="hub-sub">{multi ? p.name : 'How this period\'s leads are progressing'} <span className="cap">· {fmtNumber(base)} leads this period{fun.keyed ? ' · key events' : ''}</span></div>{stages.slice(0, fun.keyed ? stages.length : Math.max(last + 1, Math.min(3, stages.length))).map((sdef) => <RepBar key={sdef.name} label={sdef.label} value={reach[sdef.name] || 0} max={base} text={`${fmtNumber(reach[sdef.name] || 0)} · ${Math.round(((reach[sdef.name] || 0) / base) * 100)}%`} />)}</div>
                })}</div>
              </div> : null}
            </React.Fragment>
          ) })}
        </div>
      </div>
      <div className={`hub-pipecards ${pipesAll.length > 1 ? 'many' : ''}`}>{pipesAll.map(pipeCard)}</div>
      <div className="rep-grid hub-bottom">
        <div className="card rep-card"><h4>Latest wins</h4>{allWins.length ? winsFeed(10) : <p className="cap">No wins in the last 7 days yet.</p>}</div>
        {calCard}
        {lostCard}
      </div>
      <p className="cap act-foot">Everything counts in the period it happened. Leads by the date they came in. Bookings by the date they were booked; held, no-shows and show rate by the appointment's own date. Won and lost by the date the status changed, whatever month the lead came in, so a deal closed today shows today; win rate is won over won plus lost decided in the period. Result rate is deals decided in the period over those plus what is still open now: how much of the desk got resulted. Open and stale are what is on the desk now. The funnels follow this period's leads through the client's key-event stages (set under Settings, Key events), so they show how new leads are progressing, not this month's wins; a lead counts at a stage if it reached that stage or any later one. Each pipeline's funnel and lost reasons are kept apart; a stage is never counted across pipelines. Speed to lead follows the client's business-hours rule and counts the first reply a person sent{team.speedFull ? ', measured on every lead' : ', measured on as many leads as the read allowed'}. Calls come from the CRM's call export. Re-reads every 3 minutes, every minute in TV mode.</p>
    </div>
  )
}

// ---- Deals & Actions ---------------------------------------------------------
// The rep's own app: three screens, swapped with one tap. "My results" is the
// scorecard and the leaderboard and is the home screen for anyone the CRM
// knows. "Live deals" is every open deal by pipeline stage, movable from here,
// with the contact's notes a tap away. "Action list" is what is wrong or
// unfinished: appointments past their time with no result, wins with no
// value, losses with no reason, enquiries nobody has answered (with a one-tap
// reply on the same channel), stale deals in urgency tiers, deals nobody owns.
// Writes go through the server, which limits an Account User to their own
// records and logs every change. Cards, not tables, so a phone shows it whole.
export const ACT_SECTIONS = {
  upcoming: ['Upcoming appointments', 'What is coming up, soonest first. Confirm, read the notes, or check the conversation before the call.'],
  appts: ['Appointments to result', 'New or confirmed appointments whose time has passed with no result yet. Pick one, then Save.'],
  wonNoValue: ['Won without a value', 'Marked won with no deal value, so revenue is understated.'],
  lostNoReason: ['Lost without a reason', 'Marked lost with no lost reason, so nothing can be learned from it.'],
  inbound: ['Messages with no reply', 'The contact wrote last and no person has replied since (an automation does not count).'],
  staleOpen: ['Stale deals', 'Open deals nobody has touched. The longer they sit, the redder they get.'],
  unassigned: ['No rep assigned', 'Open deals with nobody responsible for them.'],
}
export const ACT_TIERS = [[30, '30+ days', 't30'], [21, '21+ days', 't21'], [14, '14+ days', 't14'], [7, '7+ days', 't7']]
export const crmLink = (loc, contactId) => (loc && contactId ? `https://app.gohighlevel.com/v2/location/${encodeURIComponent(loc)}/contacts/detail/${encodeURIComponent(contactId)}` : null)
export const crmConvLink = (loc, convId) => (loc && convId ? `https://app.gohighlevel.com/v2/location/${encodeURIComponent(loc)}/conversations/conversations/${encodeURIComponent(convId)}` : null)
export function actWhen(ms, tz) {
  if (!ms) return '-'
  try { return new Date(ms).toLocaleString('en-AU', { timeZone: tz || undefined, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) } catch { return new Date(ms).toLocaleString() }
}
export const actAgo = (d) => (d == null ? '' : d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`)
export const actHrs = (h) => (h == null ? '' : h < 1 ? 'just now' : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`)
export const actTier = (r) => (r.idleDays == null ? null : r.idleDays >= 30 ? 't30' : r.idleDays >= 21 ? 't21' : r.idleDays >= 14 ? 't14' : r.idleDays >= 7 ? 't7' : null)
export function ActOpen({ href, label = 'Open in CRM' }) { return href ? <a className="act-open" href={href} target="_blank" rel="noreferrer">{label} ↗</a> : null }
export function ActTierBadge({ r }) { const t = actTier(r); return t ? <span className={`act-tier ${t}`}>{r.idleDays}d idle</span> : null }
export const ActWaiting = ({ r }) => (r && r.unreplied ? <span className="act-wait" title="The contact wrote last and nobody has replied">✉ Message waiting</span> : null)
// A write with ten seconds to change your mind. Press once and the button
// becomes "Undo · 9s"; leave it and the write goes on its own; press it again
// and nothing is sent. Leaving the screen while it counts sends it straight
// away rather than losing it. The row stays put while it counts, so the next
// row can be dealt with in the meantime.
export const ACT_UNDO_S = 10
export function ActCommit({ label, onCommit, disabled, className = 'btn-primary act-btn', seconds = ACT_UNDO_S }) {
  const [left, setLeft] = useState(null)
  const endAt = useRef(0), timer = useRef(null), armed = useRef(false), commitRef = useRef(onCommit)
  commitRef.current = onCommit
  const clear = () => { clearInterval(timer.current); timer.current = null; armed.current = false; setLeft(null) }
  const fire = () => { const fn = commitRef.current; clear(); fn() }
  useEffect(() => () => { if (armed.current) { const fn = commitRef.current; clearInterval(timer.current); armed.current = false; fn() } }, [])
  const arm = () => {
    endAt.current = Date.now() + seconds * 1000; armed.current = true; setLeft(seconds)
    timer.current = setInterval(() => { const ms = endAt.current - Date.now(); if (ms <= 0) fire(); else setLeft(Math.ceil(ms / 1000)) }, 250)
  }
  if (left != null) return <button type="button" className="btn-ghost act-btn act-undo" onClick={clear} title="Nothing has been sent yet. Press to cancel.">Undo · {left}s</button>
  return <button type="button" className={className} disabled={disabled} onClick={arm}>{label}</button>
}
// The contact's notes: read the past ones, add a new one. Shared by every row.
export function ActNotes({ clientId, contactId, canWrite, write, busy, userName }) {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState({ status: 'idle', notes: [] })
  const [text, setText] = useState('')
  const load = () => {
    setSt((s) => ({ ...s, status: 'loading' }))
    fetch(`/.netlify/functions/windsor?scope=actions&client=${encodeURIComponent(clientId)}&notes=${encodeURIComponent(contactId)}`, { credentials: 'same-origin' })
      .then((r) => r.json().catch(() => ({ error: `server ${r.status}` })))
      .then((j) => setSt({ status: j && j.error ? 'err' : 'ok', notes: (j && j.notes) || [], error: j && j.error }))
      .catch((e) => setSt({ status: 'err', notes: [], error: String((e && e.message) || e) }))
  }
  if (!contactId) return null
  if (!open) return <button type="button" className="btn-ghost sm" onClick={() => { setOpen(true); load() }}>Notes</button>
  return (
    <div className="act-panel">
      <div className="act-panel-head"><b>Notes</b><button type="button" className="btn-ghost sm" onClick={() => setOpen(false)}>Close</button></div>
      {st.status === 'loading' ? <p className="cap">Loading notes…</p> : st.status === 'err' ? <p className="cap act-bad">{st.error}</p> : !st.notes.length ? <p className="cap">No notes yet.</p> : (
        <div className="act-notes">{st.notes.map((n) => <div className="act-note-row" key={n.id}><div className="cap">{n.at ? new Date(n.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}{n.userId && userName && userName[n.userId] ? ` · ${userName[n.userId]}` : ''}</div><div className="act-note-body">{n.body}</div></div>)}</div>
      )}
      {canWrite ? <div className="act-note">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note…" rows={2} />
        <div className="act-note-btns"><button type="button" className="btn-primary act-btn" disabled={busy || !text.trim()} onClick={async () => { const ok = await write({ op: 'note', contactId, body: text.trim() }, contactId); if (ok) { setText(''); load() } }}>Save note</button></div>
      </div> : null}
    </div>
  )
}
// The contact's conversation: the last messages, a reply on the same channel
// (which marks the row handled), and the close-as-lost that an "I'm not
// interested" message usually deserves.
export const ACT_CHANNELS = { SMS: 'SMS', Email: 'Email', WhatsApp: 'WhatsApp', FB: 'Facebook', IG: 'Instagram', Live_Chat: 'Live chat' }
export function ActConversation({ clientId, row, data, canWrite, write, busy, loc, userName, keep = false, label = 'Open & reply' }) {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState({ status: 'idle', conv: null })
  const [text, setText] = useState('')
  const [subject, setSubject] = useState('')
  const [channel, setChannel] = useState('')
  const [reason, setReason] = useState('')
  const load = () => {
    setSt((s) => ({ ...s, status: 'loading' }))
    const q = row.id ? `&convId=${encodeURIComponent(row.id)}` : `&conv=${encodeURIComponent(row.contactId || '')}`
    fetch(`/.netlify/functions/windsor?scope=actions&client=${encodeURIComponent(clientId)}${q}`, { credentials: 'same-origin' })
      .then((r) => r.json().catch(() => ({ error: `server ${r.status}` })))
      .then((j) => setSt({ status: j && j.error ? 'err' : 'ok', conv: (j && j.conversation) || null, error: j && j.error }))
      .catch((e) => setSt({ status: 'err', conv: null, error: String((e && e.message) || e) }))
  }
  if (!open) return <button type="button" className={`${keep ? 'btn-ghost' : 'btn-primary'} act-btn`} onClick={() => { setOpen(true); load() }}>{label}</button>
  const conv = st.conv || {}
  // Reply channel: defaults to the one the contact last wrote on (an inbound
  // SMS gets an SMS back); the picker offers every channel seen in the thread
  // plus SMS / e-mail when the contact has a number / address on file.
  const channels = Array.from(new Set([...(conv.channels || []), ...(row.phone ? ['SMS'] : []), ...(row.email ? ['Email'] : [])])).filter((c) => ACT_CHANNELS[c])
  const replyType = channel && channels.includes(channel) ? channel : (conv.replyType || channels[0] || 'SMS')
  const canReply = canWrite && !!ACT_CHANNELS[replyType]
  return (
    <div className="act-panel act-conv">
      <div className="act-panel-head"><b>Conversation</b>
        {channels.length > 1 ? <label className="act-chan cap">Reply by
          <select value={replyType} onChange={(e) => setChannel(e.target.value)}>{channels.map((c) => <option key={c} value={c}>{ACT_CHANNELS[c]}</option>)}</select>
        </label> : <span className="cap">{ACT_CHANNELS[replyType] || replyType}</span>}
        <button type="button" className="btn-ghost sm" onClick={() => setOpen(false)}>Close</button></div>
      {st.status === 'loading' ? <p className="cap">Loading messages…</p> : st.status === 'err' ? <p className="cap act-bad">{st.error}</p> : !(conv.messages || []).length ? <p className="cap">No messages found.</p> : (
        <div className="act-msgs">{conv.messages.map((m) => <div key={m.id} className={`act-msg-b ${m.direction === 'inbound' ? 'in' : 'out'}`}><div>{m.body || <i className="cap">({String(m.type || 'message').replace(/^TYPE_/, '').toLowerCase()})</i>}</div><div className="cap">{m.at ? new Date(m.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}{m.direction === 'outbound' ? (m.userId ? ` · ${(userName && userName[m.userId]) || 'staff'}` : ' · automation') : ''}</div></div>)}</div>
      )}
      {canReply ? <div className="act-note">
        {replyType === 'Email' ? <input className="act-in" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)" maxLength={200} /> : null}
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply by ${ACT_CHANNELS[replyType] || replyType}…`} rows={2} />
        <div className="act-note-btns">
          <button type="button" className="btn-primary act-btn" disabled={busy || !text.trim()} onClick={async () => { const ok = await write({ op: 'reply', contactId: row.contactId, conversationId: conv.id || row.id, type: replyType, body: text.trim(), ...(replyType === 'Email' && subject.trim() ? { subject: subject.trim() } : {}) }, row.id, null, !keep); if (ok && keep) { setText(''); load() } }}>{keep ? 'Send' : 'Send & mark handled'}</button>
          <ActOpen href={crmConvLink(loc, row.id)} label="Open in CRM" />
        </div>
      </div> : <div className="act-ctl"><ActOpen href={crmConvLink(loc, row.id)} label="Reply in CRM" /></div>}
      {canWrite && row.oppId && !keep ? <div className="act-ctl act-close-lost">
        <span className="cap">Not interested?</span>
        <select className="act-in" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Lost reason…</option>{(data.lostReasons || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <ActCommit label="Mark lost" className="btn-ghost act-btn" disabled={busy || !reason} onCommit={async () => { const ok = await write({ op: 'opp', oppId: row.oppId, patch: { status: 'lost', lostReasonId: reason } }, row.oppId); if (ok) await write({ op: 'dismiss', id: row.id }, row.id, null, true) }} />
      </div> : null}
    </div>
  )
}
// Move a deal along, or close it, from one compact control set.
export function ActDealControls({ d, data, busy, write, currency }) {
  const [stage, setStage] = useState(d.stageId || '')
  useEffect(() => { setStage(d.stageId || '') }, [d.stageId])
  const [close, setClose] = useState('')
  const [val, setVal] = useState(d.value > 0 ? String(d.value) : '')
  const [reason, setReason] = useState('')
  const pipe = (data.pipelines || []).find((p) => p.id === d.pipelineId) || (data.pipelines || [])[0]
  const stages = pipe ? pipe.stages : []
  return (
    <div className="act-ctl">
      {stages.length ? <label className="act-sel">Stage
        <select value={stage} disabled={busy} onChange={(e) => setStage(e.target.value)}>
          {!d.stageId ? <option value="">-</option> : null}
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label> : null}
      {stage && stage !== (d.stageId || '') ? <button type="button" className="btn-primary act-btn" disabled={busy} onClick={async () => { const ok = await write({ op: 'opp', oppId: d.id, patch: { pipelineStageId: stage, ...(pipe ? { pipelineId: pipe.id } : {}) } }, d.id, { stageId: stage, stage: (stages.find((s) => s.id === stage) || {}).name }); if (!ok) setStage(d.stageId || '') }}>Save stage</button> : null}
      <label className="act-sel">Close as
        <select value={close} disabled={busy} onChange={(e) => setClose(e.target.value)}><option value="">-</option><option value="won">Won</option><option value="lost">Lost</option></select>
      </label>
      {close === 'won' ? <>
        <input className="act-in" type="number" min="0" step="1" inputMode="decimal" placeholder={`Value (${currency || 'AUD'})`} value={val} onChange={(e) => setVal(e.target.value)} />
        <ActCommit label="Mark won" disabled={busy || !(Number(val) > 0)} onCommit={() => write({ op: 'opp', oppId: d.id, patch: { status: 'won', monetaryValue: Number(val) } }, d.id, null, true)} />
        {!(Number(val) > 0) ? <span className="cap">Enter the deal value first.</span> : null}
      </> : null}
      {close === 'lost' ? <>
        <select className="act-in" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Lost reason…</option>{(data.lostReasons || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <ActCommit label="Mark lost" disabled={busy || !reason} onCommit={() => write({ op: 'opp', oppId: d.id, patch: { status: 'lost', lostReasonId: reason } }, d.id, null, true)} />
        {!reason ? <span className="cap">Pick a lost reason first.</span> : null}
      </> : null}
    </div>
  )
}
// ---- My results: the rep scorecard and the leaderboard -------------------------
export const REP_PERIODS = [['last_7d', 'Last 7 days'], ['last_14d', 'Last 14 days'], ['last_30d', 'Last 30 days'], ['this_month', 'This month'], ['last_month', 'Last month'], ['last_90d', 'Last 90 days']]
export const LB_KEYS = [['won', 'Closed deals'], ['revenue', 'Revenue'], ['cash', 'Cash collected'], ['booked', 'Booked'], ['showed', 'Shown'], ['winRate', 'Win rate'], ['showRate', 'Show rate'], ['calls', 'Calls made'], ['minutes', 'Minutes on the phone'], ['leads', 'Leads']]
export const repMin = (m) => (m == null ? '-' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`)
export function RepTile({ label, value, sub, tone, rank }) {
  return <div className={`rep-tile ${tone || ''}`}><div className="rep-tile-l">{label}{rank ? <span className="rep-rank">#{rank.rank}</span> : null}</div><div className="rep-tile-v">{value}</div>{sub ? <div className="rep-tile-s">{sub}</div> : null}</div>
}
export function RepBar({ label, value, max, text, tone }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return <div className="rep-bar"><div className="rep-bar-l"><span>{label}</span><b>{text != null ? text : fmtNumber(value)}</b></div><div className="rep-bar-t"><div className={`rep-bar-f ${tone || ''}`} style={{ width: `${w}%` }} /></div></div>
}
export function RepLeaderboard({ rows, meId, currency }) {
  const [key, setKey] = useState('won')
  const money = (v) => fmtCurrency(v || 0, currency)
  const fmt = (r, k) => (k === 'revenue' || k === 'cash' ? (r[k] == null ? '-' : money(r[k])) : k === 'winRate' || k === 'showRate' ? (r[k] == null ? '-' : `${r[k]}%`) : fmtNumber(r[k] || 0))
  const sorted = [...(rows || [])].sort((a, b) => ((b[key] == null ? -1 : b[key]) - (a[key] == null ? -1 : a[key])) || (b.won - a.won) || (b.revenue - a.revenue))
  const top = sorted.slice(0, 3)
  const mePos = sorted.findIndex((r) => r.id === meId)
  const medal = ['🥇', '🥈', '🥉']
  return (
    <div className="card rep-card rep-lb">
      <div className="rep-lb-head"><h4>Leaderboard</h4><label className="act-sel"><select value={key} onChange={(e) => setKey(e.target.value)}>{LB_KEYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
      {!sorted.length ? <p className="cap">No reps had leads in this period.</p> : <>
        <div className="rep-podium">{top.map((r, i) => <div key={r.id} className={`rep-pod ${r.id === meId ? 'me' : ''} p${i + 1}`}><div className="rep-pod-m">{medal[i]}</div><b>{r.name}{r.id === meId ? ' (you)' : ''}</b><div className="rep-pod-v">{fmt(r, key)}</div><div className="cap">{key === 'won' ? money(r.revenue) : `${r.won} won`}</div></div>)}</div>
        {mePos >= 0 ? <p className="rep-lb-me">You are <b>#{mePos + 1} of {sorted.length}</b> on {LB_KEYS.find(([k]) => k === key)[1].toLowerCase()}{mePos > 0 ? `, ${key === 'revenue' ? money(sorted[mePos - 1][key] - sorted[mePos][key]) : `${Math.max(0, (sorted[mePos - 1][key] || 0) - (sorted[mePos][key] || 0))}${key.endsWith('Rate') ? ' points' : ''}`} behind ${sorted[mePos - 1].name}` : ' - top of the board'}.</p> : null}
        <div className="rep-lb-rows">
          <div className="rep-lb-row head"><span>#</span><span>Rep</span><span>Leads</span><span>Booked</span><span>Shown</span><span>Won</span><span>Revenue</span><span>Win</span><span>Show</span><span>Calls</span><span>Min</span></div>
          {sorted.map((r, i) => <div key={r.id} className={`rep-lb-row ${r.id === meId ? 'me' : ''}`}><span>{i + 1}</span><span className="rep-lb-name">{r.name}</span><span>{fmtNumber(r.leads)}</span><span>{fmtNumber(r.booked)}</span><span>{fmtNumber(r.showed)}</span><span>{fmtNumber(r.won)}</span><span>{money(r.revenue)}</span><span>{r.winRate == null ? '-' : `${r.winRate}%`}</span><span>{r.showRate == null ? '-' : `${r.showRate}%`}</span><span>{fmtNumber(r.calls || 0)}</span><span>{fmtNumber(r.minutes || 0)}</span></div>)}
        </div>
      </>}
    </div>
  )
}
// ---- Rep KPIs: monthly targets per rep, and the cockpit that tracks them ------
// An Agency Admin sets monthly targets per client (a default for every rep,
// overridable per rep). My results opens with "This month": each target as a
// bar with a pace mark for where the month is up to, green when on pace.
export const REP_KPI_DEFS = [
  ['revenue', 'Revenue', 'money'], ['cash', 'Cash collected', 'money'], ['won', 'Deals closed', 'count'], ['avgDeal', 'Average deal value', 'money'],
  ['booked', 'Meetings booked', 'count'], ['userBooked', 'Set by the rep', 'count'], ['held', 'Meetings held', 'count'],
  ['showRate', 'Show rate', 'pct'], ['winRate', 'Win rate', 'pct'], ['calls', 'Calls made', 'count'], ['minutes', 'Minutes on the phone', 'count'],
  ['speedMin', 'Speed to lead (median minutes)', 'lower'], ['leads', 'Leads', 'count'],
]
export function loadRepKpis(clientId) { const v = (SETTINGS.repkpis && SETTINGS.repkpis[clientId]) || {}; return { default: v.default || {}, byUser: v.byUser || {} } }
export function saveRepKpis(clientId, obj) {
  SETTINGS.repkpis = { ...(SETTINGS.repkpis || {}), [clientId]: obj }
  writeLS(REPKPI_KEY, SETTINGS.repkpis); saveSettingsRemote({ repkpis: { [clientId]: obj } }); bumpSettings()
}
// Goals for a client. Until goals are saved once, the old Rep KPIs are shown
// as goals (a default is "each rep gets this"; a per-rep number is that rep's
// own goal), so nothing set before is lost.
export function loadGoals(clientId) {
  const v = SETTINGS.goals && SETTINGS.goals[clientId]
  if (v && Array.isArray(v.goals)) return normGoals(v.goals)
  return migrateRepKpis(loadRepKpis(clientId))
}
export const goalsSaved = (clientId) => !!(SETTINGS.goals && SETTINGS.goals[clientId] && Array.isArray(SETTINGS.goals[clientId].goals))
export function saveGoals(clientId, goals) {
  const obj = { goals: normGoals(goals), savedAt: Date.now() }
  SETTINGS.goals = { ...(SETTINGS.goals || {}), [clientId]: obj }
  writeLS(GOALS_KEY, SETTINGS.goals); saveSettingsRemote({ goals: { [clientId]: obj } }); bumpSettings()
}
// A rep's own monthly targets: their share of every goal that covers them.
export const repTargetsFor = (clientId, userId, allRepIds = null) => repTargetsFromGoals(loadGoals(clientId), userId, allRepIds, tzTodayStr())
// Goals: business, pipeline and rep targets in one builder. Metric, target,
// which pipelines, which reps, and how the number is split among them.
export function GoalsEditor({ clientId, currency }) {
  const [meta, setMeta] = useState({ users: null, pipelines: [] })
  const [goals, setGoals] = useState(() => loadGoals(clientId))
  const [edit, setEdit] = useState(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setGoals(loadGoals(clientId)); setEdit(null) }, [clientId])
  useEffect(() => {
    fetch(`/.netlify/functions/windsor?scope=crmusers&withDeals=1&pipelines=1&client=${encodeURIComponent(clientId)}`, { credentials: 'same-origin' })
      .then((r) => r.json().catch(() => ({}))).then((j) => setMeta({ users: (j && j.users) || [], pipelines: (j && j.pipelines) || [] })).catch(() => setMeta({ users: [], pipelines: [] }))
  }, [clientId])
  const users = meta.users || []
  const repIds = users.map((u) => u.id)
  const nameOf = (id) => (users.find((u) => u.id === id) || {}).name || 'Former rep'
  const pipeName = (id) => (meta.pipelines.find((p) => p.id === id) || {}).name || 'Pipeline'
  const fmtT = (g) => { const m = goalMetric(g.metric) || []; return m[2] === 'money' ? fmtCurrency(g.target, currency) : m[2] === 'pct' ? `${g.target}%` : m[2] === 'lower' ? `${g.target} min` : fmtNumber(g.target) }
  const persist = (next) => { setGoals(next); saveGoals(clientId, next); setSaved(true); setTimeout(() => setSaved(false), 2000) }
  const blank = () => ({ id: newGoalId(), name: '', metric: 'revenue', target: '', period: 'month', from: '', to: '', endsOn: '', byMonth: {}, byQuarter: {}, pipelines: null, reps: null, split: 'even', weights: {}, shares: {} })
  const today = tzTodayStr()
  // Progress for every goal in its own window, from the same read the hub uses.
  const prog = useGoalProgress(clientId, goals, 0)
  const periodLabel = (g) => (g.period === 'quarter' ? 'quarterly' : g.period === 'range' ? `${g.from} to ${g.to}` : 'monthly')
  const groups = [['business', 'Business and team goals', 'Every pipeline; all reps or the reps ticked.'], ['pipeline', 'Pipeline goals', 'One or more pipelines; split among the reps attached.'], ['rep', 'Rep goals', 'One rep\'s own target. Beats any share of a wider goal for the same metric.']]
  const summary = (g) => {
    const m = goalMetric(g.metric) || []
    const scope = [g.pipelines ? g.pipelines.map(pipeName).join(', ') : 'All pipelines', g.reps ? g.reps.map(nameOf).join(', ') : 'All reps'].join(' · ')
    const split = (SPLITS.find(([k]) => k === (g.reps && g.reps.length === 1 ? 'each' : g.split)) || [])[1] || ''
    const plan = Object.keys(g.byMonth || {}).length + Object.keys(g.byQuarter || {}).length
    return `${m[1]} · ${fmtT(g)} ${periodLabel(g)}${plan ? ` · ${plan} planned` : ''}${g.endsOn ? ` · until ${g.endsOn}` : ''} · ${scope}${m[2] === 'pct' || m[2] === 'lower' || RATE_METRICS.has(g.metric) || (g.reps && g.reps.length === 1) ? '' : ` · ${split.toLowerCase()}`}`
  }
  const form = edit ? (() => {
    const g = edit; const m = goalMetric(g.metric) || []; const isRate = m[2] === 'pct' || m[2] === 'lower' || RATE_METRICS.has(g.metric)
    const set = (patch) => setEdit({ ...g, ...patch })
    const ids = g.reps || repIds
    const errs = validateGoal({ ...g, target: Number(g.target) }, repIds)
    const toggle = (list, id) => { const cur = list || []; return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }
    const shares = goalShares({ ...g, target: Number(g.target) || 0 }, repIds)
    return (
      <div className="card goal-form">
        <div className="rep-lb-head"><h4>{goals.some((x) => x.id === g.id) ? 'Edit goal' : 'New goal'}</h4><button type="button" className="btn-ghost sm" onClick={() => setEdit(null)}>Cancel</button></div>
        <div className="goal-grid">
          <label className="goal-f">Metric<select value={g.metric} onChange={(e) => { const mm = goalMetric(e.target.value); set({ metric: e.target.value, pipelines: mm && !mm[3] ? null : g.pipelines }) }}>{GOAL_METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="goal-f">Period<select value={g.period} onChange={(e) => set({ period: e.target.value })}><option value="month">Monthly, recurring</option><option value="quarter">Quarterly, recurring</option><option value="range">Custom dates, once</option></select></label>
          <label className="goal-f">Target {g.period === 'quarter' ? 'a quarter' : g.period === 'range' ? 'for the dates' : 'a month'}{m[2] === 'pct' ? ' (%)' : m[2] === 'lower' ? ' (minutes)' : m[2] === 'money' ? ` (${currency || 'AUD'})` : ''}<input type="number" min="0" step={m[2] === 'money' ? '100' : '1'} inputMode="decimal" value={g.target} onChange={(e) => set({ target: e.target.value })} /></label>
          {g.period === 'range' ? <><label className="goal-f">From<input type="date" value={g.from || ''} onChange={(e) => set({ from: e.target.value })} /></label><label className="goal-f">To<input type="date" value={g.to || ''} onChange={(e) => set({ to: e.target.value })} /></label></>
            : <label className="goal-f">Runs until <span className="cap">(optional)</span><input type="month" value={g.endsOn || ''} onChange={(e) => set({ endsOn: e.target.value })} /></label>}
          <label className="goal-f">Name <span className="cap">(optional)</span><input type="text" value={g.name} placeholder={m[1] ? `${m[1]} goal` : ''} onChange={(e) => set({ name: e.target.value })} /></label>
        </div>
        <div className="goal-f"><span>Pipelines</span>{m[3] === false ? <p className="cap">{m[1]} is per rep, not per pipeline.</p> : <div className="hub-chips">
          <button type="button" className={`goal-chip ${!g.pipelines ? 'on' : ''}`} onClick={() => set({ pipelines: null })}>All pipelines</button>
          {meta.pipelines.map((p) => <button type="button" key={p.id} className={`goal-chip ${g.pipelines && g.pipelines.includes(p.id) ? 'on' : ''}`} onClick={() => { const n = toggle(g.pipelines, p.id); set({ pipelines: n.length ? n : null }) }}>{p.name}</button>)}
        </div>}</div>
        <div className="goal-f"><span>Reps</span><div className="hub-chips">
          <button type="button" className={`goal-chip ${!g.reps ? 'on' : ''}`} onClick={() => set({ reps: null })}>All reps</button>
          {users.map((u) => <button type="button" key={u.id} className={`goal-chip ${g.reps && g.reps.includes(u.id) ? 'on' : ''}`} onClick={() => { const n = toggle(g.reps, u.id); set({ reps: n.length ? n : null }) }}>{u.name}</button>)}
          {meta.users === null ? <span className="cap">Loading reps…</span> : null}
        </div></div>
        {g.period !== 'range' ? <div className="goal-f"><span>Plan {g.period === 'quarter' ? 'quarter by quarter' : 'month by month'} <span className="cap">(optional · blank means the default target)</span></span>
          <div className="goal-plan">{(g.period === 'quarter' ? quarterKeysFrom(today, 4) : monthKeysFrom(today, 12)).map((k) => { const map = g.period === 'quarter' ? 'byQuarter' : 'byMonth'; const cur = (g[map] || {})[k]; return <label key={k}><span>{g.period === 'quarter' ? k.replace('-', ' ') : new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1).toLocaleString('en-AU', { month: 'short', year: '2-digit' })}</span><input type="number" min="0" placeholder={g.target || ''} value={cur ?? ''} onChange={(e) => { const next = { ...(g[map] || {}) }; if (e.target.value === '') delete next[k]; else next[k] = e.target.value; set({ [map]: next }) }} /></label> })}</div></div> : null}
        {!isRate && !(g.reps && g.reps.length === 1) ? <label className="goal-f">How the number is shared<select value={g.split} onChange={(e) => set({ split: e.target.value })}>{SPLITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label> : null}
        {!isRate && (g.split === 'weighted' || g.split === 'custom') && !(g.reps && g.reps.length === 1) ? <div className="goal-f"><span>{g.split === 'weighted' ? 'Percentage per rep' : 'Amount per rep'}</span>
          <div className="goal-shares">{ids.map((id) => <label key={id}><span>{nameOf(id)}</span><input type="number" min="0" step={g.split === 'weighted' ? '1' : '1'} value={g.split === 'weighted' ? (g.weights[id] ?? '') : (g.shares[id] ?? '')} onChange={(e) => set(g.split === 'weighted' ? { weights: { ...g.weights, [id]: e.target.value } } : { shares: { ...g.shares, [id]: e.target.value } })} />{g.split === 'weighted' ? <b>= {shares[id] != null ? fmtT({ ...g, target: shares[id] }) : '-'}</b> : null}</label>)}</div>
          <p className="cap">{g.split === 'weighted' ? `Adds up to ${ids.reduce((a, id) => a + (Number(g.weights[id]) || 0), 0)}%` : `Adds up to ${fmtT({ ...g, target: ids.reduce((a, id) => a + (Number(g.shares[id]) || 0), 0) })} of ${fmtT({ ...g, target: Number(g.target) || 0 })}`}</p></div> : null}
        {!isRate && g.split === 'even' && ids.length && Number(g.target) > 0 ? <p className="cap">Each of the {ids.length} reps gets {fmtT({ ...g, target: shares[ids[0]] || 0 })}.</p> : null}
        {errs.length ? <ul className="goal-errs">{errs.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
        <div className="act-note-btns"><button type="button" className="btn-primary act-btn" disabled={errs.length > 0} onClick={() => { const next = goals.some((x) => x.id === g.id) ? goals.map((x) => (x.id === g.id ? { ...g, target: Number(g.target) } : x)) : [...goals, { ...g, target: Number(g.target) }]; persist(next); setEdit(null) }}>Save goal</button></div>
      </div>
    )
  })() : null
  return (
    <div className="goals">
      <p className="cap" style={{ marginTop: 0 }}>A goal is a metric, a target for a period (monthly or quarterly recurring, or custom dates once), which pipelines and which reps it covers, and how the number is shared among those reps. A recurring goal can carry a plan with a different number for particular months or quarters, and can stop after a given month. A goal on every pipeline and every rep is a business goal; on one pipeline, a pipeline goal; on one rep, that rep's own target. Business and pipeline goals become the dials on the Sales Hub; a rep's share shows on their My results cockpit. {!goalsSaved(clientId) && goals.length ? 'The Rep KPIs set earlier are shown here as goals; save any change and they are kept as goals from then on.' : ''}</p>
      <div className="act-note-btns" style={{ marginBottom: 12 }}><button type="button" className="btn-primary act-btn" disabled={!!edit} onClick={() => setEdit(blank())}>New goal</button>{saved ? <span className="cap">Saved.</span> : null}</div>
      {form}
      {groups.map(([lvl, title, hint]) => { const list = goals.filter((g) => goalLevel(g) === lvl); return (
        <div className="goal-group" key={lvl}><div className="hub-sub">{title} <span className="cap">· {hint}</span></div>
          {list.length ? list.map((g) => { const p = prog[g.id]; const m = goalMetric(g.metric) || []; const fmtV = (v) => (v == null ? '-' : m[2] === 'money' ? fmtCurrency(v, currency) : m[2] === 'pct' ? `${v}%` : m[2] === 'lower' ? `${v} min` : fmtNumber(v)); return <div className="goal-row" key={g.id}><div><b>{g.name || m[1]}</b><div className="cap">{summary(g)}</div>{p ? <div className="cap goal-prog">{p.window.label}: <b>{fmtV(p.actual)}</b> of {fmtV(p.target)}{p.actual != null && p.target && m[2] !== 'lower' ? ` · ${Math.round((p.actual / p.target) * 100)}%` : ''}{p.window.notYet ? ' · not started' : ''}</div> : null}</div><div className="act-note-btns"><button type="button" className="btn-ghost sm" onClick={() => setEdit({ ...g, target: String(g.target), from: g.from || '', to: g.to || '', endsOn: g.endsOn || '' })}>Edit</button><button type="button" className="btn-ghost sm" onClick={() => { if (window.confirm('Delete this goal?')) persist(goals.filter((x) => x.id !== g.id)) }}>Delete</button></div></div> }) : <p className="cap">None yet.</p>}
        </div>) })}
    </div>
  )
}
export function RepCockpit({ clientId, rep, currency, nonce, canEdit }) {
  const st = useRepCard(clientId, rep, 'this_month', nonce)
  useSettingsSync()
  const targets = repTargetsFor(clientId, rep)
  const keys = REP_KPI_DEFS.filter(([k]) => targets[k] > 0)
  const now = new Date()
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const day = now.getDate()
  const elapsed = Math.min(1, Math.max(0.03, day / dim))
  if (!keys.length) return canEdit ? <div className="card rep-cockpit-empty"><b>No monthly targets yet.</b> <span className="cap">Set goals in Settings → this client → Goals, and this becomes the rep's cockpit.</span></div> : null
  const d = st.data || {}
  const ap = d.appointments || {}
  const actual = {
    revenue: d.revenue || 0, cash: (d.cash && d.cash.collected) || 0, won: d.won || 0, booked: ap.booked || 0, userBooked: ap.set != null ? ap.set : (ap.byStaff || 0), held: ap.showed || 0,
    avgDeal: d.avgDeal == null ? null : d.avgDeal, showRate: ap.showRate, winRate: d.winRate, calls: (d.calls && d.calls.outbound) || 0, minutes: (d.calls && d.calls.minutes) || 0, speedMin: d.speed ? d.speed.medianMin : null, leads: d.leads || 0,
  }
  const fmt = (k, v, kind) => (v == null ? '-' : kind === 'money' ? fmtCurrency(v, currency) : kind === 'pct' ? `${v}%` : kind === 'lower' ? repMin(v) : fmtNumber(v))
  const monthName = now.toLocaleString('en-AU', { month: 'long' })
  return (
    <div className="card rep-cockpit">
      <div className="rep-cockpit-head"><h4>This month · {monthName}</h4><span className="cap">Day {day} of {dim} · {Math.round(elapsed * 100)}% of the month gone{st.status === 'loading' ? ' · updating…' : ''}</span></div>
      <div className="rep-cockpit-grid">
        {keys.map(([k, label, kind]) => {
          const t = targets[k], a = actual[k]
          let ratio, status, sub
          if (kind === 'lower') { ratio = a == null ? 0 : Math.min(1, t / Math.max(a, 0.01)); status = a == null ? '' : a <= t ? 'good' : a <= t * 1.5 ? 'warn' : 'bad'; sub = a == null ? 'not measured yet' : a <= t ? 'inside target' : `${repMin(a - t)} over target` }
          else if (kind === 'pct') { ratio = a == null ? 0 : Math.min(1, a / t); status = a == null ? '' : a >= t ? 'good' : a >= t * 0.85 ? 'warn' : 'bad'; sub = a == null ? 'nothing to rate yet' : a >= t ? 'on target' : `${t - a} points short` }
          else if (RATE_METRICS.has(k)) { ratio = a == null ? 0 : Math.min(1, a / t); status = a == null ? '' : a >= t ? 'good' : a >= t * 0.85 ? 'warn' : 'bad'; sub = a == null ? 'nothing won yet' : a >= t ? 'on target' : `${fmt(k, t - a, kind)} under target` }
          else { ratio = Math.min(1, (a || 0) / t); const paceNeed = t * elapsed; status = (a || 0) >= paceNeed ? 'good' : (a || 0) >= paceNeed * 0.8 ? 'warn' : 'bad'; const left = Math.max(0, t - (a || 0)); sub = (a || 0) >= t ? 'target hit' : `${fmt(k, left, kind)} to go · pace says ${fmt(k, Math.round(paceNeed), kind)} by today` }
          return (
            <div className={`rep-kpi ${status}`} key={k}>
              <div className="rep-kpi-l"><span>{label}</span><b>{fmt(k, a, kind)}<small> / {fmt(k, t, kind)}</small></b></div>
              <div className="rep-kpi-t"><div className="rep-kpi-f" style={{ width: `${Math.round(ratio * 100)}%` }} />{(kind === 'count' || kind === 'money') && !RATE_METRICS.has(k) ? <div className="rep-kpi-pace" style={{ left: `${Math.round(elapsed * 100)}%` }} title="Where the month is up to" /> : null}</div>
              <div className="cap">{sub}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The client's own key events (Settings -> Key events), read for one rep: a
// stage event is the leads that reached that stage, a calendar event is the
// appointments booked on that calendar (with how many showed).
export function repKeyEventRows(clientId, d) {
  const ke = mergeCalKeyEvents(normKeyEvents(loadKeyEvents(clientId)))
  const out = []
  for (const e of ke) {
    if (!e || WON_RE.test(e.label)) continue
    if (e.kind === 'calendar') { const c = (d.byCalendar || {})[e.ref]; out.push({ label: e.label, kind: 'calendar', count: c ? c.booked : 0, showed: c ? c.showed : 0 }) }
    else if (e.kind === 'stage') out.push({ label: e.label, kind: 'stage', count: (d.stages || {})[e.ref] || 0 })
  }
  return out
}
export function RepKeyEvents({ clientId, d }) {
  const rows = repKeyEventRows(clientId, d)
  if (!rows.length) return null
  const max = Math.max(1, d.leads || 0, ...rows.map((r) => r.count))
  return (
    <div className="card rep-card">
      <h4>Key events</h4>
      <RepBar label="Leads" value={d.leads || 0} max={max} />
      {rows.map((r) => <RepBar key={r.kind + r.label} label={`${r.kind === 'calendar' ? '📅 ' : ''}${r.label}`} value={r.count} max={max} text={`${fmtNumber(r.count)} · ${d.leads ? Math.round((r.count / d.leads) * 100) : 0}%${r.kind === 'calendar' && r.count ? ` · ${r.showed} showed` : ''}`} tone={r.kind === 'calendar' ? 'good' : ''} />)}
      <RepBar label="Won" value={d.won || 0} max={max} tone="good" text={`${fmtNumber(d.won || 0)} · ${d.leads ? Math.round(((d.won || 0) / d.leads) * 100) : 0}%`} />
    </div>
  )
}
export function RepCardView({ clientId, authUser, currency, reps, meId, nonce, onGoActions, selfOnly = false }) {
  const isViewer = selfOnly
  const [period, setPeriod] = useState('last_30d')
  const [rep, setRep] = useState(meId || '')
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [tick, setTick] = useState(0)
  useEffect(() => { if (!rep && meId) setRep(meId) }, [meId]) // eslint-disable-line
  useEffect(() => {
    if (!isViewer && !rep) { setSt({ status: 'pick', data: null }); return }
    let dead = false
    setSt((s) => ({ status: s.data ? 'refreshing' : 'loading', data: s.data }))
    const r = presetRange(period)
    const qs = `scope=repcard&client=${encodeURIComponent(clientId)}&${rangeQuery(r)}&preset=${period}${!isViewer && rep ? `&user=${encodeURIComponent(rep)}` : ''}${hoursQuery(loadHours(clientId))}${tick || nonce ? `&_r=${tick}.${nonce || 0}` : ''}`
    fetch(`/.netlify/functions/windsor?${qs}`, { credentials: 'same-origin' })
      .then((x) => x.json().catch(() => ({ error: `server ${x.status}` })))
      .then((j) => { if (!dead) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch((e) => { if (!dead) setSt({ status: 'err', data: { error: String((e && e.message) || e) } }) })
    return () => { dead = true }
  }, [clientId, period, rep, isViewer, tick, nonce])
  const d = st.data || {}
  const money = (v) => fmtCurrency(v || 0, currency)
  const pct = (v) => (v == null ? '-' : `${v}%`)
  const head = (
    <div className="act-bar">
      <div className="act-filters">
        {!isViewer ? <label className="act-sel"><select value={rep} onChange={(e) => setRep(e.target.value)}><option value="">Pick a rep…</option>{(reps || []).map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === meId ? ' (me)' : ''}</option>)}</select></label> : null}
        <label className="act-sel"><select value={period} onChange={(e) => setPeriod(e.target.value)}>{REP_PERIODS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        <button type="button" className="btn-ghost sm" disabled={st.status === 'refreshing'} onClick={() => setTick((t) => t + 1)}>{st.status === 'refreshing' ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </div>
  )
  if (st.status === 'pick') return <div className="act-wrap">{head}<div className="card act-clear"><span className="cap">Pick a rep to see their results.</span></div></div>
  if (st.status === 'loading') return <div className="act-wrap">{head}<div className="card"><Spinner label="Adding up the period…" /></div></div>
  if (st.status === 'err') return <div className="act-wrap">{head}<div className="card"><p className="cap act-bad" style={{ margin: 0 }}>{d.error || 'Could not load.'}</p></div></div>
  const ap = d.appointments || {}
  const sp = d.speed
  const now = d.now || { stale: {} }
  const stale = now.stale || {}
  const team = d.team || {}
  const rk = d.rank || {}
  const stageNames = (() => { const out = []; for (const p of (d.pipelines || [])) for (const s of (p.stages || [])) if (!out.includes(s)) out.push(s); return out })()
  const stageRows = stageNames.map((n) => [n, (d.stages || {})[n] || 0]).filter(([, v]) => v > 0)
  const stageMax = Math.max(1, ...stageRows.map(([, v]) => v))
  const bkt = (sp && sp.buckets) || null
  const bktMax = bkt ? Math.max(1, ...bkt.map((b) => b.count || 0)) : 1
  const label = (REP_PERIODS.find(([id]) => id === period) || [])[1]
  return (
    <div className="act-wrap rep-wrap">
      {head}
      <div className="rep-head"><b>{d.name || 'Rep'}</b><span className="cap">{label}{d.period && d.period.from ? ` · ${d.period.from} to ${d.period.to}` : ''}</span></div>
      <RepCockpit clientId={clientId} rep={d.userId} currency={currency} nonce={nonce} canEdit={!!(authUser && isAdminishFE(authUser.role))} />
      <div className="rep-tiles">
        <RepTile label="Leads" value={fmtNumber(d.leads || 0)} rank={rk.leads} sub={rk.leads && rk.leads.of > 1 ? `of ${rk.leads.of} reps` : null} />
        <RepTile label="Booked" value={fmtNumber(ap.booked || 0)} rank={rk.booked} sub={ap.booked ? `${ap.byStaff} by you · ${ap.byCustomer} by the customer` : (d.bookRate != null ? `${d.bookRate}% of leads` : null)} />
        <RepTile label="Show rate" value={pct(ap.showRate)} rank={rk.showRate} sub={team.avgShowRate != null ? `team ${team.avgShowRate}%` : null} tone={ap.showRate != null && team.avgShowRate != null ? (ap.showRate >= team.avgShowRate ? 'good' : 'warn') : ''} />
        <RepTile label="Win rate" value={pct(d.winRate)} rank={rk.winRate} sub={team.avgWinRate != null ? `team ${team.avgWinRate}%` : null} tone={d.winRate != null && team.avgWinRate != null ? (d.winRate >= team.avgWinRate ? 'good' : 'warn') : ''} />
        <RepTile label="Won" value={fmtNumber(d.won || 0)} rank={rk.revenue} sub={d.revenue ? `${money(d.revenue)}${d.avgDeal ? ` · avg ${money(d.avgDeal)}` : ''}` : null} tone="good" />
        <RepTile label="Lost" value={fmtNumber(d.lost || 0)} sub={d.lostReasons && d.lostReasons[0] ? `mostly "${d.lostReasons[0].reason}"` : null} />
        <RepTile label="Open now" value={fmtNumber(now.open || 0)} sub={now.openValue ? money(now.openValue) + ' in play' : null} />
        <RepTile label="Stale" value={fmtNumber(stale.count || 0)} sub={stale.count ? `of ${stale.of} open · avg ${stale.avgIdle} days idle · oldest ${stale.oldest}` : (stale.of ? `of ${stale.of} open · ${stale.threshold}+ days` : null)} tone={stale.count ? 'warn' : 'good'} />
        {d.calls ? <RepTile label="Calls made" value={fmtNumber(d.calls.outbound || 0)} sub={`${fmtNumber(d.calls.connected || 0)} connected · ${fmtNumber(d.calls.minutes || 0)} min on the phone`} /> : null}
        {d.cash && d.cash.field ? <RepTile label="Cash collected" value={money(d.cash.collected || 0)} sub={d.revenue ? `${Math.round(((d.cash.collected || 0) / d.revenue) * 100)}% of won value` : null} tone="good" /> : null}
        <RepTile label="Days to close" value={d.avgCloseDays != null ? `${d.avgCloseDays} d` : '-'} rank={rk.closeDays} sub={d.avgCloseDays != null ? `average deal cycle${team.avgCloseDays != null ? ` · team ${team.avgCloseDays} d` : ''}` : 'no wins in this period'} tone={d.avgCloseDays != null && team.avgCloseDays != null ? (d.avgCloseDays <= team.avgCloseDays ? 'good' : 'warn') : ''} />
        <RepTile label="Speed to lead" value={sp && sp.medianMin != null ? repMin(sp.medianMin) : '-'} sub={sp ? (sp.medianMin != null ? `median · ${sp.within5Pct != null ? `${sp.within5Pct}% under 5 min` : ''}` : 'no replies measured') : 'not measured'} tone={sp && sp.medianMin != null ? (sp.medianMin <= 5 ? 'good' : sp.medianMin <= 60 ? '' : 'warn') : ''} />
      </div>
      <RepLeaderboard rows={d.leaderboard || []} meId={d.userId} currency={currency} />
      <div className="rep-grid">
        <div className="card rep-card">
          <h4>Appointments</h4>
          {ap.booked ? <>
            <RepBar label="Showed" value={ap.showed} max={ap.booked} tone="good" />
            <RepBar label="No-show" value={ap.noShow} max={ap.booked} tone="bad" />
            <RepBar label="Cancelled" value={ap.cancelled} max={ap.booked} />
            <RepBar label="Still to come" value={ap.upcoming} max={ap.booked} />
            {ap.unresulted ? <RepBar label="Passed, not resulted" value={ap.unresulted} max={ap.booked} tone="warn" /> : null}
            {ap.unresulted && onGoActions ? <button type="button" className="btn-ghost sm" onClick={onGoActions}>Result them in the Action list</button> : null}
          </> : <p className="cap">No appointments booked in this period.</p>}
        </div>
        <RepKeyEvents clientId={clientId} d={d} />
        <div className="card rep-card">
          <h4>How far your leads got</h4>
          {stageRows.length ? stageRows.map(([n, v]) => <RepBar key={n} label={n} value={v} max={stageMax} text={`${fmtNumber(v)} · ${d.leads ? Math.round((v / d.leads) * 100) : 0}%`} />) : <p className="cap">No leads in this period.</p>}
          {d.qualified != null && d.leads ? <p className="cap">Qualified: {fmtNumber(d.qualified)} ({pct(d.qualRate)})</p> : null}
        </div>
        <div className="card rep-card">
          <h4>Speed to lead</h4>
          {sp && sp.medianMin != null ? <>
            <p className="cap"><b>In business hours</b>: {sp.inHours != null ? `${fmtNumber(sp.inHours)} leads · ` : ''}median {repMin(sp.medianMin)}{sp.avgMin != null ? ` · average ${repMin(sp.avgMin)}` : ''} · {sp.measured} replied{sp.viaAppt ? ` (${sp.viaAppt} by booking an appointment)` : ''}. {sp.full ? 'Every lead measured.' : `${sp.sampled} of ${sp.totalLeads} leads measured.`}</p>
            {bkt ? bkt.map((b) => <RepBar key={b.key || b.label} label={b.label} value={b.count || 0} max={bktMax} tone={/Under 5|5-15/.test(b.label) ? 'good' : /Over 24|4-24/.test(b.label) ? 'bad' : ''} />) : null}
            {sp.after && sp.after.count ? <p className="cap"><b>After hours</b>: {fmtNumber(sp.after.count)} leads arrived outside business hours{sp.after.medianMin != null ? `; answered a median ${repMin(sp.after.medianMin)} after the next opening${sp.after.within5Pct != null ? `, ${sp.after.within5Pct}% within 5 min of opening` : ''}` : ''}. The buckets above are in-hours leads only.</p> : (sp.hours ? <p className="cap">Every lead in this period arrived in business hours.</p> : null)}
          </> : <p className="cap">{sp ? 'No first replies could be measured for this period.' : 'Speed to lead was not measured for this period.'}</p>}
        </div>
        <div className="card rep-card">
          <h4>Lost reasons</h4>
          {d.lostReasons && d.lostReasons.length ? d.lostReasons.slice(0, 6).map((r) => <RepBar key={r.reason} label={r.reason} value={r.count} max={d.lostReasons[0].count} tone="bad" />) : <p className="cap">Nothing lost in this period.</p>}
          {d.byPipeline && d.byPipeline.length > 1 ? <p className="cap">By pipeline: {d.byPipeline.map((p) => `${p.name} ${p.leads} leads, ${p.won} won`).join(' · ')}</p> : null}
        </div>
      </div>
      <p className="cap act-foot">Leads are the deals assigned to {isViewer ? 'you' : 'this rep'} that were created in the period. Won and lost count deals from those leads. Open and stale are what is on the desk right now. Speed to lead follows the client's business-hours rule and counts the first reply a person sent (or a staff-booked appointment), on a sample of the rep's leads. Ranks are among the {team.reps || 0} reps who had leads in the period.</p>
    </div>
  )
}
// ---- Compare: two reps side by side --------------------------------------------
// For an Account Admin or agency staff: the same scorecard for two people at
// once, one metric per row, the better side marked. Two reads of the same
// repcard scope, so it costs nothing new on the server.
export function useRepCard(clientId, rep, period, nonce) {
  const [st, setSt] = useState({ status: 'idle', data: null })
  useEffect(() => {
    if (!rep) { setSt({ status: 'idle', data: null }); return }
    let dead = false
    setSt((s) => ({ status: 'loading', data: s.data }))
    const r = presetRange(period)
    fetch(`/.netlify/functions/windsor?scope=repcard&client=${encodeURIComponent(clientId)}&${rangeQuery(r)}&preset=${period}&user=${encodeURIComponent(rep)}${hoursQuery(loadHours(clientId))}${nonce ? `&_r=${nonce}` : ''}`, { credentials: 'same-origin' })
      .then((x) => x.json().catch(() => ({ error: `server ${x.status}` })))
      .then((j) => { if (!dead) setSt({ status: j && j.error ? 'err' : 'ok', data: j }) })
      .catch((e) => { if (!dead) setSt({ status: 'err', data: { error: String((e && e.message) || e) } }) })
    return () => { dead = true }
  }, [clientId, rep, period, nonce])
  return st
}
export function RepCompareView({ clientId, currency, reps, meId, nonce }) {
  const [period, setPeriod] = useState('last_30d')
  const [a, setA] = useState(meId || (reps[0] && reps[0].id) || '')
  const [b, setB] = useState((reps.find((r) => r.id !== (meId || (reps[0] && reps[0].id))) || {}).id || '')
  const A = useRepCard(clientId, a, period, nonce), B = useRepCard(clientId, b, period, nonce)
  const money = (v) => fmtCurrency(v || 0, currency)
  const da = A.data || {}, db = B.data || {}
  const ready = A.status === 'ok' && B.status === 'ok'
  const rows = [
    ['Leads', (d) => d.leads, (v) => fmtNumber(v || 0), 'high'],
    ['Appointments booked', (d) => (d.appointments || {}).booked, (v) => fmtNumber(v || 0), 'high'],
    ['Booked by the customer', (d) => (d.appointments || {}).byCustomer, (v) => fmtNumber(v || 0), 'high'],
    ['Showed', (d) => (d.appointments || {}).showed, (v) => fmtNumber(v || 0), 'high'],
    ['Show rate', (d) => (d.appointments || {}).showRate, (v) => (v == null ? '-' : `${v}%`), 'high'],
    ['Won', (d) => d.won, (v) => fmtNumber(v || 0), 'high'],
    ['Win rate', (d) => d.winRate, (v) => (v == null ? '-' : `${v}%`), 'high'],
    ['Revenue', (d) => d.revenue, (v) => money(v), 'high'],
    ['Average deal', (d) => d.avgDeal, (v) => (v == null ? '-' : money(v)), 'high'],
    ['Lost', (d) => d.lost, (v) => fmtNumber(v || 0), 'low'],
    ['Open now', (d) => (d.now || {}).open, (v) => fmtNumber(v || 0), null],
    ['Stale now', (d) => ((d.now || {}).stale || {}).count, (v) => fmtNumber(v || 0), 'low'],
    ['Speed to lead (median, in hours)', (d) => d.speed && d.speed.medianMin, (v) => (v == null ? '-' : repMin(v)), 'low'],
    ['Replied under 5 min', (d) => d.speed && d.speed.within5Pct, (v) => (v == null ? '-' : `${v}%`), 'high'],
    ['Days to close', (d) => d.avgCloseDays, (v) => (v == null ? '-' : `${v} d`), 'low'],
    ['Calls made', (d) => d.calls && d.calls.outbound, (v) => fmtNumber(v || 0), 'high'],
    ['Minutes on the phone', (d) => d.calls && d.calls.minutes, (v) => fmtNumber(v || 0), 'high'],
    ['Cash collected', (d) => d.cash && d.cash.collected, (v) => (v == null ? '-' : money(v)), 'high'],
  ]
  const better = (va, vb, dir) => { if (!dir || va == null || vb == null || va === vb) return [false, false]; return dir === 'high' ? [va > vb, vb > va] : [va < vb, vb < va] }
  const stageNames = (() => { const out = []; for (const p of (da.pipelines || db.pipelines || [])) for (const s of (p.stages || [])) if (!out.includes(s)) out.push(s); return out })()
  const stageRows = stageNames.map((n) => [n, (da.stages || {})[n] || 0, (db.stages || {})[n] || 0]).filter(([, x, y]) => x || y)
  const reasons = [...new Set([...(da.lostReasons || []).map((r) => r.reason), ...(db.lostReasons || []).map((r) => r.reason)])].map((n) => [n, ((da.lostReasons || []).find((r) => r.reason === n) || {}).count || 0, ((db.lostReasons || []).find((r) => r.reason === n) || {}).count || 0]).sort((x, y) => (y[1] + y[2]) - (x[1] + x[2])).slice(0, 8)
  const pair = (label, x, y, fmt = fmtNumber, dir = 'high') => { const [ba, bb] = better(x, y, dir); return <div className="cmp-row" key={label}><span className="cmp-l">{label}</span><span className={`cmp-v ${ba ? 'win' : ''}`}>{fmt(x)}</span><span className={`cmp-v ${bb ? 'win' : ''}`}>{fmt(y)}</span></div> }
  const sel = (v, set, other) => <select value={v} onChange={(e) => set(e.target.value)}><option value="">Pick a rep…</option>{reps.map((u) => <option key={u.id} value={u.id} disabled={u.id === other}>{u.name}{u.id === meId ? ' (me)' : ''}</option>)}</select>
  return (
    <div className="act-wrap">
      <div className="act-bar"><div className="act-filters">
        <label className="act-sel">{sel(a, setA, b)}</label><span className="cap">vs</span><label className="act-sel">{sel(b, setB, a)}</label>
        <label className="act-sel"><select value={period} onChange={(e) => setPeriod(e.target.value)}>{REP_PERIODS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
      </div></div>
      {!a || !b ? <div className="card act-clear"><span className="cap">Pick two reps to compare.</span></div>
        : A.status === 'err' || B.status === 'err' ? <div className="card"><p className="cap act-bad" style={{ margin: 0 }}>{(A.data && A.data.error) || (B.data && B.data.error) || 'Could not load.'}</p></div>
          : !ready ? <div className="card"><Spinner label="Adding up both reps…" /></div> : (
            <div className="cmp-wrap">
              <div className="card rep-card cmp-card">
                <div className="cmp-row cmp-head"><span className="cmp-l" /><span className="cmp-v">{da.name}</span><span className="cmp-v">{db.name}</span></div>
                {rows.map(([label, get, fmt, dir]) => pair(label, get(da), get(db), fmt, dir))}
              </div>
              <div className="rep-grid">
                {(() => { const ra = repKeyEventRows(clientId, da), rb = repKeyEventRows(clientId, db); return ra.length ? <div className="card rep-card cmp-card"><h4>Key events</h4>
                  <div className="cmp-row cmp-head"><span className="cmp-l" /><span className="cmp-v">{da.name}</span><span className="cmp-v">{db.name}</span></div>
                  {ra.map((r, i) => pair(`${r.kind === 'calendar' ? '📅 ' : ''}${r.label}`, r.count, (rb[i] || {}).count || 0, (v) => fmtNumber(v || 0), 'high'))}
                </div> : null })()}
                <div className="card rep-card cmp-card"><h4>How far leads got</h4>
                  <div className="cmp-row cmp-head"><span className="cmp-l" /><span className="cmp-v">{da.name}</span><span className="cmp-v">{db.name}</span></div>
                  {stageRows.length ? stageRows.map(([n, x, y]) => pair(n, x, y, (v) => fmtNumber(v || 0), 'high')) : <p className="cap">No leads in this period.</p>}
                </div>
                <div className="card rep-card cmp-card"><h4>Lost reasons</h4>
                  <div className="cmp-row cmp-head"><span className="cmp-l" /><span className="cmp-v">{da.name}</span><span className="cmp-v">{db.name}</span></div>
                  {reasons.length ? reasons.map(([n, x, y]) => pair(n, x, y, (v) => fmtNumber(v || 0), 'low')) : <p className="cap">Nothing lost in this period.</p>}
                </div>
                <div className="card rep-card cmp-card"><h4>Speed to lead, in business hours</h4>
                  <div className="cmp-row cmp-head"><span className="cmp-l" /><span className="cmp-v">{da.name}</span><span className="cmp-v">{db.name}</span></div>
                  {pair('Leads in hours', da.speed && da.speed.inHours, db.speed && db.speed.inHours, (v) => (v == null ? '-' : fmtNumber(v)), null)}
                  {pair('Leads after hours', da.speed && da.speed.after && da.speed.after.count, db.speed && db.speed.after && db.speed.after.count, (v) => (v == null ? '-' : fmtNumber(v)), null)}
                  {pair('Median reply', da.speed && da.speed.medianMin, db.speed && db.speed.medianMin, (v) => (v == null ? '-' : repMin(v)), 'low')}
                  {pair('Average reply', da.speed && da.speed.avgMin, db.speed && db.speed.avgMin, (v) => (v == null ? '-' : repMin(v)), 'low')}
                  {((da.speed && da.speed.buckets) || (db.speed && db.speed.buckets) || []).map((bk, i) => pair(bk.label, ((da.speed && da.speed.buckets) || [])[i] && da.speed.buckets[i].count, ((db.speed && db.speed.buckets) || [])[i] && db.speed.buckets[i].count, (v) => fmtNumber(v || 0), i < 2 ? 'high' : i > 3 ? 'low' : null))}
                  {pair('After-hours median (from opening)', da.speed && da.speed.after && da.speed.after.medianMin, db.speed && db.speed.after && db.speed.after.medianMin, (v) => (v == null ? '-' : repMin(v)), 'low')}
                </div>
              </div>
              <p className="cap act-foot">Green marks the better side. Same rules as My results: leads assigned to each rep created in the period; speed follows the client's business-hours rule and counts the first reply a person sent.</p>
            </div>
          )}
    </div>
  )
}

export function DealsActionsView({ clientId, authUser, currency, nonce }) {
  const isViewer = !!(authUser && isClientRoleFE(authUser.role))
  const [screen, setScreenRaw] = useState(isViewer ? 'results' : 'actions')
  const touched = useRef(false)
  const setScreen = (s) => { touched.current = true; setScreenRaw(s) }
  const [mine, setMine] = useState(isViewer)
  const [stale, setStale] = useState(7)
  const [tier, setTier] = useState(0)
  const [tick, setTick] = useState(0)
  const [st, setSt] = useState({ status: 'loading', data: null })
  const [rep, setRep] = useState('all')
  const [cal, setCal] = useState('all')
  const [pipeF, setPipeF] = useState('all')
  const [stageF, setStageF] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [busy, setBusy] = useState({})
  const [gone, setGone] = useState({})
  const [patched, setPatched] = useState({})
  const [msg, setMsg] = useState(null)
  const [openSec, setOpenSec] = useState({})
  const loadedAt = useRef(0)
  useEffect(() => {
    let dead = false
    setSt((s) => ({ status: s.data ? 'refreshing' : 'loading', data: s.data }))
    const qs = `scope=actions&client=${encodeURIComponent(clientId)}&mine=${mine ? 1 : 0}&stale=${stale}${tick || nonce ? `&_r=${tick}.${nonce || 0}` : ''}`
    fetch(`/.netlify/functions/windsor?${qs}`, { credentials: 'same-origin' })
      .then((r) => r.json().catch(() => ({ error: `server ${r.status}` })))
      .then((j) => {
        if (dead) return
        loadedAt.current = Date.now(); setSt({ status: j && j.error && !j.counts ? 'err' : 'ok', data: j }); setGone({}); setPatched({})
        // Home is the rep's own results whenever the CRM knows who they are.
        if (!touched.current && j && j.meMatched) setScreenRaw('results')
      })
      .catch((e) => { if (!dead) setSt({ status: 'err', data: { error: String(e && e.message || e) } }) })
    return () => { dead = true }
  }, [clientId, mine, stale, tick, nonce])
  useEffect(() => {
    const iv = setInterval(() => { if (document.visibilityState === 'visible') setTick((t) => t + 1) }, 60000)
    const vis = () => { if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > 20000) setTick((t) => t + 1) }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', vis) }
  }, [])
  const data = st.data || {}
  const canWrite = data.canWrite === true
  const loc = data.locationId
  const tz = data.tz
  const users = data.users || []
  const reps = data.reps || users
  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])), [users])
  const write = async (payload, id, patch = null, remove = false) => {
    setBusy((b) => ({ ...b, [id]: true })); setMsg(null)
    try {
      const r = await fetch(`/.netlify/functions/windsor?scope=actions&client=${encodeURIComponent(clientId)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({ error: `server ${r.status}` }))
      if (!r.ok || (j && j.error)) throw new Error((j && j.error) || `server ${r.status}`)
      if (remove) setGone((g) => ({ ...g, [id]: true }))
      if (patch) setPatched((p) => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }))
      setMsg({ ok: true, text: payload.op === 'note' ? 'Note added.' : payload.op === 'appt' ? `Appointment marked ${payload.status === 'noshow' ? 'no-show' : payload.status}.` : payload.op === 'dismiss' ? 'Marked as handled.' : payload.op === 'reply' ? 'Reply sent and marked handled.' : 'Saved to the CRM.' })
      return true
    } catch (e) { setMsg({ ok: false, text: String((e && e.message) || e) }); return false }
    finally { setBusy((b) => { const n = { ...b }; delete n[id]; return n }) }
  }
  const repOk = (uid) => rep === 'all' || (rep === 'none' ? !uid : uid === rep)
  const live = (rows) => (rows || []).filter((r) => !gone[r.id] && repOk(r.userId)).map((r) => (patched[r.id] ? { ...r, ...patched[r.id] } : r))
  const lists = {
    upcoming: live(data.upcoming).filter((a) => cal === 'all' || a.calendar === cal),
    appts: live(data.appts).filter((a) => cal === 'all' || a.calendar === cal),
    wonNoValue: live(data.wonNoValue), lostNoReason: live(data.lostNoReason), inbound: live(data.inbound),
    staleOpen: live(data.staleOpen).filter((d) => !tier || (d.idleDays || 0) >= tier), unassigned: rep === 'all' || rep === 'none' ? live(data.unassigned) : [],
  }
  const todo = Object.entries(lists).reduce((n, [k, l]) => n + (k === 'upcoming' ? 0 : l.length), 0)
  const sorters = { newest: (a, b) => (b.createdMs || 0) - (a.createdMs || 0), oldest: (a, b) => (a.createdMs || 0) - (b.createdMs || 0), value: (a, b) => (b.value || 0) - (a.value || 0), idle: (a, b) => (b.idleDays || 0) - (a.idleDays || 0), recent: (a, b) => (b.updatedMs || 0) - (a.updatedMs || 0) }
  const deals = live(data.open).filter((d) => (pipeF === 'all' || d.pipelineId === pipeF) && (stageF === 'all' || d.stageId === stageF)).sort(sorters[sortBy] || sorters.newest)
  const pipeSel = (data.pipelines || []).find((p) => p.id === pipeF)
  // Live deals grouped per pipeline stage, in pipeline order.
  const dealGroups = useMemo(() => {
    const order = []; const idx = {}
    for (const p of (data.pipelines || [])) for (const s of (p.stages || [])) { const k = `${p.id}|${s.id}`; idx[k] = order.length; order.push({ key: k, pipeline: p.name, stage: s.name, rows: [] }) }
    const extra = { key: 'other', pipeline: '', stage: 'No stage', rows: [] }
    for (const d of deals) { const k = `${d.pipelineId}|${d.stageId}`; if (idx[k] != null) order[idx[k]].rows.push(d); else extra.rows.push(d) }
    const out = order.filter((g) => g.rows.length); if (extra.rows.length) out.push(extra)
    return out
  }, [deals, data.pipelines])
  const money = (v) => fmtCurrency(v, currency)
  // Every section starts collapsed so the whole list of what needs doing is
  // visible at a glance; a tap opens the one being worked on.
  const isOpen = (k) => (openSec[k] == null ? false : openSec[k])
  const sec = (key, title, help, rows, render, extra = null, tone = '') => {
    if (!rows.length && st.status === 'ok') return null
    return (
      <section className="act-sec" key={key}>
        <button type="button" className="act-sec-head" onClick={() => setOpenSec((o) => ({ ...o, [key]: !isOpen(key) }))}>
          <span className={`act-count ${tone || (rows.length ? 'on' : '')}`}>{rows.length}</span><b>{title}</b><span className="cap">{help}</span><span className="act-chev">{isOpen(key) ? '▾' : '▸'}</span>
        </button>
        {isOpen(key) && extra ? <div className="act-sec-extra">{extra}</div> : null}
        {isOpen(key) ? <div className="act-rows">{rows.map(render)}</div> : null}
      </section>
    )
  }
  const who = (r) => <div className="act-who"><b>{r.name}</b>{r.pipeline || r.stage ? <span className="cap">{[r.pipeline, r.stage].filter(Boolean).join(' · ')}</span> : null}{r.user ? <span className="cap">Rep: {r.user}</span> : <span className="cap act-norep">No rep</span>}</div>
  const dealRow = (d) => (
    <div className="act-row" key={d.id}>
      {who(d)}
      <div className="act-meta"><span>{d.value > 0 ? money(d.value) : <span className="cap">No value</span>}{d.idleDays >= 7 ? <> <ActTierBadge r={d} /></> : null} <ActWaiting r={d} /></span><span className="cap">Last activity {actAgo(d.idleDays)} · created {actAgo(d.ageDays)}</span></div>
      <div className="act-ctl-col">
        {canWrite ? <ActDealControls d={d} data={data} busy={!!busy[d.id]} write={write} currency={currency} /> : null}
        <div className="act-ctl"><ActNotes clientId={clientId} contactId={d.contactId} canWrite={canWrite} write={write} busy={!!busy[d.contactId]} userName={userName} /><ActOpen href={crmLink(loc, d.contactId)} /></div>
      </div>
    </div>
  )
  const st7 = data.staleTiers || {}
  if (st.status === 'loading') return <div className="card"><Spinner label="Reading the CRM…" /></div>
  if (st.status === 'err') return <div className="card"><p className="cap act-bad">Could not load: {data.error || 'unknown error'}</p><button type="button" className="btn-ghost sm" onClick={() => setTick((t) => t + 1)}>Try again</button></div>
  if (data.ghl === false) return <div className="card"><p className="cap">{data.error || 'This account has no Caalano Systems connection.'}</p></div>
  return (
    <div className="act-wrap">
      <div className="act-bar">
        <div className="subtabs act-screens">
          <button type="button" className={screen === 'results' ? 'active' : ''} onClick={() => setScreen('results')}>My results</button>
          <button type="button" className={screen === 'deals' ? 'active' : ''} onClick={() => setScreen('deals')}>Live deals{deals.length ? <span className="act-pill dim">{deals.length}</span> : null}</button>
          <button type="button" className={screen === 'actions' ? 'active' : ''} onClick={() => setScreen('actions')}>Action list{todo ? <span className="act-pill">{todo}</span> : null}</button>
          {!data.accountUser && reps.length > 1 ? <button type="button" className={screen === 'compare' ? 'active' : ''} onClick={() => setScreen('compare')}>Compare</button> : null}
        </div>
        {screen === 'results' || screen === 'compare' ? null : <div className="act-filters">
          {data.meMatched && !data.accountUser ? <label className="act-sel"><select value={mine ? 'mine' : 'all'} onChange={(e) => { setMine(e.target.value === 'mine'); setRep('all') }}><option value="mine">Mine</option><option value="all">Everyone</option></select></label> : null}
          {!mine ? <label className="act-sel"><select value={rep} onChange={(e) => setRep(e.target.value)}><option value="all">All reps</option><option value="none">No rep</option>{reps.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label> : null}
          {screen === 'actions' && (data.calendars || []).length > 1 ? <label className="act-sel"><select value={cal} onChange={(e) => setCal(e.target.value)}><option value="all">All calendars</option>{(data.calendars || []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></label> : null}
          {screen === 'actions' ? <label className="act-sel"><select value={tier} onChange={(e) => setTier(Number(e.target.value))}><option value={0}>Stale: all (7+ days)</option><option value={14}>Stale: 14+ days</option><option value={21}>Stale: 21+ days</option><option value={30}>Stale: 30+ days</option></select></label> : null}
          {screen === 'deals' && (data.pipelines || []).length > 1 ? <label className="act-sel"><select value={pipeF} onChange={(e) => { setPipeF(e.target.value); setStageF('all') }}><option value="all">All pipelines</option>{(data.pipelines || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : null}
          {screen === 'deals' && pipeSel ? <label className="act-sel"><select value={stageF} onChange={(e) => setStageF(e.target.value)}><option value="all">All stages</option>{pipeSel.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : null}
          {screen === 'deals' ? <label className="act-sel"><select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="recent">Last touched</option><option value="idle">Longest idle</option><option value="value">Highest value</option></select></label> : null}
          <button type="button" className="btn-ghost sm" disabled={st.status === 'refreshing'} onClick={() => setTick((t) => t + 1)} title="Re-read the CRM now">{st.status === 'refreshing' ? 'Refreshing…' : 'Refresh'}</button>
        </div>}
      </div>
      {screen === 'results' ? <RepCardView clientId={clientId} authUser={authUser} currency={currency} reps={reps} meId={data.meId || null} nonce={nonce} onGoActions={() => setScreen('actions')} selfOnly={!!data.accountUser} /> : null}
      {screen === 'compare' ? <RepCompareView clientId={clientId} currency={currency} reps={reps} meId={data.meId || null} nonce={nonce} /> : null}
      {screen !== 'results' && screen !== 'compare' && msg ? <p className={`cap act-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</p> : null}
      {screen !== 'results' && screen !== 'compare' && !canWrite ? <p className="cap act-ro">Read-only: you can see the list and open each record in the CRM, but not update it from here.{isViewer ? ' Ask your admin for CRM update access.' : ''}</p> : null}
      {screen !== 'results' && screen !== 'compare' && mine && !data.meMatched ? <p className="cap act-ro">Your login e-mail does not match a user in this CRM, so the list shows everyone.</p> : null}
      {screen === 'results' || screen === 'compare' ? null : screen === 'actions' ? (
        todo === 0 && st.status === 'ok' && !lists.upcoming.length ? <div className="card act-clear"><b>All clear.</b> <span className="cap">Nothing needs fixing{mine ? ' on your deals' : ''} right now.</span></div> : <>
          {todo === 0 && st.status === 'ok' ? <div className="card act-clear"><b>All clear.</b> <span className="cap">Nothing needs fixing{mine ? ' on your deals' : ''} right now.</span></div> : null}
          {sec('upcoming', ...ACT_SECTIONS.upcoming, lists.upcoming, (a) => (
            <div className="act-row" key={a.id}>
              {who(a)}
              <div className="act-meta"><span>{actWhen(a.startMs, tz)} <span className="act-status">{String(a.status || 'new').replace(/_/g, ' ')}</span> <ActWaiting r={a} /></span><span className="cap">{a.calendar}{a.title ? ` · ${a.title}` : ''} · {a.inDays === 0 ? 'today' : a.inDays === 1 ? 'tomorrow' : `in ${a.inDays} days`}{a.by === 'self' ? ' · booked by the customer' : ''}</span></div>
              <div className="act-ctl">
                {canWrite && /^new$|^booked$|^$/.test(String(a.status || '')) ? <ActCommit label="Confirm" disabled={busy[a.id]} onCommit={() => write({ op: 'appt', eventId: a.id, status: 'confirmed' }, a.id, { status: 'confirmed' })} /> : null}
                <ActConversation clientId={clientId} row={{ id: null, contactId: a.contactId, oppId: a.oppId }} data={data} canWrite={canWrite} write={write} busy={!!busy[a.contactId]} loc={loc} userName={userName} keep label={a.unreplied ? 'Reply' : 'Conversation'} />
                <ActNotes clientId={clientId} contactId={a.contactId} canWrite={canWrite} write={write} busy={!!busy[a.contactId]} userName={userName} />
                <ActOpen href={crmLink(loc, a.contactId)} />
              </div>
            </div>
          ), null, 'info')}
          {sec('appts', ...ACT_SECTIONS.appts, lists.appts, (a) => <ActApptRow key={a.id} a={a} tz={tz} busy={!!busy[a.id]} canWrite={canWrite} write={write} loc={loc} who={who} clientId={clientId} userName={userName} />)}
          {sec('wonNoValue', ...ACT_SECTIONS.wonNoValue, lists.wonNoValue, (d) => <ActValueRow key={d.id} d={d} busy={!!busy[d.id]} canWrite={canWrite} write={write} currency={currency} loc={loc} who={who} clientId={clientId} userName={userName} />)}
          {sec('lostNoReason', ...ACT_SECTIONS.lostNoReason, lists.lostNoReason, (d) => <ActReasonRow key={d.id} d={d} data={data} busy={!!busy[d.id]} canWrite={canWrite} write={write} loc={loc} who={who} clientId={clientId} userName={userName} />)}
          {sec('inbound', ...ACT_SECTIONS.inbound, lists.inbound, (c) => (
            <div className="act-row" key={c.id}>
              {who(c)}
              <div className="act-meta"><span>{c.snippet || <i className="cap">(no text)</i>}</span><span className="cap">{c.type ? `${String(c.type).replace(/^TYPE_/, '').toLowerCase()} · ` : ''}{actHrs(c.hoursAgo)}{c.unread ? ` · ${c.unread} unread` : ''}{c.autoReplied ? ' · an automation replied, no person has' : ''}</span></div>
              <div className="act-ctl-col">
                <div className="act-ctl">
                  <ActConversation clientId={clientId} row={c} data={data} canWrite={canWrite} write={write} busy={!!busy[c.id] || !!busy[c.oppId]} loc={loc} userName={userName} />
                  <ActNotes clientId={clientId} contactId={c.contactId} canWrite={canWrite} write={write} busy={!!busy[c.contactId]} userName={userName} />
                  {canWrite ? <button type="button" className="btn-ghost sm" disabled={busy[c.id]} onClick={() => write({ op: 'dismiss', id: c.id }, c.id, null, true)} title="Hide this from the list for a while (it does not touch the CRM)">Handled</button> : null}
                </div>
              </div>
            </div>
          ))}
          {sec('staleOpen', `${ACT_SECTIONS.staleOpen[0]} (${tier || 7}+ days)`, ACT_SECTIONS.staleOpen[1], lists.staleOpen, dealRow,
            <div className="act-tiers">{ACT_TIERS.map(([d, l, k]) => <button type="button" key={k} className={`act-tier ${k} ${tier === d ? 'on' : ''}`} onClick={() => setTier(tier === d ? 0 : d)}>{l}: {st7[k] || 0}</button>)}</div>)}
          {sec('unassigned', ...ACT_SECTIONS.unassigned, lists.unassigned, (d) => <ActAssignRow key={d.id} d={d} users={users} busy={!!busy[d.id]} canWrite={canWrite} write={write} loc={loc} who={who} clientId={clientId} userName={userName} />)}
        </>
      ) : (
        <div className="act-deals">
          {!deals.length ? <div className="card act-clear"><span className="cap">No open deals{mine ? ' assigned to you' : ''}{pipeF !== 'all' ? ' in this pipeline' : ''}.</span></div> : null}
          {dealGroups.map((g) => (
            <section className="act-sec" key={g.key}>
              <button type="button" className="act-sec-head" onClick={() => setOpenSec((o) => ({ ...o, [g.key]: !isOpen(g.key) }))}>
                <span className="act-count">{g.rows.length}</span><b>{g.stage}</b><span className="cap">{g.pipeline}{g.rows.some((r) => r.value > 0) ? ` · ${money(g.rows.reduce((s, r) => s + (r.value || 0), 0))}` : ''}</span><span className="act-chev">{isOpen(g.key) ? '▾' : '▸'}</span>
              </button>
              {isOpen(g.key) ? <div className="act-rows">{g.rows.map(dealRow)}</div> : null}
            </section>
          ))}
          {data.open && data.open.length >= 400 ? <p className="cap">Showing the 400 most recently touched open deals.</p> : null}
        </div>
      )}
      {screen !== 'results' && screen !== 'compare' ? <p className="cap act-foot">CRM snapshot from {data.snapshotAt ? actWhen(data.snapshotAt, tz) : '-'} · re-reads every minute while open{data.truncated ? ' · the snapshot is capped, so very old deals may be missing' : ''}.</p> : null}
    </div>
  )
}
// An appointment past its time: the CRM's current status, a result to pick,
// and a Save to confirm it - nothing is written on the first tap.
export function ActApptRow({ a, tz, busy, canWrite, write, loc, who, clientId, userName }) {
  const [pick, setPick] = useState('')
  const cur = String(a.status || 'booked').replace(/_/g, ' ')
  const opts = [['showed', 'Showed'], ['noshow', 'No-show'], ['cancelled', 'Cancelled']]
  return (
    <div className="act-row">
      {who(a)}
      <div className="act-meta"><span>{actWhen(a.startMs, tz)} <span className="act-status">{cur}</span> <ActWaiting r={a} /></span><span className="cap">{a.calendar}{a.title ? ` · ${a.title}` : ''} · {actAgo(a.daysAgo)}</span></div>
      <div className="act-ctl-col">
        {canWrite ? <div className="act-ctl">
          <div className="act-seg">{opts.map(([v, l]) => <button type="button" key={v} className={pick === v ? 'on' : ''} disabled={busy} onClick={() => setPick(pick === v ? '' : v)}>{l}</button>)}</div>
          {pick ? <ActCommit key={pick} label={`Save ${opts.find(([v]) => v === pick)[1].toLowerCase()}`} disabled={busy} onCommit={() => write({ op: 'appt', eventId: a.id, status: pick }, a.id, null, true)} /> : null}
        </div> : null}
        <div className="act-ctl"><ActNotes clientId={clientId} contactId={a.contactId} canWrite={canWrite} write={write} busy={busy} userName={userName} /><ActOpen href={crmLink(loc, a.contactId)} /></div>
      </div>
    </div>
  )
}
export function ActValueRow({ d, busy, canWrite, write, currency, loc, who, clientId, userName }) {
  const [val, setVal] = useState('')
  return (
    <div className="act-row">
      {who(d)}
      <div className="act-meta"><span>Won {actAgo(d.idleDays)}</span><span className="cap">No value recorded</span></div>
      <div className="act-ctl">
        {canWrite ? <><input className="act-in" type="number" min="0" step="1" inputMode="decimal" placeholder={`Value (${currency || 'AUD'})`} value={val} onChange={(e) => setVal(e.target.value)} />
          <ActCommit label="Save" disabled={busy || !(Number(val) > 0)} onCommit={() => write({ op: 'opp', oppId: d.id, patch: { monetaryValue: Number(val) } }, d.id, null, true)} /></> : null}
        <ActNotes clientId={clientId} contactId={d.contactId} canWrite={canWrite} write={write} busy={busy} userName={userName} />
        <ActOpen href={crmLink(loc, d.contactId)} />
      </div>
    </div>
  )
}
export function ActReasonRow({ d, data, busy, canWrite, write, loc, who, clientId, userName }) {
  const [reason, setReason] = useState('')
  return (
    <div className="act-row">
      {who(d)}
      <div className="act-meta"><span>Lost {actAgo(d.idleDays)}</span><span className="cap">No lost reason</span></div>
      <div className="act-ctl">
        {canWrite ? <><select className="act-in" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Lost reason…</option>{(data.lostReasons || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <ActCommit label="Save" disabled={busy || !reason} onCommit={() => write({ op: 'opp', oppId: d.id, patch: { lostReasonId: reason } }, d.id, null, true)} /></> : null}
        <ActNotes clientId={clientId} contactId={d.contactId} canWrite={canWrite} write={write} busy={busy} userName={userName} />
        <ActOpen href={crmLink(loc, d.contactId)} />
      </div>
    </div>
  )
}
export function ActAssignRow({ d, users, busy, canWrite, write, loc, who, clientId, userName }) {
  const [uid, setUid] = useState('')
  return (
    <div className="act-row">
      {who(d)}
      <div className="act-meta"><span>{d.value > 0 ? fmtCurrency(d.value) : <span className="cap">No value</span>}</span><span className="cap">Created {actAgo(d.ageDays)}</span></div>
      <div className="act-ctl">
        {canWrite ? <><select className="act-in" value={uid} onChange={(e) => setUid(e.target.value)}><option value="">Assign to…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <button type="button" className="btn-primary act-btn" disabled={busy || !uid} onClick={() => write({ op: 'opp', oppId: d.id, patch: { assignedTo: uid } }, d.id, null, true)}>Assign</button></> : null}
        <ActNotes clientId={clientId} contactId={d.contactId} canWrite={canWrite} write={write} busy={busy} userName={userName} />
        <ActOpen href={crmLink(loc, d.contactId)} />
      </div>
    </div>
  )
}
