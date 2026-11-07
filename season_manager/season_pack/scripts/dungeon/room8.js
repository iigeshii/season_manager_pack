import { world, system, BlockPermutation } from "@minecraft/server";
import { isOperator, spawnDungeonMob } from "./nether_rules.js";
import { LAYOUT } from "./layout.js";
import { P, NETHER_ID, origin, isEventOn } from "./run_state.js";
import { currentStage, isMember, resetEvent, sendHome } from "./mending_rescue.js";

// ─────────────────────────────────────────────
//  ROOM 8: THE LIBRARIAN'S CELL (finale)
//  When the run reaches Room 8, the librarian is in his cell: a librarian
//  with no trades yet (villager_v2 "season:become_empty_librarian"; Mending
//  comes later, by retraining him), unhurtable.
//
//  Once every online non-operator party member is in the hall (and at
//  least one party member): a pause, he thanks them in chat, the cell door
//  opens and the portal lights. A minecart appears on rails laid along the
//  red runner, he gets in, and it rolls him to the portal — where he and
//  the cart vanish in a burst of particles (he never actually travels).
//  The rescue is announced to the whole server and written to the content
//  log (date and party, for the Hall of Heroes). Thirty seconds later
//  everyone left in the Nether is sent home and the whole event resets.
//
//  Anyone stepping into the portal meanwhile is sent home rather than
//  through it. Put back (bars, portal out, rails and leftovers gone) when
//  the run moves past Room 8 or ends. A restart mid-finale ends the run.
//
//  Bring him back to the village later with
//    /function season/summon_rescued_librarian  (him, in a minecart)
// ─────────────────────────────────────────────

const R = LAYOUT.room8;
const STAGE = 8;
const TICKS = 2;
const THANKS_AT = 60; // ticks after the party is in: first line
const THANKS_2_AT = 120;
const OPEN_AT = 160; // cell door opens, portal lights
const CART_AT = 200; // the minecart appears and he gets in
const RIDE_TIMEOUT = 300; // vanish anyway if the cart hasn't arrived in 15 s
const CLOSING_AT = 400; // ticks after he's gone: "the portal is closing"
const KICK_AT = 600; // 30 s after he's gone: everyone home, full reset
const PUSH = 0.15; // minecart nudge per step when it slows down

const TAG = "season:room8";
const RUN = P + "room8_run";

// Rails along the runner: east for the first cells, the corner, then north.
const RAIL = "minecraft:rail";
function railDirection(i) {
  const [x, , z] = R.path[i];
  const next = R.path[i + 1];
  const prev = R.path[i - 1];
  const turnsNorth = next && next[0] === x && prev && prev[2] === z; // came from the west, goes north
  if (turnsNorth) return 8; // north_west curve
  if (next ? next[0] !== x : prev[0] !== x) return 1; // east-west
  return 0; // north-south
}

let finale = undefined; // { phase, start, cart, librarian, rideStart, goneAt }

// ── Helpers ─────────────────────────────────

const currentRun = () => world.getDynamicProperty(P + "run") ?? 0;

function at(rel, dx = 0, dz = 0) {
  const o = origin();
  return { x: o.x + rel[0] + dx, y: o.y + rel[1], z: o.z + rel[2] + dz };
}

function blockAt(rel) {
  try {
    return world.getDimension(NETHER_ID).getBlock(at(rel));
  } catch {
    return undefined; // chunk not loaded
  }
}

function swap(rel, from, perm) {
  const block = blockAt(rel);
  if (block && block.typeId === from) block.setPermutation(perm);
}

function partyHere() {
  return world.getDimension(NETHER_ID).getPlayers().filter(isMember);
}

function tell(players, message) {
  for (const player of players) player.sendMessage(message);
}

function sound(id) {
  for (const player of world.getDimension(NETHER_ID).getPlayers()) {
    try {
      player.playSound(id);
    } catch {
      // unknown sound: skip
    }
  }
}

function relOf(location) {
  const o = origin();
  return [Math.floor(location.x) - o.x, Math.floor(location.y) - o.y, Math.floor(location.z) - o.z];
}

function inHall(player) {
  const [x, y, z] = relOf(player.location);
  const [x1, y1, z1, x2, y2, z2] = R.hall;
  return x >= x1 && x <= x2 && y >= y1 && y <= y2 && z >= z1 && z <= z2;
}

const AIR = BlockPermutation.resolve("minecraft:air");
const BARS = BlockPermutation.resolve("minecraft:iron_bars");
const PORTAL = BlockPermutation.resolve("minecraft:portal", R.portal_states);

function setCellDoor(open) {
  for (const p of R.cell_door) {
    if (open) swap(p, "minecraft:iron_bars", AIR);
    else swap(p, "minecraft:air", BARS);
  }
}

function setPortal(lit) {
  for (const p of R.portal) {
    if (lit) swap(p, "minecraft:air", PORTAL);
    else swap(p, "minecraft:portal", AIR);
  }
}

function setRails(present) {
  R.path.forEach((p, i) => {
    if (present) swap(p, "minecraft:air", BlockPermutation.resolve(RAIL, { rail_direction: railDirection(i) }));
    else swap(p, RAIL, AIR);
  });
}

function removeOurs() {
  for (const entity of world.getDimension(NETHER_ID).getEntities({ tags: [TAG] })) entity.remove();
}

// ── The librarian ───────────────────────────

// Whether the cell's chunk is loaded and ticking. Right after the run
// reaches Room 8 (or a jump, or a restart) it often isn't yet; spawning or
// deciding anything before then fails or misreads the room.
function cellLoaded() {
  return blockAt([Math.floor(R.librarian.x), R.librarian.y, Math.floor(R.librarian.z)]) !== undefined;
}

function spawnLibrarian() {
  const nether = world.getDimension(NETHER_ID);
  const spot = at([R.librarian.x, R.librarian.y, R.librarian.z]);
  let librarian;
  try {
    librarian = spawnDungeonMob(nether, "minecraft:villager_v2", spot);
  } catch {
    return undefined; // not loaded after all: try again next check
  }
  librarian.addTag(TAG);
  librarian.triggerEvent("season:become_empty_librarian");
  try {
    librarian.teleport(spot, { rotation: { x: 0, y: R.librarian.yaw } });
  } catch {
    // facing is cosmetic
  }
  return librarian;
}

function findLibrarian() {
  return world.getDimension(NETHER_ID).getEntities({ tags: [TAG], type: "minecraft:villager_v2" })[0];
}

// Particles that need no Molang variables passed in (portal_reverse_particle
// needs a direction this API version can't supply, and logs errors).
const VANISH_PARTICLES = ["minecraft:endrod", "minecraft:villager_happy"];

function vanish(location) {
  const nether = world.getDimension(NETHER_ID);
  for (let i = 0; i < 16; i++) {
    try {
      nether.spawnParticle(VANISH_PARTICLES[i % VANISH_PARTICLES.length], {
        x: location.x + (Math.random() - 0.5) * 2,
        y: location.y + Math.random() * 2,
        z: location.z + (Math.random() - 0.5) * 2,
      });
    } catch {
      // unknown particle: skip
    }
  }
  sound("mob.endermen.portal");
  removeOurs();
  setRails(false);
}

function recordRescue(party) {
  const names = party.map((p) => p.name);
  world.sendMessage(`§6The librarian is free! Rescued by ${names.join(", ") || "the party"}.`);
  console.warn(`[Mending Rescue] Librarian rescued ${new Date().toISOString()} (run ${currentRun()}) by: ${names.join(", ")}`);
}

// ── Set up and put back ─────────────────────

function setUp() {
  if (!cellLoaded()) return; // wait until the cell is loaded
  removeOurs();
  setRails(false);
  setPortal(false);
  setCellDoor(false);
  if (!spawnLibrarian()) return;
  finale = { phase: "waiting" };
  world.setDynamicProperty(RUN, currentRun());
}

function putBack() {
  finale = undefined;
  removeOurs();
  setRails(false);
  setPortal(false);
  setCellDoor(false);
  world.setDynamicProperty(RUN, undefined);
}

// ── Main loop ───────────────────────────────

system.runInterval(() => {
  if (!origin()) return;
  const nether = world.getDimension(NETHER_ID);
  if (nether.getPlayers().length === 0) return; // chunks likely unloaded

  const active = isEventOn() && currentStage() === STAGE;
  if (!active) {
    if (world.getDynamicProperty(RUN) !== undefined) putBack();
    return;
  }
  if (world.getDynamicProperty(RUN) !== currentRun()) {
    setUp();
    return;
  }
  if (!finale) {
    // A restart mid-room: if he's still caged, carry on; otherwise end the
    // run. Only decide once the cell is loaded (he can't be seen before).
    if (!cellLoaded()) return;
    if (findLibrarian() && blockAt(R.cell_door[0])?.typeId === "minecraft:iron_bars") finale = { phase: "waiting" };
    else {
      resetEvent();
      return;
    }
  }

  // Nobody leaves through the portal: anyone stepping in is sent home.
  for (const player of nether.getPlayers()) {
    if (isOperator(player)) continue;
    if (blockAt(relOf(player.location))?.typeId === "minecraft:portal") sendHome(player, "§7You've been sent home.");
  }

  const party = partyHere();
  const now = system.currentTick;
  switch (finale.phase) {
    case "waiting": {
      if (cellLoaded() && !findLibrarian()) spawnLibrarian(); // e.g. removed by an operator
      if (party.filter((p) => !isOperator(p)).every(inHall) && party.some(inHall)) {
        finale = { phase: "thanks", start: now };
      }
      return;
    }
    case "thanks": {
      const t = now - finale.start;
      if (t >= THANKS_AT && !finale.said1) {
        finale.said1 = true;
        tell(party, "§e<Librarian> §fYou came. After all these years, someone came.");
      }
      if (t >= THANKS_2_AT && !finale.said2) {
        finale.said2 = true;
        tell(party, "§e<Librarian> §fCome — let's go home. I have so much to teach your village.");
      }
      if (t >= OPEN_AT && !finale.opened) {
        finale.opened = true;
        setCellDoor(true);
        setPortal(true);
        sound("random.door_open");
      }
      if (t >= CART_AT) {
        setRails(true);
        const librarian = findLibrarian();
        const cart = nether.spawnEntity("minecraft:minecart", at(R.path[0], 0.5, 0.5));
        cart.addTag(TAG);
        try {
          if (librarian) cart.getComponent("minecraft:rideable")?.addRider(librarian);
        } catch {
          // couldn't seat him: he vanishes with the cart anyway
        }
        finale = { phase: "ride", cart, rideStart: now };
      }
      return;
    }
    case "ride": {
      const cart = finale.cart;
      const end = R.path[R.path.length - 1];
      const arrived = cart?.isValid() && relOf(cart.location)[2] <= end[2];
      if (!cart?.isValid() || arrived || now - finale.rideStart > RIDE_TIMEOUT) {
        vanish(cart?.isValid() ? cart.location : at(end, 0.5, 0.5));
        recordRescue(party);
        finale = { phase: "farewell", goneAt: now };
        return;
      }
      // Keep it rolling: east to the corner, then north to the portal.
      const v = cart.getVelocity();
      if (Math.abs(v.x) + Math.abs(v.z) < 0.2) {
        const [cx] = relOf(cart.location);
        cart.applyImpulse(cx < R.path.find((p, i) => railDirection(i) === 8)[0] ? { x: PUSH, y: 0, z: 0 } : { x: 0, y: 0, z: -PUSH });
      }
      return;
    }
    case "farewell": {
      const t = now - finale.goneAt;
      if (t >= CLOSING_AT && !finale.warned) {
        finale.warned = true;
        tell(party, "§7The portal is closing...");
      }
      if (t >= KICK_AT) {
        finale = { phase: "done" };
        resetEvent(); // everyone home, everything back for the next group
      }
      return;
    }
    default:
      return;
  }
}, TICKS);
