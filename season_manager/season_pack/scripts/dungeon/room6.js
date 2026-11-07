import { world, system, BlockPermutation, ItemStack } from "@minecraft/server";
import { spawnDungeonMob } from "./nether_rules.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn, isTestMode, onRunEnded } from "./run_state.js";
import { currentStage } from "./mending_rescue.js";
import { setGate } from "./gates.js";

// ─────────────────────────────────────────────
//  ROOM 6: THREE-FLOOR MAZE
//  When the run reaches the maze, six keys (trial keys named "Key #1" to
//  "Key #6", marked with this run's number) are hidden in six random maze
//  barrels, and 24 mobs are scattered through the corridors — 8 per floor,
//  spread out, no boss, never restocked.
//
//  The key hall has six numbered altars (barrels). Putting a key in its own
//  altar consumes it and lights the altar's pedestal; any other item is
//  left alone. When all six are lit, the exit bars (Airlock 6's back gate)
//  open.
//
//  Test mode: the mobs die off about 10 seconds after they're out.
//
//  Keys left in barrels, altars, inventories or on the floor and leftover
//  mobs are cleared when the run moves past the maze or ends; keys are
//  taken out of inventories the moment a run ends, and on login.
// ─────────────────────────────────────────────

const R = LAYOUT.room6;
const STAGE = 6;
const CHECK_TICKS = 20;
const KEY_ITEM = "minecraft:trial_key";
const MOB_TAG = "season:room6_mob";
const MOB_SPACING = 6; // blocks apart, at least, on the same floor
const LIT = "minecraft:shroomlight";
const ROOM_RADIUS = 40; // around the maze centre, for dropped keys

const RUN = P + "room6_run";
const ALTARS = P + "room6_altars"; // JSON [6] booleans
const MOBS_DONE = P + "room6_mobs_done";

// Per floor (feet level): what's scattered there.
const XBOW = { type: "minecraft:piglin", weapon: "crossbow" };
const SWORD = { type: "minecraft:piglin", weapon: "golden_sword" };
const PILLAGER = { type: "minecraft:pillager" };
const BRUTE = { type: "minecraft:piglin_brute" };
const PER_FLOOR = [SWORD, SWORD, SWORD, XBOW, XBOW, PILLAGER, PILLAGER, BRUTE];

let spawnPlan = []; // mobs still to place this run: [{ spec, spot }]
let mobsPlacedAt = undefined; // tick the last of them went out (test mode kills them 10 s later)
const TEST_KILL_TICKS = 200; // test mode: the maze mobs die off after ~10 seconds

// ── Helpers ─────────────────────────────────

const currentRun = () => world.getDynamicProperty(P + "run") ?? 0;
const runMark = (run) => `§8${run}`;

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

function containerAt(rel) {
  return blockAt(rel)?.getComponent("minecraft:inventory")?.container;
}

function swap(rel, from, to) {
  const block = blockAt(rel);
  if (block && block.typeId === from) block.setPermutation(BlockPermutation.resolve(to));
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

const shuffle = (list) => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

// ── Keys ────────────────────────────────────

function makeKey(n, run) {
  const key = new ItemStack(KEY_ITEM, 1);
  key.nameTag = R.key_names[n];
  key.setLore([runMark(run)]);
  return key;
}

// Any maze key, from any run.
function isMazeKey(item) {
  return !!item && item.typeId === KEY_ITEM && R.key_names.includes(item.nameTag) && item.getLore().some((l) => l.startsWith("§8"));
}

// Key #n from this run.
function isKeyFor(item, n) {
  return isMazeKey(item) && item.nameTag === R.key_names[n] && item.getLore().includes(runMark(currentRun()));
}

function clearKeysFrom(container) {
  if (!container) return;
  for (let slot = 0; slot < container.size; slot++) {
    if (isMazeKey(container.getItem(slot))) container.setItem(slot, undefined);
  }
}

function clearKeysEverywhere() {
  for (const p of [...R.barrels, ...R.altars]) clearKeysFrom(containerAt(p));
  for (const player of world.getAllPlayers()) clearKeysFrom(player.getComponent("minecraft:inventory")?.container);
  if (origin()) {
    const centre = at(R.barrels[Math.floor(R.barrels.length / 2)]);
    for (const drop of world.getDimension(NETHER_ID).getEntities({ type: "minecraft:item", location: centre, maxDistance: ROOM_RADIUS })) {
      if (isMazeKey(drop.getComponent("minecraft:item")?.itemStack)) drop.remove();
    }
  }
}

function hideKeys(run) {
  const barrels = shuffle([...R.barrels]).slice(0, R.key_names.length);
  barrels.forEach((rel, n) => {
    const container = containerAt(rel);
    if (!container) return;
    const empty = [...Array(container.size).keys()].filter((s) => !container.getItem(s));
    container.setItem(empty[Math.floor(Math.random() * empty.length)] ?? 0, makeKey(n, run));
  });
}

// ── Altars ──────────────────────────────────

function altarsDone() {
  const raw = world.getDynamicProperty(ALTARS);
  try {
    return typeof raw === "string" ? JSON.parse(raw) : R.altars.map(() => false);
  } catch {
    return R.altars.map(() => false);
  }
}

function checkAltars() {
  const done = altarsDone();
  let changed = false;
  R.altars.forEach((rel, n) => {
    if (done[n]) return;
    const container = containerAt(rel);
    if (!container) return;
    for (let slot = 0; slot < container.size; slot++) {
      if (!isKeyFor(container.getItem(slot), n)) continue;
      container.setItem(slot, undefined); // consumed
      done[n] = true;
      changed = true;
      swap(R.pedestals[n], R.pedestal_block, LIT);
      sound("random.orb");
      return;
    }
  });
  if (!changed) return;
  world.setDynamicProperty(ALTARS, JSON.stringify(done));
  if (done.every(Boolean)) {
    setGate(STAGE, "back", true);
    sound("random.levelup");
  }
}

// ── Mobs ────────────────────────────────────

function planMobs() {
  const plan = [];
  const floors = [...new Set(R.mob_spots.map((p) => p[1]))];
  for (const y of floors) {
    const chosen = [];
    for (const spot of shuffle(R.mob_spots.filter((p) => p[1] === y))) {
      if (chosen.length >= PER_FLOOR.length) break;
      if (chosen.every((c) => Math.max(Math.abs(c[0] - spot[0]), Math.abs(c[2] - spot[2])) >= MOB_SPACING)) chosen.push(spot);
    }
    chosen.forEach((spot, i) => plan.push({ spec: PER_FLOOR[i], spot }));
  }
  return plan;
}

function equip(mob, slot, item) {
  try {
    mob.runCommand(`replaceitem entity @s ${slot} 0 ${item}`);
  } catch {
    // command failed: default gear
  }
}

// Places what it can; anything in an unloaded chunk waits for the next check.
function placeMobs() {
  const nether = world.getDimension(NETHER_ID);
  spawnPlan = spawnPlan.filter(({ spec, spot }) => {
    const p = at(spot);
    try {
      const mob = spawnDungeonMob(nether, spec.type, { x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
      mob.addTag(MOB_TAG);
      if (spec.weapon) equip(mob, "slot.weapon.mainhand", spec.weapon);
      return false;
    } catch {
      return true; // not loaded yet
    }
  });
  if (spawnPlan.length === 0) {
    world.setDynamicProperty(MOBS_DONE, currentRun());
    mobsPlacedAt = system.currentTick;
  }
}

// ── Set up and clear ────────────────────────

function setUp() {
  if (![...R.barrels, ...R.altars].every((p) => containerAt(p))) return false; // not loaded yet
  clearKeysEverywhere();
  R.pedestals.forEach((p) => swap(p, LIT, R.pedestal_block));
  world.setDynamicProperty(ALTARS, JSON.stringify(R.altars.map(() => false)));
  hideKeys(currentRun());
  spawnPlan = planMobs();
  world.setDynamicProperty(MOBS_DONE, undefined);
  world.setDynamicProperty(RUN, currentRun());
  return true;
}

function clearRoom() {
  spawnPlan = [];
  for (const mob of world.getDimension(NETHER_ID).getEntities({ tags: [MOB_TAG] })) mob.remove();
  clearKeysEverywhere();
  R.pedestals.forEach((p) => swap(p, LIT, R.pedestal_block));
  world.setDynamicProperty(ALTARS, undefined);
  world.setDynamicProperty(MOBS_DONE, undefined);
  world.setDynamicProperty(RUN, undefined);
}

// Keys come out of inventories the moment a run ends, wherever players are,
// and from anyone offline then when they next log in (unless they're in the
// maze stage of a run).
onRunEnded(() => {
  for (const player of world.getAllPlayers()) clearKeysFrom(player.getComponent("minecraft:inventory")?.container);
});
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    if (!player.isValid() || (isEventOn() && currentStage() === STAGE)) return;
    clearKeysFrom(player.getComponent("minecraft:inventory")?.container);
  }, 20);
});

// ── Main loop ───────────────────────────────

system.runInterval(() => {
  if (!origin()) return;
  if (world.getDimension(NETHER_ID).getPlayers().length === 0) return; // chunks likely unloaded

  const active = isEventOn() && currentStage() === STAGE;
  if (!active) {
    if (world.getDynamicProperty(RUN) !== undefined) clearRoom();
    return;
  }
  if (world.getDynamicProperty(RUN) !== currentRun()) {
    if (world.getDynamicProperty(RUN) !== undefined) clearRoom();
    setUp();
    return;
  }
  // A restart before all mobs were placed: plan them again (no restock
  // once they're all out).
  if (world.getDynamicProperty(MOBS_DONE) !== currentRun() && spawnPlan.length === 0) {
    const placed = world.getDimension(NETHER_ID).getEntities({ tags: [MOB_TAG] }).length;
    spawnPlan = placed > 0 ? [] : planMobs();
    if (placed > 0) world.setDynamicProperty(MOBS_DONE, currentRun());
  }
  if (spawnPlan.length > 0) placeMobs();
  // Test mode: the maze mobs die off ~10 seconds after they're out (or as
  // soon as test mode is switched on, if that's later).
  if (isTestMode()) {
    mobsPlacedAt ??= system.currentTick;
    if (system.currentTick - mobsPlacedAt >= TEST_KILL_TICKS) {
      for (const mob of world.getDimension(NETHER_ID).getEntities({ tags: [MOB_TAG] })) mob.kill();
    }
  }
  checkAltars();
}, CHECK_TICKS);
