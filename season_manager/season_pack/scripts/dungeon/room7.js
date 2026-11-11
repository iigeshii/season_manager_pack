import { world, system, BlockPermutation } from "@minecraft/server";
import { isOperator } from "./nether_rules.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn, onRoomRestart } from "./run_state.js";
import { currentStage, isMember } from "./mending_rescue.js";
import { setGate } from "./gates.js";

// ─────────────────────────────────────────────
//  ROOM 7: RUNE FLOOR (light puzzle)
//  Every block of the 23 x 23 floor is a rune tile. Stepping onto a tile
//  flips only that tile, dark to lit or lit to dark. Every tile lit opens
//  the exit bars (Airlock 7's back gate).
//
//  Nothing flips while the party walks in. Once every online non-operator
//  party member is on the floor (and at least one party member), the
//  entrance bars close, six random patterns flash (half a second each,
//  ticking), the last one stays (half the floor lit), a chime — and from
//  each player's next step, tiles flip. A tile flips when a player lands on
//  it from a different tile (jumping in place doesn't count); two players
//  stepping onto one tile together cancel out. Ledges and doorways aren't
//  tiles.
//
//  Anyone on the arrival ledge (e.g. respawned) gets the entrance opened so
//  they can rejoin; it closes again once the ledge is empty.
//
//  Put back (all dark, entrance open, toggling off) when the run moves past
//  Room 7 or ends. A restart mid-puzzle keeps the floor as it is.
// ─────────────────────────────────────────────

const R = LAYOUT.room7;
const STAGE = 7;
const FLASHES = 6;
const FLASH_TICKS = 10; // half a second per pattern
const START_LIT = R.start_lit_fraction;

const MODE = P + "room7_mode"; // "waiting" | "flashing" | "playing" | "won"
const RUN = P + "room7_run";

const [x1, y0, z1] = R.floor_min;
const [x2, , z2] = R.floor_max;
const TILES = [];
for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) TILES.push([x, y0, z]);
const tileIndex = (x, z) => (x - x1) * (z2 - z1 + 1) + (z - z1);

const DARK = BlockPermutation.resolve(R.dark);
const LIT = BlockPermutation.resolve(R.lit);
const BARS = BlockPermutation.resolve("minecraft:iron_bars");
const AIR = BlockPermutation.resolve("minecraft:air");

let lastTile = new Map(); // player id -> tile index they last stood on (undefined: off the floor)
let flashStep = 0;
let flashTimer = 0;

// ── Helpers ─────────────────────────────────

const mode = () => world.getDynamicProperty(MODE) ?? "waiting";
const setMode = (m) => world.setDynamicProperty(MODE, m);
const currentRun = () => world.getDynamicProperty(P + "run") ?? 0;

function at(rel) {
  const o = origin();
  return { x: o.x + rel[0], y: o.y + rel[1], z: o.z + rel[2] };
}

function blockAt(rel) {
  try {
    return world.getDimension(NETHER_ID).getBlock(at(rel));
  } catch {
    return undefined; // chunk not loaded
  }
}

function sound(id) {
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    try {
      player.playSound(id);
    } catch {
      // unknown sound: skip
    }
  }
}

// The tile a player is standing over (feet at floor level + 1), or undefined.
function tileUnder(player) {
  const o = origin();
  const x = Math.floor(player.location.x) - o.x;
  const y = Math.floor(player.location.y) - o.y;
  const z = Math.floor(player.location.z) - o.z;
  if (y !== R.feet_y || x < x1 || x > x2 || z < z1 || z > z2) return undefined;
  return tileIndex(x, z);
}

function onLedge(player) {
  const o = origin();
  const [lx1, ly1, lz1, lx2, ly2, lz2] = R.arrival_ledge;
  const x = Math.floor(player.location.x) - o.x;
  const y = Math.floor(player.location.y) - o.y;
  const z = Math.floor(player.location.z) - o.z;
  return x >= lx1 && x <= lx2 && y >= ly1 && y <= ly2 && z >= lz1 && z <= lz2;
}

function isLit(i) {
  return blockAt(TILES[i])?.typeId === R.lit;
}

function setTile(i, lit) {
  const block = blockAt(TILES[i]);
  if (!block) return;
  if (lit && block.typeId === R.dark) block.setPermutation(LIT);
  if (!lit && block.typeId === R.lit) block.setPermutation(DARK);
}

function setEntrance(open) {
  for (const p of R.entrance_gate) {
    const block = blockAt(p);
    if (!block) continue;
    if (open && block.typeId === "minecraft:iron_bars") block.setPermutation(AIR);
    if (!open && block.isAir) block.setPermutation(BARS);
  }
}

function randomPattern() {
  TILES.forEach((_, i) => setTile(i, Math.random() < START_LIT));
}

function allLit() {
  return TILES.every((_, i) => isLit(i));
}

function resetRoom() {
  lastTile = new Map();
  TILES.forEach((_, i) => setTile(i, false));
  setEntrance(true);
  setMode("waiting");
}

// ── Main loop: every tick, so sprinting players don't skip tiles ──

let litCheck = 0;

system.runInterval(() => {
  if (!origin()) return;
  const nether = world.getDimension(NETHER_ID);
  const players = nether.getPlayers();
  if (players.length === 0) return; // chunks likely unloaded

  const active = isEventOn() && currentStage() === STAGE;
  if (!active) {
    if (world.getDynamicProperty(RUN) !== undefined) {
      resetRoom();
      world.setDynamicProperty(RUN, undefined);
    }
    return;
  }
  if (world.getDynamicProperty(RUN) !== currentRun()) {
    resetRoom();
    world.setDynamicProperty(RUN, currentRun());
    return;
  }

  const members = players.filter(isMember);
  switch (mode()) {
    case "waiting": {
      const onFloor = (p) => tileUnder(p) !== undefined;
      if (members.filter((p) => !isOperator(p)).every(onFloor) && members.some(onFloor)) {
        setEntrance(false);
        flashStep = 0;
        flashTimer = 0;
        setMode("flashing");
      }
      return;
    }
    case "flashing": {
      if (flashTimer-- > 0) return;
      flashTimer = FLASH_TICKS;
      randomPattern();
      sound("random.click");
      if (++flashStep < FLASHES) return;
      // Keep this pattern; toggling counts from each player's next step.
      lastTile = new Map(members.map((p) => [p.id, tileUnder(p)]));
      sound("note.chime");
      setMode("playing");
      return;
    }
    case "playing": {
      // Entrance open while someone waits on the arrival ledge (respawned).
      setEntrance(members.some(onLedge));

      const flips = new Map(); // tile -> times flipped this tick
      for (const player of members) {
        if (!player.isOnGround) continue; // mid-jump: wait until they land
        const tile = tileUnder(player);
        const seen = lastTile.has(player.id); // first sighting (e.g. after a restart) only records
        const before = lastTile.get(player.id);
        lastTile.set(player.id, tile);
        if (!seen || tile === undefined || tile === before) continue;
        flips.set(tile, (flips.get(tile) ?? 0) + 1);
      }
      for (const [tile, times] of flips) {
        if (times % 2 === 1) setTile(tile, !isLit(tile)); // two at once cancel out
      }

      // Win check: on a change, and once a second as a backstop.
      if (flips.size > 0 || ++litCheck >= 20) {
        litCheck = 0;
        if (allLit()) {
          setGate(STAGE, "back", true);
          setMode("won");
          sound("random.levelup");
        }
      }
      return;
    }
    default:
      return; // won
  }
}, 1);

// `jump 7`: start over. Marked as set up for no run, so the next check
// puts the room back and sets it up fresh.
onRoomRestart(STAGE, () => world.setDynamicProperty(RUN, -1));
