import { world, system } from "@minecraft/server";
import { isOperator } from "./nether_rules.js";
import { setPortalStatus, describePortals } from "../nether_portals.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, getJson, setJson, origin, isEventOn, isTestMode, setTestMode, extraCommands, onRunEnded, runEnded, restartRoom } from "./run_state.js";
import { gateOnRunStarted, resetGate, clearStickyPads, closeInnerPortcullis } from "./room1_gate.js";
import { gatesForStage, closeAllAirlockGates } from "./gates.js";

// ─────────────────────────────────────────────
//  MENDING RESCUE EVENT
//  Tracks a dungeon run: who's in the party, which room they're in, where
//  dead party members respawn, and keeping the party in that room.
//
//  The event is always in one of four phases, moving one way round:
//    closed     nothing on. Portals closed (operators only); anyone else
//               in the Nether is sent home.
//    gathering  after `start`. Portals open; everyone in the Nether is
//               held to Room 1 to gather.
//    running    from the first airlock (the group inside it becomes the
//               party) through Rooms 2-7. Portals open: anyone coming in
//               joins the party at the checkpoint.
//    finale     from the airlock into Room 8. Portals closed again; anyone
//               not in the party is sent home. Party members offline at
//               that moment are dropped from it.
//  Then closed again: when the finale is done, the last party member
//  leaves, or `reset`.
//
//  The dungeon's rooms, airlocks and checkpoints come from layout.js,
//  generated from the fabricator's schematic, relative to the structure's
//  minimum corner. The pack only needs to know where it was placed
//  (unrotated).
//
//  Commands (scriptevent season:mending_rescue <word>, from chat):
//    set_origin <x> <y> <z>  where the structure was placed (once)
//    start     a fresh event from any phase: does everything reset does,
//              then gathering.
//    leave <player>  takes one player off the party and sends them home.
//    test_mode on|off  group puzzles can be done solo: Room 1's pads
//              stay lit, Airlock 1 needs 1 player, Room 2's pity ladder
//              comes after 30 s instead of 10 min.
//    reset     back to closed from any phase: ends any run, resets the
//              gate, and sends everyone in the Nether home, operators
//              included. Keeps the origin and test mode.
//    reset_gate  closes and darkens the Room 1 gate.
//    jump <n>  testing: go straight to room n (2-8), starting a run if
//              needed, with the gates set and the party at its checkpoint.
//              Room n always starts over from scratch, even if the party
//              is already in it.
//    where     which room/airlock you're standing in.
//    answer    Room 3's counts, for testing (room3.js).
//    (none)    shows the current state.
//  The airlocks (airlocks.js) start the run and move it room to room.
//
//  Containment: while a run is on, a non-operator in the Nether who is
//  outside the current stage's zone (the room, plus the airlocks either
//  side of it) is taken back to the checkpoint.
//
//  Late joiners: while running, a non-operator outside the party who comes
//  into the Nether (any portal, or logging in there) joins the party at
//  the room it's on and is sent to the checkpoint, like a respawn.
//
//  Logging out keeps a player in the party. Back while the run is still
//  running (or they were in the finale party): returned to the checkpoint.
//  Back after the party reached Room 8 without them, or after the run
//  ended: sent home.
//
//  Membership is stamped on each player as the run number it applies to,
//  so starting a new run invalidates the last one without having to reach
//  players who are offline.
//
//  Keep inventory: the keepinventory game rule is on in the running phase
//  (Rooms 2-7) and off otherwise, so a party member who dies goes straight
//  back into the fight with their gear, and no Gravestone add-on graves
//  are left in the dungeon. Off again from the finale (Room 8 has nothing
//  that kills). It's a world-wide rule, so while on it covers deaths
//  anywhere. Put right on every script load, in case the world stopped
//  mid-change.
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

// In the finale, only those who were online when the party moved into
// Room 8 (their ids, saved then). Membership is stamped on the player, and
// offline players can't be reached, so this list is how they're dropped.
const FINALE_PARTY = "finale_party";

export function isMember(player) {
  if (!isEventOn() || player.getDynamicProperty(P + "member") !== currentRun()) return false;
  if (currentStage() < LAST_STAGE) return true;
  const ids = getJson(FINALE_PARTY);
  return !Array.isArray(ids) || ids.includes(player.id);
}

// ── Phase ───────────────────────────────────

const GATHERING = P + "gathering";

// "closed", "gathering", "running" or "finale" (see the top of this file).
export function phase() {
  if (isEventOn()) return currentStage() >= LAST_STAGE ? "finale" : "running";
  return world.getDynamicProperty(GATHERING) === true ? "gathering" : "closed";
}

const PORTALS = {
  closed: { open: false, text: "closed (operators only)" },
  gathering: { open: true, text: "open (anyone coming in gathers in Room 1)" },
  running: { open: true, text: "open (anyone coming in joins the party at its checkpoint)" },
  finale: { open: false, text: "closed (the party is in Room 8)" },
};
setPortalStatus(() => PORTALS[phase()]);

// Whether a player may be in the Nether right now. main.js's bounce-back
// asks this (after joinLate) before sending anyone back.
export function isAllowedInNether(player) {
  return isOperator(player) || isMember(player) || phase() === "gathering";
}

// Called by the Room 1 airlock (and jump): starts a new run whose party is
// the given players, at Room 2. Anyone who comes in after joins the party
// (joinLate).
export function sealParty(players) {
  const run = currentRun() + 1;
  world.setDynamicProperty(P + "run", run);
  for (const player of players) {
    player.setDynamicProperty(P + "member", run);
    player.sendMessage(LEAVE_HINT);
  }
  world.setDynamicProperty(P + "on", true);
  world.setDynamicProperty(GATHERING, undefined);
  setStage(2);
  gateOnRunStarted();
}

// ── Keep inventory ──────────────────────────

// Sets the game rule to match the phase: on while running, off otherwise.
// Called on every stage change (a run starts at stage 2), at the end of a
// run, and on load.
function syncKeepInventory() {
  const on = phase() === "running";
  try {
    world.getDimension("minecraft:overworld").runCommand(`gamerule keepinventory ${on}`);
  } catch (e) {
    console.warn(`[Mending Rescue] couldn't set keepinventory ${on}: ${e}`);
  }
}

onRunEnded(syncKeepInventory);
system.run(syncKeepInventory);

// Called by each airlock (and jump) as the party moves on to room n: also
// sets the airlock gates for it (gates.js). Moving into Room 8 starts the
// finale: the party becomes whoever of it is online.
export function setStage(n) {
  const finaleParty = n >= LAST_STAGE && isEventOn() ? world.getAllPlayers().filter(isMember).map((p) => p.id) : undefined;
  setJson(FINALE_PARTY, finaleParty);
  world.setDynamicProperty(P + "stage", n);
  gatesForStage(n);
  syncKeepInventory();
}

// ── Late joiners ────────────────────────────

// Whether someone arriving now would join the party.
export function canJoinLate() {
  return phase() === "running" && !!origin();
}

// A non-operator outside the party who has come into the Nether during a
// run: joins the party and is sent to the checkpoint. Returns whether they
// joined. Called by main.js's bounce-back and on login.
export function joinLate(player) {
  if (isOperator(player) || isMember(player) || !canJoinLate()) return false;
  const stage = currentStage();
  for (const other of world.getAllPlayers()) {
    if (isMember(other)) other.sendMessage(`§7${player.name} has joined the party.`);
  }
  player.setDynamicProperty(P + "member", currentRun());
  player.sendMessage(`§6You've joined the rescue party in Room ${stage}, ${LAYOUT.stages[stage].room}.`);
  player.sendMessage(LEAVE_HINT);
  system.run(() => {
    if (player.isValid()) sendTo(player, checkpoint());
  });
  return true;
}

// ── Leaving ─────────────────────────────────
// A party member can leave mid-run: crouching in an airlock (leave.js) or
// an operator's leave command. They're taken off the party and sent home,
// and could come back later as a late joiner. If that leaves nobody from
// the party online, the run ends and everything resets for the next group.

export const LEAVE_HINT = "§7Want out? Crouch in any airlock for 5 seconds to leave the rescue.";

export function leaveRun(player) {
  if (!isMember(player)) return false;
  // Off the party first, so a later death or login doesn't bring them back.
  player.setDynamicProperty(P + "member", undefined);
  if (player.dimension.id === NETHER_ID) sendHome(player, "§7You've left the rescue party and been sent home.");
  else player.sendMessage("§7You've left the rescue party.");
  const rest = world.getAllPlayers().filter(isMember);
  for (const other of rest) other.sendMessage(`§7${player.name} has left the party.`);
  if (rest.length === 0) resetEvent();
  return true;
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
// Every non-operator in the Nether, by phase:
//   closed     sent home
//   gathering  held to Room 1 and its airlock, so someone who lights a
//              portal elsewhere is brought to the dais instead of roaming
//   running    party held to the current stage; anyone else joins it
//   finale     party held to Room 8; anyone else sent home

const TOO_LATE = "§7The rescue party has reached the Librarian's Cell, and it's too late to join. You've been sent home.";

system.runInterval(() => {
  if (!origin()) return;
  const now = phase();
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    if (isOperator(player)) continue;
    if (now === "closed") {
      sendHome(player, "§7The Nether is closed. You've been sent home.");
      continue;
    }
    if (now !== "gathering" && !isMember(player) && !joinLate(player)) {
      sendHome(player, TOO_LATE);
      continue;
    }
    const stage = now === "gathering" ? 1 : currentStage();
    if (inStageZone(player.location, stage)) continue;
    sendTo(player, placed(LAYOUT.stages[stage].checkpoint));
    player.sendMessage(stage === 1 ? "§7You were brought back to the dais." : "§7You were brought back to the checkpoint.");
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
export function sendHome(player, message) {
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

// Back to closed, whatever phase it's in: run over, Room 1 gate and every
// airlock shut, and every non-operator in the Nether sent home. Rooms put
// themselves back once they're loaded. Keeps the origin and the test-mode
// setting. Used by the reset command, the end of the finale, and the last
// party member leaving. Returns how many players were sent home.
export function resetEvent(message = "§7The rescue run has ended. You've been sent home.") {
  world.setDynamicProperty(P + "on", false);
  world.setDynamicProperty(GATHERING, undefined);
  setStage(1);
  resetGate();
  closeAllAirlockGates();
  runEnded();
  let sent = 0;
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    if (isOperator(player)) continue;
    sendHome(player, message);
    sent++;
  }
  return sent;
}

// The reset command, and the first half of start: resetEvent, then
// operators sent home too, so the Nether is empty. Returns how many were
// sent home.
function clearAll(message) {
  let sent = resetEvent(message);
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    sendHome(player, message);
    sent++;
  }
  return sent;
}

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
    // Logged in inside the Nether during a run they're not part of: they
    // join it at the checkpoint.
    if (inNether && joinLate(player)) return;
    // Logged out in the dungeon and came back when they're no longer
    // allowed there (run over, or the party reached Room 8 without them):
    // sent home rather than left in a sealed room.
    if (inNether && !isAllowedInNether(player)) {
      sendHome(player, phase() === "finale" ? TOO_LATE : "§7The rescue run you were on has ended. You've been sent home.");
      return;
    }
    // A party member who logged in outside the Nether (e.g. quit on the
    // death screen) rejoins the party at the checkpoint.
    if (!inNether && isMember(player) && origin()) sendTo(player, checkpoint());
  }, LOGIN_DELAY_TICKS);
});

// ── Command ─────────────────────────────────
//   /scriptevent season:mending_rescue <word> (see the top of this file)

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
    case "start": {
      // A fresh event for a new group, whatever phase it was in: everything
      // reset and the Nether emptied (as reset), then gathering, and
      // everyone told. The run itself starts at the first airlock.
      if (!origin()) return reply("§cSet the dungeon's position first: set_origin <x> <y> <z>.");
      const wasOn = isEventOn();
      const sent = clearAll("§7The rescue is starting over. You've been sent home.");
      world.setDynamicProperty(GATHERING, true);
      world.sendMessage("§6The Mending Rescue is open! §fLight a Nether portal and gather on the dais in Room 1.");
      return reply(
        `§aMending Rescue started fresh${wasOn ? ` (run ${currentRun()} ended)` : ""}, ` +
          `${sent} player${sent === 1 ? "" : "s"} sent home. Nether portals: ${describePortals()}.`
      );
    }
    case "jump": {
      // Testing: skip rooms already checked. Starts a run if none is on
      // (party = everyone in the Nether, plus whoever typed it), puts the
      // gates as if the party had just come through the airlock into room
      // n, starts room n over from scratch (even if it's the room they're
      // in), and teleports the online party to its checkpoint.
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
      restartRoom(n);
      const target = checkpoint();
      const members = world.getAllPlayers().filter(isMember);
      for (const player of members) sendTo(player, target);
      return reply(`§aJumped to Room ${n}, ${LAYOUT.stages[n].room} (starting over). Sent ${members.map((p) => p.name).join(", ")} to ${fmt(target)}.`);
    }
    case "leave": {
      // Takes one player off the party and sends them home (e.g. stuck or
      // AFK). Name as shown in chat, any case.
      const name = event.message.trim().split(/\s+/).slice(1).join(" ").replace(/^@|"/g, "").toLowerCase();
      if (!isEventOn()) return reply("§7No run is on.");
      if (!name) return reply("§cUse: leave <player>.");
      const player = world.getAllPlayers().find((p) => p.name.toLowerCase() === name && isMember(p));
      if (!player) return reply(`§cNo online party member called ${name}.`);
      leaveRun(player);
      return reply(`§aTook ${player.name} off the party${isEventOn() ? "" : ". Nobody from the party was left online, so the run ended and everything was reset"}.`);
    }
    case "test_mode": {
      if (args[0] === "on" || args[0] === "off") {
        setTestMode(args[0] === "on");
        if (args[0] === "off") clearStickyPads();
      }
      return reply(`§6Test mode: ${isTestMode() ? "on (Room 1 pads stay lit, first airlock needs 1 player, Room 2 ladder after 30 s, Room 3 guards die after 3 s, Room 5 mobs die after 5 s, maze mobs after 10 s)" : "off"}.`);
    }
    case "reset": {
      const wasOn = isEventOn();
      const sent = clearAll("§7The rescue has been reset. You've been sent home.");
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
      const now = phase();
      const lines = [
        `§6Mending Rescue: ${now}${isEventOn() ? ` (run ${currentRun()})` : ""}`,
        isEventOn() ? `§7 stage: Room ${stage}, ${LAYOUT.stages[stage].room}` : undefined,
        `§7 origin: ${o ? fmt(o) : "not set"}`,
        o && isEventOn() ? `§7 checkpoint: ${fmt(checkpoint())}` : undefined,
        `§7 Nether portals: ${describePortals()}`,
        isTestMode() ? "§e test mode: on" : undefined,
      ].filter(Boolean);
      const label = (p) => (isOperator(p) ? `${p.name} (operator)` : p.name);
      if (isEventOn()) {
        const members = world.getAllPlayers().filter(isMember).map(label);
        lines.push(`§7 party online: ${members.join(", ") || "none"}`);
      }
      // Anyone else in the Nether: operators, or someone about to be joined
      // or sent home.
      const others = world.getDimension(NETHER_ID).getPlayers().filter((p) => !isMember(p)).map(label);
      if (others.length > 0) lines.push(`§7 in the Nether, not in the party: ${others.join(", ")}`);
      return reply(lines.join("\n"));
    }
    default:
      if (extraCommands.has(word)) return; // answered by a room module
      return reply("§cUse: start, reset, jump <n>, leave <player>, test_mode on|off, reset_gate, where, set_origin <x> <y> <z>, or nothing for status.");
  }
});
