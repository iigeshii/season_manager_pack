#!/usr/bin/env bash
# Packages season_pack/ (behavior pack) and season_resource_pack/ (resource
# pack) into dist/season_manager-<version>.mcaddon — a renamed .zip with
# both pack folders at its root. They're not built as separate standalone
# .mcpack files: the two packs have a hard two-way dependency on each
# other's UUID (see both manifests' "dependencies"), so importing either
# one alone wouldn't actually work cleanly — the .mcaddon is the only
# distributable that makes sense.
# Successive builds don't overwrite each other once they start getting
# committed for release.
# Stamps the placeholders __BUILD_SHA__ and __BUILD_VERSION__ in main.js
# and both manifest.json files with the current short git SHA and the
# packs' major.minor.commit-count version, and rewrites every
# "version": [a, b, c] array's patch (c) digit to the current commit count
# — only in the staged copies, tracked source is left untouched. Bumping
# the patch version on every build is what makes Minecraft actually treat
# a reimported pack as an update instead of silently keeping its cached
# copy. Both packs are always built from the same commit count, so their
# versions never drift out of sync with each other.
# Run from anywhere; paths are resolved relative to this script.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BP_DIR="$ROOT_DIR/season_manager/season_pack"
RP_DIR="$ROOT_DIR/season_manager/season_resource_pack"
DIST_DIR="$ROOT_DIR/dist"
PACK_NAME="season_manager"
STAGE_DIR="$DIST_DIR/_stage"
BP_STAGE_DIR="$STAGE_DIR/season_pack"
RP_STAGE_DIR="$STAGE_DIR/season_resource_pack"

if [ ! -f "$BP_DIR/manifest.json" ]; then
  echo "error: manifest.json not found in $BP_DIR" >&2
  exit 1
fi
if [ ! -f "$RP_DIR/manifest.json" ]; then
  echo "error: manifest.json not found in $RP_DIR" >&2
  exit 1
fi

GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
DIRTY_SUFFIX=""
# dist/ is excluded here on purpose: it holds the committed .mcaddon
# releases themselves, and without this exclusion, a build's own
# not-yet-committed output would make git status see the tree as dirty and
# mark every build after it dirty too, even with zero actual source changes.
if [ "$GIT_SHA" != "unknown" ] && [ -n "$(git -C "$ROOT_DIR" status --porcelain -- . ':!dist' 2>/dev/null)" ]; then
  DIRTY_SUFFIX="-dirty"
  GIT_SHA="${GIT_SHA}${DIRTY_SUFFIX}"
fi

# Derive major.minor from the tracked behavior pack manifest so
# BUILD_VERSION always matches the version actually stamped into both
# manifest.json files below, instead of hardcoding it a second time here.
# Both packs' header versions are kept in sync by hand when bumped, so
# either would give the same answer — the behavior pack is just the
# original source of truth from before the resource pack existed.
MAJOR_MINOR="$(grep -m1 '"version": \[' "$BP_DIR/manifest.json" | grep -oE '[0-9]+' | head -2 | tr '\n' '.' | sed 's/\.$//')"

# Patch digit = commits since major.minor was last bumped, not the repo's
# total commit count — so a fresh major.minor bump (e.g. 1.x -> 2.0) starts
# its first build at .0 instead of jumping straight to the repo's lifetime
# commit count. Walk commits touching the BP manifest, newest first, and
# keep extending BUMP_COMMIT back through every one that still reports the
# current major.minor; stop at the first one that doesn't. That leaves
# BUMP_COMMIT at the commit that introduced the current major.minor.
BUMP_COMMIT="HEAD"
for commit in $(git -C "$ROOT_DIR" rev-list HEAD -- "$BP_DIR/manifest.json" 2>/dev/null); do
  commit_mm="$(git -C "$ROOT_DIR" show "${commit}:season_manager/season_pack/manifest.json" 2>/dev/null \
    | grep -m1 '"version": \[' | grep -oE '[0-9]+' | head -2 | tr '\n' '.' | sed 's/\.$//')"
  if [ "$commit_mm" = "$MAJOR_MINOR" ]; then
    BUMP_COMMIT="$commit"
  else
    break
  fi
done
# Commits after the bump (exclusive of it), so the bump commit itself is .0.
COMMIT_COUNT="$(git -C "$ROOT_DIR" rev-list --count "${BUMP_COMMIT}..HEAD" 2>/dev/null || echo 0)"
BUILD_VERSION="${MAJOR_MINOR}.${COMMIT_COUNT}"

# Versioned filename so each build lands as its own file under dist/
# instead of overwriting the last one — needed now that built packs get
# committed for release rather than just produced and thrown away.
# Dirty builds (uncommitted changes) get -dirty tacked on so they're never
# mistaken for the real, reproducible build of that commit count.
ADDON_PATH="$DIST_DIR/${PACK_NAME}-${BUILD_VERSION}${DIRTY_SUFFIX}.mcaddon"

mkdir -p "$DIST_DIR"
rm -rf "$STAGE_DIR"
rm -f "$ADDON_PATH"
mkdir -p "$BP_STAGE_DIR" "$RP_STAGE_DIR"

# Stage copies of both packs so we can stamp SHA/version without touching
# tracked source.
cp -r "$BP_DIR/." "$BP_STAGE_DIR/"
cp -r "$RP_DIR/." "$RP_STAGE_DIR/"

stamp_manifest() {
  local stage_dir="$1"
  sed -i "s/__BUILD_SHA__/${GIT_SHA}/g" "$stage_dir/manifest.json"
  sed -i "s/__BUILD_VERSION__/${BUILD_VERSION}/g" "$stage_dir/manifest.json"
  sed -i -E "s/(\"version\": \[[0-9]+, ?[0-9]+, ?)[0-9]+(\])/\1${COMMIT_COUNT}\2/g" "$stage_dir/manifest.json"
}

stamp_manifest "$BP_STAGE_DIR"
stamp_manifest "$RP_STAGE_DIR"
# main.js only exists in the behavior pack.
sed -i "s/__BUILD_SHA__/${GIT_SHA}/g" "$BP_STAGE_DIR/scripts/main.js"
sed -i "s/__BUILD_VERSION__/${BUILD_VERSION}/g" "$BP_STAGE_DIR/scripts/main.js"

# Use PowerShell's Compress-Archive so the build has no extra dependencies
# (no zip/7z required in Git Bash). Both pack folders (season_pack/ and
# season_resource_pack/ themselves, not their contents) need to sit at the
# addon's archive root, so we zip what's directly under $STAGE_DIR rather
# than either pack's contents individually.
STAGE_DIR_WIN=$(cygpath -w "$STAGE_DIR")
ADDON_ZIP_PATH="$DIST_DIR/_addon.zip"

powershell.exe -NoProfile -Command \
  "Compress-Archive -Path '${STAGE_DIR_WIN}\*' -DestinationPath '$(cygpath -w "$ADDON_ZIP_PATH")' -Force"

rm -rf "$STAGE_DIR"
mv "$ADDON_ZIP_PATH" "$ADDON_PATH"

echo "Built $ADDON_PATH (version: $BUILD_VERSION, sha: $GIT_SHA)"
