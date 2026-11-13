import { world, system, GameMode } from "@minecraft/server";

// ─────────────────────────────────────────────
//  NETHER RULES (Mending Librarian Rescue)
//  The Nether only exists for the dungeon event. Two standing rules:
//
//  1. Game mode. Anyone tagged OPERATOR_TAG is left alone, in any mode,
//     anywhere. Everyone else is in adventure while in the Nether and in
//     survival everywhere else — no creative or spectator for non-operators.
//     Applied on dimension change, on spawn (login and respawn — dying in
//     the Nether respawns you in the Overworld), and by a sweep as a
//     backstop. Non-operators can't break blocks in the Nether either, as a
//     second line behind adventure mode. (There used to be a survival
//     exception next to Gravestone add-on graves so they could be broken;
//     a run now has keep inventory on, so no graves are made in the
//     dungeon, and the exception let tools that break extra blocks damage
//     the building.)
//
//  2. Mobs. The only mobs in the Nether are ones the pack spawns. Anything
//     the pack spawns goes through spawnDungeonMob(), which tags it
//     DUNGEON_MOB_TAG. Any other mob in the Nether, from any pack or
//     namespace, is removed outright (no death event, no drops) when it
//     spawns, when it loads with a chunk, and by a sweep. Non-mob entities
//     (items, projectiles, XP orbs) are left alone.
//
//  Neither rule is gated by the season:toggle pause: they protect the
//  dungeon rather than being season restrictions.
//
//  Operator status comes from a tag for now: @minecraft/server only exposes
//  real operator status (Player.playerPermissionLevel) from 2.1.0, and this
//  pack is on 1.14.0. Tag yourself once with:
//    /tag @s add season:operator
// ─────────────────────────────────────────────

export const OPERATOR_TAG = "season:operator";
export const DUNGEON_MOB_TAG = "season:dungeon_mob";

const NETHER_ID = "minecraft:nether";
const GAME_MODE_SWEEP_TICKS = 20; // 1 second
const MOB_SWEEP_TICKS = 60; // 3 seconds

export function isOperator(player) {
  return player.hasTag(OPERATOR_TAG);
}

// ── Game mode ───────────────────────────────

function enforceGameMode(player) {
  if (!player.isValid() || isOperator(player)) return;
  const wanted = player.dimension.id === NETHER_ID ? GameMode.adventure : GameMode.survival;
  if (player.getGameMode() !== wanted) player.setGameMode(wanted);
}

// In the Nether, non-operators can't break anything (covers the moment
// after arriving, before adventure mode is applied).
world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (event.player.dimension.id !== NETHER_ID || isOperator(event.player)) return;
  event.cancel = true;
});

// Deferred a tick: the player's dimension and game mode can still be
// settling at the moment these events fire.
world.afterEvents.playerDimensionChange.subscribe(({ player }) => {
  system.run(() => enforceGameMode(player));
});

world.afterEvents.playerSpawn.subscribe(({ player }) => {
  system.run(() => enforceGameMode(player));
});

system.runInterval(() => {
  for (const player of world.getAllPlayers()) enforceGameMode(player);
}, GAME_MODE_SWEEP_TICKS);

// ── Mobs ────────────────────────────────────

// The only way the pack should put a mob in the Nether. The tag is added
// straight away, before any after-event for the spawn is delivered.
// Mobs with a season:become_dungeon_mob event (entities/pillager.json,
// piglin.json, piglin_brute.json) join the season_dungeon family: they take
// no damage from each other and never retaliate against each other, so a
// stray crossbow bolt can't start infighting. They also don't despawn.
// They also target players out to 48 blocks (see below).
const DUNGEON_MOB_EVENT = "season:become_dungeon_mob";
const HAS_DUNGEON_EVENT = new Set(["minecraft:pillager", "minecraft:piglin", "minecraft:piglin_brute"]);

export function spawnDungeonMob(dimension, typeId, location) {
  const mob = dimension.spawnEntity(typeId, location);
  mob.addTag(DUNGEON_MOB_TAG);
  if (HAS_DUNGEON_EVENT.has(typeId)) mob.triggerEvent(DUNGEON_MOB_EVENT);
  return mob;
}

// The dungeon group also makes them look for players out to 48 blocks
// without needing line of sight (vanilla: 12-16, line of sight), so they
// come and find the party. Piglins' own events re-add their vanilla
// targeting group (e.g. on calming down), which would take over again, so
// the dungeon group is re-applied every 10 seconds.
const REAPPLY_TICKS = 200;
system.runInterval(() => {
  const nether = world.getDimension(NETHER_ID);
  for (const mob of nether.getEntities({ tags: [DUNGEON_MOB_TAG] })) {
    if (!HAS_DUNGEON_EVENT.has(mob.typeId)) continue;
    try {
      mob.triggerEvent(DUNGEON_MOB_EVENT);
    } catch {
      // not loaded / gone: skip
    }
  }
}, REAPPLY_TICKS);

function isMob(entity) {
  if (entity.typeId === "minecraft:player") return false;
  const families = entity.getComponent("minecraft:type_family");
  if (!families) return false;
  return families.hasTypeFamily("mob") || families.hasTypeFamily("monster");
}

// Removals are batched by type and reported once a second, so a burst of
// spawns is one line rather than dozens. Only when switched on (off by
// default, saved with the world): written to the content log and sent to
// operators' chat. Removal itself always happens.
//   /scriptevent season:nether_mob_removal_log on|off
const REMOVAL_REPORT_TICKS = 20; // 1 second
// Property name kept from when the switch covered chat only, so a saved
// setting carries over.
const MOB_REMOVAL_LOG_PROPERTY = "season:nether_mob_removal_log_chat";
const pendingRemovals = new Map();

function mobRemovalLogOn() {
  return world.getDynamicProperty(MOB_REMOVAL_LOG_PROPERTY) === true;
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:nether_mob_removal_log") return;
  const arg = event.message.trim().toLowerCase();
  if (arg === "on" || arg === "off") world.setDynamicProperty(MOB_REMOVAL_LOG_PROPERTY, arg === "on");
  const reply = `§6Nether mob removal log: ${mobRemovalLogOn() ? "on" : "off"}.`;
  const source = event.sourceEntity;
  if (source?.typeId === "minecraft:player") source.sendMessage(reply);
  else console.warn(reply);
});

function removeIfUnwanted(entity) {
  if (!entity.isValid()) return;
  if (entity.dimension.id !== NETHER_ID) return;
  if (entity.hasTag(DUNGEON_MOB_TAG)) return;
  if (!isMob(entity)) return;
  const { x, y, z } = entity.location;
  const where = `${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}`;
  const entry = pendingRemovals.get(entity.typeId) ?? { count: 0, where };
  entry.count++;
  entry.where = where;
  pendingRemovals.set(entity.typeId, entry);
  entity.remove();
}

system.runInterval(() => {
  if (pendingRemovals.size === 0) return;
  const parts = [...pendingRemovals].map(([type, { count, where }]) => `${count}× ${type} (last at ${where})`);
  pendingRemovals.clear();
  if (!mobRemovalLogOn()) return;
  const message = `[Nether] removed ${parts.join(", ")}`;
  console.warn(message);
  for (const player of world.getAllPlayers()) {
    if (isOperator(player)) player.sendMessage(`§8${message}`);
  }
}, REMOVAL_REPORT_TICKS);

world.afterEvents.entitySpawn.subscribe(({ entity }) => removeIfUnwanted(entity));
world.afterEvents.entityLoad.subscribe(({ entity }) => removeIfUnwanted(entity));

system.runInterval(() => {
  const nether = world.getDimension(NETHER_ID);
  for (const entity of nether.getEntities({ excludeTypes: ["minecraft:player"], excludeTags: [DUNGEON_MOB_TAG] })) {
    removeIfUnwanted(entity);
  }
}, MOB_SWEEP_TICKS);

// ── Debug ───────────────────────────────────
//   /scriptevent season:entities
// Lists every entity type within 16 blocks of whoever runs it, with
// counts, marking dungeon-tagged ones — e.g. to find out what a gravestone
// is. /scriptevent already needs operator permission to run.

const ENTITY_LIST_RADIUS = 16;

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:entities") return;
  const source = event.sourceEntity;
  if (!source || source.typeId !== "minecraft:player") return;
  const counts = new Map();
  for (const entity of source.dimension.getEntities({ location: source.location, maxDistance: ENTITY_LIST_RADIUS })) {
    if (entity.id === source.id) continue;
    const key = entity.typeId + (entity.hasTag(DUNGEON_MOB_TAG) ? " (dungeon)" : "") + (isMob(entity) ? "" : " (not a mob)");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) {
    source.sendMessage(`§7No entities within ${ENTITY_LIST_RADIUS} blocks.`);
    return;
  }
  const lines = [...counts].sort((a, b) => b[1] - a[1]).map(([type, n]) => `§7 ${n}× §f${type}`);
  source.sendMessage(`§6Entities within ${ENTITY_LIST_RADIUS} blocks (${source.dimension.id}):\n${lines.join("\n")}`);
});
