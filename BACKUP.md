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

**Stores:** `scripts/restore-backup.mjs` writes a backup file back into a
site's Blobs. It takes the whole `backup-export` JSON or one store file from
`backups/latest/`, restores `caalano-auth` first (nobody can sign in without
it), then settings, terms and the rest, and wraps text blobs correctly.

```
node scripts/restore-backup.mjs caalano360-backup-2026-09-11.json --site <site-id> --token <personal-token> --dry-run
node scripts/restore-backup.mjs caalano360-backup-2026-09-11.json --site <site-id> --token <personal-token>
node scripts/restore-backup.mjs backups/latest/caalano-settings.json --site <site-id> --token <personal-token> --store caalano-settings
```

`--dry-run` lists what would be written and touches nothing. `--wipe` also
deletes keys the backup does not have (default keeps them). Site ID is under
Site configuration → General; the token is a Netlify personal access token.
`ghl-auth` is only in a `?secrets=1` export; without it, reconnect Caalano
Systems through Settings → Connect, which mints a new token.

`tests/backup_restore_test.mjs` proves the round trip on every test run:
export, wipe, restore, export again, byte-for-byte equal.

**Test the restore once** into a scratch Netlify site. A backup nobody has
restored from is a hope, not a plan. The drill: create a throwaway Netlify site
from the same repo, set only `AUTH_SECRET`, run the restore script against it
with a fresh `backup-export` file, sign in, and check Settings shows the real
clients and key events. Then delete the site.

## Status checklist (tick these off)

- [ ] `BACKUP_GH_TOKEN` and `BACKUP_GH_REPO` set in Netlify, so the daily job
      actually runs. As of 2026-09-11 `backups/` does not exist in the repo,
      which means it has never run. Use a separate private repo
      (e.g. `alexcaalano/caalano360-backups`) rather than the app repo.
- [ ] A `backup-export?secrets=1` file saved in the password manager (dated).
- [ ] The 15 environment variables copied into the password manager entry.
- [ ] Netlify site settings (domain, production branch, function region,
      scheduled functions) written into the same entry.
- [ ] A second git remote (a private mirror) receiving pushes, or a monthly
      `git bundle` kept off-site.
- [ ] One restore drill completed into a scratch site, with the date noted here.
