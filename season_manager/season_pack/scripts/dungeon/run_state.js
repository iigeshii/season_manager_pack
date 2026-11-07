import { world } from "@minecraft/server";

// ─────────────────────────────────────────────
//  MENDING RESCUE SHARED STATE
//  World properties every dungeon module reads. Kept apart from
//  mending_rescue.js so room modules can use them without importing it.
// ─────────────────────────────────────────────

export const P = "season:mending_rescue_";
export const NETHER_ID = "minecraft:nether";

export function getJson(key) {
  const raw = world.getDynamicProperty(P + key);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function setJson(key, value) {
  world.setDynamicProperty(P + key, value === undefined ? undefined : JSON.stringify(value));
}

// Where the dungeon structure was placed: its minimum corner.
export function origin() {
  return getJson("origin");
}

// A run is on from the seal until off.
export function isEventOn() {
  return world.getDynamicProperty(P + "on") === true;
}

// Test mode: puzzles that need a group can be done solo (e.g. Room 1's
// pads stay lit on their own).
export function isTestMode() {
  return world.getDynamicProperty(P + "test_mode") === true;
}

export function setTestMode(on) {
  world.setDynamicProperty(P + "test_mode", on);
}

// Words of /scriptevent season:mending_rescue that room modules answer
// themselves, so mending_rescue.js doesn't reply "unknown command".
export const extraCommands = new Set();
