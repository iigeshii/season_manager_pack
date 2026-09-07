#!/usr/bin/env bash
# Packages season_pack/ into a .mcpack (a renamed .zip) under dist/.
# Stamps the placeholder __BUILD_SHA__ in main.js and manifest.json with the
# current short git SHA, __BUILD_VERSION__ in main.js with the pack's
# major.minor.commit-count version, and rewrites every manifest.json
# "version": [a, b, c] array's patch (c) digit to the current commit count
# — only in the staged copy, tracked source is left untouched. Bumping the
# patch version on every build is what makes Minecraft actually treat a
# reimported pack as an update instead of silently keeping its cached copy.
# Run from anywhere; paths are resolved relative to this script.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACK_DIR="$ROOT_DIR/season_manager/season_pack"
DIST_DIR="$ROOT_DIR/dist"
PACK_NAME="season_manager"
ZIP_PATH="$DIST_DIR/${PACK_NAME}.zip"
MCPACK_PATH="$DIST_DIR/${PACK_NAME}.mcpack"
STAGE_DIR="$DIST_DIR/_stage"

if [ ! -f "$PACK_DIR/manifest.json" ]; then
  echo "error: manifest.json not found in $PACK_DIR" >&2
  exit 1
fi

GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
if [ "$GIT_SHA" != "unknown" ] && [ -n "$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null)" ]; then
  GIT_SHA="${GIT_SHA}-dirty"
fi

COMMIT_COUNT="$(git -C "$ROOT_DIR" rev-list --count HEAD 2>/dev/null || echo 0)"

# Derive major.minor from the tracked manifest so BUILD_VERSION always
# matches the version actually stamped into manifest.json below, instead
# of hardcoding "1.0" a second time here.
MAJOR_MINOR="$(grep -m1 '"version": \[' "$PACK_DIR/manifest.json" | grep -oE '[0-9]+' | head -2 | tr '\n' '.' | sed 's/\.$//')"
BUILD_VERSION="${MAJOR_MINOR}.${COMMIT_COUNT}"

mkdir -p "$DIST_DIR"
rm -rf "$STAGE_DIR"
rm -f "$ZIP_PATH" "$MCPACK_PATH"

# Stage a copy so we can stamp the build SHA/version without touching
# tracked source.
mkdir -p "$STAGE_DIR"
cp -r "$PACK_DIR/." "$STAGE_DIR/"
sed -i "s/__BUILD_SHA__/${GIT_SHA}/g" "$STAGE_DIR/scripts/main.js" "$STAGE_DIR/manifest.json"
sed -i "s/__BUILD_VERSION__/${BUILD_VERSION}/g" "$STAGE_DIR/scripts/main.js"
sed -i -E "s/(\"version\": \[[0-9]+, ?[0-9]+, ?)[0-9]+(\])/\1${COMMIT_COUNT}\2/g" "$STAGE_DIR/manifest.json"

# Use PowerShell's Compress-Archive so the build has no extra dependencies
# (no zip/7z required in Git Bash). manifest.json must sit at the archive
# root, so we zip the *contents* of the staged folder, not the folder itself.
STAGE_DIR_WIN=$(cygpath -w "$STAGE_DIR")
ZIP_PATH_WIN=$(cygpath -w "$ZIP_PATH")

powershell.exe -NoProfile -Command \
  "Compress-Archive -Path '${STAGE_DIR_WIN}\*' -DestinationPath '${ZIP_PATH_WIN}' -Force"

rm -rf "$STAGE_DIR"
mv "$ZIP_PATH" "$MCPACK_PATH"
echo "Built $MCPACK_PATH (version: $BUILD_VERSION, sha: $GIT_SHA)"
