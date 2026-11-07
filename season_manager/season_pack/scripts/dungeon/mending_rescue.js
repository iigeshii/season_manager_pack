import { world, system } from "@minecraft/server";
import { isOperator } from "./nether_rules.js";
import { netherPortalsOpen, setNetherPortalsOpen, onNetherPortalsClosed } from "../nether_portals.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, getJson, setJson, origin, isEventOn, isTestMode, setTestMode, extraCommands } from "./run_state.js";
import { gateOnRunStarted, resetGate, clearStickyPads, closeInnerPortcullis } from "./room1_gate.js";
import { gatesForStage, closeAllAirlockGates } from "./gates.js";

// ─────────────────────────────────────────────
//  MENDING RESCUE EVENT
//  Tracks a dungeon run: who's in the party, which room they're in, where
//  dead party members respawn, and keeping the party in that room.
//
//  Getting into the Nether is handled by the Nether portal switch
//  (scriptevent season:nether_portals on|off), not here. A run: portals
//  on, players gather in Room 1, seal (starts the run, closes portals),
//  stage as they go, off at the end.
//
//  The dungeon's rooms, airlocks and checkpoints come from layout.js,
//  generated from the fabricator's schematic, relative to the structure's
//  minimum corner. The pack only needs to know where it was placed
//  (unrotated).
//
//  Commands (scriptevent season:mending_rescue <word>, from chat):
//    set_origin <x> <y> <z>  where the structure was placed (once)
//    seal      starts a run: the party is everyone in the Nether right
//              now, the run is at stage 2 (Room 2), and Nether portals are
//              switched off. Party members who die respawn at the
//              checkpoint and may be in the Nether even with portals off.
//    stage <n> moves the run to room n (2-8). The checkpoint becomes the
//              airlock just before it.
//    off       ends the run and resets the Room 1 gate.
//    test_mode on|off  group puzzles can be done solo: Room 1's pads
//              stay lit, Airlock 1 needs 1 player, Room 2's pity ladder
//              comes after 30 s instead of 10 min.
//    reset     everything back for the next group: ends any run, resets
//              the gate, closes Nether portals (sending non-operators
//              home). Keeps the origin and test mode.
//    reset_gate  closes and darkens the Room 1 gate.
//    jump <n>  testing: go straight to room n (2-8), starting a run if
//              needed, with the gates set and the party at its checkpoint.
//    where     which room/airlock you're standing in.
//    answer    Room 3's counts, for testing (room3.js).
//    (none)    shows the current state.
//  The airlock code will call sealParty() and setStage() itself once it
//  exists; until then they're typed.
//
//  Containment: while a run is on, a non-operator in the Nether who is
//  outside the current stage's zone (the room, plus the airlocks either
//  side of it) is taken back to the checkpoint.
//
//  Membership is stamped on each player as the run number it applies to,
//  so starting a new run invalidates the last one without having to reach
//  players who are offline.
// ─────────────────────────────────────────────

const EVENT_ID = "season:mending_rescue";
const CONTAINMENT_TICKS = 20; // 1 second
const LAST_STAGE = 8;

// ── Stored state ────────────────────────────

export { isEventOn };

function currentRun() {
  return world.getDynamicProperty(P + "run") ?? 0;
}

export function currentStage() {
  return world.getDynamicProperty(P + "stage") ?? 1;
}

export function isMember(player) {
  return isEventOn() && player.getDynamicProperty(P + "member") === currentRun();
}

// Whether a player may be in the Nether right now. main.js's bounce-back
// asks this before sending anyone back.
export function isAllowedInNether(player) {
  return isOperator(player) || netherPortalsOpen() || isMember(player);
}

// Called by the Room 1 airlock (and the seal command): starts a new run
// whose party is exactly the given players, at Room 2, and closes Nether
// portals behind them so nobody else can follow.
export function sealParty(players) {
  const run = currentRun() + 1;
  world.setDynamicProperty(P + "run", run);
  for (const player of players) player.setDynamicProperty(P + "member", run);
  world.setDynamicProperty(P + "on", true);
  setStage(2);
  setNetherPortalsOpen(false);
  gateOnRunStarted();
}

// Called by each airlock (and the stage command) as the party moves on to
// room n: also sets the airlock gates for it (gates.js).
export function setStage(n) {
  world.setDynamicProperty(P + "stage", n);
  gatesForStage(n);
}

// ── Places ──────────────────────────────────

// Layout spot (relative) to a world spot.
function placed(spot) {
  const o = origin();
  return o && { x: o.x + spot.x, y: o.y + spot.y, z: o.z + spot.z, yaw: spot.yaw };
}

function checkpoint() {
  return placed(LAYOUT.stages[currentStage()].checkpoint);
}

function sendTo(player, spot) {
  player.teleport(
    { x: spot.x, y: spot.y, z: spot.z },
    { dimension: world.getDimension(NETHER_ID), rotation: { x: 0, y: spot.yaw } }
  );
}

function fmt(v) {
  return `${Math.floor(v.x)} ${Math.floor(v.y)} ${Math.floor(v.z)}`;
}

// The structure-relative cells a player occupies: feet and body, so
// standing on a slab or stair still counts as being in the room.
function relativeCells(location) {
  const o = origin();
  const x = Math.floor(location.x) - o.x;
  const z = Math.floor(location.z) - o.z;
  return [
    { x, y: Math.floor(location.y) - o.y, z },
    { x, y: Math.floor(location.y + 0.9) - o.y, z },
  ];
}

function inBoxes(c, boxes) {
  return boxes.some((b) => c.x >= b[0] && c.y >= b[1] && c.z >= b[2] && c.x <= b[3] && c.y <= b[4] && c.z <= b[5]);
}

export function spacesAt(location) {
  const cells = relativeCells(location);
  return Object.keys(LAYOUT.spaces).filter((id) => cells.some((c) => inBoxes(c, LAYOUT.spaces[id].boxes)));
}

function inStageZone(location, stage = currentStage()) {
  const here = spacesAt(location);
  return LAYOUT.stages[stage].zone.some((id) => here.includes(id));
}

// ── Containment ─────────────────────────────
// The party is held to the current stage. Anyone else in the Nether during
// a run who isn't an operator (not in the party) is held to Room 1.

system.runInterval(() => {
  if (!isEventOn() || !origin()) return;
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    if (isOperator(player)) continue;
    const stage = isMember(player) ? currentStage() : 1;
    if (inStageZone(player.location, stage)) continue;
    sendTo(player, placed(LAYOUT.stages[stage].checkpoint));
    player.sendMessage("§7You were brought back to the checkpoint.");
  }
}, CONTAINMENT_TICKS);

// ── Sending home ────────────────────────────

// world.getDefaultSpawnLocation()'s Y can be a placeholder (~32000) if the
// spawn was never set explicitly, so find the ground at its X/Z instead.
function surfaceNear(dimension, x, z) {
  for (let y = 319; y >= -64; y--) {
    const block = dimension.getBlock({ x, y, z });
    if (block && !block.isAir && !block.isLiquid) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
  }
  return { x: x + 0.5, y: 100, z: z + 0.5 };
}

// Their bed (or other set spawn point) if they have one, else world spawn.
function sendHome(player, message) {
  const bed = player.getSpawnPoint();
  if (bed) {
    player.teleport({ x: bed.x + 0.5, y: bed.y, z: bed.z + 0.5 }, { dimension: bed.dimension });
  } else {
    const overworld = world.getDimension("minecraft:overworld");
    const spawn = world.getDefaultSpawnLocation();
    player.teleport(surfaceNear(overworld, Math.floor(spawn.x), Math.floor(spawn.z)), { dimension: overworld });
  }
  player.sendMessage(message);
}

// Everyone in the Nether who isn't allowed there any more. Operators stay
// put, and nobody is moved while portals are open (the Nether is open
// then). Returns how many were sent.
function sendOutsidersHome(message) {
  let sent = 0;
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    if (isAllowedInNether(player)) continue;
    sendHome(player, message);
    sent++;
  }
  return sent;
}

// Switching Nether portals off (by command, or the seal) clears the Nether
// at once.
onNetherPortalsClosed(() => sendOutsidersHome("§7Nether portals are closed. You've been sent home."));

// ── Death and login ─────────────────────────

const LOGIN_DELAY_TICKS = 20; // let a joining player finish loading first

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  // A party member who died respawns at the checkpoint, not at home. They
  // pass through the Overworld for a moment.
  if (!initialSpawn) {
    system.run(() => {
      if (!player.isValid() || !isMember(player)) return;
      const target = checkpoint();
      if (target) sendTo(player, target);
    });
    return;
  }

  system.runTimeout(() => {
    if (!player.isValid()) return;
    const inNether = player.dimension.id === NETHER_ID;
    // Logged out in the dungeon and came back when they're no longer
    // allowed there (run over, new run, portals closed): sent home rather
    // than left in a sealed room.
    if (inNether && !isAllowedInNether(player)) {
      sendHome(player, "§7The rescue run you were on has ended. You've been sent home.");
      return;
    }
    // A party member who logged in outside the Nether (e.g. quit on the
    // death screen) rejoins the party at the checkpoint.
    if (!inNether && isMember(player) && origin()) sendTo(player, checkpoint());
  }, LOGIN_DELAY_TICKS);
});

// ── Command ─────────────────────────────────
//   /scriptevent season:mending_rescue <seal|stage n|off|where|set_origin x y z>

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== EVENT_ID) return;
  const source = event.sourceEntity?.typeId === "minecraft:player" ? event.sourceEntity : undefined;
  const reply = (text) => (source ? source.sendMessage(text) : console.warn(text));
  const [word = "", ...args] = event.message.trim().toLowerCase().split(/\s+/);

  switch (word) {
    case "set_origin": {
      const [x, y, z] = args.map(Number);
      if (args.length !== 3 || ![x, y, z].every(Number.isInteger)) {
        return reply("§cUse: set_origin <x> <y> <z> — where the structure was placed (whole numbers).");
      }
      setJson("origin", { x, y, z });
      return reply(`§aDungeon origin set: ${x} ${y} ${z}. Room 1 dais: ${fmt(placed(LAYOUT.arrival))}.`);
    }
    case "seal": {
      if (!origin()) return reply("§cSet the dungeon's position first: set_origin <x> <y> <z>.");
      if (isEventOn()) return reply(`§cRun ${currentRun()} is already on. End it with off first.`);
      const party = world.getDimension(NETHER_ID).getPlayers();
      if (party.length === 0) return reply("§cNobody is in the Nether.");
      sealParty(party);
      return reply(`§aRun ${currentRun()} started. Party of ${party.length}: ${party.map((p) => p.name).join(", ")}. Now in Room 2. Nether portals closed.`);
    }
    case "stage": {
      const n = Number(args[0]);
      if (!isEventOn()) return reply("§cNo run is on. Start one with seal.");
      if (!Number.isInteger(n) || n < 2 || n > LAST_STAGE) return reply("§cUse: stage <2-8>.");
      setStage(n);
      return reply(`§aNow in Room ${n}, ${LAYOUT.stages[n].room}. Checkpoint: ${fmt(checkpoint())}.`);
    }
    case "jump": {
      // Testing: skip rooms already checked. Starts a run if none is on
      // (party = everyone in the Nether, plus whoever typed it), puts the
      // gates as if the party had just come through the airlock into room
      // n, and teleports the online party to its checkpoint.
      const n = Number(args[0]);
      if (!Number.isInteger(n) || n < 2 || n > LAST_STAGE) return reply("§cUse: jump <2-8>.");
      if (!origin()) return reply("§cSet the dungeon's position first: set_origin <x> <y> <z>.");
      if (!isEventOn()) {
        const party = world.getDimension(NETHER_ID).getPlayers();
        if (source && !party.some((p) => p.id === source.id)) party.push(source);
        if (party.length === 0) return reply("§cNobody to send. Run it as a player.");
        sealParty(party);
      }
      closeAllAirlockGates();
      if (n >= 3) closeInnerPortcullis();
      setStage(n);
      const target = checkpoint();
      const members = world.getAllPlayers().filter(isMember);
      for (const player of members) sendTo(player, target);
      return reply(`§aJumped to Room ${n}, ${LAYOUT.stages[n].room}. Sent ${members.map((p) => p.name).join(", ")} to ${fmt(target)}.`);
    }
    case "off": {
      if (!isEventOn()) return reply("§7No run is on.");
      world.setDynamicProperty(P + "on", false);
      resetGate();
      closeAllAirlockGates();
      const sent = sendOutsidersHome("§7The rescue run is over. You've been sent home.");
      return reply(`§aRun ${currentRun()} ended. Sent ${sent} player${sent === 1 ? "" : "s"} home.`);
    }
    case "test_mode": {
      if (args[0] === "on" || args[0] === "off") {
        setTestMode(args[0] === "on");
        if (args[0] === "off") clearStickyPads();
      }
      return reply(`§6Test mode: ${isTestMode() ? "on (Room 1 pads stay lit, first airlock needs 1 player, Room 2 ladder after 30 s, Room 3 guards die after 3 s)" : "off"}.`);
    }
    case "reset": {
      // Back to how the next group should find it, whatever state it's in.
      // Keeps the origin and the test-mode setting.
      const wasOn = isEventOn();
      world.setDynamicProperty(P + "on", false);
      setStage(1);
      resetGate();
      closeAllAirlockGates();
      const sent = setNetherPortalsOpen(false); // also sends non-operators home
      return reply(
        `§aMending Rescue reset${wasOn ? ` (run ${currentRun()} ended)` : ""}: gate closed and dark, ` +
          `Nether portals closed, ${sent} player${sent === 1 ? "" : "s"} sent home.`
      );
    }
    case "reset_gate": {
      resetGate();
      return reply("§aRoom 1 gate reset: wards dark, portcullises closing.");
    }
    case "where": {
      if (!source) return reply("Run this from chat as a player.");
      if (!origin()) return reply("§cThe dungeon's position isn't set.");
      if (source.dimension.id !== NETHER_ID) return reply("§7You're not in the Nether.");
      const o = origin();
      const rel = { x: source.location.x - o.x, y: source.location.y - o.y, z: source.location.z - o.z };
      const here = spacesAt(source.location).map((id) => LAYOUT.spaces[id].name);
      const zone = isEventOn() ? (inStageZone(source.location) ? ", inside the current zone" : ", OUTSIDE the current zone") : "";
      return reply(`§7${here.join(" / ") || "Not in any room"} (structure ${fmt(rel)})${zone}.`);
    }
    case "": {
      const o = origin();
      const stage = currentStage();
      const lines = [
        `§6Mending Rescue: ${isEventOn() ? `run ${currentRun()} on` : "no run on"}`,
        isEventOn() ? `§7 stage: Room ${stage}, ${LAYOUT.stages[stage].room}` : undefined,
        `§7 origin: ${o ? fmt(o) : "not set"}`,
        o && isEventOn() ? `§7 checkpoint: ${fmt(checkpoint())}` : undefined,
        `§7 Nether portals: ${netherPortalsOpen() ? "open" : "closed"}`,
        isTestMode() ? "§e test mode: on" : undefined,
      ].filter(Boolean);
      if (isEventOn()) {
        const members = world.getAllPlayers().filter(isMember).map((p) => p.name);
        lines.push(`§7 party online: ${members.join(", ") || "none"}`);
      }
      return reply(lines.join("\n"));
    }
    default:
      if (extraCommands.has(word)) return; // answered by a room module
      return reply("§cUse: seal, stage <n>, jump <n>, off, reset, test_mode on|off, reset_gate, where, set_origin <x> <y> <z>, or nothing for status.");
  }
});
