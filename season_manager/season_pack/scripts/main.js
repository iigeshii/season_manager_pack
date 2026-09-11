import { world, system } from "@minecraft/server";

// ─────────────────────────────────────────────
//  MESSAGES
//  Shared wording for anything this pack blocks. Phrased as temporary
//  ("currently disabled") rather than permanent, since these
//  restrictions are meant to be lifted piece by piece as the season
//  progresses.
// ─────────────────────────────────────────────

function currentlyDisabled(thing) {
  return `§cThis ${thing} is currently disabled.`;
}

// ─────────────────────────────────────────────
//  BUILD INFO
//  Stamped with the pack version (and, for console debugging, the short
//  git SHA it was built from) at package time — see scripts/build.sh.
//  Left as placeholders if loaded unstamped.
// ─────────────────────────────────────────────

const BUILD_VERSION = "__BUILD_VERSION__";
const BUILD_SHA = "__BUILD_SHA__";
const BUILD_INFO_TEXT = `Season Manager Loaded (v${BUILD_VERSION})`;

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  player.sendMessage(`§6${BUILD_INFO_TEXT}`);
});

system.run(() => {
  console.warn(`${BUILD_INFO_TEXT} sha:${BUILD_SHA}`);
});

// ─────────────────────────────────────────────
//  PACK TOGGLE
//  Pauses/resumes the cleanup sweep and banned-mob despawning without
//  needing to remove the pack. Trigger from a command block:
//    scriptevent season:toggle
// ─────────────────────────────────────────────

let enabled = true;

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:toggle") return;
  enabled = !enabled;
  world.sendMessage(`§6Season Manager ${enabled ? "resumed" : "paused"}.`);
});

// ─────────────────────────────────────────────
//  CLEANUP SEQUENCE
//  Runs automatically on an interval to keep banned items out of players'
//  hands — no command block or redstone clock needed.
//  Add more commands here to extend the sequence.
// ─────────────────────────────────────────────

// Both of these can turn up as loot/traps in the world (End ships,
// desert/jungle temples, trial chambers, etc.), bypassing any recipe lock
// entirely — so they're the only two still handled by destroy-on-pickup.
// Everything else that used to be here is now a recipe lock instead
// (see recipes/) so found/looted copies stay valid, only crafting is
// blocked. heart_of_the_sea was dropped too — it's inert on its own, and
// the conduit recipe lock already controls the only thing it's good for.
const CLEANUP_ITEMS = [
  "elytra",
  "dispenser",
];

const CLEANUP_INTERVAL_TICKS = 20; // 20 ticks = 1 second

function runCleanup() {
  if (!enabled) return;
  for (const player of world.getPlayers()) {
    for (const item of CLEANUP_ITEMS) {
      try {
        const result = player.runCommand(`clear @s ${item}`);
        if (result.successCount > 0) {
          player.sendMessage(currentlyDisabled(item.replace(/_/g, " ")));
        }
      } catch {
        // /clear throws when the player has none of that item — nothing to report
      }
    }
  }
}

system.runInterval(runCleanup, CLEANUP_INTERVAL_TICKS);

// Manual trigger, still handy for testing:
//   scriptevent season:cleanup
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:cleanup") return;
  runCleanup();
});

// ─────────────────────────────────────────────
//  BANNED MOBS
//  Despawns banned mobs the instant they spawn — natural or player-built.
//  entity.remove() deletes the entity outright rather than killing it, so
//  no death event fires and no loot drops.
// ─────────────────────────────────────────────

const BANNED_MOBS = new Set([
  "minecraft:iron_golem",
  "minecraft:piglin",
  "minecraft:piglin_brute",
]);

world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  if (!enabled) return;
  if (!BANNED_MOBS.has(entity.typeId)) return;
  entity.remove();
});

// ─────────────────────────────────────────────
//  PORTAL LOCK
//  Stops portals from being lit/activated rather than reacting after the
//  fact. Only blocks ignition — a ruined portal or bastion remnant that
//  already generates lit is unaffected.
// ─────────────────────────────────────────────

const PORTAL_IGNITERS = [
  { item: "minecraft:flint_and_steel", block: "minecraft:obsidian", label: "Nether portals" },
  // Bedrock-specific: pouring a lava bucket directly into a completed
  // obsidian frame ignites it too, same as flint and steel — Java has no
  // equivalent, so this is easy to miss.
  { item: "minecraft:lava_bucket", block: "minecraft:obsidian", label: "Nether portals" },
  // Fire charges thrown/used on the frame ignite it the same way, and are
  // the standard way to automate ignition with a dispenser (e.g. AFK farms).
  { item: "minecraft:fire_charge", block: "minecraft:obsidian", label: "Nether portals" },
  { item: "minecraft:ender_eye", block: "minecraft:end_portal_frame", label: "End portals" },
];

world.beforeEvents.itemUseOn.subscribe((event) => {
  if (!enabled) return;
  const match = PORTAL_IGNITERS.find(
    (p) => p.item === event.itemStack?.typeId && p.block === event.block.typeId
  );
  if (!match) return;
  event.cancel = true;
  event.source.sendMessage(`§c${match.label} are currently disabled.`);
});

// ─────────────────────────────────────────────
//  DIMENSION BOUNCE-BACK
//  Fallback for any way into a disabled dimension the portal lock doesn't
//  catch (pre-lit ruined portals, bastion remnants, etc.) — teleports the
//  player straight back to where they left from. The portal itself is left
//  standing (an earlier version tried to destroy it, but nether/end portals
//  resist being torn down piecemeal via script — see git history), so a
//  player who walks right back in gets bounced again.
//
//  A flat "second bounce sends you to spawn" backstop wasn't reliable
//  enough in practice — players got stuck cycling in and out of the portal
//  faster than it could catch. Instead, each consecutive bounce nudges the
//  return point 1 additional block away (2nd bounce = 2 blocks, 3rd = 3,
//  etc.), so a player standing right on the portal frame keeps landing
//  further clear of it until they're off it entirely. A hard cap still
//  sends them to world spawn if that somehow doesn't work after 10 tries.
// ─────────────────────────────────────────────

const DISABLED_DIMENSIONS = new Set(["minecraft:nether", "minecraft:the_end"]);
const BOUNCE_COOLDOWN_TICKS = 40; // 2 seconds
const BOUNCE_GIVE_UP_COUNT = 10;
const bounceCounts = new Map(); // player id -> consecutive bounce count

// world.getDefaultSpawnLocation()'s Y can be a bogus placeholder if the
// world spawn point was never explicitly set (seen returning ~32000) —
// its X/Z are fine, but find real ground instead of trusting its Y.
function findSurfaceNear(dimension, x, z) {
  for (let y = 319; y >= -64; y--) {
    const block = dimension.getBlock({ x, y, z });
    if (block && !block.isAir && block.typeId !== "minecraft:lava" && block.typeId !== "minecraft:flowing_lava") {
      return { x: x + 0.5, y: y + 1, z: z + 0.5 };
    }
  }
  return { x: x + 0.5, y: 100, z: z + 0.5 };
}

world.afterEvents.playerDimensionChange.subscribe((event) => {
  if (!enabled) return;
  const { player, toDimension, fromDimension, fromLocation } = event;
  if (!DISABLED_DIMENSIONS.has(toDimension.id)) return;

  const bounceCount = (bounceCounts.get(player.id) ?? 0) + 1;
  bounceCounts.set(player.id, bounceCount);
  system.runTimeout(() => bounceCounts.delete(player.id), BOUNCE_COOLDOWN_TICKS);

  system.run(() => {
    if (bounceCount > BOUNCE_GIVE_UP_COUNT) {
      const overworld = world.getDimension("overworld");
      const spawn = world.getDefaultSpawnLocation();
      player.teleport(findSurfaceNear(overworld, Math.floor(spawn.x), Math.floor(spawn.z)), { dimension: overworld });
      player.sendMessage(`${currentlyDisabled("dimension")} That portal isn't safe to return through — sent you to spawn instead.`);
      return;
    }

    const nudged = { x: fromLocation.x + bounceCount, y: fromLocation.y, z: fromLocation.z };
    player.teleport(nudged, { dimension: fromDimension });
    player.sendMessage(currentlyDisabled("dimension"));
  });
});

// ─────────────────────────────────────────────
//  RESCUE VILLAGERS
//  Villagers granted via /function season/summon_<name> get a permanent,
//  single-purpose profession (see entities/villager_v2.json) instead of
//  a normal one — tagged on summon so they can be found again here.
//  Vanilla's job-site claiming can still occasionally reassign a
//  villager that wanders near an unclaimed lectern/altar even with the
//  dweller.can_find_poi override in their component group, so this
//  periodically re-fires the profession event as a backstop. It's a
//  no-op if nothing actually changed, so it's cheap to run often.
//  Not gated by `enabled` — this protects an earned reward, it isn't a
//  season restriction.
// ─────────────────────────────────────────────

const RESCUE_VILLAGERS = [
  { tag: "season:rescue_mending_librarian", event: "season:become_mending_librarian" },
  { tag: "season:rescue_froglight_cleric", event: "season:become_froglight_cleric" },
];

const RESCUE_ENFORCE_INTERVAL_TICKS = 100; // 5 seconds

system.runInterval(() => {
  const overworld = world.getDimension("overworld");
  for (const { tag, event } of RESCUE_VILLAGERS) {
    for (const villager of overworld.getEntities({ type: "minecraft:villager_v2", tags: [tag] })) {
      villager.triggerEvent(event);
    }
  }
}, RESCUE_ENFORCE_INTERVAL_TICKS);

// ─────────────────────────────────────────────
//  ELITE MOBS
//  Standalone mini-bosses granted via /function season/summon_<name> — a
//  permanently tougher variant of a vanilla mob (see entities/zombie.json)
//  instead of the normal one, tagged on summon so they can be found again
//  here. Stat boosts (health/attack/equipment) live in the entity's
//  component group and don't need upkeep, but potion effects expire on
//  their own, so this periodically re-applies them well before that
//  happens. Not gated by `enabled` — this is a standalone encounter, not
//  a season restriction.
// ─────────────────────────────────────────────

const ELITE_MOBS = [
  {
    tag: "season:elite_zombie",
    type: "minecraft:zombie",
    effects: [
      { effect: "strength", amplifier: 1 },
      { effect: "resistance", amplifier: 0 },
      { effect: "fire_resistance", amplifier: 0 },
      { effect: "regeneration", amplifier: 0 },
    ],
  },
];

const ELITE_MOB_INTERVAL_TICKS = 100; // 5 seconds
const ELITE_MOB_EFFECT_DURATION_TICKS = 240; // 12 seconds — comfortably outlasts the interval

system.runInterval(() => {
  const overworld = world.getDimension("overworld");
  for (const { tag, type, effects } of ELITE_MOBS) {
    for (const mob of overworld.getEntities({ type, tags: [tag] })) {
      for (const { effect, amplifier } of effects) {
        mob.addEffect(effect, ELITE_MOB_EFFECT_DURATION_TICKS, { amplifier, showParticles: false });
      }
    }
  }
}, ELITE_MOB_INTERVAL_TICKS);
