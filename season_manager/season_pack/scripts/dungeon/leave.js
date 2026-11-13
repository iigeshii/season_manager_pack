import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { LAYOUT } from "./layout.js";
import { NETHER_ID, origin, isEventOn } from "./run_state.js";
import { isMember, spacesAt, leaveRun } from "./mending_rescue.js";

// ─────────────────────────────────────────────
//  LEAVING A RUN
//  A party member who crouches inside any airlock for HOLD_SECONDS gets a
//  "Leave the rescue?" form. Leaving takes them off the party and sends
//  them home (mending_rescue.js leaveRun). They're told how at the seal
//  and when joining late.
//
//  After the form closes they have to stand up before crouching counts
//  again, so it doesn't pop straight back up.
// ─────────────────────────────────────────────

const CHECK_TICKS = 20; // 1 second
const HOLD_SECONDS = 5;
const WARN_AT = 2; // seconds in: "keep crouching to leave"

const AIRLOCKS = LAYOUT.airlocks.map((_, i) => `airlock${i + 1}`);

const crouching = new Map(); // player id -> seconds held
const waitingToStand = new Set(); // player ids: form shown, not stood up yet

function inAirlock(player) {
  return spacesAt(player.location).some((id) => AIRLOCKS.includes(id));
}

async function askToLeave(player) {
  const form = new ActionFormData()
    .title("Leave the Rescue?")
    .body("You'll be taken off the party and sent home. You won't get the librarian's rewards.\n\nYou can come back through a Nether portal while the run is on, until the librarian's scene starts.")
    .button("Leave the rescue")
    .button("Stay");
  let response;
  try {
    response = await form.show(player);
  } catch {
    return; // left the game
  }
  if (response.canceled || response.selection !== 0) return;
  if (player.isValid() && isMember(player)) leaveRun(player);
}

system.runInterval(() => {
  if (!origin() || !isEventOn()) {
    crouching.clear();
    waitingToStand.clear();
    return;
  }
  const seen = new Set();
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    if (!player.isSneaking) {
      waitingToStand.delete(player.id);
      continue;
    }
    if (waitingToStand.has(player.id) || !isMember(player) || !inAirlock(player)) continue;
    seen.add(player.id);
    const held = (crouching.get(player.id) ?? 0) + 1;
    crouching.set(player.id, held);
    if (held === WARN_AT) player.sendMessage(`§7Keep crouching to leave the rescue...`);
    if (held < HOLD_SECONDS) continue;
    waitingToStand.add(player.id);
    askToLeave(player);
  }
  for (const id of crouching.keys()) if (!seen.has(id)) crouching.delete(id);
}, CHECK_TICKS);
