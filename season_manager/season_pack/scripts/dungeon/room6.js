import { world, system, BlockPermutation, ItemStack, MolangVariableMap } from "@minecraft/server";
import { spawnDungeonMob } from "./nether_rules.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn, isTestMode, onRunEnded, onRoomRestart, extraCommands } from "./run_state.js";
import { currentStage, isMember, spacesAt } from "./mending_rescue.js";
import { setGate } from "./gates.js";

// ─────────────────────────────────────────────
//  ROOM 6: THREE-FLOOR MAZE
//  When the run reaches the maze, six keys (trial keys named "Key #1" to
//  "Key #6", marked with this run's number) are hidden in six random maze
//  barrels, and 3-4 mob spots per floor are picked through the corridors,
//  spread out, no boss, never restocked. Nothing is spawned up
//  front: each spot's group of 1-3 mobs appears there at once, in a puff of
//  smoke and with a raid-horn alarm, the first time a player standing on
//  that same floor comes within TRIP_RADIUS blocks of it (an ambush; players
//  on the floors above and below, or on a ladder between floors, don't set
//  it off). A group is the spot's own mob from the floor mix plus 0-2 extra
//  piglins or pillagers (never an extra brute). Once out, a mob is free to
//  roam and chase anywhere. Groups not yet sprung survive a restart.
//
//  The key hall has six numbered altars (barrels). Putting a key in its own
//  altar consumes it and lights the altar's pedestal; any other item is
//  left alone. When all six are lit, the exit bars (Airlock 6's back gate)
//  open.
//
//  Test mode: each mob dies off about 10 seconds after it appears.
//
//  /scriptevent season:mending_rescue keys  lists where each of this run's
//  keys not yet in its altar is: a barrel (floor and world position), a
//  player's inventory, the wrong altar, or dropped on the floor.
//
//  Trail: wherever a party member walks in the maze, the corridor floor
//  block under their feet (polished blackstone) turns into a glowing
//  verdant froglight, so the group can see where they've already been. No
//  froglights are used in the maze's build, so the trail is wiped by
//  turning every froglight on the three floor slabs back into polished
//  blackstone: when the maze is set up for a run (or `jump 6`) and when
//  it's cleared.
//
//  Every maze barrel and key altar is emptied completely (not just keys:
//  they're built empty, so anything in them was put there by players) when
//  the maze is set up for a run (and on `jump 6`) and when it's cleared.
//  Keys left in inventories or on the floor and leftover
//  mobs are cleared when the run moves past the maze or ends; keys are
//  taken out of inventories the moment a run ends, and on login. Maze mobs
//  found at any other time (left in a chunk that wasn't loaded when the
//  room was cleared) are removed as soon as they're seen.
// ─────────────────────────────────────────────

const R = LAYOUT.room6;
const STAGE = 6;
const CHECK_TICKS = 20;
const KEY_ITEM = "minecraft:trial_key";
const MOB_TAG = "season:room6_mob";
const MOB_SPACING = 6; // blocks apart, at least, on the same floor
const TRIP_RADIUS = 8; // a player this close to a spot (same floor) springs its mob
const TRIP_SLACK = 1.5; // feet this far above or below a spot's floor still count as on it (a jump, not a ladder climb; floors are 4 apart)
const SPAWN_PUFF = "minecraft:death_explosion_emitter"; // the white puff a mob leaves when it dies
// That puff sizes itself from its mob's box (variable.aabb); with no mob
// behind it, it's handed a piglin-sized one so it doesn't log Molang errors.
const PUFF_BOX = { x: 0.6, y: 1.9, z: 0.6 };
const ALARM_SOUND = "raid.horn";
const ALARM_RADIUS = 32; // players this close to a sprung spot hear the alarm (any floor)
const ALARM_GAP = 100; // ticks: one alarm at a time, even when several spots spring together
const LIT = "minecraft:shroomlight";
const ROOM_RADIUS = 40; // around the maze centre, for dropped keys

const TRAIL_TICKS = 4; // a sprinting player covers about a block in this time
const TRAIL = "minecraft:verdant_froglight";
const TRAIL_PERM = BlockPermutation.resolve(TRAIL);
const CORRIDOR_FLOOR = "minecraft:polished_blackstone";
const CORRIDOR_FLOOR_PERM = BlockPermutation.resolve(CORRIDOR_FLOOR);
// Floor slabs, one below each floor's feet level (mob spots are at feet level).
const SLAB_YS = [...new Set(R.mob_spots.map((p) => p[1] - 1))];
// The maze's footprint (all its boxes), for wiping the trail.
const MAZE_BOXES = LAYOUT.spaces.room6.boxes;
const MAZE_X = [Math.min(...MAZE_BOXES.map((b) => b[0])), Math.max(...MAZE_BOXES.map((b) => b[3]))];
const MAZE_Z = [Math.min(...MAZE_BOXES.map((b) => b[2])), Math.max(...MAZE_BOXES.map((b) => b[5]))];

const RUN = P + "room6_run";
const ALTARS = P + "room6_altars"; // JSON [6] booleans
const MOBS_DONE = P + "room6_mobs_done";
const PLAN = P + "room6_plan"; // JSON [{ group, spot }]: groups not sprung yet this run

// Per floor (feet level): what's scattered there.
const XBOW = { type: "minecraft:piglin", weapon: "crossbow" };
const SWORD = { type: "minecraft:piglin", weapon: "golden_sword" };
const PILLAGER = { type: "minecraft:pillager" };
const BRUTE = { type: "minecraft:piglin_brute" };
const SPOTS_PER_FLOOR = [3, 4]; // fewest, most (picked at random per floor)
// Each spot's own mob: the brute first (one per floor), then one each of
// these in random order.
const LEADS = [SWORD, XBOW, PILLAGER];
const EXTRAS = [SWORD, SWORD, SWORD, XBOW, XBOW, PILLAGER, PILLAGER]; // 0-2 more per spot, drawn from these
// Where a group stands inside its spot's block, so they don't spawn stacked.
const GROUP_OFFSETS = [
  [0.5, 0.5],
  [0.25, 0.75],
  [0.75, 0.25],
];

let spawnPlan = []; // groups still to spring this run: [{ group, spot }] (copy of PLAN)
let lastAlarm = -ALARM_GAP;
const bornAt = new Map(); // mob id -> tick it appeared (test mode kills it 10 s later)
const TEST_KILL_TICKS = 200; // test mode: each maze mob dies off after ~10 seconds

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

// Every maze barrel and key altar emptied, whatever's in them (they're
// built empty; anything else was put there by players).
function emptyBarrels() {
  for (const p of [...R.barrels, ...R.altars]) {
    const container = containerAt(p);
    if (!container) continue;
    for (let slot = 0; slot < container.size; slot++) container.setItem(slot, undefined);
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
    const [fewest, most] = SPOTS_PER_FLOOR;
    const count = fewest + Math.floor(Math.random() * (most - fewest + 1));
    const leads = [BRUTE, ...shuffle([...LEADS])];
    const chosen = [];
    for (const spot of shuffle(R.mob_spots.filter((p) => p[1] === y))) {
      if (chosen.length >= count) break;
      if (chosen.every((c) => Math.max(Math.abs(c[0] - spot[0]), Math.abs(c[2] - spot[2])) >= MOB_SPACING)) chosen.push(spot);
    }
    chosen.forEach((spot, i) => {
      const group = [leads[i % leads.length]];
      const extra = Math.floor(Math.random() * 3); // 0, 1 or 2
      for (let n = 0; n < extra; n++) group.push(EXTRAS[Math.floor(Math.random() * EXTRAS.length)]);
      plan.push({ group, spot });
    });
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

function savePlan() {
  world.setDynamicProperty(PLAN, spawnPlan.length > 0 ? JSON.stringify(spawnPlan) : undefined);
}

function loadPlan() {
  try {
    const raw = world.getDynamicProperty(PLAN);
    return typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

// Is a player standing on this spot's floor, within TRIP_RADIUS of it?
function tripped(spot, players) {
  const o = origin();
  return players.some(({ location: l }) => {
    const x = l.x - o.x - 0.5;
    const y = l.y - o.y;
    const z = l.z - o.z - 0.5;
    return Math.abs(y - spot[1]) <= TRIP_SLACK && Math.hypot(x - spot[0], z - spot[2]) <= TRIP_RADIUS;
  });
}

function spawnOne(nether, spec, where) {
  const mob = spawnDungeonMob(nether, spec.type, where);
  mob.addTag(MOB_TAG);
  if (spec.weapon) equip(mob, "slot.weapon.mainhand", spec.weapon);
  bornAt.set(mob.id, system.currentTick);
}

// The raid horn, heard from the sprung spot by everyone nearby; at most one
// every ALARM_GAP ticks.
function soundAlarm(nether, where) {
  if (system.currentTick - lastAlarm < ALARM_GAP) return;
  lastAlarm = system.currentTick;
  for (const player of nether.getPlayers({ location: where, maxDistance: ALARM_RADIUS })) {
    try {
      player.playSound(ALARM_SOUND, { location: where, volume: 4 });
    } catch {
      // unknown sound: skip
    }
  }
}

// Springs every group whose spot a player has walked up to; anything in an
// unloaded chunk waits for the next check.
function placeMobs() {
  const nether = world.getDimension(NETHER_ID);
  const players = nether.getPlayers().filter((pl) => pl.getGameMode?.() !== "spectator");
  const before = spawnPlan.length;
  spawnPlan = spawnPlan.filter(({ group, spec, spot }) => {
    if (!tripped(spot, players)) return true;
    const mobs = group ?? [spec]; // a plan saved before groups: one mob
    const p = at(spot);
    const where = (n) => ({ x: p.x + GROUP_OFFSETS[n % GROUP_OFFSETS.length][0], y: p.y, z: p.z + GROUP_OFFSETS[n % GROUP_OFFSETS.length][1] });
    try {
      spawnOne(nether, mobs[0], where(0));
    } catch {
      return true; // not loaded yet
    }
    mobs.slice(1).forEach((m, n) => {
      try {
        spawnOne(nether, m, where(n + 1));
      } catch {
        // same block as the first, so it's loaded; skip this one
      }
    });
    const centre = { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
    try {
      const vars = new MolangVariableMap();
      vars.setVector3("variable.aabb", PUFF_BOX);
      nether.spawnParticle(SPAWN_PUFF, { x: centre.x, y: centre.y + 1, z: centre.z }, vars);
    } catch {
      // unknown particle: no puff
    }
    soundAlarm(nether, centre);
    return false;
  });
  if (spawnPlan.length === before) return;
  savePlan();
  if (spawnPlan.length === 0) world.setDynamicProperty(MOBS_DONE, currentRun());
}

// ── Trail ───────────────────────────────────

// Lights the floor block under each party member walking the maze.
system.runInterval(() => {
  if (!origin() || !isEventOn() || currentStage() !== STAGE) return;
  if (world.getDynamicProperty(RUN) !== currentRun()) return; // not set up (and wiped) yet
  const o = origin();
  const nether = world.getDimension(NETHER_ID);
  for (const player of nether.getPlayers()) {
    if (!isMember(player)) continue;
    const below = { x: Math.floor(player.location.x), y: Math.floor(player.location.y) - 1, z: Math.floor(player.location.z) };
    if (!SLAB_YS.includes(below.y - o.y)) continue; // not standing on a floor (climbing, jumping)
    if (!spacesAt(player.location).includes("room6")) continue;
    let block;
    try {
      block = nether.getBlock(below);
    } catch {
      continue; // not loaded
    }
    if (block?.typeId === CORRIDOR_FLOOR) block.setPermutation(TRAIL_PERM);
  }
}, TRAIL_TICKS);

// Every trail block back to corridor floor. Cells in unloaded chunks are
// left for the next wipe.
function clearTrail() {
  for (const y of SLAB_YS) {
    for (let x = MAZE_X[0]; x <= MAZE_X[1]; x++) {
      for (let z = MAZE_Z[0]; z <= MAZE_Z[1]; z++) {
        const block = blockAt([x, y, z]);
        if (block?.typeId === TRAIL) block.setPermutation(CORRIDOR_FLOOR_PERM);
      }
    }
  }
}

// ── Set up and clear ────────────────────────

function setUp() {
  if (![...R.barrels, ...R.altars].every((p) => containerAt(p))) return false; // not loaded yet
  clearTrail();
  emptyBarrels();
  clearKeysEverywhere();
  R.pedestals.forEach((p) => swap(p, LIT, R.pedestal_block));
  world.setDynamicProperty(ALTARS, JSON.stringify(R.altars.map(() => false)));
  hideKeys(currentRun());
  spawnPlan = planMobs();
  savePlan();
  world.setDynamicProperty(MOBS_DONE, undefined);
  world.setDynamicProperty(RUN, currentRun());
  return true;
}

function clearRoom() {
  spawnPlan = [];
  bornAt.clear();
  world.setDynamicProperty(PLAN, undefined);
  for (const mob of world.getDimension(NETHER_ID).getEntities({ tags: [MOB_TAG] })) mob.remove();
  emptyBarrels();
  clearKeysEverywhere();
  clearTrail();
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
    // Maze mobs left in a chunk that wasn't loaded when the room was
    // cleared: gone as soon as they're seen. (The Gate Ring is right above
    // the maze, and its mobs stop to stare at anything left down here.)
    for (const mob of world.getDimension(NETHER_ID).getEntities({ tags: [MOB_TAG] })) mob.remove();
    return;
  }
  if (world.getDynamicProperty(RUN) !== currentRun()) {
    if (world.getDynamicProperty(RUN) !== undefined) clearRoom();
    setUp();
    return;
  }
  // A restart before all mobs were sprung: pick up the saved plan (no
  // restock once they're all out). A run from before saved plans: plan
  // again only if nothing was placed yet.
  if (world.getDynamicProperty(MOBS_DONE) !== currentRun() && spawnPlan.length === 0) {
    const saved = loadPlan();
    if (saved) {
      spawnPlan = saved;
    } else {
      const placed = world.getDimension(NETHER_ID).getEntities({ tags: [MOB_TAG] }).length;
      spawnPlan = placed > 0 ? [] : planMobs();
      if (placed > 0) world.setDynamicProperty(MOBS_DONE, currentRun());
      else savePlan();
    }
  }
  if (spawnPlan.length > 0) placeMobs();
  // Test mode: each maze mob dies off ~10 seconds after it appears (or after
  // it's first seen, for one already out when test mode is switched on).
  if (isTestMode()) {
    for (const mob of world.getDimension(NETHER_ID).getEntities({ tags: [MOB_TAG] })) {
      if (!bornAt.has(mob.id)) bornAt.set(mob.id, system.currentTick);
      if (system.currentTick - bornAt.get(mob.id) >= TEST_KILL_TICKS) {
        bornAt.delete(mob.id);
        mob.kill();
      }
    }
  }
  checkAltars();
}, CHECK_TICKS);

// `jump 6`: start over. Marked as set up for no run, so the next check
// puts the room back and sets it up fresh.
onRoomRestart(STAGE, () => world.setDynamicProperty(RUN, -1));

// ── Command: where the keys are ─────────────
//   /scriptevent season:mending_rescue keys

extraCommands.add("keys");

// Which of this run's keys an item is (0-5), or -1.
function keyNumber(item) {
  return R.key_names.findIndex((_, n) => isKeyFor(item, n));
}

// Floors by feet level, bottom first.
const FLOOR_NAMES = ["bottom", "middle", "top"];
const FLOOR_YS = [...new Set(R.mob_spots.map((p) => p[1]))].sort((a, b) => a - b);

function floorOf(y) {
  const i = FLOOR_YS.indexOf(y);
  return i >= 0 ? `${FLOOR_NAMES[i] ?? `floor ${i + 1}`} floor` : `y ${y}`;
}

const fmt = (p) => `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`;

// n -> where key #n+1 is, for every key of this run found anywhere.
function findKeys() {
  const found = new Map();
  const note = (item, where) => {
    const n = keyNumber(item);
    if (n >= 0) found.set(n, [...(found.get(n) ?? []), where]);
  };
  const scan = (container, where) => {
    if (!container) return false;
    for (let slot = 0; slot < container.size; slot++) note(container.getItem(slot), where);
    return true;
  };
  let unloaded = 0;
  for (const p of R.barrels) {
    if (!scan(containerAt(p), `barrel on the ${floorOf(p[1])} at ${fmt(at(p))}`)) unloaded++;
  }
  R.altars.forEach((p, n) => {
    if (!scan(containerAt(p), `altar #${n + 1} (wrong altar) at ${fmt(at(p))}`)) unloaded++;
  });
  for (const player of world.getAllPlayers()) {
    scan(player.getComponent("minecraft:inventory")?.container, `${player.name}'s inventory`);
  }
  const centre = at(R.barrels[Math.floor(R.barrels.length / 2)]);
  for (const drop of world.getDimension(NETHER_ID).getEntities({ type: "minecraft:item", location: centre, maxDistance: ROOM_RADIUS })) {
    note(drop.getComponent("minecraft:item")?.itemStack, `dropped on the floor at ${fmt(drop.location)}`);
  }
  return { found, unloaded };
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:mending_rescue" || event.message.trim().toLowerCase() !== "keys") return;
  const source = event.sourceEntity?.typeId === "minecraft:player" ? event.sourceEntity : undefined;
  const reply = (text) => (source ? source.sendMessage(text) : console.warn(text));
  if (!origin()) return reply("§cThe dungeon's position isn't set.");
  if (!isEventOn() || currentStage() !== STAGE || world.getDynamicProperty(RUN) !== currentRun()) {
    return reply("§7The maze isn't set up (the run isn't in Room 6).");
  }
  const done = altarsDone();
  const { found, unloaded } = findKeys();
  const lines = [`§6Maze keys (run ${currentRun()}): ${done.filter(Boolean).length} of ${R.key_names.length} in their altars`];
  R.key_names.forEach((name, n) => {
    if (done[n]) return;
    const where = found.get(n);
    lines.push(`§7 ${name}: §f${where ? where.join("; ") : "not found (lost, or in a chunk that isn't loaded)"}`);
  });
  if (unloaded > 0) lines.push(`§8 (${unloaded} barrel${unloaded === 1 ? "" : "s"} not loaded, not checked)`);
  reply(lines.join("\n"));
});
