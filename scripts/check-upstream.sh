#!/usr/bin/env bash
# Lists commits of the official RSSHub repo that touched the files socialgate was ported from,
# newer than the commit recorded for each file in UPSTREAM.md.
#
#   scripts/check-upstream.sh            # prints the list, exit 0
#   scripts/check-upstream.sh --check    # same, exit 10 when something is new (for CI)
#
# RSSHUB_DIR     use an existing clone instead of the cache below
# RSSHUB_REPO    default https://github.com/DIYgod/RSSHub.git
# RSSHUB_BRANCH  default master
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${RSSHUB_REPO:-https://github.com/DIYgod/RSSHub.git}"
BRANCH="${RSSHUB_BRANCH:-master}"
DIR="${RSSHUB_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/socialgate/rsshub}"

if [ ! -d "$DIR/.git" ] && [ ! -f "$DIR/HEAD" ]; then
    # Commits and trees only, no file contents: enough for `git log -- <path>`
    git clone -q --filter=blob:none --no-checkout --branch "$BRANCH" "$REPO" "$DIR"
else
    git -C "$DIR" fetch -q origin "$BRANCH"
fi
REF="origin/$BRANCH"
git -C "$DIR" rev-parse -q --verify "$REF" >/dev/null || REF="$BRANCH"

found=0
# rows of the table: | `src/...` | `a`, `b` | commit |
while IFS='|' read -r _ ours files commit _; do
    ours=$(echo "$ours" | tr -d '` ')
    commit=$(echo "$commit" | tr -d ' ')
    paths=()
    while read -r path; do
        paths+=("lib/routes/$path")
    done < <(echo "$files" | grep -o '`[^`]*`' | tr -d '`')
    log=$(git -C "$DIR" log --oneline --no-decorate "$commit..$REF" -- "${paths[@]}" || true)
    echo "== $ours (since $commit)"
    if [ -z "$log" ]; then
        echo "   up to date"
    else
        found=1
        echo "$log" | sed 's/^/   /'
    fi
done < <(grep -E '^\| `src/' UPSTREAM.md)

echo
echo "RSSHub $REF is at $(git -C "$DIR" rev-parse --short "$REF")"
if [ "${1:-}" = "--check" ] && [ "$found" = 1 ]; then
    exit 10
fi
