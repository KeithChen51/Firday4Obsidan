#!/usr/bin/env bash
set -euo pipefail

set +x

if [[ -z "${PUBLISH_TOKEN:-}" ]]; then
	echo "Missing PUBLISH_TOKEN" >&2
	exit 1
fi

publish_remote="$(node scripts/resolve-publish-remote.mjs)"
git remote set-url origin "${publish_remote}"
git config user.name "gitee-pipe"
git config user.email "gitee-pipe@noreply.local"
node scripts/generate-official-content-release.mjs
node scripts/publish-release-branch.mjs --branch release plugin .workflow/publish/official=official
