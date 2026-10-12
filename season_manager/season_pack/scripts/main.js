import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";

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

// Every currently-banned item except diamond tools/weapon/armor ends up
// here now, on top of whatever recipe lock also exists for it (see
// recipes/) — a trial chambers run turned up a loose hopper, proving a
// recipe lock alone doesn't stop something found rather than crafted.
// elytra has no vanilla recipe at all, so this is its only restriction.
// dispenser, dropper, sticky_piston, and piston went further: their
// recipe lock files were removed entirely, since dropper/sticky_piston/
// piston stopped showing up in the survival recipe book for reasons that
// were never fully root-caused — this is their only restriction now.
// heart_of_the_sea is still deliberately NOT here — it's inert on its
// own, and the conduit recipe lock (plus this list, now) already
// controls the only thing it's good for. Anvil (and its chipped/damaged
// wear states) is also deliberately NOT here anymore — not because The
// Forge Reopens milestone was reached (it hasn't been), but because the
// group directly voted to allow anvils back, specifically for renaming
// items with nametags.
const CLEANUP_ITEMS = [
  "elytra",
  "dispenser",
  "dropper",
  "sticky_piston",
  "piston",
  "conduit",
  "hopper",
  "hopper_minecart",
  "crafter",
  "observer",
  "blaze_powder",
  "enchanting_table",
  "comparator",
  "repeater",
  "daylight_detector",
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
const ELITE_MOB_EFFECT_DURATION_TICKS = 600; // 30 seconds — wide margin over the interval so a server lag spike (e.g. a busy mob farm slowing tick processing) can't let this lapse before the next re-application fires

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

// ─────────────────────────────────────────────
//  ELITE ZOMBIE ENCOUNTER SCALING
//  Two additions on top of the base 12-guard ring from
//  summon_elite_zombie.mcfunction, aimed at the "too easy with a full
//  group" feedback without the opening fight itself growing past what
//  12 guards already felt like to deal with at once:
//
//  1. Reinforcement waves, every ELITE_ZOMBIE_REINFORCEMENT_INTERVAL_TICKS
//     (45 seconds) — a still-alive elite zombie counts players within
//     ELITE_ZOMBIE_REINFORCEMENT_RADIUS_BLOCKS and spawns
//     ELITE_ZOMBIE_REINFORCEMENT_GUARDS_PER_PLAYER guards per player
//     beyond the first, capped at ELITE_ZOMBIE_MAX_GUARDS_PER_WAVE (12)
//     regardless of how many players are actually there. So the fight
//     stays a flat 12 at the start no matter the group size, and only
//     grows from there the longer it's left running.
//
//  2. Enrage at half health — the watchdog below checks each elite
//     zombie's current health against its max every pass. The first
//     time it drops to half or below, it gets a one-time permanent
//     Strength III/Speed II buff (on top of its usual Strength II
//     stack), a chat announcement, and immediately triggers the exact
//     same reinforcement-wave formula as #1 above — then resets that
//     45-second timer, so a wave that just landed from the enrage
//     trigger doesn't get another one stacked right on top of it moments
//     later. `season:elite_zombie_enraged` marks it as already triggered
//     so the buff/announcement can't repeat, though reinforcement waves
//     keep coming on their normal timer afterward.
//
//  Since the boss never despawns on its own (see the FARM ANIMAL
//  POPULATION CAP header below for what "never despawn" costs on
//  Bedrock's mob budget — the same kind of concern applies here, just
//  from one encounter instead of a farm), reinforcement waves aren't
//  allowed to keep coming forever. The budget is a count of *waves*,
//  not a count of guards — capping by guard count instead would mean a
//  solo or two-player fight (where each wave is small, since the
//  formula is player-count-driven) could rack up dozens of separate
//  wave events before hitting the same numeric ceiling a full group
//  would reach in a handful, which is a lot of repeated interruptions
//  even though the total mob count stayed reasonable. Every elite
//  zombie carries a dynamic property
//  (ELITE_ZOMBIE_REINFORCEMENT_WAVE_COUNT_PROPERTY) tracking how many
//  waves have fired in the *current phase*, capped at
//  ELITE_ZOMBIE_MAX_REINFORCEMENT_WAVES (5) regardless of group size.
//  If the pre-enrage phase runs long enough to use up all 5 on its own
//  (players struggling to bring the boss down), reinforcements simply
//  stop until enrage actually happens — at which point this counter
//  resets to 0, buying a full fresh 5 waves for the enraged half of the
//  fight. The enrage buff and chat announcement always happen
//  regardless of budget; only the extra guards are ever affected by it.
//
//  Reinforcement guards go through the exact same setup as the
//  mcfunction's own 12 (tag, armor, effects, the custom
//  become_elite_guard_* event) via spawnEliteGuard below, so they're
//  indistinguishable from the original ring — same despawn protection,
//  same friendly-fire immunity, same stats.
// ─────────────────────────────────────────────

const ELITE_GUARD_SPAWN_HEIGHT_OFFSET_BLOCKS = 8; // spawn high and let Slow Falling bring them down, so hilly/uneven ground near the boss can't land one partially embedded in a slope

function spawnEliteGuard(overworld, center, angleRadians, radiusBlocks, type) {
  const position = {
    x: center.x + radiusBlocks * Math.cos(angleRadians),
    y: center.y + ELITE_GUARD_SPAWN_HEIGHT_OFFSET_BLOCKS,
    z: center.z + radiusBlocks * Math.sin(angleRadians),
  };

  const guard = overworld.spawnEntity(type, position);
  guard.addTag("season:elite_guard");
  guard.addEffect("strength", 1000000, { amplifier: 0, showParticles: false });
  guard.addEffect("speed", 1000000, { amplifier: 0, showParticles: false });
  guard.addEffect("slow_falling", 600, { amplifier: 0, showParticles: false });

  const equippable = guard.getComponent("minecraft:equippable");
  if (equippable) equippable.setEquipment(EquipmentSlot.Head, new ItemStack("minecraft:iron_helmet"));

  guard.triggerEvent(type === "minecraft:zombie" ? "season:become_elite_guard_zombie" : "season:become_elite_guard_skeleton");
  return guard;
}

function spawnEliteGuardRing(overworld, center, count, radiusBlocks) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    const type = i % 2 === 0 ? "minecraft:zombie" : "minecraft:skeleton";
    spawnEliteGuard(overworld, center, angle, radiusBlocks, type);
  }
}

const ELITE_ZOMBIE_REINFORCEMENT_WAVE_COUNT_PROPERTY = "season:reinforcement_wave_count";
const ELITE_ZOMBIE_MAX_REINFORCEMENT_WAVES = 5; // per phase (pre-enrage, then again post-enrage) — a wave count, not a guard count, see the header comment above for why

function getEliteZombieReinforcementWaveCount(eliteZombie) {
  return eliteZombie.getDynamicProperty(ELITE_ZOMBIE_REINFORCEMENT_WAVE_COUNT_PROPERTY) ?? 0;
}

// summon_elite_zombie.mcfunction tags the freshly-summoned boss with
// season:elite_zombie_needs_scaling alongside season:elite_zombie,
// purely so this can find it without relying on event.sourceEntity —
// that's only populated when a scriptevent is triggered from NPC
// dialogue, undefined for a command run by a player or a function,
// which this always is. No reinforcements spawn here — this just starts
// the reinforcement timer so the periodic watchdog below knows this
// boss is ready to be checked.
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:elite_zombie_spawned") return;

  const overworld = world.getDimension("overworld");
  const freshlySpawned = overworld.getEntities({
    type: "minecraft:zombie",
    tags: ["season:elite_zombie_needs_scaling"],
  });

  for (const eliteZombie of freshlySpawned) {
    eliteZombie.removeTag("season:elite_zombie_needs_scaling");
    eliteZombie.setDynamicProperty(ELITE_ZOMBIE_LAST_REINFORCEMENT_TICK_PROPERTY, system.currentTick);
  }
});

const ELITE_ZOMBIE_REINFORCEMENT_RADIUS_BLOCKS = 50; // matches the Elite Zombie's own aggro/follow range
const ELITE_ZOMBIE_REINFORCEMENT_RING_RADIUS_BLOCKS = 8; // lands right on top of the ongoing fight, not out at the opening ring's distance
const ELITE_ZOMBIE_REINFORCEMENT_GUARDS_PER_PLAYER = 2; // same formula whether this wave was triggered by the 45-second timer or by enrage
const ELITE_ZOMBIE_MAX_GUARDS_PER_WAVE = 12; // no single reinforcement wave can ever exceed this, regardless of player count — the opening 12 already felt like a lot at once, and no later wave should dump a bigger pile than that in one go
const ELITE_ZOMBIE_LAST_REINFORCEMENT_TICK_PROPERTY = "season:last_reinforcement_tick";
const ELITE_ZOMBIE_REINFORCEMENT_INTERVAL_TICKS = 900; // 45 seconds

// Every call announces itself, including the ones that spawn nothing, so a
// quiet fight never leaves players wondering whether reinforcements broke.
// The "spent" line only prints once, on the wave that uses up the budget —
// the timer watchdog keeps calling in here every 45 seconds after that, and
// a repeat line each time would just be spam.
function spawnReinforcementWave(overworld, eliteZombie) {
  const waveCount = getEliteZombieReinforcementWaveCount(eliteZombie);
  if (waveCount >= ELITE_ZOMBIE_MAX_REINFORCEMENT_WAVES) return; // this phase's 5 waves are already spent

  eliteZombie.setDynamicProperty(ELITE_ZOMBIE_LAST_REINFORCEMENT_TICK_PROPERTY, system.currentTick);
  world.sendMessage("§6The Elite Zombie calls for reinforcements...");

  const nearbyPlayerCount = overworld.getPlayers({
    location: eliteZombie.location,
    maxDistance: ELITE_ZOMBIE_REINFORCEMENT_RADIUS_BLOCKS,
  }).length;

  const extraPlayers = Math.max(0, nearbyPlayerCount - 1);
  const guardCount = Math.min(extraPlayers * ELITE_ZOMBIE_REINFORCEMENT_GUARDS_PER_PLAYER, ELITE_ZOMBIE_MAX_GUARDS_PER_WAVE);
  if (guardCount === 0) {
    // Nobody nearby to scale for — don't spend a wave on an empty spawn.
    world.sendMessage(
      `§7...but none answer. Reinforcements only come when 2 or more players are within ${ELITE_ZOMBIE_REINFORCEMENT_RADIUS_BLOCKS} blocks (${nearbyPlayerCount} now).`
    );
    return;
  }

  eliteZombie.setDynamicProperty(ELITE_ZOMBIE_REINFORCEMENT_WAVE_COUNT_PROPERTY, waveCount + 1);
  spawnEliteGuardRing(overworld, eliteZombie.location, guardCount, ELITE_ZOMBIE_REINFORCEMENT_RING_RADIUS_BLOCKS);
  world.sendMessage(`§6Reinforcements arrive — the Elite Zombie's escort grows by ${guardCount}.`);
  if (waveCount + 1 >= ELITE_ZOMBIE_MAX_REINFORCEMENT_WAVES) {
    world.sendMessage(
      eliteZombie.hasTag(ELITE_ZOMBIE_ENRAGE_TAG)
        ? "§7That was the last wave — no more reinforcements are coming."
        : "§7That was the last wave until the Elite Zombie is enraged."
    );
  }
}

const ELITE_ZOMBIE_ENRAGE_TAG = "season:elite_zombie_enraged";
const ELITE_ZOMBIE_ENRAGE_HEALTH_FRACTION = 0.5;

system.runInterval(() => {
  const overworld = world.getDimension("overworld");
  for (const mob of overworld.getEntities({ type: "minecraft:zombie", tags: ["season:elite_zombie"] })) {
    if (mob.hasTag(ELITE_ZOMBIE_ENRAGE_TAG)) continue;

    const health = mob.getComponent("minecraft:health");
    if (!health || health.currentValue > health.effectiveMax * ELITE_ZOMBIE_ENRAGE_HEALTH_FRACTION) continue;

    mob.addTag(ELITE_ZOMBIE_ENRAGE_TAG);
    mob.addEffect("strength", ELITE_MOB_EFFECT_DURATION_TICKS, { amplifier: 2, showParticles: false });
    mob.addEffect("speed", ELITE_MOB_EFFECT_DURATION_TICKS, { amplifier: 1, showParticles: false });
    world.sendMessage("§cThe Elite Zombie lets out a guttural roar!");
    // A fresh 5-wave budget for the enraged half of the fight — if the
    // pre-enrage phase already used up all 5 (players struggling to
    // bring it down), reinforcements don't stay capped out forever;
    // enrage always buys another full round of them.
    mob.setDynamicProperty(ELITE_ZOMBIE_REINFORCEMENT_WAVE_COUNT_PROPERTY, 0);
    spawnReinforcementWave(overworld, mob);
  }
}, ELITE_MOB_INTERVAL_TICKS);

system.runInterval(() => {
  const overworld = world.getDimension("overworld");
  for (const mob of overworld.getEntities({ type: "minecraft:zombie", tags: ["season:elite_zombie"] })) {
    const lastTick = mob.getDynamicProperty(ELITE_ZOMBIE_LAST_REINFORCEMENT_TICK_PROPERTY);
    if (lastTick === undefined) continue; // not finished spawning in yet — the scriptevent handler above hasn't run
    if (lastTick > system.currentTick) {
      // system.currentTick restarts at 0 every server session, but the
      // stored tick survives on the boss — without this, a boss that
      // outlives a restart would wait until the new session's tick count
      // caught up to the old one before its next wave.
      mob.setDynamicProperty(ELITE_ZOMBIE_LAST_REINFORCEMENT_TICK_PROPERTY, system.currentTick);
      continue;
    }
    if (system.currentTick - lastTick < ELITE_ZOMBIE_REINFORCEMENT_INTERVAL_TICKS) continue;

    spawnReinforcementWave(overworld, mob);
  }
}, ELITE_MOB_INTERVAL_TICKS);

// ─────────────────────────────────────────────
//  LEATHER ARMOR SPEED BONUS
//  Leather armor is crafted from Rabbit Hide now (see recipes/) — 2 or 3
//  pieces worn grants Speed I, a full 4-piece set grants Speed II
//  instead (not stacked on top of Speed I). Effects expire on their own,
//  so this re-applies on an interval, same pattern as ELITE_MOBS.
// ─────────────────────────────────────────────

const LEATHER_ARMOR_SLOTS = [
  { slot: EquipmentSlot.Head, item: "minecraft:leather_helmet" },
  { slot: EquipmentSlot.Chest, item: "minecraft:leather_chestplate" },
  { slot: EquipmentSlot.Legs, item: "minecraft:leather_leggings" },
  { slot: EquipmentSlot.Feet, item: "minecraft:leather_boots" },
];

const LEATHER_SPEED_INTERVAL_TICKS = 100; // 5 seconds
const LEATHER_SPEED_EFFECT_DURATION_TICKS = 600; // 30 seconds — wide margin over the interval so a server lag spike (e.g. a busy mob farm slowing tick processing) can't let this lapse before the next re-application fires

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const equippable = player.getComponent("minecraft:equippable");
    if (!equippable) continue;

    let piecesWorn = 0;
    for (const { slot, item } of LEATHER_ARMOR_SLOTS) {
      if (equippable.getEquipment(slot)?.typeId === item) piecesWorn++;
    }

    if (piecesWorn >= 4) {
      player.addEffect("speed", LEATHER_SPEED_EFFECT_DURATION_TICKS, { amplifier: 1, showParticles: false });
    } else if (piecesWorn >= 2) {
      player.addEffect("speed", LEATHER_SPEED_EFFECT_DURATION_TICKS, { amplifier: 0, showParticles: false });
    }
  }
}, LEATHER_SPEED_INTERVAL_TICKS);

// ─────────────────────────────────────────────
//  CHAINMAIL ARMOR HASTE BONUS
//  Same pattern as the Leather Armor Speed Bonus above, just Chainmail
//  and Haste instead of Leather and Speed — 2 or 3 pieces worn grants
//  Haste I, a full 4-piece set grants Haste II instead (not stacked on
//  top of Haste I).
// ─────────────────────────────────────────────

const CHAINMAIL_ARMOR_SLOTS = [
  { slot: EquipmentSlot.Head, item: "minecraft:chainmail_helmet" },
  { slot: EquipmentSlot.Chest, item: "minecraft:chainmail_chestplate" },
  { slot: EquipmentSlot.Legs, item: "minecraft:chainmail_leggings" },
  { slot: EquipmentSlot.Feet, item: "minecraft:chainmail_boots" },
];

const CHAINMAIL_HASTE_INTERVAL_TICKS = 100; // 5 seconds
const CHAINMAIL_HASTE_EFFECT_DURATION_TICKS = 600; // 30 seconds — wide margin over the interval so a server lag spike (e.g. a busy mob farm slowing tick processing) can't let this lapse before the next re-application fires

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const equippable = player.getComponent("minecraft:equippable");
    if (!equippable) continue;

    let piecesWorn = 0;
    for (const { slot, item } of CHAINMAIL_ARMOR_SLOTS) {
      if (equippable.getEquipment(slot)?.typeId === item) piecesWorn++;
    }

    if (piecesWorn >= 4) {
      player.addEffect("haste", CHAINMAIL_HASTE_EFFECT_DURATION_TICKS, { amplifier: 1, showParticles: false });
    } else if (piecesWorn >= 2) {
      player.addEffect("haste", CHAINMAIL_HASTE_EFFECT_DURATION_TICKS, { amplifier: 0, showParticles: false });
    }
  }
}, CHAINMAIL_HASTE_INTERVAL_TICKS);

// ─────────────────────────────────────────────
//  COPPER ARMOR REGENERATION BONUS
//  Same two-tier shape as the Leather/Chainmail bonuses above: 2 or 3
//  Copper armor pieces grants Regeneration I, and a full 4-piece set
//  grants Regeneration II instead (not stacked on top of
//  Regeneration I).
//
//  Regeneration's actual healing tick is paced by the effect's
//  amplifier (every 50 ticks at amplifier 0, every 25 at amplifier 1),
//  not by how much duration is left on it — but re-applying it on too
//  tight a loop can still starve it in practice, because the moment a
//  fresh instance is (re)applied, that internal heal cycle restarts
//  from 0. If a refresh happened every tick, the cycle would never
//  reach tick 25/50 and the player would never actually heal. This
//  re-applies every 100 ticks (5 seconds) — the same cadence as
//  Speed/Haste above — which is coarser than either heal cycle, so each
//  5-second window has room for at least one heal to fire before the
//  next refresh restarts it. A long 30-second duration (vs. the
//  5-second recheck) is still used for the same lag-spike margin as the
//  other bonuses, not because it's required for healing to work.
// ─────────────────────────────────────────────

const COPPER_ARMOR_SLOTS = [
  { slot: EquipmentSlot.Head, item: "minecraft:copper_helmet" },
  { slot: EquipmentSlot.Chest, item: "minecraft:copper_chestplate" },
  { slot: EquipmentSlot.Legs, item: "minecraft:copper_leggings" },
  { slot: EquipmentSlot.Feet, item: "minecraft:copper_boots" },
];

const COPPER_REGEN_INTERVAL_TICKS = 100; // 5 seconds
const COPPER_REGEN_EFFECT_DURATION_TICKS = 600; // 30 seconds — see header comment for why this margin doesn't fight the healing cycle

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const equippable = player.getComponent("minecraft:equippable");
    if (!equippable) continue;

    let piecesWorn = 0;
    for (const { slot, item } of COPPER_ARMOR_SLOTS) {
      if (equippable.getEquipment(slot)?.typeId === item) piecesWorn++;
    }

    if (piecesWorn >= 4) {
      player.addEffect("regeneration", COPPER_REGEN_EFFECT_DURATION_TICKS, { amplifier: 1, showParticles: false });
    } else if (piecesWorn >= 2) {
      player.addEffect("regeneration", COPPER_REGEN_EFFECT_DURATION_TICKS, { amplifier: 0, showParticles: false });
    }
  }
}, COPPER_REGEN_INTERVAL_TICKS);

// ─────────────────────────────────────────────
//  CAVE COMBO: NIGHT VISION
//  A fifth, cross-material bonus layered on top of the single-material
//  ones above: Copper Helmet + full Chainmail body (Chestplate/
//  Leggings/Boots) + a waxed Copper Lantern carried anywhere in the
//  hotbar + below a configurable Y level grants Night Vision. The 3
//  Chainmail pieces still grant Haste I on their own via the watchdog
//  above (2-3 pieces = Haste I) — this doesn't touch that. A lone
//  Copper Helmet is below Copper's own 2-piece threshold, so it grants
//  nothing by itself; the combo only adds Night Vision on top once
//  every condition is met at once.
//
//  Conditions stop being met → this simply stops re-applying and lets
//  the existing Night Vision run out on its own. It deliberately never
//  calls removeEffect("night_vision"), since that would also strip
//  Night Vision from an actual potion the player drank independently of
//  this combo.
//
//  Each application is a 30-second duration (comfortably over the
//  15-second floor — Night Vision's screen fades/flickers under about
//  10 seconds left, so staying well clear of that matters), refreshed
//  every 5 seconds, same cadence as the other bonuses.
// ─────────────────────────────────────────────

const CAVE_COMBO_HELMET_ITEM = "minecraft:copper_helmet";
const CAVE_COMBO_CHEST_ITEM = "minecraft:chainmail_chestplate";
const CAVE_COMBO_LEGS_ITEM = "minecraft:chainmail_leggings";
const CAVE_COMBO_BOOTS_ITEM = "minecraft:chainmail_boots";

// All 4 waxed Copper Lantern oxidation stages — verified against the
// current Bedrock item ID list (see README for how that was checked
// elsewhere in this pack). Unwaxed lanterns don't count.
const CAVE_COMBO_WAXED_LANTERN_ITEMS = [
  "minecraft:waxed_copper_lantern",
  "minecraft:waxed_exposed_copper_lantern",
  "minecraft:waxed_weathered_copper_lantern",
  "minecraft:waxed_oxidized_copper_lantern",
];

const CAVE_COMBO_MAX_Y = 40; // "below Y=40" — change this one line to retune the threshold

const CAVE_COMBO_INTERVAL_TICKS = 100; // 5 seconds
const CAVE_COMBO_EFFECT_DURATION_TICKS = 600; // 30 seconds — well over the 15-second floor noted above

function hasWaxedCopperLanternInHotbar(player) {
  const inventory = player.getComponent("minecraft:inventory");
  const container = inventory?.container;
  if (!container) return false;

  for (let slot = 0; slot < 9; slot++) {
    const item = container.getItem(slot);
    if (item && CAVE_COMBO_WAXED_LANTERN_ITEMS.includes(item.typeId)) return true;
  }
  return false;
}

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const equippable = player.getComponent("minecraft:equippable");
    if (!equippable) continue;

    const wearingComboArmor =
      equippable.getEquipment(EquipmentSlot.Head)?.typeId === CAVE_COMBO_HELMET_ITEM &&
      equippable.getEquipment(EquipmentSlot.Chest)?.typeId === CAVE_COMBO_CHEST_ITEM &&
      equippable.getEquipment(EquipmentSlot.Legs)?.typeId === CAVE_COMBO_LEGS_ITEM &&
      equippable.getEquipment(EquipmentSlot.Feet)?.typeId === CAVE_COMBO_BOOTS_ITEM;

    if (!wearingComboArmor) continue;
    if (player.location.y >= CAVE_COMBO_MAX_Y) continue;
    if (!hasWaxedCopperLanternInHotbar(player)) continue;

    player.addEffect("night_vision", CAVE_COMBO_EFFECT_DURATION_TICKS, { amplifier: 0, showParticles: false });
  }
}, CAVE_COMBO_INTERVAL_TICKS);

// ─────────────────────────────────────────────
//  FARM ANIMAL POPULATION CAP
//  Bedrock's global mob cap is a flat 200 mobs world-wide; once that's
//  hit, natural spawning of everything (zombies, skeletons, wildlife)
//  stops dead everywhere. Unattended breeding pens are the usual
//  culprit — Pigs, Chickens, Cows, and Sheep breed exponentially if fed
//  and never thinned out. This keeps their combined total under a cap
//  by despawning the surplus.
//
//  Uses .remove() rather than .kill() specifically so this can't be
//  exploited as a free meat/wool farm (no death event, no loot drop, no
//  XP). Each despawn comes from whichever of the 4 species currently
//  has the most individuals loaded, recomputed after every removal —
//  not a flat random pick across all of them combined. That matters for
//  lopsided farms: 200 Sheep and 2 Cows should only ever cost Sheep,
//  since Cows never become the largest group. A purely random pick
//  across the combined pool would instead cull proportionally and could
//  easily wipe out the 2 Cows just from bad luck. Babies and the
//  Sheep-color preference (see pickCullTarget) are tie-breakers *within*
//  whichever species gets picked, not a global override of this rule.
//
//  Named animals (a Name Tag applied) are absolutely protected — never
//  a cull candidate, full stop, regardless of species count or any
//  other factor. They still count toward the 160 total (they're still
//  real entities eating into Bedrock's mob budget), but "largest
//  species" and all cull selection only ever look at unnamed animals,
//  so a named individual can never be the one removed. If every
//  remaining animal over the cap happens to be named, the watchdog just
//  stops for that pass rather than touching a protected one.
// ─────────────────────────────────────────────

const FARM_ANIMAL_TYPES = ["minecraft:pig", "minecraft:chicken", "minecraft:cow", "minecraft:sheep"];

// Singular/plural names for the despawn message, one line per species.
const FARM_ANIMAL_NAMES = {
  "minecraft:pig": ["pig", "pigs"],
  "minecraft:chicken": ["chicken", "chickens"],
  "minecraft:cow": ["cow", "cows"],
  "minecraft:sheep": ["sheep", "sheep"],
};

const FARM_ANIMAL_CAP = 160;
const FARM_ANIMAL_INTERVAL_TICKS = 100; // 5 seconds

const UNDYED_SHEEP_CULL_WEIGHT = 3;
const DEFAULT_CULL_WEIGHT = 1;

function isBabyAnimal(animal) {
  return animal.getComponent("minecraft:is_baby") !== undefined;
}

function isNamed(animal) {
  return !!animal.nameTag;
}

function isUndyedSheep(animal) {
  if (animal.typeId !== "minecraft:sheep") return false;
  const color = animal.getComponent("minecraft:color");
  return !color || color.value === 0; // 0 = white, vanilla's default undyed color
}

function pickWeighted(animals) {
  const weights = animals.map((animal) => (isUndyedSheep(animal) ? UNDYED_SHEEP_CULL_WEIGHT : DEFAULT_CULL_WEIGHT));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < animals.length; i++) {
    roll -= weights[i];
    if (roll < 0) return animals[i];
  }
  return animals[animals.length - 1]; // floating-point fallback
}

// Finds the species with the most CULLABLE (unnamed) individuals
// currently loaded — not total individuals, so a species that's mostly
// named animals doesn't get targeted just because its total count is
// high when there's nothing left in it this function is allowed to
// touch — then picks which one of that species to despawn: every baby
// of that species goes before any adult of it (babies are usually a
// small slice of the population at any moment, since they grow up in
// ~20 minutes, so anything less than an absolute rule barely reads as a
// priority in practice); once no babies are left, white/undyed Sheep
// are 3x more likely than other adults of that species, but not an
// absolute rule — an earlier version made that absolute too and it
// wiped out every white Sheep in one pass, since most naturally-spawned
// Sheep are undyed to begin with. Returns null if every type's
// cullable list is empty (everything left is named/protected).
function pickCullTarget(cullableByType) {
  let largestType = null;
  for (const type of FARM_ANIMAL_TYPES) {
    const list = cullableByType.get(type);
    if (list.length > 0 && (!largestType || list.length > cullableByType.get(largestType).length)) {
      largestType = type;
    }
  }
  if (!largestType) return null;

  const candidates = cullableByType.get(largestType);
  const babies = candidates.filter(isBabyAnimal);
  if (babies.length > 0) {
    return { type: largestType, target: babies[Math.floor(Math.random() * babies.length)] };
  }

  return { type: largestType, target: pickWeighted(candidates) };
}

system.runInterval(() => {
  const overworld = world.getDimension("overworld");
  const animalsByType = new Map(FARM_ANIMAL_TYPES.map((type) => [type, overworld.getEntities({ type })]));

  let total = 0;
  for (const list of animalsByType.values()) total += list.length;

  const cullableByType = new Map(
    FARM_ANIMAL_TYPES.map((type) => [type, animalsByType.get(type).filter((animal) => !isNamed(animal))])
  );

  const culledByType = new Map(FARM_ANIMAL_TYPES.map((type) => [type, 0]));
  while (total > FARM_ANIMAL_CAP) {
    const picked = pickCullTarget(cullableByType);
    if (!picked) break; // everything left over the cap is named/protected

    const { type, target } = picked;
    const list = cullableByType.get(type);
    list.splice(list.indexOf(target), 1);
    target.remove();
    culledByType.set(type, culledByType.get(type) + 1);
    total--;
  }

  for (const [type, count] of culledByType) {
    if (count === 0) continue;
    const [singular, plural] = FARM_ANIMAL_NAMES[type];
    world.sendMessage(`§e${count} ${count === 1 ? singular : plural} despawned (mob cap).`);
  }
}, FARM_ANIMAL_INTERVAL_TICKS);
