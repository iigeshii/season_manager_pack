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

// Things room modules do the moment a run ends (off / reset), whether or
// not anyone is in the Nether — e.g. taking puzzle items back out of
// inventories. Block cleanup waits for the rooms to be loaded.
const runEndHandlers = [];
export function onRunEnded(handler) {
  runEndHandlers.push(handler);
}
export function runEnded() {
  for (const handler of runEndHandlers) handler();
}

// `jump` starts the room it lands in over from scratch, even the room the
// party is already in. Each room registers how to mark its own setup stale;
// its loop then puts the room back and sets it up fresh on the next check
// (once the room is loaded).
const roomRestarts = new Map();
export function onRoomRestart(stage, handler) {
  roomRestarts.set(stage, handler);
}
export function restartRoom(stage) {
  roomRestarts.get(stage)?.();
}

// Words of /scriptevent season:mending_rescue that room modules answer
// themselves, so mending_rescue.js doesn't reply "unknown command".
export const extraCommands = new Set();
