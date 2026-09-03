// One-click backup: everything that lives only in Blobs, as a single JSON file
// downloaded to the superadmin's machine. Works with no GitHub token set, so a
// backup can always be taken by hand before anything risky.
//
//   /.netlify/functions/backup-export             every store except secrets
//   /.netlify/functions/backup-export?secrets=1   adds the Caalano Systems OAuth
//                                                 token store - keep that file
//                                                 where secrets are kept
//
// Superadmin only. The file names its format and date, lists what was NOT
// included (the rebuildable caches), and every store carries its key count and
// whether it was capped, so a restore knows exactly what it is holding.
import { collectBackup } from '../lib/backup.mjs'
import { requireOpsAdmin } from '../lib/auth.mjs'

export default async (req) => {
  const deny = await requireOpsAdmin(req); if (deny) return deny
  const url = new URL(req.url)
  const includeSecrets = url.searchParams.get('secrets') === '1'
  try {
    const all = await collectBackup({ includeSecrets })
    const day = all.at.slice(0, 10)
    const name = `caalano360-backup-${day}${includeSecrets ? '-with-secrets' : ''}.json`
    return new Response(JSON.stringify(all, null, 1), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 })
  }
}
