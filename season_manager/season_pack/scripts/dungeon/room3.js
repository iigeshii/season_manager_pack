import { world, system, BlockPermutation, ItemStack } from "@minecraft/server";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn, isTestMode, extraCommands } from "./run_state.js";
import { currentStage } from "./mending_rescue.js";
import { setGate } from "./gates.js";
import { spawnDungeonMob } from "./nether_rules.js";

// ─────────────────────────────────────────────
//  ROOM 3: TALLY HALL (counting puzzle)
//  When the run reaches Room 3, each counted colour gets a random count
//  (1-8), split between concrete set out on display spots and lore-tagged
//  concrete hidden in the barrels, plus a few decoy colours. The party
//  counts each colour (barrels + placed), dials the counts into the six
//  tally columns (each starts at 1 lit; each press lights one more, up to
//  8, then wraps to 1 — never 0) and presses the submit button.
//
//  Right: a green circle on the floor, the counters lock, and the exit
//  bars (Airlock 3's back gate) rise.
//  Wrong: a red X, the columns all count up 1-8 together then reset to 1
//  (buttons locked), and guards appear on the four spawn tiles: 2 piglins
//  and 2 piglin brutes. Submit stays locked until every guard is dead; then
//  the floor clears. In test mode the guards are killed after 3 seconds.
//
//  No chat messages: the floor, the sounds and the bars say what happened.
//
//  Players may take concrete out of the barrels; the answer is fixed when
//  the room is set up. All of it (placed blocks, barrels, lore-tagged items
//  in inventories or on the floor, guards) is cleared when the run moves
//  past Room 3 or ends.
//
//  /scriptevent season:mending_rescue answer  shows the counts (testing).
// ─────────────────────────────────────────────

const R = LAYOUT.room3;
const STAGE = 3;
const CHECK_TICKS = 10;
const ANIM_TICKS = 5; // per step of the wrong-answer count-up
// Marks puzzle concrete so it can be cleared on reset. Shows as a blank
// lore line: nothing that names or hints at the room.
const LORE = "§8§r";
const OLD_LORES = ["§7Mending Rescue: Tally Hall"]; // earlier test builds
const GUARD_TAG = "season:room3_guard";
// One per spawn tile. Brutes ignore gold armour, so gold can't wave the penalty away.
const GUARD_TYPES = ["minecraft:piglin", "minecraft:piglin_brute", "minecraft:piglin", "minecraft:piglin_brute"];
const TEST_GUARD_TICKS = 60; // test mode: guards are killed after 3 seconds
const ROOM_RADIUS = 20; // from the room centre, for clearing dropped items and guards

const SETUP = P + "room3_setup"; // JSON { run, answer: [6], placed: [[x, y, z, block]] }
const COUNTERS = P + "room3_counters"; // JSON [6]
const MODE = P + "room3_mode"; // "counting" | "penalty" (count-up running) | "guards" | "solved"
const PENALTY_AT = P + "room3_penalty_at"; // Date.now() of the wrong answer
const PENALTY_STALE_MS = 10 * 1000; // count-up lost to a restart: spawn guards anyway

extraCommands.add("answer");

// ── Helpers ─────────────────────────────────

const perms = new Map();
function permOf(name) {
  if (!perms.has(name)) perms.set(name, BlockPermutation.resolve(name));
  return perms.get(name);
}

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

// Replace a block only if it's the one expected.
function swap(rel, from, to) {
  const block = blockAt(rel);
  if (block && block.typeId === from) block.setPermutation(permOf(to));
}

const sameCell = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function getJsonProp(key) {
  const raw = world.getDynamicProperty(key);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const currentRun = () => world.getDynamicProperty(P + "run") ?? 0;
const mode = () => world.getDynamicProperty(MODE);
const colourName = (id) => id.replace("minecraft:", "").replace("_concrete", "").replace(/_/g, " ");

function sound(id) {
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    try {
      player.playSound(id);
    } catch {
      // unknown sound: skip
    }
  }
}

// Middle of the hall (from the display spots' spread), for entity searches.
const CENTRE = (() => {
  const mid = (k) => (Math.min(...R.display_spots.map((p) => p[k])) + Math.max(...R.display_spots.map((p) => p[k]))) / 2;
  return [mid(0), mid(1), mid(2)];
})();

// ── Columns and floor ───────────────────────

function counters() {
  return getJsonProp(COUNTERS) ?? R.columns.map(() => 1);
}

function paintColumn(i, n) {
  R.columns[i].indicators.forEach((p, k) => {
    if (k < n) swap(p, R.indicator_dark, R.indicator_lit);
    else swap(p, R.indicator_lit, R.indicator_dark);
  });
}

function setCounters(values) {
  world.setDynamicProperty(COUNTERS, JSON.stringify(values));
  values.forEach((n, i) => paintColumn(i, n));
}

function paintFloor(pattern) {
  // "x", "circle" or "none"
  for (const p of R.x_cells) {
    if (pattern === "x") swap(p, R.floor_base, R.x_block);
    else swap(p, R.x_block, R.floor_base);
  }
  for (const p of R.circle_cells) {
    if (pattern === "circle") swap(p, R.floor_base, R.circle_block);
    else swap(p, R.circle_block, R.floor_base);
  }
}

// ── Barrels ─────────────────────────────────

function barrelContainer(rel) {
  return blockAt(rel)?.getComponent("minecraft:inventory")?.container;
}

function isPuzzleItem(item) {
  if (!item) return false;
  const lore = item.getLore();
  return lore.includes(LORE) || OLD_LORES.some((l) => lore.includes(l));
}

// n split into 1-3 random stacks.
function splitStacks(n) {
  if (n <= 0) return [];
  const parts = randInt(1, Math.min(3, n));
  const cuts = shuffle([...Array(n - 1).keys()].map((k) => k + 1)).slice(0, parts - 1).sort((a, b) => a - b);
  const edges = [0, ...cuts, n];
  return edges.slice(1).map((e, i) => e - edges[i]);
}

function putInRandomBarrel(block, amount) {
  const item = new ItemStack(block, amount);
  item.setLore([LORE]);
  for (let tries = 0; tries < 20; tries++) {
    const container = barrelContainer(pick(R.barrels));
    if (!container || container.emptySlotsCount === 0) continue;
    const slot = randInt(0, container.size - 1);
    if (container.getItem(slot)) continue;
    container.setItem(slot, item);
    return;
  }
}

// ── Set up and clear ────────────────────────

const PUZZLE_BLOCKS = new Set([...R.counted, ...R.decoys]);

// Every display spot emptied of any puzzle colour, whatever the records
// say (they're empty by design), so leftovers from an interrupted or older
// setup can never add to a count.
function sweepDisplaySpots() {
  for (const p of R.display_spots) {
    const block = blockAt(p);
    if (block && PUZZLE_BLOCKS.has(block.typeId)) block.setPermutation(permOf("minecraft:air"));
  }
}

// Puzzle concrete taken by anyone online, or dropped on the floor.
function clearPuzzleItems() {
  const nether = world.getDimension(NETHER_ID);
  for (const drop of nether.getEntities({ type: "minecraft:item", location: at(CENTRE), maxDistance: ROOM_RADIUS })) {
    if (isPuzzleItem(drop.getComponent("minecraft:item")?.itemStack)) drop.remove();
  }
  for (const player of world.getAllPlayers()) {
    const container = player.getComponent("minecraft:inventory")?.container;
    if (!container) continue;
    for (let slot = 0; slot < container.size; slot++) {
      if (isPuzzleItem(container.getItem(slot))) container.setItem(slot, undefined);
    }
  }
}

function setUp() {
  // Everything must be loaded, or try again next check.
  if (![...R.display_spots, ...R.barrels].every((p) => blockAt(p))) return;
  if (!R.barrels.every((p) => barrelContainer(p))) return;

  const [lo, hi] = R.count_range;
  const answer = R.counted.map(() => randInt(lo, hi));
  const spots = shuffle([...R.display_spots]);
  const placed = [];
  const stacks = []; // [block, amount]

  // A few decoys: 2-3 set out, 1-3 small stacks in barrels.
  for (let i = randInt(2, 3); i > 0 && spots.length > 0; i--) placed.push([...spots.pop(), pick(R.decoys)]);
  for (let i = randInt(1, 3); i > 0; i--) stacks.push([pick(R.decoys), randInt(1, 3)]);

  // Each counted colour: up to ~60% set out on spots, the rest in barrels.
  R.counted.forEach((colour, i) => {
    const out = Math.min(spots.length, randInt(0, Math.ceil(answer[i] * 0.6)));
    for (let k = 0; k < out; k++) placed.push([...spots.pop(), colour]);
    for (const amount of splitStacks(answer[i] - out)) stacks.push([colour, amount]);
  });

  sweepDisplaySpots();
  clearPuzzleItems();
  for (const p of R.barrels) barrelContainer(p)?.clearAll();
  for (const [block, amount] of shuffle(stacks)) putInRandomBarrel(block, amount);
  for (const [x, y, z, block] of placed) swap([x, y, z], "minecraft:air", block);

  world.setDynamicProperty(SETUP, JSON.stringify({ run: currentRun(), answer, placed }));
  world.setDynamicProperty(MODE, "counting");
  setCounters(R.columns.map(() => 1)); // never 0: every column starts at 1
  paintFloor("none");
}

function clearRoom() {
  sweepDisplaySpots();
  for (const p of R.barrels) barrelContainer(p)?.clearAll();
  R.columns.forEach((_, i) => paintColumn(i, 0));
  paintFloor("none");
  for (const guard of world.getDimension(NETHER_ID).getEntities({ tags: [GUARD_TAG] })) guard.remove();
  clearPuzzleItems();

  world.setDynamicProperty(SETUP, undefined);
  world.setDynamicProperty(COUNTERS, undefined);
  world.setDynamicProperty(MODE, undefined);
  world.setDynamicProperty(PENALTY_AT, undefined);
}

// ── Answers ─────────────────────────────────

function solved() {
  world.setDynamicProperty(MODE, "solved");
  paintFloor("circle");
  setGate(STAGE, "back", true);
  sound("random.levelup");
}

function callGuards() {
  if (mode() !== "penalty") return; // already done, or the room was cleared
  setCounters(R.columns.map(() => 1));
  const nether = world.getDimension(NETHER_ID);
  const guards = R.guard_spawns.map((spawn, i) => {
    const p = at(spawn);
    const guard = spawnDungeonMob(nether, GUARD_TYPES[i % GUARD_TYPES.length], { x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
    guard.addTag(GUARD_TAG);
    return guard;
  });
  world.setDynamicProperty(MODE, "guards");
  if (isTestMode()) {
    system.runTimeout(() => {
      for (const guard of guards) if (guard.isValid()) guard.kill();
    }, TEST_GUARD_TICKS);
  }
}

function wrong() {
  world.setDynamicProperty(MODE, "penalty");
  world.setDynamicProperty(PENALTY_AT, Date.now());
  paintFloor("x");
  sound("mob.ghast.scream");
  // Columns count up 1-8 together, then reset to 1; then the guards.
  for (let n = 1; n <= 8; n++) {
    system.runTimeout(() => R.columns.forEach((_, i) => paintColumn(i, n)), n * ANIM_TICKS);
  }
  system.runTimeout(callGuards, 9 * ANIM_TICKS);
}

// ── Buttons ─────────────────────────────────

world.afterEvents.buttonPush.subscribe(({ block, dimension }) => {
  if (dimension.id !== NETHER_ID || !origin()) return;
  if (!isEventOn() || currentStage() !== STAGE) return;
  const o = origin();
  const rel = [block.location.x - o.x, block.location.y - o.y, block.location.z - o.z];

  const column = R.columns.findIndex((c) => sameCell(c.button, rel));
  const isSubmit = sameCell(R.submit_button, rel);
  if (column < 0 && !isSubmit) return;
  if (mode() !== "counting") return; // locked while the penalty runs, and once solved

  if (column >= 0) {
    const values = counters();
    values[column] = (values[column] % 8) + 1;
    setCounters(values);
    return;
  }

  const setup = getJsonProp(SETUP);
  if (!setup) return;
  const values = counters();
  if (setup.answer.every((n, i) => values[i] === n)) solved();
  else wrong();
});

// ── Main loop ───────────────────────────────

system.runInterval(() => {
  if (!origin()) return;
  if (world.getDimension(NETHER_ID).getPlayers().length === 0) return; // chunks likely unloaded
  const setup = getJsonProp(SETUP);

  // Run moved past Room 3, or ended: clear it once.
  if (!isEventOn() || currentStage() !== STAGE) {
    if (setup) clearRoom();
    return;
  }
  // First check in Room 3 this run (or leftovers from an earlier one).
  if (!setup || setup.run !== currentRun()) {
    if (setup) clearRoom();
    setUp();
    return;
  }
  // Count-up interrupted by a restart: call the guards now.
  if (mode() === "penalty" && Date.now() - (world.getDynamicProperty(PENALTY_AT) ?? 0) > PENALTY_STALE_MS) callGuards();
  // Once every guard is dead, clear the X and unlock.
  if (mode() === "guards" && world.getDimension(NETHER_ID).getEntities({ tags: [GUARD_TAG] }).length === 0) {
    paintFloor("none");
    world.setDynamicProperty(MODE, "counting");
  }
}, CHECK_TICKS);

// ── Testing ─────────────────────────────────

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:mending_rescue" || event.message.trim().toLowerCase() !== "answer") return;
  const source = event.sourceEntity;
  const setup = getJsonProp(SETUP);
  const text = setup
    ? "§7Room 3 answer: " + R.counted.map((c, i) => `${colourName(c)} ${setup.answer[i]}`).join(", ")
    : "§7Room 3 isn't set up (the party isn't in Room 3).";
  if (source?.typeId === "minecraft:player") source.sendMessage(text);
  else console.warn(text);
});
