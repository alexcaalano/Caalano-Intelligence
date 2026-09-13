// Apply db/migrations/*.sql in name order, once each, recording what ran in
// schema_migrations. Works against a pg client (production, DATABASE_URL) or
// anything with an exec(sql) method (the tests run it on an in-process
// Postgres). Each file runs inside its own transaction.
//
//   node db/migrate.mjs            apply pending migrations to DATABASE_URL
//   node db/migrate.mjs --status   list applied and pending, change nothing
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

export function migrationFiles() {
  return readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
}
export async function applyMigrations(db, { log = () => {} } = {}) {
  const exec = (sql) => (db.exec ? db.exec(sql) : db.query(sql))
  await exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
  const done = new Set(((await db.query('select name from schema_migrations')).rows || []).map((r) => r.name))
  const applied = []
  for (const f of migrationFiles()) {
    if (done.has(f)) continue
    const sql = readFileSync(join(DIR, f), 'utf8')
    await exec('begin')
    try {
      await exec(sql)
      await exec(`insert into schema_migrations (name) values ('${f.replace(/'/g, "''")}')`)
      await exec('commit')
    } catch (e) { await exec('rollback'); throw new Error(`${f}: ${e.message}`) }
    applied.push(f); log(`applied ${f}`)
  }
  return applied
}
export async function migrationStatus(db) {
  await (db.exec ? db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())') : db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())'))
  const done = new Set(((await db.query('select name from schema_migrations')).rows || []).map((r) => r.name))
  return migrationFiles().map((f) => ({ name: f, applied: done.has(f) }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(2) }
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } })
  await client.connect()
  try {
    if (process.argv.includes('--status')) {
      for (const m of await migrationStatus(client)) console.log(`${m.applied ? 'applied' : 'pending'}  ${m.name}`)
    } else {
      const applied = await applyMigrations(client, { log: console.log })
      console.log(applied.length ? `${applied.length} migration(s) applied` : 'nothing to apply')
    }
  } finally { await client.end() }
}
