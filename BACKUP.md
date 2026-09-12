# Backing up and restoring Caalano360

What lives where, how it is backed up, and how to put it back. Written so that
someone who has never seen the app could do it from this page.

## What exists

| Asset | Where it lives | Backup |
|---|---|---|
| Source code, history, release tags | GitHub (`alexcaalano/Caalano-Intelligence`) | Every push. Every release since v3.0.0 has a tag. Keep a second remote and an occasional `git bundle` as well. |
| Configuration, users, terms, history, audit and reliability logs | Netlify Blobs (11 stores) | Daily to `backups/` in the repo when `BACKUP_GH_TOKEN` + `BACKUP_GH_REPO` are set; on demand via `backup-export`. |
| Caalano Systems agency OAuth token | Blob store `ghl-auth` | Only in a `backup-export?secrets=1` download. Keep that file in the password manager, never in git. |
| Caches, warm state, opportunity snapshots | Blob stores | Not backed up - they rebuild themselves. |
| 15 secrets (`AUTH_SECRET`, `WINDSOR_API_KEY`, `GHL_CLIENT_ID/SECRET`, `META_*`, `ANTHROPIC_API_KEY`, `BACKUP_GH_*`, …) | Netlify → Site configuration → Environment variables | Must be copied into the password manager by hand. |
| Site settings not in `netlify.toml` (domains, production branch, function region) | Netlify dashboard | Write them down in the password manager entry for the site. |

## Taking a backup now

The daily job (next section) is the backup. To take one by hand, signed in as
a superadmin, open these on the site's own domain; each downloads a JSON file:

- `/.netlify/functions/backup-export` - every store except the token and the
  two log stores.
- `/.netlify/functions/backup-export?secrets=1` - adds the Caalano Systems
  token store. Keep this file in the password manager only.
- `/.netlify/functions/backup-export?logs=1` - adds the reliability and
  activity logs (bulky).

There are no buttons for these in the app any more: the file holds
everything sensitive and the backup runs by itself, so Settings → Logs only
shows when the last daily backup ran. `git bundle create
caalano360-YYYYMMDD.bundle --all` from a checkout gives one file with the
whole code history.

## Automatic daily backup

`settings-backup` runs daily. The work happens in `settings-backup-background`
(a background function, so it has 15 minutes rather than 10 seconds) and lands
in the repo named by `BACKUP_GH_REPO` as one commit: one file per store under
`backups/latest/` and `backups/daily/YYYY-MM-DD/`. It silently skips when the
token is unset. Open `/.netlify/functions/settings-backup-now` as a superadmin
to start a backup by hand and see how the last one went (files, size, commit,
and any store that failed); add `?status=1` to look without starting one. If
`backups/` does not exist in the repo, it has never run.

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

- [x] `BACKUP_GH_TOKEN` and `BACKUP_GH_REPO` set in Netlify (2026-09-12, repo
      `alexcaalano/caalano360-backups`, first run wrote 11 stores, 23 files, one
      commit, 15 s). The job runs daily by itself now.
- [x] A `backup-export?secrets=1` file saved in the password manager (2026-09-12).
- [x] The environment variables copied into the password manager entry (2026-09-12; the two Meta ones wait on a Meta admin approval, `WARM_SECRET` is not set and not needed).
- [x] Netlify site settings (domain, production branch, function region)
      written into the same entry (2026-09-12).
- [ ] A second git remote (a private mirror) receiving pushes, or a monthly
      `git bundle` kept off-site. (A full clone of the repository lives on
      Alex's MacBook via GitHub Desktop since 2026-09-12, which covers the
      "one copy outside GitHub" part; a mirror that updates itself is still
      open.)
- [x] Every release tagged: the 42 legacy tags were pushed on 2026-09-12
      (`scripts/create-missing-tags.sh`), 605 tags on GitHub.
- [x] One restore drill completed into a scratch site: 2026-09-12, the full
      `backup-export` file restored into a throwaway Netlify project with only
      `AUTH_SECRET` set; sign-in, all 25 clients and every settings section came
      back. Scratch site deleted afterwards.
