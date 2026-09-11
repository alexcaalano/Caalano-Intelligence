#!/usr/bin/env node
// Restore a Caalano360 backup (the JSON from /.netlify/functions/backup-export,
// or one store file from backups/latest/) into Netlify Blobs.
//
//   node scripts/restore-backup.mjs <file.json> --site <netlify-site-id> --token <netlify-personal-token> [options]
//
//   --store <name>     only this store (repeatable). Default: every store in the file.
//   --dry-run          list what would be written, write nothing.
//   --wipe             delete keys in the store that are not in the backup (default: keep them).
//   --yes              skip the confirmation prompt.
//
// Site id: Netlify → Site configuration → General → Site details → Site ID.
// Token:   Netlify → User settings → Applications → Personal access tokens.
// Runs from anywhere with node 18+; nothing else in the repo is needed.
//
// Order matters on a bare site: restore caalano-auth first (nobody can sign in
// without it), then caalano-settings, then the rest. This script does that when
// given a whole backup. ghl-auth (the CRM token) only exists in a
// `?secrets=1` export; without it, reconnect Caalano Systems from Settings.
import fs from 'node:fs'
import readline from 'node:readline'
import { getStore } from '@netlify/blobs'

export async function restoreStores(stores, names, { dry = false, wipe = false, log = console.log, mk = (name) => getStore({ name, consistency: 'strong' }) } = {}) {
  const summary = []
  for (const name of names) {
    const store = mk(name)
    const data = stores[name]
    let written = 0, removed = 0
    for (const [key, value] of Object.entries(data)) {
      if (!dry) {
        if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value._text === 'string') await store.set(key, value._text)
        else await store.setJSON(key, value)
      }
      written++
    }
    if (wipe) {
      let cursor
      do {
        const page = await store.list({ cursor })
        for (const b of page.blobs || []) { if (!(b.key in data)) { if (!dry) await store.delete(b.key); removed++ } }
        cursor = page.cursor
      } while (cursor)
    }
    log(`  ${dry ? 'would write' : 'wrote'} ${written} keys to ${name}${wipe ? `, ${dry ? 'would remove' : 'removed'} ${removed} extra` : ''}`)
    summary.push({ name, written, removed })
  }
  return summary
}

async function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const only = args.flatMap((a, i) => (a === '--store' ? [args[i + 1]] : []))
  if (!file) { console.error('usage: restore-backup.mjs <file.json> --site <id> --token <token> [--store name] [--dry-run] [--wipe] [--yes]'); process.exit(2) }
  const siteID = opt('--site') || process.env.NETLIFY_SITE_ID, token = opt('--token') || process.env.NETLIFY_AUTH_TOKEN
  const dry = flags.has('--dry-run')
  if (!dry && (!siteID || !token)) { console.error('need --site and --token (or NETLIFY_SITE_ID / NETLIFY_AUTH_TOKEN) unless --dry-run'); process.exit(2) }

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  // Whole export: { format, stores: { name: { data } } }. Single store file: { store, data }.
  const stores = raw.stores ? Object.fromEntries(Object.entries(raw.stores).map(([n, s]) => [n, s.data || {}])) : raw.store ? { [raw.store]: raw.data || {} } : null
  if (!stores) { console.error('not a Caalano360 backup file'); process.exit(2) }
  const ORDER = ['caalano-auth', 'caalano-settings', 'caalano-terms', 'ghl-auth']
  const names = Object.keys(stores).filter((n) => !only.length || only.includes(n)).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99))
  if (!names.length) { console.error('no matching stores in the file'); process.exit(2) }

  console.log(`${dry ? 'DRY RUN - ' : ''}restoring from ${file} (taken ${raw.at || 'unknown'}, format ${raw.format || 'single store'})`)
  for (const n of names) console.log(`  ${n}: ${Object.keys(stores[n]).length} keys`)
  if (!dry && !flags.has('--yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const ans = await new Promise((res) => rl.question(`Write these into site ${siteID}? This overwrites matching keys. Type yes: `, res)); rl.close()
    if (ans.trim() !== 'yes') { console.log('aborted'); process.exit(1) }
  }
    await restoreStores(stores, names, { dry, wipe: flags.has('--wipe'), mk: (name) => getStore({ name, siteID, token, consistency: 'strong' }) })
}
if (!process.env.RESTORE_AS_MODULE) await main()
