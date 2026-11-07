import { world, system, BlockPermutation } from "@minecraft/server";
import { isOperator } from "./nether_rules.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn } from "./run_state.js";
import { currentStage, isMember } from "./mending_rescue.js";
import { setGate } from "./gates.js";

// ─────────────────────────────────────────────
//  ROOM 4: GLASS FURNACE (collapsing floor)
//  An arena of orange glass over a basement 3 blocks down. Once every
//  online non-operator party member is on the arena (and at least one
//  party member), the entrance bridge retracts, the entrance gate bars, and
//  a 3-2-1 countdown (on the wall timer) starts the round. Tiles flash red for a second, then
//  vanish — slowly at first, faster and faster — down to 20% of the floor
//  remaining. Anyone off the arena (fallen into the basement) is out for
//  the round.
//
//  Time left is shown in lit blocks on the north and south walls (two
//  digits either side of the middle lavafall). No on-screen text; a ping
//  for each countdown second and each of the last 5 seconds.
//
//  Win: at least one party member still on the arena when the round ends
//  (60 s). The floor refills, both bridges appear, both
//  gates open, and the room's exit (Airlock 4's back gate) opens.
//  Everyone falls: the floor refills, the entrance bridge returns and its
//  gate opens; the next round starts when everyone is back on the arena.
//
//  Cleared (floor full, entrance bridge and gate open, exit bridge gone and
//  its gate barred) when the run moves past Room 4 or ends.
// ─────────────────────────────────────────────

const R = LAYOUT.room4;
const STAGE = 4;
const TICKS = 2;
const COUNTDOWN_SECONDS = 3;
const WARN_TICKS = 20; // red for a second before vanishing
const START_RATE = 1; // tiles per second at the start of the round
const END_RATE = 18; // ... and at the end: reaches the 20%-left cap ~5-10 s before time
const MAX_GONE = 0.8; // never remove more than this: at least 20% of the floor remains
const REFILL_PER_STEP = 30; // tiles restored per step while refilling (~2 s)

const MODE = P + "room4_mode"; // "waiting" | "countdown" | "round" | "refill_won" | "refill_lost" | "won"
const RUN = P + "room4_run"; // run the room was last set up for

const perms = new Map();
const permOf = (name) => {
  if (!perms.has(name)) perms.set(name, BlockPermutation.resolve(name));
  return perms.get(name);
};
const AIR = "minecraft:air";
const BARS = "minecraft:iron_bars";

// Round state lives in memory; a restart mid-round counts as a lost round.
let round = undefined; // { startTick, endTick, queue: [tile index], pending: [{ i, at }], removed, budget }
let countdownStart = 0;

// ── Helpers ─────────────────────────────────

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

function swap(rel, from, to) {
  const block = blockAt(rel);
  if (block && block.typeId === from) block.setPermutation(permOf(to));
}

function inBox(player, box) {
  const o = origin();
  const x = Math.floor(player.location.x) - o.x;
  const y = Math.floor(player.location.y) - o.y;
  const z = Math.floor(player.location.z) - o.z;
  return x >= box[0] && y >= box[1] && z >= box[2] && x <= box[3] && y <= box[4] && z <= box[5];
}

const onArena = (player) => inBox(player, R.platform_box);
const mode = () => world.getDynamicProperty(MODE) ?? "waiting";
const setMode = (m) => world.setDynamicProperty(MODE, m);
const currentRun = () => world.getDynamicProperty(P + "run") ?? 0;

function sound(players, id) {
  for (const player of players) {
    try {
      player.playSound(id);
    } catch {
      // unknown sound: skip
    }
  }
}

// ── Wall timer ──────────────────────────────
// Two 3x5 block digits in the north and south wall panels either side of
// the middle lavafall. Lit pixels are shroomlight; unlit ones get their
// original brick back.

const FONT = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "001", "001", "001"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
};
const BLANK = ["000", "000", "000", "000", "000"];
const PIXEL_LIT = "minecraft:shroomlight";

function paintDigit(grid, original, glyph) {
  grid.forEach((row, r) =>
    row.forEach((p, c) => {
      const brick = original[p.join(",")];
      if (glyph[r][c] === "1") swap(p, brick, PIXEL_LIT);
      else swap(p, PIXEL_LIT, brick);
    })
  );
}

// Seconds 0-99 on both walls; undefined blanks them.
function showTimer(seconds) {
  for (const wall of R.timer) {
    const tens = seconds === undefined || seconds < 10 ? BLANK : FONT[Math.floor(seconds / 10) % 10];
    const ones = seconds === undefined ? BLANK : FONT[seconds % 10];
    paintDigit(wall.tens, wall.original, tens);
    paintDigit(wall.ones, wall.original, ones);
  }
}

// Time left on the walls every second (no on-screen text); a ping for each
// of the last 5 seconds.
function announceTimeLeft(players) {
  const left = Math.ceil((round.endTick - system.currentTick) / 20);
  if (left === round.announced || left <= 0) return;
  round.announced = left;
  showTimer(left);
  if (left <= 5) sound(players, "note.pling");
}

// ── Bridges, gates, floor ───────────────────

function setBridge(blocks, present) {
  for (const p of blocks) {
    if (present) swap(p, AIR, R.bridge_block);
    else swap(p, R.bridge_block, AIR);
  }
}

function setBars(blocks, open) {
  for (const p of blocks) {
    if (open) swap(p, BARS, AIR);
    else swap(p, AIR, BARS);
  }
}

// Restores up to `limit` missing or red tiles. Returns true once the whole
// floor is back.
function refill(limit) {
  let done = 0;
  for (const p of R.tiles) {
    const block = blockAt(p);
    if (!block || block.typeId === R.tile_block) continue;
    if (block.typeId !== AIR && block.typeId !== R.warning_block) continue;
    if (done >= limit) return false;
    block.setPermutation(permOf(R.tile_block));
    done++;
  }
  return true;
}

// How the next group finds the room.
function resetRoom() {
  round = undefined;
  showTimer(undefined);
  refill(Infinity);
  setBridge(R.entrance_bridge, true);
  setBars(R.entrance_gate, true);
  setBridge(R.exit_bridge, false);
  setBars(R.exit_gate, false);
  setMode("waiting");
}

// ── The round ───────────────────────────────

function startCountdown(members) {
  setBridge(R.entrance_bridge, false);
  setBars(R.entrance_gate, false);
  countdownStart = system.currentTick;
  setMode("countdown");
  showTimer(COUNTDOWN_SECONDS); // the wall counts 3-2-1, then shows the round time
  sound(members, "note.pling");
}

function startRound() {
  const seconds = R.round_seconds;
  const order = R.tiles.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  round = {
    startTick: system.currentTick,
    endTick: system.currentTick + seconds * 20,
    queue: order,
    pending: [],
    removed: 0,
    announced: undefined, // last whole second announced
    budget: 0,
  };
  setMode("round");
}

function stepRound(members) {
  const now = system.currentTick;

  // Tiles whose warning is over vanish.
  round.pending = round.pending.filter(({ i, at: when }) => {
    if (when > now) return true;
    swap(R.tiles[i], R.warning_block, AIR);
    return false;
  });

  // Nobody left on the arena: round lost.
  if (!members.some(onArena)) {
    round = undefined;
    showTimer(undefined);
    setMode("refill_lost");
    sound(members, "note.bass");
    return;
  }
  announceTimeLeft(world.getDimension(NETHER_ID).getPlayers());

  // Time's up with someone still standing: won.
  if (now >= round.endTick) {
    round = undefined;
    showTimer(0);
    setMode("refill_won");
    sound(members, "random.levelup");
    return;
  }

  // More tiles start to go, faster as the round goes on.
  const progress = (now - round.startTick) / (round.endTick - round.startTick);
  round.budget += (START_RATE + (END_RATE - START_RATE) * progress) * (TICKS / 20);
  const cap = Math.floor(R.tiles.length * MAX_GONE);
  while (round.budget >= 1 && round.removed < cap && round.queue.length > 0) {
    round.budget -= 1;
    const i = round.queue.pop();
    swap(R.tiles[i], R.tile_block, R.warning_block);
    round.pending.push({ i, at: now + WARN_TICKS });
    round.removed++;
  }
}

// ── Main loop ───────────────────────────────

system.runInterval(() => {
  if (!origin()) return;
  const nether = world.getDimension(NETHER_ID);
  if (nether.getPlayers().length === 0) return; // chunks likely unloaded

  const active = isEventOn() && currentStage() === STAGE;
  if (!active) {
    // Run moved past Room 4, or ended: put the room back once.
    if (world.getDynamicProperty(RUN) !== undefined) {
      resetRoom();
      world.setDynamicProperty(RUN, undefined);
    }
    return;
  }
  // First check in Room 4 this run (or leftovers from an earlier one).
  if (world.getDynamicProperty(RUN) !== currentRun()) {
    resetRoom();
    world.setDynamicProperty(RUN, currentRun());
    return;
  }

  const members = nether.getPlayers().filter(isMember);
  switch (mode()) {
    case "waiting": {
      const everyone = members.filter((p) => !isOperator(p)).every(onArena);
      if (everyone && members.some(onArena)) startCountdown(members);
      return;
    }
    case "countdown": {
      const elapsed = Math.floor((system.currentTick - countdownStart) / 20);
      if (system.currentTick - countdownStart > (COUNTDOWN_SECONDS + 5) * 20) {
        setMode("refill_lost"); // countdown lost to a restart
        return;
      }
      if ((system.currentTick - countdownStart) % 20 < TICKS && elapsed > 0) {
        const left = COUNTDOWN_SECONDS - elapsed;
        showTimer(left > 0 ? left : R.round_seconds);
        sound(members, left > 0 ? "note.pling" : "note.harp");
        if (left <= 0) startRound();
      }
      return;
    }
    case "round": {
      if (!round) {
        setMode("refill_lost"); // round lost to a restart
        return;
      }
      stepRound(members);
      return;
    }
    case "refill_lost": {
      if (!refill(REFILL_PER_STEP)) return;
      setBridge(R.entrance_bridge, true);
      setBars(R.entrance_gate, true);
      setMode("waiting");
      return;
    }
    case "refill_won": {
      if (!refill(REFILL_PER_STEP)) return;
      setBridge(R.entrance_bridge, true);
      setBars(R.entrance_gate, true);
      setBridge(R.exit_bridge, true);
      setBars(R.exit_gate, true);
      setGate(STAGE, "back", true);
      showTimer(undefined);
      setMode("won");
      return;
    }
    default:
      return; // won: nothing more to do
  }
}, TICKS);
