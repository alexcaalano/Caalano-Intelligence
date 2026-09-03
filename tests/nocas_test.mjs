// The mock now mirrors @netlify/blobs 8.2.0 exactly: setJSON(key, data) writes
// unconditionally and returns undefined. Any option object is IGNORED - which is
// what made the previous test pass against a library that cannot do it.
const tick = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 4)))
const mk = () => { const b = new Map()
  return { get: async (k) => { await tick(); return b.has(k) ? JSON.parse(JSON.stringify(b.get(k))) : null },
           setJSON: async (k, v) => { await tick(); b.set(k, JSON.parse(JSON.stringify(v))); return undefined },
           delete: async (k) => { await tick(); b.delete(k) },
           keys: () => [...b.keys()] } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- 1. sharded diag writes -------------------------------------------------
const DIAG_DAY_CAP = 400, DIAG_SHARDS = 12
async function diagWrite(store, dayKey, entry, mode) {
  if (mode === 'perEntry') {
    const now = Date.now()
    const seq = `${String(now).padStart(14, '0')}-${Math.random().toString(36).slice(2, 8)}`
    await store.setJSON(`${dayKey}:${seq}`, { t: now, ...entry })
    return
  }
  const cur = (await store.get(dayKey, { type: 'json' }).catch(() => null)) || []
  cur.push(entry)
  await store.setJSON(dayKey, cur.length > DIAG_DAY_CAP ? cur.slice(cur.length - DIAG_DAY_CAP) : cur)
}
const readAll = async (store, dayKey, mode) => {
  if (mode !== 'perEntry') { const r = await store.get(dayKey, { type: 'json' }); return Array.isArray(r) ? r : [] }
  const keys = store.keys().filter((k) => k.startsWith(dayKey + ':')).sort().reverse().slice(0, DIAG_DAY_CAP)
  const out = []
  for (const k of keys) { const e = await store.get(k, { type: 'json' }); if (e) out.push(e) }
  return out
}
let fails = 0
console.log('reliability log, no compare-and-swap available:')
for (const n of [10, 40, 80]) {
  const one = mk(), many = mk()
  await Promise.all(Array.from({ length: n }, (_, i) => diagWrite(one, 'd', { i }, 'shared')))
  await Promise.all(Array.from({ length: n }, (_, i) => diagWrite(many, 'd', { i }, 'perEntry')))
  const a = (await readAll(one, 'd', 'shared')).length, b = (await readAll(many, 'd', 'perEntry')).length
  const ok = b === n
  if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${String(n).padStart(2)} writers: one shared blob kept ${String(a).padStart(2)}/${n}, one blob per entry kept ${String(b).padStart(2)}/${n}`)
}

// --- 2. last-write-wins leader election -------------------------------------
const SNAP_LOCK_MS = 20000, SNAP_SETTLE_MS = 180
async function claim(store, loc) {
  const now = Date.now()
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const held = await store.get(`lock:${loc}`, { type: 'json' }).catch(() => null)
  if (held && held.at && (now - held.at) < SNAP_LOCK_MS) return false
  await store.setJSON(`lock:${loc}`, { at: now, id })
  await sleep(SNAP_SETTLE_MS)
  const back = await store.get(`lock:${loc}`, { type: 'json' }).catch(() => null)
  return !!(back && back.id === id)
}
console.log('\nleader election over last-write-wins:')
for (const n of [2, 6, 12]) {
  let worst = 0, total = 0, zero = 0
  for (let trial = 0; trial < 40; trial++) {
    const st = mk()
    const res = await Promise.all(Array.from({ length: n }, () => claim(st, 'L')))
    const winners = res.filter(Boolean).length
    total += winners; worst = Math.max(worst, winners); if (winners === 0) zero++
    // Stagger the next trial so a stale lock never carries over.
    await sleep(0)
  }
  const avg = (total / 40).toFixed(2)
  const ok = zero === 0 && worst === 1   // exactly one leader, every time
  if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${String(n).padStart(2)} racers: avg ${avg} leader(s), worst ${worst}, never-zero: ${zero === 0}`)
}
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
