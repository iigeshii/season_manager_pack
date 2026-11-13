import { world, system, BlockPermutation } from "@minecraft/server";
import { isOperator } from "./nether_rules.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn, isTestMode, onRoomRestart } from "./run_state.js";
import { currentStage, isMember } from "./mending_rescue.js";
import { setGate, isGateWantedOpen } from "./gates.js";

// ─────────────────────────────────────────────
//  ROOM 2: BROKEN RAMPART (parkour)
//  The exit portcullis (Airlock 2's back gate) opens once every online
//  non-operator party member is on the finish landing, with at least one
//  party member there (so an operator can test solo). It stays open until
//  the party gathers in Airlock 2, which closes it behind them.
//
//  Pity ladder: the first time any party member reaches the finish
//  landing, a timer starts (10 minutes; 30 seconds in test mode). When it
//  runs out, a ladder appears on the landing's west face (the side the
//  course comes in on), near its south end, so anyone still in the pit
//  can climb up — nobody holds the group up for ever. The timer is saved
//  with the world. The ladder is removed when the run moves past Room 2 or
//  ends. (layout.js still lists the old spot on the north face, under the
//  carved marker column; it's no longer used, now that the bar wall is
//  there.)
//
//  Bar wall: the middle row's first platform (B1, top 6) and the corner
//  landing (top 5) are close enough to the finish landing (top 3) that a
//  sprint jump down clears the gap, skipping the whole south leg. So the
//  row just north of the landing is walled with solid polished blackstone
//  bricks (the room's own walls) from the pit floor up to the ceiling. The
//  real route comes in from the west, so it's unaffected. (It was iron bars
//  at first, but bars are thin: they left a strip of landing in front of
//  them to land on, and a gap round the west end to walk through. Then
//  bricks on the landing's own north row, but that put the east end in
//  front of the exit bars.) Placed by the script (the dungeon was pasted
//  before the wall existed), filling only air; the earlier versions are
//  taken back out.
// ─────────────────────────────────────────────

const CHECK_TICKS = 10;
const STAGE = 2;
const PITY_MS = 10 * 60 * 1000;
const PITY_TEST_MS = 30 * 1000;
const WARN_MS = 60 * 1000; // "one minute left" message

const TIMER = P + "room2_pity_started"; // "<run>:<Date.now()>" when the first member arrived
const WARNED = P + "room2_pity_warned";
const LADDER_UP = P + "room2_pity_ladder";

const [x1, y1, z1, x2, y2, z2] = LAYOUT.room2.finish_box;
const LADDER_TYPE = "minecraft:ladder";
// Structure-relative: against the landing's west face, one row in from its
// south edge, from the pit floor (level with the bottom of the landing,
// here) to the landing's top. Clear of C10's jump, which lands at the
// north end of that face.
const LADDER_BLOCKS = [1, 2, 3].map((d) => [x1 - 1, y1 - d, z2 - 1]);
const LADDER_PERM = BlockPermutation.resolve(LADDER_TYPE, { facing_direction: 4 }); // facing west
// The old spot on the north face, cleared too in case a ladder was left there.
const OLD_LADDER_BLOCKS = LAYOUT.room2.rescue_ladder.blocks;
const AIR_PERM = BlockPermutation.resolve("minecraft:air");

function rel(player) {
  const o = origin();
  return {
    x: Math.floor(player.location.x) - o.x,
    y: Math.floor(player.location.y) - o.y,
    z: Math.floor(player.location.z) - o.z,
  };
}

function onFinish(player) {
  const { x, y, z } = rel(player);
  return x >= x1 && x <= x2 && y >= y1 && y <= y2 && z >= z1 && z <= z2;
}

// ── Bar wall ────────────────────────────────
// Structure-relative: the row just north of the finish landing (z1 - 1),
// across the landing's full width, from the pit floor up to the room's
// ceiling. (It was on the landing's own north row at first, but its east
// end stood in front of the exit bars' first column. That row was all air
// in the build, so the old wall there is taken back out.)
const WALL_PERM = BlockPermutation.resolve("minecraft:polished_blackstone_bricks");
const WALL_TYPE = "minecraft:polished_blackstone_bricks";
const WALL_Z = z1 - 1;
const OLD_WALL_Z = z1; // where the earlier versions stood
const OLD_BARS = "minecraft:iron_bars"; // the very first version
const AIR = BlockPermutation.resolve("minecraft:air");
const FLOOR_Y = LAYOUT.spaces.room2.boxes[0][1]; // lowest air row in the room (the pit)
const CEILING_Y = LAYOUT.spaces.room2.boxes[0][4]; // highest air row in the room

let wallUp = false; // set once the whole wall has been checked this session

function wallBlock(nether, o, x, y, z) {
  try {
    return nether.getBlock({ x: o.x + x, y: o.y + y, z: o.z + z });
  } catch {
    return undefined; // chunk not loaded
  }
}

// Fills any air in the wall with brick, and clears the old wall off the
// landing (only the blocks the script put there). Runs once per script
// load; a cell in an unloaded chunk leaves it to the next check.
function ensureWall() {
  if (wallUp) return;
  const o = origin();
  const nether = world.getDimension(NETHER_ID);
  let complete = true;
  for (let x = x1; x <= x2; x++) {
    for (let y = FLOOR_Y; y <= CEILING_Y; y++) {
      const block = wallBlock(nether, o, x, y, WALL_Z);
      if (!block) complete = false;
      else if (block.isAir) block.setPermutation(WALL_PERM);
    }
    for (let y = y1; y <= CEILING_Y; y++) {
      const block = wallBlock(nether, o, x, y, OLD_WALL_Z);
      if (!block) complete = false;
      else if (block.typeId === WALL_TYPE || block.typeId === OLD_BARS) block.setPermutation(AIR);
    }
  }
  wallUp = complete;
}

// When this run's timer started, or undefined. A timer left over from an
// earlier run (ended with nobody around to tidy up) doesn't count.
function timerStart() {
  const raw = world.getDynamicProperty(TIMER);
  if (typeof raw !== "string") return undefined;
  const [run, start] = raw.split(":").map(Number);
  return run === (world.getDynamicProperty(P + "run") ?? 0) ? start : undefined;
}

function tell(players, message) {
  for (const player of players) player.sendMessage(message);
}

// Places or removes the ladder, swapping only air ↔ ladder.
function setLadder(up) {
  const o = origin();
  const nether = world.getDimension(NETHER_ID);
  const blocks = up ? LADDER_BLOCKS : [...LADDER_BLOCKS, ...OLD_LADDER_BLOCKS];
  for (const [x, y, z] of blocks) {
    let block;
    try {
      block = nether.getBlock({ x: o.x + x, y: o.y + y, z: o.z + z });
    } catch {
      continue; // chunk not loaded
    }
    if (!block) continue;
    if (up && block.isAir) block.setPermutation(LADDER_PERM);
    if (!up && block.typeId === LADDER_TYPE) block.setPermutation(AIR_PERM);
  }
  world.setDynamicProperty(LADDER_UP, up);
}

function clearRoom() {
  if (world.getDynamicProperty(LADDER_UP) === true) setLadder(false);
  world.setDynamicProperty(TIMER, undefined);
  world.setDynamicProperty(WARNED, undefined);
}

system.runInterval(() => {
  if (!origin()) return;
  if (world.getDimension(NETHER_ID).getPlayers().length === 0) return; // chunks likely unloaded
  ensureWall();

  // Run moved past Room 2, or ended: tidy up once.
  if (!isEventOn() || currentStage() !== STAGE) {
    if (world.getDynamicProperty(TIMER) !== undefined || world.getDynamicProperty(LADDER_UP) === true) clearRoom();
    return;
  }

  const members = world.getDimension(NETHER_ID).getPlayers().filter(isMember);
  const finished = members.filter(onFinish);

  // A previous run's leftovers: clear them before this run's timer starts.
  if (timerStart() === undefined && world.getDynamicProperty(TIMER) !== undefined) clearRoom();

  // Pity ladder timer.
  const started = timerStart();
  if (started === undefined) {
    if (finished.length > 0) {
      world.setDynamicProperty(TIMER, `${world.getDynamicProperty(P + "run") ?? 0}:${Date.now()}`);
      const wait = isTestMode() ? "30 seconds" : "10 minutes";
      tell(members, `§7${finished[0].name} made it across. In ${wait}, a ladder will be lowered for anyone still below.`);
    }
  } else if (world.getDynamicProperty(LADDER_UP) !== true) {
    const limit = isTestMode() ? PITY_TEST_MS : PITY_MS;
    const left = limit - (Date.now() - started);
    if (left <= 0) {
      setLadder(true);
      tell(members, "§6A ladder has been lowered at the west side of the far landing.");
    } else if (left <= WARN_MS && world.getDynamicProperty(WARNED) !== true && limit > WARN_MS) {
      world.setDynamicProperty(WARNED, true);
      tell(members, "§7One minute until the ladder is lowered.");
    }
  }

  // Exit bars.
  if (isGateWantedOpen(STAGE, "back")) return; // already open
  const missing = members.filter((p) => !isOperator(p) && !onFinish(p));
  if (missing.length > 0 || finished.length === 0) return;
  setGate(STAGE, "back", true);
  tell(members, "§6The bars at the far wall rise.");
}, CHECK_TICKS);

// `jump 2`: start over. A timer from no run counts as leftovers, so the
// next check clears the room (ladder down, timer off).
onRoomRestart(STAGE, () => world.setDynamicProperty(TIMER, "-1:0"));
