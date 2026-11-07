import { world, system } from "@minecraft/server";
import { isOperator } from "./nether_rules.js";
import { LAYOUT } from "./layout.js";

// ─────────────────────────────────────────────
//  MENDING RESCUE EVENT
//  The event switch, the one allowed portal, who may be in the Nether, and
//  keeping the party in the room they're playing.
//
//  The dungeon's rooms, airlocks, checkpoints and portals come from
//  layout.js, generated from the fabricator's schematic, relative to the
//  structure's minimum corner. The pack only needs to know where it was
//  placed (unrotated).
//
//  Setup (once, by an operator, from chat):
//    set_origin <x> <y> <z>  the corner you gave /structure load
//    set_portal   look at the Overworld portal's obsidian frame
//    set_return   stand outside the Overworld portal, facing away from it
//
//  Running it:
//    on        starts a run at stage 1 (Room 1). Anyone stepping into the
//              registered portal (lit) is teleported to the Room 1 dais
//              and may be in the Nether.
//    seal      the party is everyone in the Nether right now; moves to
//              stage 2. From here on only party members get through the
//              portal (to the checkpoint); everyone else is pushed back
//              out. Party members who die respawn at the checkpoint.
//    stage <n> moves the run to room n (2-8). The checkpoint becomes the
//              airlock just before it.
//    off       ends the run. Non-operators still in the Nether are sent
//              to the return point.
//    where     which room/airlock you're standing in.
//    (none)    shows the current state.
//  The airlock code will call sealParty() and setStage() itself once it
//  exists; until then they're typed.
//
//  Containment: while the event is on, a non-operator in the Nether who is
//  outside the current stage's zone (the room, plus the airlocks either
//  side of it) is taken back to the checkpoint.
//
//  Everyone non-operator who isn't allowed in the Nether is still bounced
//  by the dimension bounce-back in main.js, whatever portal they used. Only
//  the registered portal is intercepted here, and only it may be lit by
//  non-operators, only while the event is on.
//
//  Membership is stamped on each player as the run number it applies to,
//  so starting a new run invalidates the last one without having to reach
//  players who are offline.
// ─────────────────────────────────────────────

const EVENT_ID = "season:mending_rescue";
const P = "season:mending_rescue_";

const NETHER_ID = "minecraft:nether";
const OVERWORLD_ID = "minecraft:overworld";
const PORTAL_CHECK_TICKS = 2;
const CONTAINMENT_TICKS = 20; // 1 second
const PORTAL_SEARCH_LIMIT = 200; // blocks, when tracing a frame
const RAYCAST_DISTANCE = 10;
const LAST_STAGE = 8;

// ── Stored state ────────────────────────────

function getJson(key) {
  const raw = world.getDynamicProperty(P + key);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function setJson(key, value) {
  world.setDynamicProperty(P + key, value === undefined ? undefined : JSON.stringify(value));
}

export function isEventOn() {
  return world.getDynamicProperty(P + "on") === true;
}

function isSealed() {
  return world.getDynamicProperty(P + "sealed") === true;
}

function currentRun() {
  return world.getDynamicProperty(P + "run") ?? 0;
}

function currentStage() {
  return world.getDynamicProperty(P + "stage") ?? 1;
}

function hasEntered(player) {
  return player.getDynamicProperty(P + "entered") === currentRun();
}

function isMember(player) {
  return player.getDynamicProperty(P + "member") === currentRun();
}

// Whether a player may be in the Nether right now. main.js's bounce-back
// asks this before sending anyone back.
export function isAllowedInNether(player) {
  if (isOperator(player)) return true;
  if (!isEventOn()) return false;
  return isSealed() ? isMember(player) : hasEntered(player);
}

// Called by the Room 1 airlock (and the seal command): the party becomes
// exactly the given players, and the run moves on to Room 2.
export function sealParty(players) {
  const run = currentRun();
  for (const player of players) player.setDynamicProperty(P + "member", run);
  world.setDynamicProperty(P + "sealed", true);
  setStage(2);
}

// Called by each airlock as the party moves on to room n.
export function setStage(n) {
  world.setDynamicProperty(P + "stage", n);
}

// ── Places ──────────────────────────────────

function origin() {
  return getJson("origin");
}

// Layout spot (relative) to a world spot.
function placed(spot) {
  const o = origin();
  return o && { x: o.x + spot.x, y: o.y + spot.y, z: o.z + spot.z, yaw: spot.yaw };
}

function arrival() {
  return placed(LAYOUT.arrival);
}

function checkpoint() {
  return placed(LAYOUT.stages[currentStage()].checkpoint);
}

// A spot is { x, y, z, yaw }.
function spotOf(player) {
  const { x, y, z } = player.location;
  return { x, y, z, yaw: player.getRotation().y };
}

function sendTo(player, spot, dimensionId) {
  player.teleport(
    { x: spot.x, y: spot.y, z: spot.z },
    { dimension: world.getDimension(dimensionId), rotation: { x: 0, y: spot.yaw } }
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

function spacesAt(location) {
  const cells = relativeCells(location);
  return Object.keys(LAYOUT.spaces).filter((id) => cells.some((c) => inBoxes(c, LAYOUT.spaces[id].boxes)));
}

function inStageZone(location) {
  const here = spacesAt(location);
  return LAYOUT.stages[currentStage()].zone.some((id) => here.includes(id));
}

// A relative { min, max } box placed in the world, as a test on a location.
function inPlacedBox(location, box) {
  const o = origin();
  const c = { x: Math.floor(location.x) - o.x, y: Math.floor(location.y) - o.y, z: Math.floor(location.z) - o.z };
  return inBoxes(c, [[...box.min, ...box.max]]);
}

// ── The registered Overworld portal ─────────

function inBox(location, box) {
  const x = Math.floor(location.x);
  const y = Math.floor(location.y);
  const z = Math.floor(location.z);
  return x >= box.min.x && x <= box.max.x && y >= box.min.y && y <= box.max.y && z >= box.min.z && z <= box.max.z;
}

// main.js's portal lock asks this: non-operators may light only the
// registered frame, only while the event is on.
export function mayLightPortal(block) {
  if (!isEventOn()) return false;
  if (block.dimension.id !== OVERWORLD_ID) return false;
  const box = getJson("portal");
  return !!box && inBox(block.location, box);
}

// Follows connected obsidian and portal blocks from the one looked at and
// returns the box around them, or undefined if it isn't a portal frame.
function traceFrame(start) {
  const dimension = start.dimension;
  const isFrame = (b) => b && (b.typeId === "minecraft:obsidian" || b.typeId === "minecraft:portal");
  if (!isFrame(start)) return undefined;
  const seen = new Set();
  const queue = [start.location];
  const min = { ...start.location };
  const max = { ...start.location };
  while (queue.length > 0) {
    const at = queue.pop();
    const key = `${at.x},${at.y},${at.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > PORTAL_SEARCH_LIMIT) return undefined;
    const block = dimension.getBlock(at);
    if (!isFrame(block)) continue;
    for (const axis of ["x", "y", "z"]) {
      min[axis] = Math.min(min[axis], at[axis]);
      max[axis] = Math.max(max[axis], at[axis]);
    }
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      queue.push({ x: at.x + dx, y: at.y + dy, z: at.z + dz });
    }
  }
  // A frame is flat: one block thick on X or on Z.
  if (min.x !== max.x && min.z !== max.z) return undefined;
  return { min, max };
}

// Players stepping into a portal we handle are caught here before vanilla
// travel fires (that takes ~4 seconds of standing in it), so the game never
// builds a portal of its own on the other side.
system.runInterval(() => {
  const box = getJson("portal");
  if (box) {
    const overworld = world.getDimension(OVERWORLD_ID);
    for (const player of overworld.getPlayers()) {
      if (!inBox(player.location, box)) continue;
      if (overworld.getBlock(player.location)?.typeId !== "minecraft:portal") continue;
      handlePortalStep(player);
    }
  }

  if (!origin()) return;
  const nether = world.getDimension(NETHER_ID);
  for (const player of nether.getPlayers()) {
    for (const [name, exitBox] of Object.entries(LAYOUT.exits)) {
      if (!inPlacedBox(player.location, exitBox)) continue;
      if (nether.getBlock(player.location)?.typeId !== "minecraft:portal") continue;
      handleExit(player, name);
    }
  }
}, PORTAL_CHECK_TICKS);

function handlePortalStep(player) {
  const on = isEventOn();
  const sealed = isSealed();
  const operator = isOperator(player);

  const mayPass = operator || (on && (!sealed || isMember(player)));
  if (!mayPass) {
    const back = getJson("return");
    const why = on ? "§cThe rescue party has gone in. The portal is sealed." : "§cThis portal is currently disabled.";
    if (back) sendTo(player, back, OVERWORLD_ID);
    player.sendMessage(why);
    return;
  }

  const target = on && sealed ? checkpoint() : arrival();
  if (!target) {
    player.sendMessage("§cThe dungeon's position isn't set. Run /scriptevent season:mending_rescue set_origin <x> <y> <z>.");
    return;
  }
  if (on && !sealed) player.setDynamicProperty(P + "entered", currentRun());
  sendTo(player, target, NETHER_ID);
}

// The Room 1 return portal (going home before the run starts) and the
// Room 8 exit (done). Both lead to the return point. Finishing through
// Room 8 also ends that player's part in the run.
function handleExit(player, name) {
  const back = getJson("return");
  if (!back) return;
  if (name === "room8_exit") player.setDynamicProperty(P + "member", undefined);
  sendTo(player, back, OVERWORLD_ID);
}

// ── Containment ─────────────────────────────

system.runInterval(() => {
  if (!isEventOn() || !origin()) return;
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    if (isOperator(player) || !isAllowedInNether(player)) continue;
    if (inStageZone(player.location)) continue;
    const target = isSealed() ? checkpoint() : arrival();
    sendTo(player, target, NETHER_ID);
    player.sendMessage("§7You were brought back to the checkpoint.");
  }
}, CONTAINMENT_TICKS);

// ── Death and login ─────────────────────────

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  system.run(() => {
    if (!player.isValid()) return;

    // A party member who died respawns at the checkpoint, not at home.
    if (!initialSpawn) {
      if (!isEventOn() || !isSealed() || !isMember(player)) return;
      const target = checkpoint();
      if (target) sendTo(player, target, NETHER_ID);
      return;
    }

    // Logging in inside the Nether when not allowed there: sent home.
    if (player.dimension.id !== NETHER_ID || isAllowedInNether(player)) return;
    const back = getJson("return");
    if (back) sendTo(player, back, OVERWORLD_ID);
  });
});

// ── Command ─────────────────────────────────
//   /scriptevent season:mending_rescue <on|off|seal|stage n|where|set_origin x y z|set_portal|set_return>

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== EVENT_ID) return;
  const source = event.sourceEntity?.typeId === "minecraft:player" ? event.sourceEntity : undefined;
  const reply = (text) => (source ? source.sendMessage(text) : console.warn(text));
  const [word = "", ...args] = event.message.trim().toLowerCase().split(/\s+/);
  const needPlayer = () => {
    if (!source) reply("Run this from chat as a player.");
    return !!source;
  };

  switch (word) {
    case "set_origin": {
      const [x, y, z] = args.map(Number);
      if (args.length !== 3 || ![x, y, z].every(Number.isInteger)) {
        return reply("§cUse: set_origin <x> <y> <z> — the corner you gave /structure load (whole numbers).");
      }
      setJson("origin", { x, y, z });
      return reply(`§aDungeon origin set: ${x} ${y} ${z}. Arrival: ${fmt(arrival())}.`);
    }
    case "set_portal": {
      if (!needPlayer()) return;
      if (source.dimension.id !== OVERWORLD_ID) return reply("§cStand in the Overworld and look at the portal frame.");
      const hit = source.getBlockFromViewDirection({ maxDistance: RAYCAST_DISTANCE });
      const box = hit && traceFrame(hit.block);
      if (!box) return reply("§cLook at the portal's obsidian frame (within 10 blocks).");
      setJson("portal", box);
      return reply(`§aMending Rescue portal set: ${fmt(box.min)} to ${fmt(box.max)}.`);
    }
    case "set_return": {
      if (!needPlayer()) return;
      if (source.dimension.id !== OVERWORLD_ID) return reply("§cStand outside the Overworld portal.");
      setJson("return", spotOf(source));
      return reply(`§aReturn point set: ${fmt(source.location)}.`);
    }
    case "on": {
      const missing = ["origin", "portal", "return"].filter((k) => !getJson(k));
      if (missing.length > 0) return reply(`§cSet these first: ${missing.map((k) => "set_" + k).join(", ")}.`);
      world.setDynamicProperty(P + "run", currentRun() + 1);
      world.setDynamicProperty(P + "on", true);
      world.setDynamicProperty(P + "sealed", false);
      setStage(1);
      return reply(`§aMending Rescue is on (run ${currentRun()}). The portal is open.`);
    }
    case "seal": {
      if (!isEventOn()) return reply("§cThe event is off.");
      const party = world.getDimension(NETHER_ID).getPlayers();
      sealParty(party);
      return reply(`§aSealed. Party of ${party.length}: ${party.map((p) => p.name).join(", ") || "nobody"}. Now in Room 2.`);
    }
    case "stage": {
      const n = Number(args[0]);
      if (!isEventOn() || !isSealed()) return reply("§cSeal the party first.");
      if (!Number.isInteger(n) || n < 2 || n > LAST_STAGE) return reply("§cUse: stage <2-8>.");
      setStage(n);
      return reply(`§aNow in Room ${n}, ${LAYOUT.stages[n].room}. Checkpoint: ${fmt(checkpoint())}.`);
    }
    case "off": {
      world.setDynamicProperty(P + "on", false);
      world.setDynamicProperty(P + "sealed", false);
      const back = getJson("return");
      let sent = 0;
      for (const player of world.getDimension(NETHER_ID).getPlayers()) {
        if (isOperator(player) || !back) continue;
        sendTo(player, back, OVERWORLD_ID);
        sent++;
      }
      return reply(`§aMending Rescue is off. Sent ${sent} player${sent === 1 ? "" : "s"} home.`);
    }
    case "where": {
      if (!needPlayer()) return;
      if (!origin()) return reply("§cThe dungeon's position isn't set.");
      if (source.dimension.id !== NETHER_ID) return reply("§7You're not in the Nether.");
      const o = origin();
      const rel = { x: source.location.x - o.x, y: source.location.y - o.y, z: source.location.z - o.z };
      const here = spacesAt(source.location).map((id) => LAYOUT.spaces[id].name);
      const zone = isEventOn() ? (inStageZone(source.location) ? ", inside the current zone" : ", OUTSIDE the current zone") : "";
      return reply(`§7${here.join(" / ") || "Not in any room"} (structure ${fmt(rel)})${zone}.`);
    }
    case "": {
      const portal = getJson("portal");
      const o = origin();
      const back = getJson("return");
      const stage = currentStage();
      const lines = [
        `§6Mending Rescue: ${isEventOn() ? (isSealed() ? "on, sealed" : "on, open") : "off"} (run ${currentRun()})`,
        isEventOn() ? `§7 stage: Room ${stage}, ${LAYOUT.stages[stage].room}` : undefined,
        `§7 origin: ${o ? fmt(o) : "not set"}`,
        `§7 portal: ${portal ? `${fmt(portal.min)} to ${fmt(portal.max)}` : "not set"}`,
        `§7 return: ${back ? fmt(back) : "not set"}`,
        o && isEventOn() ? `§7 checkpoint: ${fmt(isSealed() ? checkpoint() : arrival())}` : undefined,
      ].filter(Boolean);
      if (isSealed()) {
        const members = world.getAllPlayers().filter(isMember).map((p) => p.name);
        lines.push(`§7 party online: ${members.join(", ") || "none"}`);
      }
      return reply(lines.join("\n"));
    }
    default:
      return reply("§cUse: on, off, seal, stage <n>, where, set_origin <x> <y> <z>, set_portal, set_return, or nothing for status.");
  }
});
