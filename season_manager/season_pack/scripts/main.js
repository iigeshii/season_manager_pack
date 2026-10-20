import { world, system, EquipmentSlot } from "@minecraft/server";

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
//     (so a solo fight still gets 2), capped at ELITE_ZOMBIE_MAX_GUARDS_PER_WAVE (12)
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

  // The equippable component only exists on players in Bedrock, so on a
  // zombie/skeleton it comes back undefined — use the same replaceitem
  // command summon_elite_zombie.mcfunction gives the opening ring, or
  // these burn in daylight.
  guard.runCommand("replaceitem entity @s slot.armor.head 0 minecraft:iron_helmet");

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

// Every wave announces itself, so players can always see reinforcements
// coming. The "spent" line only prints once, on the wave that uses up the budget —
// the timer watchdog keeps calling in here every 45 seconds after that, and
// a repeat line each time would just be spam.
function spawnReinforcementWave(overworld, eliteZombie) {
  const waveCount = getEliteZombieReinforcementWaveCount(eliteZombie);
  if (waveCount >= ELITE_ZOMBIE_MAX_REINFORCEMENT_WAVES) return; // this phase's 5 waves are already spent

  eliteZombie.setDynamicProperty(ELITE_ZOMBIE_LAST_REINFORCEMENT_TICK_PROPERTY, system.currentTick);

  const nearbyPlayerCount = overworld.getPlayers({
    location: eliteZombie.location,
    maxDistance: ELITE_ZOMBIE_REINFORCEMENT_RADIUS_BLOCKS,
  }).length;

  const guardCount = Math.min(nearbyPlayerCount * ELITE_ZOMBIE_REINFORCEMENT_GUARDS_PER_PLAYER, ELITE_ZOMBIE_MAX_GUARDS_PER_WAVE);
  // Nobody nearby means nobody is fighting — stay silent rather than
  // broadcast to the whole server every 45 seconds, and don't spend a wave.
  if (guardCount === 0) return;

  world.sendMessage("§6The Elite Zombie calls for reinforcements...");
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

// ─────────────────────────────────────────────
//  SNIPER ROOST TOWERS
//  Scaffolding for the Skeleton Sniper mini-boss being designed (still
//  pre-build — HP, kiting, and the volley attack aren't written yet):
//  a scattered handful of lookout towers the boss can perch on and
//  teleport between when swarmed, built fresh around the fight's center
//  each time rather than requiring anyone to hand-place them.
//
//  Each tower is a solid 5x5 column rooted at the ground (via the same
//  findSurfaceNear helper the dimension-bounce logic above uses), random
//  height, topped with a 5x5 slab platform and a 3-tall fence post at
//  each of its four corners. One tower always lands centered exactly on
//  the fight's origin point; the rest scatter at random angles/distances
//  around it.
//
//  Blocks can't carry tags the way entities can (addTag/getTags only
//  exist on entities), so cleanup doesn't try to remember every placed
//  block. Instead spawnSniperTowers returns one small descriptor per
//  tower (its center X/Z, base Y, and height) — enough to recompute the
//  exact same fill regions and clear them back to air later. Whatever
//  eventually owns the fight (the boss entity itself, once built) should
//  store that descriptor list and hand it to despawnSniperTowers when
//  the fight ends.
// ─────────────────────────────────────────────

const SNIPER_TOWER_BODY_BLOCK = "minecraft:cobblestone";
const SNIPER_TOWER_SLAB_BLOCK = "minecraft:stone_slab";
const SNIPER_TOWER_FENCE_BLOCK = "minecraft:oak_fence";
const SNIPER_TOWER_FOOTPRINT_RADIUS = 2; // 2 blocks either side of center = 5x5
const SNIPER_TOWER_FENCE_HEIGHT_BLOCKS = 3;
const SNIPER_TOWER_MIN_HEIGHT_BLOCKS = 5;
const SNIPER_TOWER_MAX_HEIGHT_BLOCKS = 15;
const SNIPER_TOWER_CIRCLE_SLOTS = 12; // every slot gets a tower, evenly spaced so none can land on top of each other
const SNIPER_TOWER_CIRCLE_RADIUS_BLOCKS = 45;
const SNIPER_TOWER_CIRCLE_RADIUS_JITTER_BLOCKS = 6;
const SNIPER_TOWER_CIRCLE_ANGLE_JITTER_RADIANS = (Math.PI / SNIPER_TOWER_CIRCLE_SLOTS) * 0.4; // stays within its own slot, never drifts into a neighbor's
const SNIPER_TOWER_LIST_PROPERTY = "season:sniper_towers";

function randomIntInclusive(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sniperTowerCorners(cx, cz) {
  const r = SNIPER_TOWER_FOOTPRINT_RADIUS;
  return [
    [cx - r, cz - r],
    [cx - r, cz + r],
    [cx + r, cz - r],
    [cx + r, cz + r],
  ];
}

// Builds one tower and returns its descriptor. Rooted at the first open
// space above solid ground rather than floating, so it reads as a
// lookout tower rather than a platform dropped from the sky.
function buildSniperTower(dimension, x, z) {
  const cx = Math.round(x);
  const cz = Math.round(z);
  const r = SNIPER_TOWER_FOOTPRINT_RADIUS;
  const baseY = Math.floor(findSurfaceNear(dimension, cx, cz).y);
  const height = randomIntInclusive(SNIPER_TOWER_MIN_HEIGHT_BLOCKS, SNIPER_TOWER_MAX_HEIGHT_BLOCKS);

  dimension.runCommand(
    `fill ${cx - r} ${baseY} ${cz - r} ${cx + r} ${baseY + height - 1} ${cz + r} ${SNIPER_TOWER_BODY_BLOCK}`
  );

  const fenceBottom = baseY + height;
  const fenceTop = fenceBottom + SNIPER_TOWER_FENCE_HEIGHT_BLOCKS - 1;
  for (const [fx, fz] of sniperTowerCorners(cx, cz)) {
    dimension.runCommand(`fill ${fx} ${fenceBottom} ${fz} ${fx} ${fenceTop} ${fz} ${SNIPER_TOWER_FENCE_BLOCK}`);
  }

  const roofY = fenceTop + 1;
  dimension.runCommand(`fill ${cx - r} ${roofY} ${cz - r} ${cx + r} ${roofY} ${cz + r} ${SNIPER_TOWER_SLAB_BLOCK}`);

  return { x: cx, z: cz, baseY, height };
}

// One tower per slot, all 12 evenly spaced around a large ring centered on
// `center`, with a little random jitter in angle and radius so it doesn't
// look too mechanically perfect. Returns every tower's descriptor for the
// caller to store (e.g. on the boss entity) and hand to
// despawnSniperTowers later.
function spawnSniperTowers(dimension, center) {
  const towers = [];

  for (let slot = 0; slot < SNIPER_TOWER_CIRCLE_SLOTS; slot++) {
    const baseAngle = (slot / SNIPER_TOWER_CIRCLE_SLOTS) * 2 * Math.PI;
    const angle = baseAngle + (Math.random() * 2 - 1) * SNIPER_TOWER_CIRCLE_ANGLE_JITTER_RADIANS;
    const radius = SNIPER_TOWER_CIRCLE_RADIUS_BLOCKS + (Math.random() * 2 - 1) * SNIPER_TOWER_CIRCLE_RADIUS_JITTER_BLOCKS;
    towers.push(buildSniperTower(dimension, center.x + radius * Math.cos(angle), center.z + radius * Math.sin(angle)));
  }

  return towers;
}

// /fill only edits blocks in loaded chunks — a tower out past render/sim
// distance when this runs gets a fill that silently does nothing. Used
// by the retry watchdog below to decide whether a tower actually needs
// clearing (also lets it skip ones a previous pass already got, without
// needing to track that separately).
function sniperTowerStillStanding(dimension, { x, baseY, z }) {
  const block = dimension.getBlock({ x, y: baseY, z });
  return !block || !block.isAir;
}

function despawnSniperTower(dimension, { x: cx, z: cz, baseY, height }) {
  const r = SNIPER_TOWER_FOOTPRINT_RADIUS;
  const roofY = baseY + height + SNIPER_TOWER_FENCE_HEIGHT_BLOCKS; // body, corner posts, and roof all fall within the same 5x5 footprint, so one fill clears the whole thing
  dimension.runCommand(`fill ${cx - r} ${baseY} ${cz - r} ${cx + r} ${roofY} ${cz + r} air`);
}

// Re-fills each tower's body/slab/corner regions with air, from nothing
// but the descriptors spawnSniperTowers returned.
function despawnSniperTowers(dimension, towers) {
  for (const tower of towers) {
    despawnSniperTower(dimension, tower);
  }
}

// Standalone preview hooks, separate from the real Elite Sniper fight
// below — run via /function season/spawn_sniper_towers and
// /function season/despawn_sniper_towers to check tower placement/spacing
// without spawning the full encounter. Both tag the calling player before
// firing the scriptevent (event.sourceEntity is only populated for
// NPC-dialogue-triggered scriptevents — see the Elite Zombie section above
// for the same workaround).
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:spawn_sniper_towers") return;

  for (const player of world.getPlayers({ tags: ["season:sniper_towers_pending"] })) {
    player.removeTag("season:sniper_towers_pending");
    const towers = spawnSniperTowers(player.dimension, player.location);
    player.setDynamicProperty(SNIPER_TOWER_LIST_PROPERTY, JSON.stringify(towers));
    player.sendMessage(`§6${towers.length} sniper roost towers built.`);
  }
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:despawn_sniper_towers") return;

  for (const player of world.getPlayers({ tags: ["season:sniper_towers_despawn_pending"] })) {
    player.removeTag("season:sniper_towers_despawn_pending");
    const stored = player.getDynamicProperty(SNIPER_TOWER_LIST_PROPERTY);
    if (!stored) continue;

    despawnSniperTowers(player.dimension, JSON.parse(stored));
    player.setDynamicProperty(SNIPER_TOWER_LIST_PROPERTY, undefined);
    player.sendMessage("§6Sniper roost towers cleared.");
  }
});

// ─────────────────────────────────────────────
//  ELITE SNIPER ENCOUNTER
//  A ranged, kiting mini-boss built around the roost towers above —
//  opposite of the Elite Zombie's stand-and-tank fight: lower HP for a
//  boss, hits hard from range, and actively avoids melee instead of
//  soaking it.
//
//  On spawn: 12 towers go up around the boss (spawnSniperTowers, see
//  above), the boss moves onto one of them and gets a heavily-enchanted
//  bow, and 6 Stray guards (the slowness-tipped-arrow skeleton variant,
//  not plain skeletons, so the escort is ranged pressure too rather than
//  another melee swarm) spawn on 6 of the towers. Every guard and the
//  boss itself independently re-teleport to a random tower on their own
//  random timer for the rest of the fight — not a shared schedule — so
//  the roosts never settle into a predictable rotation.
//
//  Fight mechanics:
//  - Kiting: a player within ELITE_SNIPER_SWARM_RADIUS_BLOCKS teleports
//    the boss to a different random tower (cooldown-gated so it can't
//    blink every tick with someone stood next to it).
//  - Volley: every ~20s the boss telegraphs, winds up, then fires a
//    5-arrow spread at wherever the nearest player was standing when it
//    fired.
//  - Enrage at half health: faster attack interval, and every hit it
//    lands afterward applies Slowness — done through
//    projectileHitEntity below rather than real tipped-arrow items,
//    since minecraft:shooter has no way to carry a potion effect on a
//    mob's own shots the way a held tipped arrow does for a player.
//  - A dead guard is replaced ELITE_SNIPER_GUARD_RESPAWN_DELAY_TICKS
//    (30s) later, for as long as the boss is alive, keeping the escort
//    back at 6. The moment the boss dies, every remaining guard and
//    every tower comes down with it.
//
//  Assumes one Elite Sniper fight at a time, same as the Elite Zombie
//  above — nothing here is scoped per-fight beyond the tower list each
//  entity carries on its own dynamic property.
// ─────────────────────────────────────────────

const ELITE_SNIPER_GUARD_COUNT = 6;
const ELITE_SNIPER_GUARD_RESPAWN_DELAY_TICKS = 600; // 30 seconds
const ELITE_SNIPER_GUARD_ROTATION_MIN_TICKS = 300; // 15 seconds
const ELITE_SNIPER_GUARD_ROTATION_MAX_TICKS = 900; // 45 seconds
const ELITE_SNIPER_SWARM_RADIUS_BLOCKS = 3;
const ELITE_SNIPER_TELEPORT_COOLDOWN_TICKS = 160; // 8 seconds
const ELITE_SNIPER_LAST_TELEPORT_TICK_PROPERTY = "season:last_teleport_tick";
const ELITE_SNIPER_VOLLEY_INTERVAL_TICKS = 400; // 20 seconds
const ELITE_SNIPER_VOLLEY_WINDUP_TICKS = 30; // 1.5 seconds
const ELITE_SNIPER_VOLLEY_SPEED = 10; // fast enough that gravity barely has time to pull the shot down short
const ELITE_SNIPER_VOLLEY_RANGE_BLOCKS = 64;
const ELITE_SNIPER_ARENA_CENTER_PROPERTY = "season:arena_center";
const ELITE_SNIPER_RAIN_RADIUS_BLOCKS = 50; // covers the whole tower ring, not just the area right around the boss
const ELITE_SNIPER_RAIN_GRID_SPACING_BLOCKS = 4; // candidate drop points, 4 blocks apart
const ELITE_SNIPER_RAIN_COVERAGE_FRACTION = 0.95; // ~95% of those candidate points get an arrow, per pass
const ELITE_SNIPER_RAIN_DROP_HEIGHT_BLOCKS = 40; // high enough to clear terrain variation across the whole arena; gravity does the rest
const ELITE_SNIPER_RAIN_FALL_SPEED = 1.5;
const ELITE_SNIPER_RAIN_SPAWN_WINDOW_TICKS = 40; // 2 seconds — spreads out when each arrow actually spawns within a pass
const ELITE_SNIPER_RAIN_PASS_COUNT = 5;
const ELITE_SNIPER_RAIN_PASS_INTERVAL_TICKS = 30; // 1.5 seconds between the start of each pass
const ELITE_SNIPER_RAIN_NEAR_PLAYER_JITTER_BLOCKS = 2; // close enough to actually threaten, not a guaranteed point-blank hit
const ELITE_SNIPER_RAIN_NEAR_PLAYER_SPAWN_WINDOW_TICKS = 10; // short on purpose — reacts to where the player is now, not where the full window would let them wander off to
const ELITE_SNIPER_REGULAR_ARROW_COUNT = 3; // every normal shot is a small spread, not a single arrow
const ELITE_SNIPER_REGULAR_SPREAD_RADIANS = 0.08; // tighter than the heavy volley's spread
const ELITE_SNIPER_REGULAR_FIRE_INTERVAL_TICKS = 90; // 4.5 seconds, replaces the vanilla ranged_attack interval this boss no longer uses
const ELITE_SNIPER_REGULAR_FIRE_INTERVAL_ENRAGED_TICKS = 55; // ~2.75 seconds
const ELITE_SNIPER_ENRAGE_TAG = "season:elite_sniper_enraged";
const ELITE_SNIPER_ENRAGE_HEALTH_FRACTION = 0.5;
const ELITE_SNIPER_ENRAGE_SLOWNESS_DURATION_TICKS = 100; // 5 seconds

function findNearestPlayer(dimension, location, maxDistance) {
  let nearest = null;
  let nearestDistSq = Infinity;
  for (const player of dimension.getPlayers({ location, maxDistance })) {
    const dx = player.location.x - location.x;
    const dy = player.location.y - location.y;
    const dz = player.location.z - location.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = player;
    }
  }
  return nearest;
}

// Stands on top of the solid stone body, inside the ring of corner fence
// posts and under the slab roof — not up on the roof itself.
function sniperTowerStandLocation(tower) {
  return {
    x: tower.x + 0.5,
    y: tower.baseY + tower.height,
    z: tower.z + 0.5,
  };
}

// Component groups holding nearest_attackable_target are split out on
// both entities specifically so this can force a fresh target pick
// (remove+add the same group resets the AI goal) without also resetting
// health or anything else bundled into the main elite group — see
// skeleton.json/stray.json.
function sniperRetargetEventId(entity) {
  return entity.typeId === "minecraft:skeleton" ? "season:elite_sniper_retarget" : "season:elite_guard_pillager_retarget";
}

function pickRandomTower(towers, excludeFloorXZ) {
  const options = excludeFloorXZ
    ? towers.filter((t) => t.x !== excludeFloorXZ.x || t.z !== excludeFloorXZ.z)
    : towers;
  return options[Math.floor(Math.random() * options.length)];
}

function sniperTowerKey(x, z) {
  return `${x},${z}`;
}

// Which towers currently have a sniper (boss or guard) standing on them,
// identified by rounding each one's live position down to a tower's own
// integer coordinates — so this doesn't need any separate bookkeeping
// that could drift out of sync with where everyone actually is.
// `excludeEntity` leaves the entity doing the picking out of its own
// occupancy count, so it isn't blocked from picking a tower it could
// freely move to just because it's about to vacate its current one.
function getOccupiedTowerKeys(dimension, excludeEntity) {
  const occupied = new Set();
  const snipers = [
    ...dimension.getEntities({ type: "minecraft:skeleton", tags: ["season:elite_sniper"] }),
    ...dimension.getEntities({ type: "minecraft:pillager", tags: ["season:elite_guard_pillager"] }),
  ];
  for (const sniper of snipers) {
    if (excludeEntity && sniper.id === excludeEntity.id) continue;
    occupied.add(sniperTowerKey(Math.floor(sniper.location.x), Math.floor(sniper.location.z)));
  }
  return occupied;
}

// Same as pickRandomTower, but also avoids any tower another sniper is
// currently standing on, so they stop stacking up on the same one. Falls
// back to allowing occupied towers only if every single one is taken
// (12 towers vs. at most 7 snipers, so this is just a safety net).
function pickUnoccupiedTower(dimension, towers, entity, excludeFloorXZ) {
  const occupied = getOccupiedTowerKeys(dimension, entity);
  const isFree = (t) => !occupied.has(sniperTowerKey(t.x, t.z));

  const free = towers.filter((t) => isFree(t) && (!excludeFloorXZ || t.x !== excludeFloorXZ.x || t.z !== excludeFloorXZ.z));
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)];

  const freeIgnoringCurrent = towers.filter(isFree);
  if (freeIgnoringCurrent.length > 0) return freeIgnoringCurrent[Math.floor(Math.random() * freeIgnoringCurrent.length)];

  return pickRandomTower(towers, excludeFloorXZ);
}

// Every guard (and the boss) carries its own copy of the tower list —
// simpler than looking the boss up again on every rotation, and it's a
// small enough JSON string not to matter.
function getStoredTowers(entity) {
  const stored = entity.getDynamicProperty(SNIPER_TOWER_LIST_PROPERTY);
  return stored ? JSON.parse(stored) : [];
}

function isEliteSniperFightActive(dimension) {
  return dimension.getEntities({ type: "minecraft:skeleton", tags: ["season:elite_sniper"] }).length > 0;
}

// Reschedules itself with a fresh random delay every time, so rotations
// never settle into a visible pattern across guards. Stops on its own
// once the entity is no longer valid (dead/removed) rather than needing
// to be cancelled from anywhere else.
function scheduleRoostRotation(entity) {
  const delay = randomIntInclusive(ELITE_SNIPER_GUARD_ROTATION_MIN_TICKS, ELITE_SNIPER_GUARD_ROTATION_MAX_TICKS);
  system.runTimeout(() => {
    if (!entity.isValid()) return;

    const towers = getStoredTowers(entity);
    const current = { x: Math.floor(entity.location.x), z: Math.floor(entity.location.z) };
    const target = pickUnoccupiedTower(entity.dimension, towers, entity, current);
    if (target) {
      entity.teleport(sniperTowerStandLocation(target));
      entity.triggerEvent(sniperRetargetEventId(entity)); // new vantage point — pick a fresh target instead of staying locked onto whoever it had before
    }

    scheduleRoostRotation(entity);
  }, delay);
}

function spawnEliteSniperGuard(dimension, towers) {
  const guard = dimension.spawnEntity("minecraft:pillager", sniperTowerStandLocation(pickUnoccupiedTower(dimension, towers)));
  guard.addTag("season:elite_guard_pillager");
  guard.setDynamicProperty(SNIPER_TOWER_LIST_PROPERTY, JSON.stringify(towers));

  // minecraft:equipment only rolls at the moment the entity is actually
  // created — adding the component group a moment later via
  // triggerEvent (below) is too late for it to take effect, leaving the
  // guard with nothing in hand. Equip it directly instead of trusting
  // that timing. (Firing itself goes through the scripted
  // shooter/ranged_attack components below, not native crossbow_attack —
  // that never actually fired even once armed, so this is purely visual.)
  try {
    guard.runCommand("replaceitem entity @s slot.weapon.mainhand 0 minecraft:crossbow");
    guard.runCommand("enchant @s multishot 1");
  } catch (error) {
    console.warn(`Elite Sniper guard crossbow equip failed: ${error}`);
  }

  // Pillagers aren't undead and don't burn in daylight, unlike the
  // Strays these replaced — no helmet workaround needed here.
  guard.triggerEvent("season:become_elite_guard_pillager");
  scheduleRoostRotation(guard);
  return guard;
}

// Shared by both the frequent small-spread regular shots and the
// occasional bigger telegraphed volley — only the arrow count and
// spread angle differ between them. All shots are fully scripted now
// (see season:become_elite_sniper stripping vanilla's default
// ranged_attack groups), so this is the only thing that ever puts an
// arrow in the air for this boss.
const ELITE_SNIPER_ARROW_SPAWN_OFFSET_BLOCKS = 0.8; // clears the boss's own hitbox so a fresh arrow can't immediately clip it
const ELITE_SNIPER_ARROW_LIFETIME_TICKS = 100; // 5 seconds — plenty of time to land a hit, not enough to stick around as free loot

function fireSniperArrows(dimension, boss, targetLocation, arrowCount, spreadRadians) {
  const eyeLocation = { x: boss.location.x, y: boss.location.y + 1.6, z: boss.location.z };
  const dx = targetLocation.x - eyeLocation.x;
  const dy = targetLocation.y - eyeLocation.y;
  const dz = targetLocation.z - eyeLocation.z;
  const baseAngle = Math.atan2(dz, dx);
  const pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));

  boss.runCommand("playsound bow.shoot @a ~ ~ ~");
  for (let i = 0; i < arrowCount; i++) {
    const angle = baseAngle + (Math.random() * 2 - 1) * spreadRadians;
    const forward = {
      x: Math.cos(angle) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: Math.sin(angle) * Math.cos(pitch),
    };
    // Spawn out along the aim direction rather than at the boss's own
    // chest — without this it spawns inside its own hitbox and, with no
    // owner set (below), has nothing telling it not to hit the thing it
    // spawned inside of.
    const origin = {
      x: eyeLocation.x + forward.x * ELITE_SNIPER_ARROW_SPAWN_OFFSET_BLOCKS,
      y: eyeLocation.y + forward.y * ELITE_SNIPER_ARROW_SPAWN_OFFSET_BLOCKS,
      z: eyeLocation.z + forward.z * ELITE_SNIPER_ARROW_SPAWN_OFFSET_BLOCKS,
    };
    const arrow = dimension.spawnEntity("minecraft:arrow", origin);
    const projectile = arrow.getComponent("minecraft:projectile");
    if (projectile) {
      projectile.owner = boss; // also excludes the shooter from the projectile's own collision
      projectile.shoot({
        x: forward.x * ELITE_SNIPER_VOLLEY_SPEED,
        y: forward.y * ELITE_SNIPER_VOLLEY_SPEED,
        z: forward.z * ELITE_SNIPER_VOLLEY_SPEED,
      });
    }

    // Arrows fired by vanilla mob AI come out flagged non-pickupable;
    // these are spawned directly rather than through that pipeline, and
    // there's no exposed way to set that flag from script. Despawning
    // them shortly after firing avoids leaving free, pickupable arrows
    // lying around, which is the actual vanilla-consistent behavior here.
    system.runTimeout(() => {
      if (arrow.isValid()) arrow.remove();
    }, ELITE_SNIPER_ARROW_LIFETIME_TICKS);
  }
}

function getArenaCenter(entity) {
  const stored = entity.getDynamicProperty(ELITE_SNIPER_ARENA_CENTER_PROPERTY);
  return stored ? JSON.parse(stored) : entity.location;
}

// The heavy volley's actual effect — not aimed at anyone. Covers the
// whole arena (the full tower ring, not just around the boss) with
// arrows dropping straight down from above, so it reads as area denial
// — get under cover or in the open and take your chances — rather than
// a bigger version of the regular aimed shots.
// A single falling arrow at a given (x, z) — shared by both the random
// grid drops and the guaranteed near-player ones below.
function dropSniperRainArrow(dimension, boss, x, dropY, z, spawnDelay) {
  system.runTimeout(() => {
    if (!boss.isValid()) return;

    const arrow = dimension.spawnEntity("minecraft:arrow", { x, y: dropY, z });
    const projectile = arrow.getComponent("minecraft:projectile");
    if (projectile) {
      projectile.owner = boss;
      projectile.shoot({ x: 0, y: -ELITE_SNIPER_RAIN_FALL_SPEED, z: 0 });
    }
    system.runTimeout(() => {
      if (arrow.isValid()) arrow.remove();
    }, ELITE_SNIPER_ARROW_LIFETIME_TICKS);
  }, spawnDelay);
}

// One wave of the rain. The grid gives the "whole arena is getting
// pelted" visual, but a fixed 4-block lattice falling at fixed points is
// coarse next to a player's hitbox and easy to just not be standing on —
// each candidate gets randomized within its own cell so repeated casts
// don't land in identical spots, and every player actually in the arena
// also gets a guaranteed close call near their current position (short
// delay, so it reacts to where they are now rather than where they were
// a full window of time ago) so the rain is a real threat, not scenery.
function fireSniperArrowRainPass(dimension, boss, center, radius, dropY, candidates) {
  const half = ELITE_SNIPER_RAIN_GRID_SPACING_BLOCKS / 2;
  for (const { x, z } of candidates) {
    if (Math.random() >= ELITE_SNIPER_RAIN_COVERAGE_FRACTION) continue;

    const jitterX = x + (Math.random() * 2 - 1) * half;
    const jitterZ = z + (Math.random() * 2 - 1) * half;
    // Staggered over a couple seconds instead of all spawning in the same
    // tick — spreads the entity-creation cost out, and reads more like
    // rain falling than a single instant wall of arrows.
    dropSniperRainArrow(dimension, boss, jitterX, dropY, jitterZ, Math.floor(Math.random() * ELITE_SNIPER_RAIN_SPAWN_WINDOW_TICKS));
  }

  for (const player of dimension.getPlayers({ location: center, maxDistance: radius })) {
    const nearX = player.location.x + (Math.random() * 2 - 1) * ELITE_SNIPER_RAIN_NEAR_PLAYER_JITTER_BLOCKS;
    const nearZ = player.location.z + (Math.random() * 2 - 1) * ELITE_SNIPER_RAIN_NEAR_PLAYER_JITTER_BLOCKS;
    dropSniperRainArrow(dimension, boss, nearX, dropY, nearZ, Math.floor(Math.random() * ELITE_SNIPER_RAIN_NEAR_PLAYER_SPAWN_WINDOW_TICKS));
  }
}

function fireSniperArrowRain(dimension, boss) {
  const center = getArenaCenter(boss);
  const dropY = center.y + ELITE_SNIPER_RAIN_DROP_HEIGHT_BLOCKS;
  const r = ELITE_SNIPER_RAIN_RADIUS_BLOCKS;

  const candidates = [];
  for (let x = -r; x <= r; x += ELITE_SNIPER_RAIN_GRID_SPACING_BLOCKS) {
    for (let z = -r; z <= r; z += ELITE_SNIPER_RAIN_GRID_SPACING_BLOCKS) {
      if (x * x + z * z <= r * r) candidates.push({ x: center.x + x, z: center.z + z });
    }
  }

  for (let pass = 0; pass < ELITE_SNIPER_RAIN_PASS_COUNT; pass++) {
    system.runTimeout(() => {
      if (boss.isValid()) fireSniperArrowRainPass(dimension, boss, center, r, dropY, candidates);
    }, pass * ELITE_SNIPER_RAIN_PASS_INTERVAL_TICKS);
  }
}

// The boss's everyday attack — reschedules itself the same way roost
// rotation does, stopping on its own once the boss is gone. Fires
// immediately on each cycle, no telegraph (that's reserved for the
// heavier volley below). Runs faster once enraged.
function scheduleSniperRegularFire(dimension, boss) {
  const interval = boss.hasTag(ELITE_SNIPER_ENRAGE_TAG)
    ? ELITE_SNIPER_REGULAR_FIRE_INTERVAL_ENRAGED_TICKS
    : ELITE_SNIPER_REGULAR_FIRE_INTERVAL_TICKS;

  system.runTimeout(() => {
    if (!boss.isValid()) return;

    const target = findNearestPlayer(dimension, boss.location, ELITE_SNIPER_VOLLEY_RANGE_BLOCKS);
    if (target) {
      fireSniperArrows(dimension, boss, target.location, ELITE_SNIPER_REGULAR_ARROW_COUNT, ELITE_SNIPER_REGULAR_SPREAD_RADIANS);
    }

    scheduleSniperRegularFire(dimension, boss);
  }, interval);
}

// The occasional bigger, telegraphed burst — reschedules itself the same
// way roost rotation does, stopping on its own once the boss is gone.
function scheduleSniperVolley(dimension, boss) {
  system.runTimeout(() => {
    if (!boss.isValid()) return;

    // Still gated on someone being nearby, just not aimed at them —
    // no point raining arrows across an empty arena.
    if (findNearestPlayer(dimension, boss.location, ELITE_SNIPER_VOLLEY_RANGE_BLOCKS)) {
      world.sendMessage("§6The Elite Sniper draws back a heavy volley — arrows are about to rain across the arena!");
      system.runTimeout(() => {
        if (boss.isValid()) fireSniperArrowRain(dimension, boss);
      }, ELITE_SNIPER_VOLLEY_WINDUP_TICKS);
    }

    scheduleSniperVolley(dimension, boss);
  }, ELITE_SNIPER_VOLLEY_INTERVAL_TICKS);
}

// summon_elite_sniper.mcfunction tags the freshly-summoned boss with
// season:elite_sniper_needs_setup alongside season:elite_sniper, the
// same event.sourceEntity workaround as the Elite Zombie above.
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:elite_sniper_spawned") return;

  const overworld = world.getDimension("overworld");
  const freshlySpawned = overworld.getEntities({
    type: "minecraft:skeleton",
    tags: ["season:elite_sniper_needs_setup"],
  });

  for (const boss of freshlySpawned) {
    boss.removeTag("season:elite_sniper_needs_setup");

    boss.setDynamicProperty(ELITE_SNIPER_ARENA_CENTER_PROPERTY, JSON.stringify(boss.location));

    const towers = spawnSniperTowers(overworld, boss.location);
    boss.setDynamicProperty(SNIPER_TOWER_LIST_PROPERTY, JSON.stringify(towers));
    boss.teleport(sniperTowerStandLocation(pickRandomTower(towers)));

    // Guards first and each isolated in its own try/catch — a thrown
    // error from any one step here used to silently abort the rest of
    // this loop (including every guard after the first failure), which
    // is exactly the kind of untested-API risk flagged when this was
    // built. Isolating each spawn means one bad call can't take the
    // other five down with it.
    for (let i = 0; i < ELITE_SNIPER_GUARD_COUNT; i++) {
      try {
        spawnEliteSniperGuard(overworld, towers);
      } catch (error) {
        console.warn(`Elite Sniper guard ${i} failed to spawn: ${error}`);
      }
    }

    // The copper/eye-trimmed iron armor set comes from
    // season_elite_sniper_equipment.json via the minecraft:equipment
    // component on season:elite_sniper (same proven loot-table pattern
    // the Elite Zombie already uses). The bow is also in that table, but
    // gets a guaranteed direct equip here too — the same
    // equipment-rolls-too-late-to-matter issue that left the Pillager
    // guards unarmed could just as easily be silently leaving this bow
    // unequipped, and unlike the guards, nothing here actually depends
    // on it being in hand (every shot is scripted), so
    // there was no functional symptom to notice it by.
    try {
      boss.runCommand("replaceitem entity @s slot.weapon.mainhand 0 minecraft:bow");
      boss.runCommand("enchant @s power 5");
    } catch (error) {
      console.warn(`Elite Sniper bow equip failed: ${error}`);
    }

    scheduleRoostRotation(boss);
    scheduleSniperRegularFire(overworld, boss);
    scheduleSniperVolley(overworld, boss);
    world.sendMessage("§cA sniper has taken position. Watch the towers.");
  }
});

// Kiting watchdog — teleports the boss away from anyone who gets too
// close, cooldown-gated so it can't blink every pass while someone's
// stood right next to it.
system.runInterval(() => {
  const overworld = world.getDimension("overworld");
  for (const boss of overworld.getEntities({ type: "minecraft:skeleton", tags: ["season:elite_sniper"] })) {
    const lastTeleportTick = boss.getDynamicProperty(ELITE_SNIPER_LAST_TELEPORT_TICK_PROPERTY) ?? 0;
    if (system.currentTick - lastTeleportTick < ELITE_SNIPER_TELEPORT_COOLDOWN_TICKS) continue;
    if (!findNearestPlayer(overworld, boss.location, ELITE_SNIPER_SWARM_RADIUS_BLOCKS)) continue;

    const towers = getStoredTowers(boss);
    const current = { x: Math.floor(boss.location.x), z: Math.floor(boss.location.z) };
    const target = pickUnoccupiedTower(overworld, towers, boss, current);
    if (!target) continue;

    boss.teleport(sniperTowerStandLocation(target));
    boss.triggerEvent(sniperRetargetEventId(boss));
    boss.setDynamicProperty(ELITE_SNIPER_LAST_TELEPORT_TICK_PROPERTY, system.currentTick);
  }
}, ELITE_MOB_INTERVAL_TICKS);

const ELITE_SNIPER_PERCH_CHECK_INTERVAL_TICKS = 20; // 1 second — snappier than the other watchdogs, since getting knocked off should feel immediate

// Whether the block directly underfoot is a tower's own stone body —
// simpler and more reliable than comparing Y against an expected height,
// since it doesn't care which tower (or which one's ground height) the
// entity happens to be near.
function isOnSniperTowerPerch(dimension, entity) {
  const { x, y, z } = entity.location;
  const below = dimension.getBlock({ x: Math.floor(x), y: Math.floor(y) - 1, z: Math.floor(z) });
  return below?.typeId === SNIPER_TOWER_BODY_BLOCK;
}

// Knocked off a tower (combat knockback, or just wandering off the edge)
// — relocate immediately to a random tower, no cooldown. This is
// separate from the boss's own kiting watchdog above, which only fires
// on player proximity; this one covers both the boss and the guards, and
// fires purely off "not standing on a tower anymore," whatever the cause.
system.runInterval(() => {
  const overworld = world.getDimension("overworld");
  const snipers = [
    ...overworld.getEntities({ type: "minecraft:skeleton", tags: ["season:elite_sniper"] }),
    ...overworld.getEntities({ type: "minecraft:pillager", tags: ["season:elite_guard_pillager"] }),
  ];

  for (const sniper of snipers) {
    if (isOnSniperTowerPerch(overworld, sniper)) continue;

    const towers = getStoredTowers(sniper);
    const target = pickUnoccupiedTower(overworld, towers, sniper);
    if (!target) continue;

    sniper.teleport(sniperTowerStandLocation(target));
    sniper.triggerEvent(sniperRetargetEventId(sniper));
  }
}, ELITE_SNIPER_PERCH_CHECK_INTERVAL_TICKS);

// Enrage at half health — just a tag flip. scheduleSniperRegularFire
// checks it on every reschedule to pick the faster interval, and
// projectileHitEntity below starts applying Slowness on every hit this
// boss lands from this point on.
system.runInterval(() => {
  const overworld = world.getDimension("overworld");
  for (const boss of overworld.getEntities({ type: "minecraft:skeleton", tags: ["season:elite_sniper"] })) {
    if (boss.hasTag(ELITE_SNIPER_ENRAGE_TAG)) continue;

    const health = boss.getComponent("minecraft:health");
    if (!health || health.currentValue > health.effectiveMax * ELITE_SNIPER_ENRAGE_HEALTH_FRACTION) continue;

    boss.addTag(ELITE_SNIPER_ENRAGE_TAG);
    world.sendMessage("§cThe Elite Sniper's shots grow faster — and colder.");
  }
}, ELITE_MOB_INTERVAL_TICKS);

// Minecraft's own arrow damage is based on the projectile's velocity at
// impact, and the manually-set velocities this boss's arrows use aren't
// registering meaningful damage through that path — reported in-game as
// shots that land but don't hurt. Applying damage directly here sidesteps
// whatever's going wrong with the native calculation for a scripted
// velocity, for every arrow this boss owns (regular fire, the heavy
// volley, and the arena-wide rain all set the same owner).
const ELITE_SNIPER_ARROW_DAMAGE = 6;

world.afterEvents.projectileHitEntity.subscribe((event) => {
  if (!event.source?.hasTag("season:elite_sniper")) return;

  const hit = event.getEntityHit().entity;
  if (!hit || hit.typeId !== "minecraft:player") return;

  hit.applyDamage(ELITE_SNIPER_ARROW_DAMAGE, { cause: "arrow", damagingEntity: event.source });

  if (event.source.hasTag(ELITE_SNIPER_ENRAGE_TAG)) {
    hit.addEffect("slowness", ELITE_SNIPER_ENRAGE_SLOWNESS_DURATION_TICKS, { amplifier: 1, showParticles: true });
  }
});

// Guard replenishment and boss-death cleanup hang off the same event — a
// dead elite_guard_pillager gets a replacement 30 seconds later as long
// as the fight is still on, and a dead elite_sniper takes every
// remaining guard and every tower down with it.
world.afterEvents.entityDie.subscribe((event) => {
  const { deadEntity } = event;

  if (deadEntity.typeId === "minecraft:pillager" && deadEntity.hasTag("season:elite_guard_pillager")) {
    const overworld = world.getDimension("overworld");
    system.runTimeout(() => {
      if (!isEliteSniperFightActive(overworld)) return;
      const [boss] = overworld.getEntities({ type: "minecraft:skeleton", tags: ["season:elite_sniper"] });
      spawnEliteSniperGuard(overworld, getStoredTowers(boss));
    }, ELITE_SNIPER_GUARD_RESPAWN_DELAY_TICKS);
    return;
  }

  if (deadEntity.typeId === "minecraft:skeleton" && deadEntity.hasTag("season:elite_sniper")) {
    const overworld = world.getDimension("overworld");
    const towers = getStoredTowers(deadEntity);
    despawnSniperTowers(overworld, towers);
    // Anything out past render/sim distance just got a fill command that
    // silently did nothing — queue those for the retry watchdog below
    // instead of losing track of them.
    queuePendingTowerCleanup(towers.filter((tower) => sniperTowerStillStanding(overworld, tower)));
    for (const guard of overworld.getEntities({ type: "minecraft:pillager", tags: ["season:elite_guard_pillager"] })) {
      guard.remove();
    }
    world.sendMessage("§6The Elite Sniper falls — the towers come down with it.");
  }
});

// Retry queue for towers the death handler above couldn't reach (out past
// render/sim distance at the moment the boss died). Stored on `world`
// rather than the now-gone boss entity, and checked every
// ELITE_MOB_INTERVAL_TICKS — whenever a player eventually wanders back
// into range of one, the next pass clears it and drops it from the list.
const SNIPER_TOWER_PENDING_CLEANUP_PROPERTY = "season:pending_tower_cleanup";

function queuePendingTowerCleanup(towers) {
  if (towers.length === 0) return;
  const existing = JSON.parse(world.getDynamicProperty(SNIPER_TOWER_PENDING_CLEANUP_PROPERTY) ?? "[]");
  world.setDynamicProperty(SNIPER_TOWER_PENDING_CLEANUP_PROPERTY, JSON.stringify([...existing, ...towers]));
}

system.runInterval(() => {
  const pending = JSON.parse(world.getDynamicProperty(SNIPER_TOWER_PENDING_CLEANUP_PROPERTY) ?? "[]");
  if (pending.length === 0) return;

  const overworld = world.getDimension("overworld");
  const stillPending = [];
  for (const tower of pending) {
    if (!sniperTowerStillStanding(overworld, tower)) continue; // already cleared, or never actually finished building
    despawnSniperTower(overworld, tower);
    if (sniperTowerStillStanding(overworld, tower)) stillPending.push(tower); // still out of range — try again next pass
  }

  world.setDynamicProperty(SNIPER_TOWER_PENDING_CLEANUP_PROPERTY, JSON.stringify(stillPending));
}, ELITE_MOB_INTERVAL_TICKS);
