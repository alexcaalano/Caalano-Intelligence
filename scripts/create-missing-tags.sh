#!/usr/bin/env bash
# Create + push the release tags that were never created.
#
# 42 releases have a CHANGELOG entry and a real commit but no git tag: the
# earliest 38 (from before tagging started) plus v3.89.0, v3.237.0, v3.380.0 and
# v3.381.0, which slipped. The commits were recovered by searching history for
# each APP_VERSION string and cross-checked against the 381 releases that DO
# have tags - all 381 matched, so the same method is sound for these.
#
# This could not be run from the agent session: pushing tags returns 403, that
# session's credential covers the working branch only.
#
# Safe to re-run: `git tag` without -f refuses to move an existing tag.
set -euo pipefail
cd "$(dirname "$0")/.."

created=0
while read -r tag sha; do
  [ -z "$tag" ] && continue
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "  $tag already exists locally, skipping"
    continue
  fi
  git tag "$tag" "$sha"
  created=$((created + 1))
done <<'TAGS'
v3.0.0 43dadea
v3.1.0 b3ad8e6
v3.10.0 c9040aa
v3.11.0 1934ad9
v3.12.0 f57ec01
v3.13.0 1864b5a
v3.14.0 de9349a
v3.14.1 eeed5c1
v3.14.2 cc1fca1
v3.14.3 887354c
v3.15.0 7b56181
v3.16.0 0093412
v3.17.0 32d40bb
v3.18.0 37961c6
v3.18.1 32bc08b
v3.19.0 5ae4cb9
v3.2.0 c710a78
v3.20.0 1d9d82e
v3.21.0 bb0dbba
v3.22.0 dbe6b97
v3.23.0 11e9c94
v3.237.0 93572d6
v3.24.0 f11effc
v3.25.0 7699088
v3.26.0 724fbff
v3.27.0 519101a
v3.28.0 810daf3
v3.29.0 18869c5
v3.29.1 ebe041a
v3.3.0 4f98d44
v3.30.0 a730a1b
v3.31.0 2fa2a8d
v3.31.1 266097a
v3.380.0 8640d6c
v3.381.0 f73c487
v3.4.0 455bc22
v3.5.0 ce0cb49
v3.6.0 cb373db
v3.7.0 a20253b
v3.8.0 c957e3c
v3.89.0 1239afe
v3.9.0 b3b1e28
TAGS

echo "created $created tag(s) locally"
echo "pushing..."
git push origin --tags
echo "done - remote tags: $(git ls-remote --tags origin | grep -v '\^{}' | wc -l)"
