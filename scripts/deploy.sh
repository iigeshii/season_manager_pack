#!/usr/bin/env bash
# Installs (or refreshes) the dev copy of the behavior pack into Minecraft's
# development_behavior_packs folder. Wipes any existing copy first so stale
# files never linger between iterations — just reload the world in-game after.
#
# Usage: ./scripts/deploy.sh [path-to-development_behavior_packs]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACK_DIR="$ROOT_DIR/season_manager/season_pack"
PACK_NAME="season_manager"

if [ ! -f "$PACK_DIR/manifest.json" ]; then
  echo "error: manifest.json not found in $PACK_DIR" >&2
  exit 1
fi

GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
if [ "$GIT_SHA" != "unknown" ] && [ -n "$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null)" ]; then
  GIT_SHA="${GIT_SHA}-dirty"
fi

if [ "${1:-}" ]; then
  DEV_PACKS_DIR="$1"
else
  PACKAGES_DIR="$HOME/AppData/Local/Packages"
  DEV_PACKS_DIR="$(find "$PACKAGES_DIR" -maxdepth 6 -type d \
    -ipath "*Microsoft.Minecraft*/LocalState/games/com.mojang/development_behavior_packs" \
    2>/dev/null | head -n 1)"
fi

if [ -z "${DEV_PACKS_DIR:-}" ] || [ ! -d "$DEV_PACKS_DIR" ]; then
  echo "error: could not locate development_behavior_packs automatically." >&2
  echo "       pass its path explicitly: ./scripts/deploy.sh \"<path>\"" >&2
  exit 1
fi

TARGET_DIR="$DEV_PACKS_DIR/$PACK_NAME"

echo "Removing old install at $TARGET_DIR (if present)..."
rm -rf "$TARGET_DIR"

echo "Copying $PACK_DIR -> $TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -r "$PACK_DIR/." "$TARGET_DIR/"

# Stamp the build SHA into the deployed copy only — tracked source is untouched
sed -i "s/__BUILD_SHA__/${GIT_SHA}/g" "$TARGET_DIR/scripts/main.js"

echo "Installed to $TARGET_DIR (sha: $GIT_SHA)"
