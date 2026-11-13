import { world } from "@minecraft/server";
import { LAYOUT } from "./layout.js";
import { NETHER_ID, origin } from "./run_state.js";

// ─────────────────────────────────────────────
//  NO BEDS OR TNT IN THE DUNGEON
//  Beds explode in the Nether and TNT explodes anywhere, so neither can be
//  placed in or around the dungeon by anyone, operators included. Covers
//  the structure's whole box plus MARGIN blocks on every side, so nothing
//  can be set off against the outside of its walls either. TNT minecarts
//  count as TNT.
//
//  Not gated by the season:toggle pause: it protects the dungeon rather
//  than being a season restriction.
// ─────────────────────────────────────────────

const MARGIN = 8; // blocks around the structure

function isForbidden(typeId) {
  return typeId === "minecraft:bed" || typeId.endsWith("_bed") || typeId === "minecraft:tnt" || typeId === "minecraft:tnt_minecart";
}

function nearDungeon(location) {
  const o = origin();
  if (!o) return false;
  const [sx, sy, sz] = LAYOUT.size;
  return (
    location.x >= o.x - MARGIN && location.x < o.x + sx + MARGIN &&
    location.y >= o.y - MARGIN && location.y < o.y + sy + MARGIN &&
    location.z >= o.z - MARGIN && location.z < o.z + sz + MARGIN
  );
}

world.beforeEvents.itemUseOn.subscribe((event) => {
  const item = event.itemStack?.typeId;
  if (!item || !isForbidden(item)) return;
  if (event.block.dimension.id !== NETHER_ID || !nearDungeon(event.block.location)) return;
  event.cancel = true;
  if (event.isFirstEvent !== false) event.source.sendMessage("§cBeds and TNT can't be placed in the dungeon.");
});
