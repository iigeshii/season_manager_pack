import { world, system, BlockPermutation } from "@minecraft/server";
import { isOperator, spawnDungeonMob } from "./nether_rules.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn, isTestMode } from "./run_state.js";
import { currentStage, isMember } from "./mending_rescue.js";
import { setGate } from "./gates.js";

// ─────────────────────────────────────────────
//  ROOM 5: GATE RING (mob arena)
//  Twelve barred gates round a circular arena, in three thirds of four
//  (Fredo's plan). Each third ends in a brute wave at gates 4, 8 and 12:
//    1-3  pillagers                 4  brutes
//    5-7  piglins: crossbow, sword, mix          8  brutes
//    9-11 gold-armoured piglins + 1-2 brutes     12 the Piglin Warden + brutes
//  The Warden is a stand-in for now: a named brute in gold armour with
//  extra health, strength and resistance (the custom mob comes later).
//
//  Once every online non-operator party member stands in the gilded centre
//  circle (and at least one party member), light runs along the spoke to
//  gate 1, which opens: bars gone, lamp lit, its mobs summoned. The light
//  then runs round the ring track like a clock hand, reaching the next gate
//  after GATE_SECONDS — sooner the moment every mob in the arena is dead —
//  and pausing while more than MAX_ALIVE are alive.
//  Win: gate 12 open and every mob dead → the exit bars (Airlock 5's back
//  gate) open.
//  Test mode: each gate's mobs are killed 5 seconds after they appear.
//
//  The room is put back (gates barred, lights dark, mobs removed) when the
//  run moves past Room 5 or ends. A restart mid-fight starts it over.
// ─────────────────────────────────────────────

const R = LAYOUT.room5;
const STAGE = 5;
const TICKS = 2;
const SPOKE_TICKS = 60; // the light takes 3 s to reach gate 1
const GATE_SECONDS = 35; // light time from one gate to the next
const FAST_CELLS_PER_STEP = 1; // when every mob is dead: 10 track cells a second
const MAX_ALIVE = 8; // the light pauses while more than this many are alive
const TEST_KILL_TICKS = 100; // test mode: each gate's mobs die after 5 s
const MOB_TAG = "season:room5_mob";

const MODE = P + "room5_mode"; // "waiting" | "running" | "won"
const RUN = P + "room5_run";

// What comes out of each gate. weapon/armor are applied with replaceitem.
const PILLAGER = { type: "minecraft:pillager" };
const BRUTE = { type: "minecraft:piglin_brute" };
const XBOW = { type: "minecraft:piglin", weapon: "crossbow" };
const SWORD = { type: "minecraft:piglin", weapon: "golden_sword" };
const GOLD_XBOW = { ...XBOW, gold: true };
const GOLD_SWORD = { ...SWORD, gold: true };
const WARDEN = { type: "minecraft:piglin_brute", gold: true, warden: true };
const WAVES = [
  [PILLAGER, PILLAGER], // 1
  [PILLAGER, PILLAGER, PILLAGER], // 2
  [PILLAGER, PILLAGER, PILLAGER], // 3
  [BRUTE, BRUTE], // 4: brute wave
  [XBOW, XBOW, XBOW], // 5: crossbow piglins
  [SWORD, SWORD, SWORD], // 6: melee piglins
  [XBOW, XBOW, SWORD, SWORD], // 7: a mix
  [BRUTE, BRUTE, BRUTE], // 8: brute wave
  [GOLD_XBOW, GOLD_SWORD, GOLD_XBOW, BRUTE], // 9
  [GOLD_SWORD, GOLD_XBOW, GOLD_SWORD, BRUTE], // 10
  [GOLD_XBOW, GOLD_SWORD, GOLD_XBOW, BRUTE, BRUTE], // 11
  [WARDEN, BRUTE, BRUTE], // 12: the Piglin Warden
];

const AIR = "minecraft:air";
const BARS = "minecraft:iron_bars";
const LIT = R.path_lit;
const perms = new Map();
const permOf = (name, states) => {
  const key = name + JSON.stringify(states ?? {});
  if (!perms.has(key)) perms.set(key, BlockPermutation.resolve(name, states));
  return perms.get(key);
};
const PATH_DARK = R.path_dark;

// Fight state lives in memory; a restart mid-fight resets the room.
let fight = undefined; // { spoke, track, opened, startTick }

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

function swap(rel, from, toName, toStates) {
  const block = blockAt(rel);
  if (block && block.typeId === from) block.setPermutation(permOf(toName, toStates));
}

const mode = () => world.getDynamicProperty(MODE) ?? "waiting";
const setMode = (m) => world.setDynamicProperty(MODE, m);
const currentRun = () => world.getDynamicProperty(P + "run") ?? 0;

function inCircle(player) {
  const o = origin();
  const dx = player.location.x - (o.x + R.centre[0] + 0.5);
  const dz = player.location.z - (o.z + R.centre[2] + 0.5);
  const dy = Math.floor(player.location.y) - (o.y + R.centre[1]);
  return dx * dx + dz * dz <= R.radius * R.radius && dy >= -1 && dy <= 2;
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

function aliveMobs() {
  return world.getDimension(NETHER_ID).getEntities({ tags: [MOB_TAG] });
}

// ── Mobs ────────────────────────────────────

function equip(mob, slot, item) {
  try {
    mob.runCommand(`replaceitem entity @s ${slot} 0 ${item}`);
  } catch {
    // command failed: the mob keeps its default gear
  }
}

function spawnWave(gate) {
  const nether = world.getDimension(NETHER_ID);
  const base = at(gate.spawn);
  const mobs = WAVES[gate.number - 1].map((spec, i) => {
    const location = { x: base.x + 0.5 + (i % 2 ? 0.3 : -0.3), y: base.y, z: base.z + 0.5 + (i % 3 - 1) * 0.3 };
    const mob = spawnDungeonMob(nether, spec.type, location);
    mob.addTag(MOB_TAG);
    if (spec.weapon) equip(mob, "slot.weapon.mainhand", spec.weapon);
    if (spec.gold) {
      equip(mob, "slot.armor.head", "golden_helmet");
      equip(mob, "slot.armor.chest", "golden_chestplate");
      equip(mob, "slot.armor.legs", "golden_leggings");
      equip(mob, "slot.armor.feet", "golden_boots");
    }
    if (spec.warden) {
      mob.nameTag = "Piglin Warden";
      const long = 20 * 60 * 30;
      mob.addEffect("health_boost", long, { amplifier: 4, showParticles: false }); // +20 health
      mob.addEffect("instant_health", 1, { amplifier: 4, showParticles: false });
      mob.addEffect("strength", long, { amplifier: 0, showParticles: false });
      mob.addEffect("resistance", long, { amplifier: 0, showParticles: false });
    }
    return mob;
  });
  if (isTestMode()) {
    system.runTimeout(() => {
      for (const mob of mobs) if (mob.isValid()) mob.kill();
    }, TEST_KILL_TICKS);
  }
}

// ── Gates and lights ────────────────────────

function openGate(gate) {
  for (const p of gate.bars) swap(p, BARS, AIR);
  swap(gate.lamp, R.lamp_dark, LIT);
  spawnWave(gate);
  sound(gate.number % 4 === 0 ? "mob.piglin.angry" : "random.door_open");
}

function lightPath(cells, upTo) {
  for (let i = 0; i < Math.min(upTo, cells.length); i++) swap(cells[i], PATH_DARK.type, LIT);
}

function resetRoom() {
  fight = undefined;
  for (const mob of aliveMobs()) mob.remove();
  for (const gate of R.gates) {
    for (const p of gate.bars) swap(p, AIR, BARS);
    swap(gate.lamp, LIT, R.lamp_dark);
  }
  for (const p of [...R.spoke, ...R.track]) swap(p, LIT, PATH_DARK.type, PATH_DARK.states);
  setMode("waiting");
}

// ── The fight ───────────────────────────────

function startFight() {
  fight = { spoke: 0, track: 0, opened: 0 };
  setMode("running");
  sound("note.pling");
}

function stepFight() {
  // The spoke first, then gate 1.
  if (fight.spoke < R.spoke.length) {
    fight.spoke = Math.min(R.spoke.length, fight.spoke + R.spoke.length / (SPOKE_TICKS / TICKS));
    lightPath(R.spoke, Math.floor(fight.spoke));
    return;
  }

  const alive = aliveMobs().length;
  const next = R.gates[fight.opened]; // undefined once all 12 are open

  if (!next) {
    if (alive === 0) {
      setGate(STAGE, "back", true);
      setMode("won");
      fight = undefined;
      sound("random.levelup");
    }
    return;
  }

  // Run the light toward the next gate: steady, faster when the arena is
  // clear, paused while too many are alive.
  const prev = fight.opened === 0 ? next.opens_at : R.gates[fight.opened - 1].opens_at;
  let speed = (next.opens_at - prev) / ((GATE_SECONDS * 20) / TICKS);
  if (fight.opened > 0 && alive === 0) speed = Math.max(speed, FAST_CELLS_PER_STEP);
  if (alive > MAX_ALIVE) speed = 0;
  fight.track = Math.min(next.opens_at, fight.track + speed);
  lightPath(R.track, Math.floor(fight.track) + 1);

  if (fight.track >= next.opens_at) {
    openGate(next);
    fight.opened++;
  }
}

// ── Main loop ───────────────────────────────

system.runInterval(() => {
  if (!origin()) return;
  const nether = world.getDimension(NETHER_ID);
  if (nether.getPlayers().length === 0) return; // chunks likely unloaded

  const active = isEventOn() && currentStage() === STAGE;
  if (!active) {
    // Run moved past Room 5, or ended: put the room back once.
    if (world.getDynamicProperty(RUN) !== undefined) {
      resetRoom();
      world.setDynamicProperty(RUN, undefined);
    }
    return;
  }
  // First check in Room 5 this run (or leftovers from an earlier one).
  if (world.getDynamicProperty(RUN) !== currentRun()) {
    resetRoom();
    world.setDynamicProperty(RUN, currentRun());
    return;
  }

  switch (mode()) {
    case "waiting": {
      const members = nether.getPlayers().filter(isMember);
      const everyone = members.filter((p) => !isOperator(p)).every(inCircle);
      if (everyone && members.some(inCircle)) startFight();
      return;
    }
    case "running": {
      if (!fight) {
        resetRoom(); // fight lost to a restart: start over
        return;
      }
      stepFight();
      return;
    }
    default:
      return; // won
  }
}, TICKS);
