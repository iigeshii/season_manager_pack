import { world, system, BlockPermutation, ItemStack, EnchantmentTypes, EquipmentSlot } from "@minecraft/server";

// ─────────────────────────────────────────────
//  LIBRARY FRAME TEST (temporary)
//  A throwaway test rig for the Mystic Library token board: answers
//  whether the pack can build a framed book, catch token clicks on it,
//  protect it, and save/load it as a structure with the book still in
//  the frame. Delete once the real board is built.
//
//    /scriptevent season:library_test place   build a test frame + sign in front of you
//    /scriptevent season:library_test decoy   get a decoy book to put in the frame
//    /scriptevent season:library_test save    save the rig (with its book) as a structure
//    /scriptevent season:library_test load    load that structure in front of you, turned to your facing
//    /scriptevent season:library_test clear   remove every test rig
// ─────────────────────────────────────────────

const EVENT_ID = "season:library_test";
const TOKEN_ID = "newhaven:wyatt_token";
const STATE_KEY = "season:library_frame_test";
const STRUCTURE = "season:library_frame_test";
const BOOK_STRUCTURE = "season:library_frame_test_book"; // just the framed book, for putting it back
const DECOY_LORE = "§7Display copy";
const SIGN_BLOCK = "minecraft:crimson_wall_sign"; // the id room8_rewards.js already uses

// facing_direction for frames and wall signs, and the step one block that way.
const DIRS = {
  north: { dx: 0, dz: -1, facing: 2 },
  south: { dx: 0, dz: 1, facing: 3 },
  west: { dx: -1, dz: 0, facing: 4 },
  east: { dx: 1, dz: 0, facing: 5 },
};
const OPPOSITE = { north: "south", south: "north", west: "east", east: "west" };
const CLOCKWISE = ["north", "east", "south", "west"];

// ── State ───────────────────────────────────

function loadState() {
  try {
    return JSON.parse(world.getDynamicProperty(STATE_KEY) ?? "null") ?? { rigs: [], saved: null, clicks: 0 };
  } catch {
    return { rigs: [], saved: null, clicks: 0 };
  }
}

function saveState(state) {
  world.setDynamicProperty(STATE_KEY, JSON.stringify(state));
}

// ── Geometry ────────────────────────────────

function lookDirection(player) {
  const yaw = ((player.getRotation().y % 360) + 360) % 360; // 0 south, 90 west, 180 north, 270 east
  if (yaw >= 45 && yaw < 135) return "west";
  if (yaw >= 135 && yaw < 225) return "north";
  if (yaw >= 225 && yaw < 315) return "east";
  return "south";
}

// The rig sits two blocks ahead: a frame at eye height over a sign, both
// hung on a two-block obsidian backing behind them, facing the player.
function rigLayout(player) {
  const look = lookDirection(player);
  const d = DIRS[look];
  const p = player.location;
  const bx = Math.floor(p.x);
  const by = Math.floor(p.y);
  const bz = Math.floor(p.z);
  const front = { x: bx + 2 * d.dx, z: bz + 2 * d.dz };
  const back = { x: bx + 3 * d.dx, z: bz + 3 * d.dz };
  return {
    dim: player.dimension.id,
    look,
    frame: { x: front.x, y: by + 1, z: front.z },
    sign: { x: front.x, y: by, z: front.z },
    backing: [
      { x: back.x, y: by, z: back.z },
      { x: back.x, y: by + 1, z: back.z },
    ],
  };
}

function rigBlocks(rig) {
  return [rig.frame, rig.sign, ...rig.backing];
}

function rigMin(rig) {
  const all = rigBlocks(rig);
  return {
    x: Math.min(...all.map((b) => b.x)),
    y: Math.min(...all.map((b) => b.y)),
    z: Math.min(...all.map((b) => b.z)),
  };
}

function rigMax(rig) {
  const all = rigBlocks(rig);
  return {
    x: Math.max(...all.map((b) => b.x)),
    y: Math.max(...all.map((b) => b.y)),
    z: Math.max(...all.map((b) => b.z)),
  };
}

const same = (block, pos) => block.x === pos.x && block.y === pos.y && block.z === pos.z;
const fmt = (pos) => `${pos.x} ${pos.y} ${pos.z}`;

function findRig(block, part) {
  const state = loadState();
  return state.rigs.find(
    (rig) => rig.dim === block.dimension.id && (part ? same(block, rig[part]) : rigBlocks(rig).some((pos) => same(block, pos)))
  );
}

// ── Building ────────────────────────────────

function signText(state) {
  return `§lFrame test§r\nToken clicks: ${state.clicks}`;
}

function writeSign(dimension, pos, state) {
  const sign = dimension.getBlock(pos)?.getComponent("minecraft:sign");
  sign?.setText(signText(state));
  sign?.setWaxed(true);
}

function place(player, reply) {
  const rig = rigLayout(player);
  const dimension = player.dimension;
  const face = DIRS[OPPOSITE[rig.look]].facing;
  const report = [];

  for (const pos of rig.backing) dimension.getBlock(pos)?.setPermutation(BlockPermutation.resolve("minecraft:obsidian"));

  try {
    dimension.getBlock(rig.frame).setPermutation(BlockPermutation.resolve("minecraft:frame", { facing_direction: face }));
    report.push("§aFrame placed.");
  } catch (error) {
    report.push(`§cFrame failed: ${error}`);
  }

  const state = loadState();
  try {
    dimension.getBlock(rig.sign).setPermutation(BlockPermutation.resolve(SIGN_BLOCK, { facing_direction: face }));
    writeSign(dimension, rig.sign, state);
    report.push("§aSign placed and written.");
  } catch (error) {
    report.push(`§cSign failed: ${error}`);
  }

  // Can the script put a book in the frame by itself?
  const frame = dimension.getBlock(rig.frame);
  const found = ["minecraft:item_frame", "minecraft:frame", "item_frame"].filter((id) => {
    try {
      return frame?.getComponent(id) !== undefined;
    } catch {
      return false;
    }
  });
  report.push(found.length ? `§eFrame component found: ${found.join(", ")}` : "§7No frame component exposed to scripts.");
  try {
    dimension.runCommand(`replaceitem block ${fmt(rig.frame)} slot.container 0 enchanted_book`);
    report.push("§eThe replaceitem command ran: check whether a book appeared.");
  } catch (error) {
    report.push(`§7replaceitem on the frame failed: ${String(error).slice(0, 80)}`);
  }

  state.rigs.push(rig);
  saveState(state);
  reply([`§6Test rig placed at ${fmt(rig.frame)} facing ${OPPOSITE[rig.look]}.`, ...report].join("\n"));
}

function decoyBook(name) {
  const book = new ItemStack("minecraft:enchanted_book", 1);
  book.getComponent("minecraft:enchantable").addEnchantment({ type: EnchantmentTypes.get("vanishing"), level: 1 });
  book.nameTag = `§b${name}`;
  book.setLore([DECOY_LORE]);
  return book;
}

function giveDecoy(player, name, reply) {
  const container = player.getComponent("minecraft:inventory").container;
  const left = container.addItem(decoyBook(name));
  if (left) player.dimension.spawnItem(left, player.location);
  reply(`§aGave a decoy "${name}" book. Put it in the test frame with an empty-handed or book-in-hand right-click.`);
}

function saveRig(player, reply) {
  const state = loadState();
  const rig = state.rigs.at(-1);
  if (!rig) return reply("§cPlace a test rig first.");
  const from = rigMin(rig);
  const to = rigMax(rig);
  try {
    const dimension = world.getDimension(rig.dim);
    dimension.runCommand(`structure save ${STRUCTURE} ${fmt(from)} ${fmt(to)} true disk true`);
    dimension.runCommand(`structure save ${BOOK_STRUCTURE} ${fmt(rig.frame)} ${fmt(rig.frame)} false disk true`);
  } catch (error) {
    return reply(`§cStructure save failed: ${error}`);
  }
  state.saved = { look: rig.look };
  saveState(state);
  reply(
    `§aSaved the newest rig (${fmt(from)} to ${fmt(to)}) as ${STRUCTURE}, and its framed book on its own.\n` +
      "§eFrom now on, a book punched out of any test frame is put back automatically."
  );
}

function loadRig(player, reply) {
  const state = loadState();
  if (!state.saved) return reply("§cSave a rig first.");
  const rig = rigLayout(player);
  const rotation = rotationFrom(state.saved.look, rig.look);
  try {
    player.dimension.runCommand(`structure load ${STRUCTURE} ${fmt(rigMin(rig))} ${rotation}`);
  } catch (error) {
    return reply(`§cStructure load failed: ${error}`);
  }
  state.rigs.push(rig);
  saveState(state);
  reply(
    `§aLoaded the saved rig in front of you (turned ${rotation.replace("_degrees", "°")}).\n` +
      "§eCheck: is the book still in the frame, and does the frame face you?"
  );
}

function rotationFrom(savedLook, look) {
  const steps = (CLOCKWISE.indexOf(look) - CLOCKWISE.indexOf(savedLook) + 4) % 4;
  return `${steps * 90}_degrees`;
}

// Clears any decoy that dropped by the frame, then reloads the framed book.
function restoreBook(rig) {
  const state = loadState();
  if (!state.saved) return false;
  const dimension = world.getDimension(rig.dim);
  const center = { x: rig.frame.x + 0.5, y: rig.frame.y + 0.5, z: rig.frame.z + 0.5 };
  let cleared = 0;
  for (const entity of dimension.getEntities({ type: "minecraft:item", location: center, maxDistance: 3 })) {
    const stack = entity.getComponent("minecraft:item")?.itemStack;
    if (stack?.getLore().includes(DECOY_LORE)) {
      entity.remove();
      cleared++;
    }
  }
  dimension.runCommand(`structure load ${BOOK_STRUCTURE} ${fmt(rig.frame)} ${rotationFrom(state.saved.look, rig.look)}`);
  return cleared;
}

function clearRigs(reply) {
  const state = loadState();
  for (const rig of state.rigs) {
    const dimension = world.getDimension(rig.dim);
    for (const pos of rigBlocks(rig)) {
      try {
        dimension.getBlock(pos)?.setPermutation(BlockPermutation.resolve("minecraft:air"));
      } catch {
        // chunk not loaded
      }
    }
  }
  const count = state.rigs.length;
  saveState({ rigs: [], saved: state.saved, clicks: 0 });
  reply(`§aCleared ${count} test rig(s).`);
}

// ── Command ─────────────────────────────────

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== EVENT_ID) return;
  const player = event.sourceEntity?.typeId === "minecraft:player" ? event.sourceEntity : undefined;
  const reply = (text) => (player ? player.sendMessage(text) : console.warn(text));
  if (!player) return reply("Run this as a player.");
  const [word = "", ...args] = event.message.trim().split(/\s+/);

  switch (word.toLowerCase()) {
    case "place":
      return place(player, reply);
    case "decoy":
      return giveDecoy(player, args.join(" ") || "Sharpness", reply);
    case "save":
      return saveRig(player, reply);
    case "load":
      return loadRig(player, reply);
    case "clear":
      return clearRigs(reply);
    default:
      return reply("§7Use: /scriptevent season:library_test <place|decoy [name]|save|load|clear>");
  }
});

// ── Token clicks ────────────────────────────

const lastClick = new Map(); // player id -> tick; the event repeats while the button is held

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  const { block, player, itemStack } = event;
  if (block.typeId !== "minecraft:frame" || !findRig(block, "frame")) return;

  const now = system.currentTick;
  const repeat = now - (lastClick.get(player.id) ?? -100) < 10;
  lastClick.set(player.id, now);

  if (itemStack?.typeId !== TOKEN_ID) {
    // Let it through so a decoy book can be put in the frame.
    if (!repeat) system.run(() => player.sendMessage(`§7Frame click with ${itemStack?.typeId ?? "an empty hand"}: let through.`));
    return;
  }

  event.cancel = true;
  if (repeat) return;
  system.run(() => {
    const equippable = player.getComponent("minecraft:equippable");
    const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId !== TOKEN_ID) return;
    if (held.amount > 1) {
      held.amount -= 1;
      equippable.setEquipment(EquipmentSlot.Mainhand, held);
    } else {
      equippable.setEquipment(EquipmentSlot.Mainhand);
    }
    const state = loadState();
    state.clicks += 1;
    saveState(state);
    const rig = findRig(block, "frame");
    if (rig) writeSign(world.getDimension(rig.dim), rig.sign, state);
    player.sendMessage(`§aToken caught (${state.clicks} so far). §eDid the frame keep its book?`);
  });
});

// ── Explosions ──────────────────────────────

// Creepers, TNT and the rest still go off, but the rig's blocks are taken
// off the list of blocks the explosion destroys.
world.beforeEvents.explosion.subscribe((event) => {
  const blocks = event.getImpactedBlocks();
  const kept = blocks.filter((block) => !findRig(block));
  if (kept.length === blocks.length) return;
  event.setImpactedBlocks(kept);
  const spared = blocks.length - kept.length;
  system.run(() => world.sendMessage(`§aExplosion: ${spared} test rig block(s) spared. §eAre the frame, book and sign all still there?`));
});
// ── Protection ──────────────────────────────

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  const rig = findRig(event.block);
  if (!rig) return;
  event.cancel = true;
  const player = event.player;
  const hitSign = same(event.block, rig.sign);
  system.run(() => player.sendMessage("§aBreak blocked on the test rig."));
  // A cancelled break on a sign wipes its text, so write it straight back.
  if (hitSign) system.runTimeout(() => writeSign(world.getDimension(rig.dim), rig.sign, loadState()), 2);
});

world.afterEvents.entityHitBlock.subscribe((event) => {
  const { damagingEntity, hitBlock } = event;
  if (damagingEntity?.typeId !== "minecraft:player" || hitBlock.typeId !== "minecraft:frame") return;
  const rig = findRig(hitBlock, "frame");
  if (!rig) return;
  if (!loadState().saved) {
    damagingEntity.sendMessage("§eYou hit the test frame. Run save first to have its book put back automatically.");
    return;
  }
  // Punching a frame in survival takes its item out, and that can't be cancelled.
  // So put the book back a moment later, and take the dropped decoy away.
  system.runTimeout(() => {
    try {
      const cleared = restoreBook(rig);
      damagingEntity.sendMessage(
        `§aBook put back${cleared ? `, dropped decoy removed` : ""}. §eDid it come back, and is the dropped book gone?`
      );
    } catch (error) {
      damagingEntity.sendMessage(`§cCouldn't put the book back: ${error}`);
    }
  }, 2);
});
