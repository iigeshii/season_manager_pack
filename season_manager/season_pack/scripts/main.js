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
//  Stamped with the short git SHA at package time — see scripts/build.sh.
//  Left as a placeholder if loaded unstamped.
// ─────────────────────────────────────────────

const BUILD_SHA = "__BUILD_SHA__";
const BUILD_INFO_TEXT = `Season Manager Loaded (${BUILD_SHA})`;

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  player.sendMessage(`§6${BUILD_INFO_TEXT}`);
});

system.run(() => {
  console.warn(BUILD_INFO_TEXT);
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

const CLEANUP_ITEMS = [
  "elytra",
  "hopper",
  "hopper_minecart",
  "piston",
  "sticky_piston",
  "dispenser",
  "dropper",
  "observer",
  "slime",
  "honey_block",
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

const BANNED_MOBS = new Set(["minecraft:iron_golem"]);

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
//  The recently-bounced check is the backstop for that: a player who bounces
//  twice in a row (i.e. walked straight back into the same live portal) is
//  sent to world spawn instead of back onto it.
// ─────────────────────────────────────────────

const DISABLED_DIMENSIONS = new Set(["minecraft:nether", "minecraft:the_end"]);
const BOUNCE_COOLDOWN_TICKS = 40; // 2 seconds
const recentlyBounced = new Set();

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

  const looping = recentlyBounced.has(player.id);
  recentlyBounced.add(player.id);
  system.runTimeout(() => recentlyBounced.delete(player.id), BOUNCE_COOLDOWN_TICKS);

  system.run(() => {
    if (looping) {
      const overworld = world.getDimension("overworld");
      const spawn = world.getDefaultSpawnLocation();
      player.teleport(findSurfaceNear(overworld, Math.floor(spawn.x), Math.floor(spawn.z)), { dimension: overworld });
      player.sendMessage(`${currentlyDisabled("dimension")} That portal isn't safe to return through — sent you to spawn instead.`);
      return;
    }

    player.teleport(fromLocation, { dimension: fromDimension });
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
