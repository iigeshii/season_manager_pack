import { world, system } from "@minecraft/server";

// ─────────────────────────────────────────────
//  NETHER PORTAL SWITCH
//  Opens or closes Nether portals for everyone, on its own — separate from
//  scriptevent season:toggle. Off (the default): the portal lock and
//  bounce-back in main.js keep everyone but operators out of the Nether.
//  On: anyone may light a Nether portal and travel. The End stays sealed
//  either way. Saved with the world.
//    /scriptevent season:nether_portals on|off
//    /scriptevent season:nether_portals        (shows the setting)
// ─────────────────────────────────────────────

const PROPERTY = "season:nether_portals_open";

export function netherPortalsOpen() {
  return world.getDynamicProperty(PROPERTY) === true;
}

// Also used by the Mending Rescue seal, which closes portals behind the party.
export function setNetherPortalsOpen(open) {
  world.setDynamicProperty(PROPERTY, open);
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "season:nether_portals") return;
  const arg = event.message.trim().toLowerCase();
  if (arg === "on" || arg === "off") setNetherPortalsOpen(arg === "on");
  const reply = `§6Nether portals: ${netherPortalsOpen() ? "open to everyone" : "closed (operators only)"}.`;
  const source = event.sourceEntity;
  if (source?.typeId === "minecraft:player") source.sendMessage(reply);
  else console.warn(reply);
});
