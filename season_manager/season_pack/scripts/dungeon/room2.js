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
//  runs out, a ladder appears on the landing's north face so anyone still
//  in the pit can climb up — nobody holds the group up for ever. The
//  timer is saved with the world. The ladder is removed when the run
//  moves past Room 2 or ends.
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
const LADDER = LAYOUT.room2.rescue_ladder;
const LADDER_PERM = BlockPermutation.resolve(LADDER.type, LADDER.states);
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
  for (const [x, y, z] of LADDER.blocks) {
    let block;
    try {
      block = nether.getBlock({ x: o.x + x, y: o.y + y, z: o.z + z });
    } catch {
      continue; // chunk not loaded
    }
    if (!block) continue;
    if (up && block.isAir) block.setPermutation(LADDER_PERM);
    if (!up && block.typeId === LADDER.type) block.setPermutation(AIR_PERM);
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
      tell(members, "§6A ladder has been lowered at the far wall.");
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
