import { world, system, BlockPermutation } from "@minecraft/server";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn, isTestMode } from "./run_state.js";

// ─────────────────────────────────────────────
//  ROOM 1: FORTRESS GATE
//  Four pressure-plate pads in the forecourt corners. A player standing on
//  a pad sends light along its ward line (floor, then up a tower) to a seal
//  above the gate; stepping off lets it drain back. When all four seals are
//  lit at once, the gate opens and stays open: the lines stay lit, the
//  crown above the gate lights, and the outer portcullis lifts row by row.
//
//  Test mode (scriptevent season:mending_rescue test_mode on): each pad
//  stays lit once stepped on, so one player can open the gate.
//
//  The gate is Airlock 1's back gate and the inner portcullis its front
//  gate. When a run starts (seal) the outer portcullis closes behind the
//  party, the wards go dark, and the inner portcullis opens into Room 2.
//  When the run ends, both are reset: inner closed, outer closed, dark.
//
//  Block changes only ever replace the exact block expected (dark ward ↔
//  shroomlight, iron bars ↔ air), so nothing else placed there is touched.
//  Coordinates come from layout.js (relative to the structure origin).
// ─────────────────────────────────────────────

const GATE = LAYOUT.room1_gate;
const TICKS = 2;
const RISE_PER_STEP = 4; // blocks lit per step: ~1 s for the long lines, as designed
const FALL_PER_STEP = 4; // blocks drained per step when a player steps off
const PORTCULLIS_ROW_TICKS = 6; // between rows: 7 rows in ~2 s, as designed

const OUTER_OPEN = P + "gate_outer_open";
const INNER_OPEN = P + "gate_inner_open";

// Each kind of block: its name (to recognise it) and permutation (to place it).
const kind = (b) => ({ name: b.type, perm: BlockPermutation.resolve(b.type, b.states) });
const LIT = kind(GATE.blocks.lit);
const LINE_DARK = kind(GATE.blocks.line_dark);
const SEAL_DARK = kind(GATE.blocks.seal_dark);
const CROWN_DARK = kind(GATE.blocks.crown_dark);
const BARS = kind(GATE.blocks.bars);
const AIR = kind({ type: "minecraft:air", states: {} });

// Each pad's ward: its line blocks, then the seal. progress = how many of
// them are lit, from the pad end. Rebuilt from the world on first use.
const wards = GATE.pads.map((pad) => ({
  pad,
  blocks: [...pad.line, pad.seal],
  progress: undefined,
  sticky: false,
}));

let portcullisTimer = 0;

// ── Block helpers ───────────────────────────

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

// Replace a block only if it's the one we expect to be there.
function swap(rel, from, to) {
  const block = blockAt(rel);
  if (block && block.typeId === from.name) block.setPermutation(to.perm);
}

function wardDark(ward, index) {
  return index === ward.blocks.length - 1 ? SEAL_DARK : LINE_DARK;
}

function setWardBlock(ward, index, lit) {
  const dark = wardDark(ward, index);
  if (lit) swap(ward.blocks[index], dark, LIT);
  else swap(ward.blocks[index], LIT, dark);
}

// How far a ward is lit right now, read from the blocks.
function readProgress(ward) {
  let n = 0;
  while (n < ward.blocks.length && blockAt(ward.blocks[n])?.typeId === LIT.name) n++;
  return n;
}

function isFull(ward) {
  return ward.progress === ward.blocks.length;
}

function playSound(id, rel) {
  try {
    world.getDimension(NETHER_ID).playSound(id, at(rel));
  } catch {
    // unknown sound or unloaded chunk: skip
  }
}

// ── Pads ────────────────────────────────────

function padOccupied(pad, players) {
  const o = origin();
  const [px, py, pz] = pad.plate;
  return players.some((p) => {
    const x = Math.floor(p.location.x) - o.x;
    const y = Math.floor(p.location.y) - o.y;
    const z = Math.floor(p.location.z) - o.z;
    return x === px && z === pz && (y === py || y === py + 1);
  });
}

function stepWard(ward, occupied, gateOpen) {
  if (ward.progress === undefined) ward.progress = readProgress(ward);
  if (isTestMode() && occupied) ward.sticky = true;
  const target = gateOpen || occupied || ward.sticky ? ward.blocks.length : 0;
  if (ward.progress === target) return;

  const wasFull = isFull(ward);
  if (ward.progress < target) {
    const next = Math.min(target, ward.progress + RISE_PER_STEP);
    for (let i = ward.progress; i < next; i++) setWardBlock(ward, i, true);
    ward.progress = next;
  } else {
    const next = Math.max(target, ward.progress - FALL_PER_STEP);
    for (let i = ward.progress - 1; i >= next; i--) setWardBlock(ward, i, false);
    ward.progress = next;
  }
  if (!wasFull && isFull(ward)) playSound("random.orb", ward.pad.seal);
}

// ── Portcullises ────────────────────────────

// Moves a portcullis one row toward open (bars removed bottom first) or
// closed (bars restored top first). Returns true if anything changed.
function stepPortcullis(rows, open) {
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

function setCrown(lit) {
  for (const p of GATE.crown) {
    if (lit) swap(p, CROWN_DARK, LIT);
    else swap(p, LIT, CROWN_DARK);
  }
}

// ── Main loop ───────────────────────────────

system.runInterval(() => {
  if (!origin()) return;
  const players = world.getDimension(NETHER_ID).getPlayers();
  if (players.length === 0) return; // nobody near: chunks likely unloaded

  const outerOpen = world.getDynamicProperty(OUTER_OPEN) === true;
  const innerOpen = world.getDynamicProperty(INNER_OPEN) === true;

  // The pads only matter before a run starts, while the group gathers.
  if (!isEventOn()) {
    for (const ward of wards) stepWard(ward, padOccupied(ward.pad, players), outerOpen);
    if (!outerOpen && wards.every(isFull)) {
      world.setDynamicProperty(OUTER_OPEN, true);
      setCrown(true);
      playSound("random.anvil_use", GATE.outer_portcullis[0][2]);
    }
  }

  portcullisTimer += TICKS;
  if (portcullisTimer >= PORTCULLIS_ROW_TICKS) {
    portcullisTimer = 0;
    const movedOuter = stepPortcullis(GATE.outer_portcullis, world.getDynamicProperty(OUTER_OPEN) === true);
    const movedInner = stepPortcullis(GATE.inner_portcullis, innerOpen);
    if (movedOuter) playSound("random.door_open", GATE.outer_portcullis[0][2]);
    if (movedInner) playSound("random.door_open", GATE.inner_portcullis[0][2]);
  }
}, TICKS);

// ── Called by mending_rescue.js ─────────────

// Darkens every ward, seal and the crown, and forgets test-mode stickiness.
function darkenAll() {
  for (const ward of wards) {
    for (let i = 0; i < ward.blocks.length; i++) setWardBlock(ward, i, false);
    ward.progress = 0;
    ward.sticky = false;
  }
  setCrown(false);
}

// The seal: the outer portcullis closes behind the party, Room 1 goes
// dark, and the inner portcullis opens into Room 2.
export function gateOnRunStarted() {
  world.setDynamicProperty(OUTER_OPEN, false);
  world.setDynamicProperty(INNER_OPEN, true);
  darkenAll();
}

// Run over (or a manual reset): everything back to how the next group
// finds it. Portcullises close row by row.
export function resetGate() {
  world.setDynamicProperty(OUTER_OPEN, false);
  world.setDynamicProperty(INNER_OPEN, false);
  darkenAll();
}

// Test mode switched off: pads stop being sticky.
export function clearStickyPads() {
  for (const ward of wards) ward.sticky = false;
}
