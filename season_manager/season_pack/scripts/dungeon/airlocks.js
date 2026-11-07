import { world, system } from "@minecraft/server";
import { isOperator } from "./nether_rules.js";
import { NETHER_ID, origin, isEventOn, isTestMode } from "./run_state.js";
import { sealParty, setStage, currentStage, isMember, spacesAt } from "./mending_rescue.js";
import { isGateOpen } from "./room1_gate.js";

// ─────────────────────────────────────────────
//  AIRLOCKS
//  Moves the run on when the whole group is inside an airlock, held for
//  a few seconds so someone stepping through doesn't trigger it.
//
//  Airlock 1 (Room 1's gate passage) starts the run: the gate must be
//  open, every non-operator in the Nether must be inside the airlock, and
//  there must be at least MIN_PARTY of them (1 in test mode). The party is
//  everyone in the airlock, operators included — that's how an operator
//  tests solo. Sealing closes the gate behind them, opens the way into
//  Room 2 and closes Nether portals (see sealParty).
//
//  Airlocks 2-7: every online non-operator party member is inside airlock
//  n, and at least one party member is → the run moves to room n+1 and the
//  checkpoint to that airlock. (Each room's own gates come with its room
//  code; until then this only moves the stage.)
//
//  Typed seal / stage commands still work as overrides.
// ─────────────────────────────────────────────

const CHECK_TICKS = 20; // 1 second
const HOLD_CHECKS = 3; // seconds the group must stay put
const MIN_PARTY = 4; // realm rule

// Consecutive checks the current group has held, and who they were.
let held = 0;
let heldKey = "";

function inAirlock(player, n) {
  return spacesAt(player.location).includes(`airlock${n}`);
}

function tell(players, message) {
  for (const player of players) player.sendMessage(message);
}

// Who's in the airlock if it's ready to close, else undefined.
function readyGroup(players) {
  if (!isEventOn()) {
    if (!isGateOpen()) return undefined;
    const inside = players.filter((p) => inAirlock(p, 1));
    const outside = players.filter((p) => !isOperator(p) && !inAirlock(p, 1));
    const needed = isTestMode() ? 1 : MIN_PARTY;
    return outside.length === 0 && inside.length >= needed ? inside : undefined;
  }

  const n = currentStage(); // the airlock ahead of room n is airlock n
  if (n >= 8) return undefined;
  const members = players.filter(isMember);
  const inside = members.filter((p) => inAirlock(p, n));
  const missing = members.filter((p) => !isOperator(p) && !inAirlock(p, n));
  return missing.length === 0 && inside.length > 0 ? inside : undefined;
}

system.runInterval(() => {
  if (!origin()) return;
  const players = world.getDimension(NETHER_ID).getPlayers();
  const group = players.length > 0 ? readyGroup(players) : undefined;
  if (!group) {
    held = 0;
    heldKey = "";
    return;
  }

  const key = `${isEventOn() ? currentStage() : 1}:${group.map((p) => p.id).sort().join(",")}`;
  if (key !== heldKey) {
    heldKey = key;
    held = 0;
    tell(group, "§7Everyone's in. Hold still...");
  }
  held++;
  if (held < HOLD_CHECKS) return;
  held = 0;
  heldKey = "";

  if (!isEventOn()) {
    sealParty(group);
    tell(group, "§6The gate slams shut behind you. The way into the prison is open.");
  } else {
    const next = currentStage() + 1;
    setStage(next);
    tell(group, `§6The airlock seals behind you. Room ${next} lies ahead.`);
  }
}, CHECK_TICKS);
