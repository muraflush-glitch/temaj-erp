#!/usr/bin/env bash
# Verifikon, bën commit, hap PR, pret CI dhe e bashkon vetëm nëse CI kalon.
# Përdorimi: scripts/ship.sh "<titulli>" <skedari-i-trupit-të-PR> <skedari-i-mesazhit-të-commit>
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=muraflush-glitch/temaj-erp
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" != "main" ] || { echo "Mos puno direkt në main"; exit 1; }
npm run -s typecheck
(cd apps/api && npx jest --runInBand 2>&1 | grep -E "^Tests:")
npm run -s build >/tmp/build.log 2>&1
npm audit --omit=dev --audit-level=high >/dev/null
git add -A
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -F "$3"
git -c push.negotiate=true push -q -u origin "$BRANCH" 2>&1 | grep -v "negotiat\|acknowledg" || true
PR=$(gh api "repos/$REPO/pulls" -f title="$1" -f head="$BRANCH" -f base=main -f body="$(cat "$2")" --jq '.number')
echo "PR #$PR"
SHA=$(git rev-parse HEAD)
for i in $(seq 1 60); do
  sleep 10
  OUT=$(gh api "repos/$REPO/actions/runs?head_sha=$SHA" --jq '[.workflow_runs[] | .conclusion // "pending"] | join(",")')
  [ -n "$OUT" ] && ! echo "$OUT" | grep -q pending && break
done
echo "CI: $OUT"
echo "$OUT" | grep -qv "failure\|cancelled\|pending" && [ -n "$OUT" ] || { echo "CI nuk kaloi; nuk bashkohet"; exit 1; }
gh api -X PUT "repos/$REPO/pulls/$PR/merge" -f merge_method=merge --jq '.message'
git fetch -q origin main && git checkout -q main && git merge -q --ff-only origin/main
