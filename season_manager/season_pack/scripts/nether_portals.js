import { world, system } from "@minecraft/server";

// ─────────────────────────────────────────────
//  NETHER PORTALS
//  Whether anyone but an operator may light or go through a Nether portal.
//  There's no switch of its own: the Mending Rescue phase decides it
//  (dungeon/mending_rescue.js registers the check). Open while the rescue
//  is gathering or running, closed otherwise. The portal lock and
//  bounce-back in main.js enforce it. The End stays sealed either way.
//    /scriptevent season:nether_portals        (shows the state)
// ─────────────────────────────────────────────

const OLD_SWITCH = "season:nether_portals_open"; // the old on/off switch, no longer used

let status = () => ({ open: false, text: "closed (operators only)" });

// Mending Rescue sets this: returns { open, text } for right now.
export function setPortalStatus(check) {
  status = check;
}

export function netherPortalsOpen() {
  return status().open;
}

export function describePortals() {
  return status().text;
}

system.run(() => world.setDynamicProperty(OLD_SWITCH, undefined));

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:nether_portals") return;
  const arg = event.message.trim().toLowerCase();
  const note = arg ? " §7Portals follow the Mending Rescue: open with §fmending_rescue start§7, close with §fmending_rescue reset§7." : "";
  const reply = `§6Nether portals: ${describePortals()}.${note}`;
  const source = event.sourceEntity;
  if (source?.typeId === "minecraft:player") source.sendMessage(reply);
  else console.warn(reply);
});
