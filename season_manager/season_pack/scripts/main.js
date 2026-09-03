import { world, system } from "@minecraft/server";

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

const CLEANUP_ITEMS = ["elytra", "hopper", "hopper_minecart"];

const CLEANUP_INTERVAL_TICKS = 20; // 20 ticks = 1 second

function runCleanup() {
  if (!enabled) return;
  for (const player of world.getPlayers()) {
    for (const item of CLEANUP_ITEMS) {
      try {
        const result = player.runCommand(`clear @s ${item}`);
        if (result.successCount > 0) {
          player.sendMessage(`§c${item} removed — not permitted this season.`);
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
  { item: "minecraft:ender_eye", block: "minecraft:end_portal_frame", label: "The End" },
];

world.beforeEvents.itemUseOn.subscribe((event) => {
  if (!enabled) return;
  const match = PORTAL_IGNITERS.find(
    (p) => p.item === event.itemStack?.typeId && p.block === event.block.typeId
  );
  if (!match) return;
  event.cancel = true;
  event.source.sendMessage(`§c${match.label} are disabled this season.`);
});

// ─────────────────────────────────────────────
//  DIMENSION BOUNCE-BACK
//  Fallback for any way into a disabled dimension the portal lock doesn't
//  catch (pre-lit ruined portals, bastion remnants, etc.) — teleports the
//  player straight back to where they left from.
// ─────────────────────────────────────────────

const DISABLED_DIMENSIONS = new Set(["minecraft:nether", "minecraft:the_end"]);

world.afterEvents.playerDimensionChange.subscribe((event) => {
  if (!enabled) return;
  const { player, toDimension, fromDimension, fromLocation } = event;
  if (!DISABLED_DIMENSIONS.has(toDimension.id)) return;
  system.run(() => {
    player.teleport(fromLocation, { dimension: fromDimension });
    player.sendMessage("§cYou entered a forbidden dimension and were sent back.");
  });
});
