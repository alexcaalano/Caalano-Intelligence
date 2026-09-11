// @needs-fake-blobs
// Backup round trip: export every store, wipe it, restore from the export, and
// the second export must equal the first. Text blobs and JSON blobs both survive.
import assert from 'node:assert/strict'
import { getStore } from '@netlify/blobs'
import { collectBackup } from '../netlify/lib/backup.mjs'
process.env.RESTORE_AS_MODULE = '1'
process.argv = ['node', 'restore', 'x.json', '--dry-run']
const { restoreStores } = await import('../scripts/restore-backup.mjs')

// Seed a text blob and a couple of JSON blobs where the fixture has none.
await getStore({ name: 'caalano-monthly' }).set('note', 'plain text, not json')
await getStore({ name: 'caalano-settings' }).setJSON('extra', { a: 1, nested: { b: [1, 2] } })
const before = await collectBackup({ includeSecrets: true })
assert.equal(before.format, 'caalano360-backup/2')
assert.ok(before.stores['caalano-settings'].keys >= 2)
assert.deepEqual(before.stores['caalano-monthly'].data.note, { _text: 'plain text, not json' }, 'text blobs are wrapped, not dropped')
assert.ok(before.stores['ghl-auth'].keys === 1, 'secrets store included when asked')

// Wipe everything the backup covers, then restore it.
const stores = Object.fromEntries(Object.entries(before.stores).map(([n, s]) => [n, s.data]))
for (const n of Object.keys(stores)) { const st = getStore({ name: n }); for (const k of Object.keys(stores[n])) await st.delete(k) }
assert.equal((await collectBackup({ includeSecrets: true })).stores['caalano-settings'].keys, 0, 'wiped')
const log = []
const summary = await restoreStores(stores, Object.keys(stores), { log: (m) => log.push(m), mk: (name) => getStore({ name }) })
assert.ok(summary.find((s) => s.name === 'caalano-auth'), 'auth store restored')
const after = await collectBackup({ includeSecrets: true })
for (const n of Object.keys(stores)) assert.deepEqual(after.stores[n].data, before.stores[n].data, `store ${n} round-trips`)
// Dry run writes nothing.
await getStore({ name: 'caalano-settings' }).delete('extra')
await restoreStores(stores, ['caalano-settings'], { dry: true, log: () => {}, mk: (name) => getStore({ name }) })
assert.equal(await getStore({ name: 'caalano-settings' }).get('extra'), null, 'dry run leaves the store alone')
console.log('backup_restore_test ok')
