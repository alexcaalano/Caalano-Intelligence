# Backing up and restoring Caalano360

What lives where, how it is backed up, and how to put it back. Written so that
someone who has never seen the app could do it from this page.

## What exists

| Asset | Where it lives | Backup |
|---|---|---|
| Source code, history, release tags | GitHub (`alexcaalano/Caalano-Intelligence`) | Every push. Keep a second remote and an occasional `git bundle` as well. |
| Configuration, users, terms, history, audit and reliability logs | Netlify Blobs (11 stores) | Daily to `backups/` in the repo when `BACKUP_GH_TOKEN` + `BACKUP_GH_REPO` are set; on demand via `backup-export`. |
| Caalano Systems agency OAuth token | Blob store `ghl-auth` | Only in a `backup-export?secrets=1` download. Keep that file in the password manager, never in git. |
| Caches, warm state, opportunity snapshots | Blob stores | Not backed up - they rebuild themselves. |
| 15 secrets (`AUTH_SECRET`, `WINDSOR_API_KEY`, `GHL_CLIENT_ID/SECRET`, `META_*`, `ANTHROPIC_API_KEY`, `BACKUP_GH_*`, …) | Netlify → Site configuration → Environment variables | Must be copied into the password manager by hand. |
| Site settings not in `netlify.toml` (domains, production branch, function region) | Netlify dashboard | Write them down in the password manager entry for the site. |

## Taking a backup now

1. Signed in as a superadmin, open `/.netlify/functions/backup-export`. A JSON file downloads with every store above except the token.
2. Open `/.netlify/functions/backup-export?secrets=1` for the version that includes the token store. Store that one in the password manager only.
3. `git bundle create caalano360-YYYYMMDD.bundle --all` from a checkout (after `git fetch --tags`) gives one file holding the whole history.

## Automatic daily backup

`settings-backup` runs daily and writes one file per store to `backups/latest/`
and `backups/daily/YYYY-MM-DD/` in the repo named by `BACKUP_GH_REPO`. It
silently skips when the token is unset - open `/.netlify/functions/settings-backup-now`
to see whether it ran and what it wrote. If `backups/` does not exist in the
repo, it has never run.

## Restoring

**Code:** `git clone caalano360-YYYYMMDD.bundle Caalano360` (or clone from
GitHub), `git checkout vX.Y.Z` for a specific release, push to a new repo,
connect it to a Netlify site, set the environment variables from the password
manager.

**Stores:** a restore script has to write each `stores[name].data[key]` back
with `getStore({ name }).setJSON(key, value)` (or `set` for `_text` values).
The `caalano-auth` store must be restored before anyone can sign in; restore
`ghl-auth` from the secrets download or reconnect Caalano Systems through
Settings → Connect, which mints a new token.

**Test the restore once** into a scratch Netlify site. A backup nobody has
restored from is a hope, not a plan.
