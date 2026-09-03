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
//  player straight back to where they left from, then best-effort destroys
//  the portal that let them through so it can't fire again.
//
//  The teleport always happens first: fromLocation is exactly the spot
//  that triggered the portal, so if it's still there when the player lands
//  it just re-triggers — but the send-back itself must never be blocked on
//  cleanup succeeding (or taking a while, for the Nether's block-by-block
//  scan). The recently-bounced check is the backstop for that case: a
//  portal that's still live (bigger than its configured radius, or the
//  cleanup hasn't caught up yet) sends the second bounce to world spawn
//  instead of back onto it.
// ─────────────────────────────────────────────

const DISABLED_DIMENSIONS = new Set(["minecraft:nether", "minecraft:the_end"]);
// Nether portals validate their shape continuously: clearing the interior
// "minecraft:portal" blocks while the obsidian frame is still intact gets
// silently refilled by the game on the next check, since as far as the
// engine's concerned a complete frame should have a portal in it. Clearing
// the frame instead is what actually breaks it — same as mining out a
// single frame block in survival collapses the whole portal.
//
// End portal frames don't need the same treatment: they're unbreakable and
// unobtainable in normal play, so the game never needed a live re-validation
// for them the way nether portals do. Clearing the "minecraft:end_portal"
// blocks should stick on its own. As a defensive backstop (in case some
// re-validation does exist) each frame's eye of ender is also stripped —
// unlike obsidian, frame blocks themselves are irreplaceable, so this
// defuses the portal without destroying anything the player can't recreate
// by finding another eye.
const PORTAL_BLOCKS = {
  "minecraft:nether": {
    radius: 4,
    actions: [{ type: "minecraft:obsidian", clear: true }],
  },
  "minecraft:the_end": {
    radius: 3,
    actions: [
      { type: "minecraft:end_portal", clear: true },
      { type: "minecraft:end_portal_frame", stripEye: true },
    ],
  },
};
const BOUNCE_COOLDOWN_TICKS = 40; // 2 seconds
const recentlyBounced = new Set();

function destroyPortalNear(dimension, location, actions, radius) {
  const cx = Math.floor(location.x);
  const cy = Math.floor(location.y);
  const cz = Math.floor(location.z);
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        let block;
        try {
          block = dimension.getBlock({ x, y, z });
        } catch {
          continue; // unloaded chunk at the edge of the radius — skip it
        }
        const action = actions.find((a) => a.type === block?.typeId);
        if (!action) continue;
        try {
          if (action.clear) {
            block.setType("minecraft:air");
          } else if (action.stripEye) {
            block.setPermutation(block.permutation.withState("end_portal_eye_piece", false));
          }
        } catch (e) {
          console.warn(`destroyPortalNear: failed to modify ${action.type} at ${x},${y},${z}: ${e}`);
        }
      }
    }
  }
}

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
      player.sendMessage("§cThat portal isn't safe to return through — sent you to spawn instead.");
      return;
    }

    // Teleport back first — this must always happen regardless of whether
    // the portal cleanup below succeeds or runs long.
    player.teleport(fromLocation, { dimension: fromDimension });
    player.sendMessage("§cYou entered a forbidden dimension and were sent back.");

    const portalInfo = PORTAL_BLOCKS[toDimension.id];
    if (portalInfo) {
      destroyPortalNear(fromDimension, fromLocation, portalInfo.actions, portalInfo.radius);
    }
  });
});
