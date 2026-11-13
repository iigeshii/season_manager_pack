import { world, system } from "@minecraft/server";

// ─────────────────────────────────────────────
//  NETHER PORTAL SWITCH
//  Opens or closes Nether portals for everyone, on its own — separate from
//  scriptevent season:toggle. Off (the default): the portal lock and
//  bounce-back in main.js keep everyone but operators out of the Nether,
//  and switching off sends anyone already there home at once (except
//  operators and a running Mending Rescue party).
//  On: anyone may light a Nether portal and travel. The End stays sealed
//  either way. Saved with the world.
//    /scriptevent season:nether_portals on|off
//    /scriptevent season:nether_portals        (shows the setting)
// ─────────────────────────────────────────────

const PROPERTY = "season:nether_portals_open";

export function netherPortalsOpen() {
  return world.getDynamicProperty(PROPERTY) === true;
}

// What portals actually do right now, in one of three states:
//   open      the switch is on: anyone may come in (held to Room 1 to gather)
//   run only  a Mending Rescue run can be joined: anyone coming in joins
//             the party at its checkpoint (mending_rescue.js says when)
//   closed    operators only
// "run only" wins over the switch, since joining happens first.
let runOnly = () => false;
export function setRunOnlyCheck(check) {
  runOnly = check;
}
export function describePortals() {
  if (runOnly()) return "run only (anyone coming in joins the rescue party at its checkpoint)";
  return netherPortalsOpen() ? "open (anyone may come in)" : "closed (operators only)";
}

// Run whenever portals are switched off; each returns how many players it
// moved. Mending Rescue registers the one that sends people out of the
// Nether (it knows who's in a party).
const closeHandlers = [];
export function onNetherPortalsClosed(handler) {
  closeHandlers.push(handler);
}

// Also used by the Mending Rescue seal, which closes portals behind the
// party. Returns how many players were sent out of the Nether.
export function setNetherPortalsOpen(open) {
  world.setDynamicProperty(PROPERTY, open);
  if (open) return 0;
  return closeHandlers.reduce((sent, handler) => sent + handler(), 0);
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:nether_portals") return;
  const arg = event.message.trim().toLowerCase();
  const sent = arg === "on" || arg === "off" ? setNetherPortalsOpen(arg === "on") : 0;
  const moved = arg === "off" ? ` Sent ${sent} player${sent === 1 ? "" : "s"} out of the Nether.` : "";
  const reply = `§6Nether portals: ${describePortals()}. §7Switch: ${netherPortalsOpen() ? "on" : "off"}.${moved}`;
  const source = event.sourceEntity;
  if (source?.typeId === "minecraft:player") source.sendMessage(reply);
  else console.warn(reply);
});
