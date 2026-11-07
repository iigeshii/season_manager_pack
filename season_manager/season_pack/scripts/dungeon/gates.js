import { world, system, BlockPermutation } from "@minecraft/server";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin } from "./run_state.js";
import { closeInnerPortcullis } from "./room1_gate.js";

// ─────────────────────────────────────────────
//  AIRLOCK GATES (Airlocks 2-7)
//  Each airlock n sits between room n and room n+1 and has a back gate
//  (room n's exit) and a front gate (into room n+1). Bars gates lift row
//  by row, bottom first, and drop top first; hatch gates are iron
//  trapdoors flipped open or shut in place. Airlock 1's gates are the
//  Room 1 portcullises (room1_gate.js).
//
//  Each gate's wanted state is a world property; a loop moves the blocks
//  toward it, so a restart or unloaded chunk just catches up later.
//
//  The sequence, per the design:
//    room n solved       → airlock n's back gate opens (room code)
//    party in airlock n  → back gate closes behind them, front gate opens,
//                          and airlock n-1's front gate closes (it stayed
//                          open while room n was played so respawned
//                          players could walk back in)
//
//  Block changes only swap the exact block expected (iron bars ↔ air,
//  trapdoor open ↔ shut).
// ─────────────────────────────────────────────

const ROW_TICKS = 6; // between rows while a bars gate moves
const BARS = { name: "minecraft:iron_bars", perm: BlockPermutation.resolve("minecraft:iron_bars") };
const AIR = { name: "minecraft:air", perm: BlockPermutation.resolve("minecraft:air") };
const HATCH = "minecraft:iron_trapdoor";

const key = (n, side) => `${P}airlock${n}_${side}_open`;

export function setGate(n, side, open) {
  world.setDynamicProperty(key(n, side), open);
}

export function isGateWantedOpen(n, side) {
  return world.getDynamicProperty(key(n, side)) === true;
}

// The gates as they should be once the party is playing room `stage`
// (3-8): they came through airlock stage-1, whose back gate is now shut
// and front gate open; the airlock before that is closed off.
export function gatesForStage(stage) {
  if (stage < 3) return;
  const through = stage - 1;
  setGate(through, "back", false);
  setGate(through, "front", true);
  if (through - 1 === 1) closeInnerPortcullis();
  else setGate(through - 1, "front", false);
}

// Every airlock gate shut (Airlocks 2-7), for off / reset.
export function closeAllAirlockGates() {
  for (let n = 2; n <= LAYOUT.airlocks.length; n++) {
    setGate(n, "back", false);
    setGate(n, "front", false);
  }
}

// ── Moving the blocks ───────────────────────

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
  if (block && block.typeId === from.name) block.setPermutation(to.perm);
}

// One row toward open (bottom row with bars first) or shut (top missing
// row first). Returns true if anything moved.
function stepBars(rows, open) {
  if (open) {
    const row = rows.find((r) => r.some((p) => blockAt(p)?.typeId === BARS.name));
    if (!row) return false;
    for (const p of row) swap(p, BARS, AIR);
    return true;
  }
  const row = [...rows].reverse().find((r) => r.some((p) => blockAt(p)?.isAir));
  if (!row) return false;
  for (const p of row) swap(p, AIR, BARS);
  return true;
}

function setHatch(blocks, open) {
  let moved = false;
  for (const p of blocks) {
    const block = blockAt(p);
    if (!block || block.typeId !== HATCH) continue;
    if (block.permutation.getState("open_bit") === open) continue;
    block.setPermutation(block.permutation.withState("open_bit", open));
    moved = true;
  }
  return moved;
}

function stepGate(gate, open) {
  return gate.kind === "hatch" ? setHatch(gate.blocks, open) : stepBars(gate.rows, open);
}

function soundAt(gate) {
  const p = gate.kind === "hatch" ? gate.blocks[0] : gate.rows[0][0];
  try {
    world.getDimension(NETHER_ID).playSound(gate.kind === "hatch" ? "open.iron_trapdoor" : "random.door_open", at(p));
  } catch {
    // unknown sound or unloaded chunk: skip
  }
}

system.runInterval(() => {
  if (!origin()) return;
  if (world.getDimension(NETHER_ID).getPlayers().length === 0) return; // chunks likely unloaded
  for (let n = 2; n <= LAYOUT.airlocks.length; n++) {
    const airlock = LAYOUT.airlocks[n - 1];
    for (const side of ["back", "front"]) {
      if (stepGate(airlock[side], isGateWantedOpen(n, side))) soundAt(airlock[side]);
    }
  }
}, ROW_TICKS);
