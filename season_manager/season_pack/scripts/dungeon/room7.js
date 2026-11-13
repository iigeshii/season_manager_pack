import { world, system, BlockPermutation } from "@minecraft/server";
import { isOperator, spawnDungeonMob } from "./nether_rules.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn, isTestMode, onRoomRestart } from "./run_state.js";
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
//  entrance bars close and the floor flashes: five random patterns (half a
//  second each, ticking), then the goal — every tile lit and the exit meter
//  full, held for a second and a half with a chime — then the starting
//  pattern (half the floor lit), which stays, and a second chime. From each
//  player's next step, tiles flip. A tile flips when a player steps onto it
//  from a different tile, or lands on it from a jump (so jumping in place
//  flips the tile you're on, and a jump to another tile flips only the one
//  you land on); two players landing on one tile together cancel out.
//  Ledges and doorways aren't tiles.
//
//  Showing that lit is the goal:
//    - the goal flash above;
//    - the exit meter: two rows of five blocks in the wall right above the
//      exit bars light up (shroomlight) one per 10% of the floor lit, and
//      go dark again as tiles do; full when every tile is lit. The wall
//      blocks it replaces are saved (world property) and put back on reset;
//    - sounds: a bright ding when a tile lights, a dull thud when one goes
//      dark, played at the tile.
//
//  The snag: the first time 90% of the floor is lit in a run, five
//  panicked chickens appear on random tiles. Each takes a small hit (so it
//  panics), runs fast, and gets a random shove every second or so, and
//  flips tiles the same way players do. Kill them to stop them. They're
//  removed when the floor is solved and when the room is reset. Test mode:
//  they die after 10 seconds.
//
//  Anyone on the arrival ledge (e.g. respawned) gets the entrance opened so
//  they can rejoin; it closes again once the ledge is empty.
//
//  Put back (all dark, meter dark, entrance open, toggling off, chickens
//  gone) when the run moves past Room 7 or ends. A restart mid-puzzle keeps
//  the floor as it is.
// ─────────────────────────────────────────────

const R = LAYOUT.room7;
const STAGE = 7;
const RANDOM_FLASHES = 5;
const FLASH_TICKS = 10; // half a second per pattern
const GOAL_TICKS = 30; // the all-lit goal is held for 1.5 s
const START_LIT = R.start_lit_fraction;

const CHICKEN_AT = 0.9; // fraction of the floor lit that lets the chickens out
const CHICKENS = 5;
const CHICKEN_TAG = "season:room7_chicken";
const CHICKEN_SHOVE_TICKS = [15, 30]; // a random shove every 0.75-1.5 s
const CHICKEN_SHOVE = 0.45; // horizontal impulse
const CHICKEN_TEST_TICKS = 200; // test mode: chickens die after 10 s

const MODE = P + "room7_mode"; // "waiting" | "flashing" | "playing" | "won"
const RUN = P + "room7_run";
const CHICKENS_RUN = P + "room7_chickens"; // run the chickens were let out in
const METER_SAVED = P + "room7_meter"; // JSON [[x, y, z, type, states]]: wall under the meter

const [x1, y0, z1] = R.floor_min;
const [x2, , z2] = R.floor_max;
const TILES = [];
for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) TILES.push([x, y0, z]);
const tileIndex = (x, z) => (x - x1) * (z2 - z1 + 1) + (z - z1);

const DARK = BlockPermutation.resolve(R.dark);
const LIT = BlockPermutation.resolve(R.lit);
const BARS = BlockPermutation.resolve("minecraft:iron_bars");
const AIR = BlockPermutation.resolve("minecraft:air");

// Exit meter: the two rows of wall above the exit bars (Airlock 7's back
// gate), bottom row first, each row in the bars' order.
const EXIT_ROWS = LAYOUT.airlocks[STAGE - 1].back.rows;
const EXIT_TOP = EXIT_ROWS[EXIT_ROWS.length - 1];
const METER = [2, 3].flatMap((up) => {
  const [x, y] = EXIT_TOP[0];
  const zs = EXIT_TOP.map((p) => p[2]);
  return Array.from({ length: Math.max(...zs) - Math.min(...zs) + 3 }, (_, i) => [x, y + up, Math.min(...zs) - 1 + i]);
});

let lastTile = new Map(); // player/chicken id -> tile index they last stood on (undefined: off the floor)
const airborne = new Set(); // player/chicken ids seen off the ground since they last stood
let flashStep = 0;
let flashTimer = 0;
let litCount = undefined; // tiles lit, kept as tiles flip; undefined until counted
let meterShown = -1; // meter cells lit, as last drawn
const nextShove = new Map(); // chicken id -> tick of its next shove

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

function soundAt(id, rel, options) {
  try {
    world.getDimension(NETHER_ID).playSound(id, at(rel), options);
  } catch {
    // unknown sound or unloaded chunk: skip
  }
}

// The tile an entity is standing over (feet at floor level + 1), or undefined.
function tileUnder(entity) {
  const o = origin();
  const x = Math.floor(entity.location.x) - o.x;
  const y = Math.floor(entity.location.y) - o.y;
  const z = Math.floor(entity.location.z) - o.z;
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
  if (lit && block.typeId === R.dark) {
    block.setPermutation(LIT);
    if (litCount !== undefined) litCount++;
  }
  if (!lit && block.typeId === R.lit) {
    block.setPermutation(DARK);
    if (litCount !== undefined) litCount--;
  }
}

function countLit() {
  litCount = TILES.reduce((n, _, i) => n + (isLit(i) ? 1 : 0), 0);
  return litCount;
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

// ── Exit meter ──────────────────────────────

// Saves the wall under the meter once, before any of it is lit.
function saveMeter() {
  if (world.getDynamicProperty(METER_SAVED) !== undefined) return true;
  const saved = [];
  for (const p of METER) {
    const block = blockAt(p);
    if (!block) return false; // not loaded: try again later
    if (block.typeId === R.lit) continue;
    saved.push([...p, block.typeId, block.permutation.getAllStates()]);
  }
  world.setDynamicProperty(METER_SAVED, JSON.stringify(saved));
  return true;
}

function savedMeter() {
  try {
    return JSON.parse(world.getDynamicProperty(METER_SAVED) ?? "[]");
  } catch {
    return [];
  }
}

// Lights the first `cells` meter blocks and puts the rest back to wall.
function showMeter(cells) {
  if (cells === meterShown || !saveMeter()) return;
  const saved = savedMeter();
  METER.forEach((p, i) => {
    const block = blockAt(p);
    if (!block) return;
    if (i < cells) {
      if (block.typeId !== R.lit) block.setPermutation(LIT);
      return;
    }
    const original = saved.find((s) => s[0] === p[0] && s[1] === p[1] && s[2] === p[2]);
    if (original && block.typeId === R.lit) block.setPermutation(BlockPermutation.resolve(original[3], original[4]));
  });
  meterShown = cells;
}

// One cell per 10% lit; full only when every tile is lit.
function meterFor(lit) {
  return lit >= TILES.length ? METER.length : Math.floor((lit / TILES.length) * METER.length);
}

// Meter back to wall, and forget the saved blocks.
function clearMeter() {
  for (const [x, y, z, type, states] of savedMeter()) {
    const block = blockAt([x, y, z]);
    if (block?.typeId === R.lit) block.setPermutation(BlockPermutation.resolve(type, states));
  }
  world.setDynamicProperty(METER_SAVED, undefined);
  meterShown = -1;
}

// ── Chickens ────────────────────────────────

function chickens() {
  return world.getDimension(NETHER_ID).getEntities({ tags: [CHICKEN_TAG] });
}

function removeChickens() {
  for (const chicken of chickens()) chicken.remove();
  nextShove.clear();
}

function releaseChickens() {
  world.setDynamicProperty(CHICKENS_RUN, currentRun());
  const nether = world.getDimension(NETHER_ID);
  const spots = [...TILES].sort(() => Math.random() - 0.5).slice(0, CHICKENS);
  for (const tile of spots) {
    const p = at([tile[0], R.feet_y, tile[2]]);
    let chicken;
    try {
      chicken = spawnDungeonMob(nether, "minecraft:chicken", { x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
    } catch {
      continue; // not loaded
    }
    chicken.addTag(CHICKEN_TAG);
    try {
      chicken.applyDamage(1); // a hurt chicken panics and runs
      chicken.addEffect("speed", 20 * 60 * 30, { amplifier: 2, showParticles: false });
    } catch {
      // effect or damage refused: it still wanders and flips
    }
    if (isTestMode()) {
      system.runTimeout(() => {
        if (chicken.isValid()) chicken.kill();
      }, CHICKEN_TEST_TICKS);
    }
  }
  sound("mob.chicken.hurt");
}

// Random shoves keep the chickens darting about.
function shoveChickens(list) {
  const now = system.currentTick;
  for (const chicken of list) {
    if ((nextShove.get(chicken.id) ?? 0) > now) continue;
    const [lo, hi] = CHICKEN_SHOVE_TICKS;
    nextShove.set(chicken.id, now + lo + Math.floor(Math.random() * (hi - lo + 1)));
    const angle = Math.random() * Math.PI * 2;
    try {
      chicken.applyImpulse({ x: Math.cos(angle) * CHICKEN_SHOVE, y: 0.15, z: Math.sin(angle) * CHICKEN_SHOVE });
    } catch {
      // can't push it: skip
    }
  }
}

// ── Reset ───────────────────────────────────

function resetRoom() {
  lastTile = new Map();
  airborne.clear();
  TILES.forEach((_, i) => setTile(i, false));
  litCount = 0;
  clearMeter();
  removeChickens();
  world.setDynamicProperty(CHICKENS_RUN, undefined);
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
      flashStep++;
      if (flashStep <= RANDOM_FLASHES) {
        // Random patterns, ticking.
        flashTimer = FLASH_TICKS;
        randomPattern();
        sound("random.click");
        return;
      }
      if (flashStep === RANDOM_FLASHES + 1) {
        // The goal: everything lit, meter full.
        flashTimer = GOAL_TICKS;
        TILES.forEach((_, i) => setTile(i, true));
        showMeter(METER.length);
        sound("random.orb");
        return;
      }
      // The starting pattern stays; toggling counts from each player's next step.
      randomPattern();
      showMeter(meterFor(countLit()));
      lastTile = new Map(members.map((p) => [p.id, tileUnder(p)]));
      airborne.clear();
      sound("note.chime");
      setMode("playing");
      return;
    }
    case "playing": {
      // Entrance open while someone waits on the arrival ledge (respawned).
      setEntrance(members.some(onLedge));
      if (litCount === undefined) countLit(); // after a restart

      const flock = chickens();
      shoveChickens(flock);

      const flips = new Map(); // tile -> times flipped this tick
      for (const walker of [...members, ...flock]) {
        if (walker.isOnGround === false) {
          airborne.add(walker.id); // mid-jump: wait until they land
          continue;
        }
        const landed = airborne.delete(walker.id);
        const tile = tileUnder(walker);
        const seen = lastTile.has(walker.id); // first sighting (e.g. after a restart) only records
        const before = lastTile.get(walker.id);
        lastTile.set(walker.id, tile);
        if (!seen || tile === undefined) continue;
        if (tile === before && !landed) continue; // still standing on the same tile
        flips.set(tile, (flips.get(tile) ?? 0) + 1);
      }
      for (const [tile, times] of flips) {
        if (times % 2 === 0) continue; // two at once cancel out
        const lit = !isLit(tile);
        setTile(tile, lit);
        soundAt(lit ? "random.orb" : "note.bass", [TILES[tile][0], R.feet_y, TILES[tile][2]], lit ? { pitch: 1.4, volume: 0.6 } : { pitch: 0.5, volume: 0.8 });
      }

      // Recount once a second as a backstop; check for the win on a change.
      if (++litCheck >= 20) {
        litCheck = 0;
        countLit();
      }
      if (flips.size > 0 || litCheck === 0) {
        showMeter(meterFor(litCount));
        if (litCount >= TILES.length) {
          removeChickens();
          setGate(STAGE, "back", true);
          setMode("won");
          sound("random.levelup");
          return;
        }
        if (litCount >= Math.ceil(TILES.length * CHICKEN_AT) && world.getDynamicProperty(CHICKENS_RUN) !== currentRun()) {
          releaseChickens();
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
