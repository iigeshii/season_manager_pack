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
//  Runs automatically on an interval to keep banned items out of players'
//  hands — no command block or redstone clock needed.
//  Add more commands here to extend the sequence.
// ─────────────────────────────────────────────

const CLEANUP_COMMANDS = [
  "clear @a elytra",
  "clear @a hopper",
];

const CLEANUP_INTERVAL_TICKS = 20; // 20 ticks = 1 second

function runCleanup() {
  const overworld = world.getDimension("overworld");
  for (const cmd of CLEANUP_COMMANDS) {
    try {
      overworld.runCommand(cmd);
    } catch {
      // /clear throws when nothing matched — not worth surfacing
    }
  }
}

system.runInterval(runCleanup, CLEANUP_INTERVAL_TICKS);

// Manual trigger, still handy for testing:
//   scriptevent custom:cleanup
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "custom:cleanup") return;
  runCleanup();
});
