import { world, system } from "@minecraft/server";

// ─────────────────────────────────────────────
//  BUILD INFO
//  Stamped with the short git SHA at package time — see scripts/build.sh
//  and scripts/deploy.sh. Left as a placeholder if loaded unstamped.
// ─────────────────────────────────────────────

const BUILD_SHA = "__BUILD_SHA__";
const BUILD_INFO_TEXT = `Custom Manager Loaded (${BUILD_SHA})`;

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  player.sendMessage(`§6${BUILD_INFO_TEXT}`);
});

system.run(() => {
  console.warn(BUILD_INFO_TEXT);
});

// ─────────────────────────────────────────────
//  CLEANUP SEQUENCE
//  Trigger the whole sequence from a single command block:
//    scriptevent custom:cleanup
//  Add more commands here to extend the sequence.
// ─────────────────────────────────────────────

const CLEANUP_COMMANDS = [
  "clear @a elytra",
  "clear @a hopper",
];

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "custom:cleanup") return;

  const overworld = world.getDimension("overworld");
  for (const cmd of CLEANUP_COMMANDS) {
    try {
      overworld.runCommand(cmd);
    } catch {
      // /clear throws when nothing matched — not worth surfacing
    }
  }
});
