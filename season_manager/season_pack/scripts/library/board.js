import { world, system, BlockPermutation, ItemStack, EnchantmentTypes, EquipmentSlot } from "@minecraft/server";
import { GROUPS, BOOKS, ROMAN } from "./books.js";
import { isOpen, bookStatus, addTokens, emeralds, onLedgerChange } from "./ledger.js";

// ─────────────────────────────────────────────
//  MYSTIC LIBRARY: THE TOKEN BOARD
//  One 17 × 6 wall for the whole library. Each book has a frame holding a
//  decoy copy (a Curse of Vanishing book with the real book's name) and a
//  status sign under it; each group has a name sign above its books.
//  Players right-click a book's frame with a Wyatt Token to put the token
//  toward that book.
//
//  Scripts can't put items into frames, so the first board is filled by
//  hand once and then saved as a structure ("capture"). After that the
//  board is always placed from the saved copy, and a book punched out of
//  its frame is put back from a saved copy of that one frame.
//
//  Layout, as seen by someone facing it (row 5 at the top):
//    rows 3-5, top band:    Mending | General | Fishing | Armor | Melee | Tools   (17 columns)
//    rows 0-2, bottom band: Ranged | Fire | Water                                (16 columns)
//  In each band: group name signs on top, frames in the middle, status signs below.
// ─────────────────────────────────────────────

const TOKEN_ID = "newhaven:wyatt_token";
const DECOY_LORE = "§7Display copy";
const BOARD_KEY = "season:library_board"; // where the board stands now
const CAPTURE_KEY = "season:library_board_capture"; // the saved, filled-in board
const BOARD_STRUCTURE = "season:library_board";
const bookStructure = (book) => `season:library_book_${book.id}`;

const WIDTH = 17;
const HEIGHT = 6;
const BACKING = "minecraft:obsidian";
const SIGN_BLOCKS = ["minecraft:birch_wall_sign", "minecraft:crimson_wall_sign"]; // first one that resolves
const REPAIR_INTERVAL = 1200; // ticks: check and rebuild the board every 60 s

// Blocks that may be in the way when a board is placed without `force`.
const CLEARABLE = new Set([
  "minecraft:air",
  "minecraft:short_grass",
  "minecraft:tall_grass",
  "minecraft:fern",
  "minecraft:large_fern",
  "minecraft:snow_layer",
  "minecraft:dandelion",
  "minecraft:poppy",
]);

// facing_direction for frames and wall signs, and the step one block that way.
const DIRS = {
  north: { dx: 0, dz: -1, facing: 2 },
  south: { dx: 0, dz: 1, facing: 3 },
  west: { dx: -1, dz: 0, facing: 4 },
  east: { dx: 1, dz: 0, facing: 5 },
};
const OPPOSITE = { north: "south", south: "north", west: "east", east: "west" };
const CLOCKWISE = ["north", "east", "south", "west"];
const RIGHT_OF = { north: "east", east: "south", south: "west", west: "north" };

// ── The layout ──────────────────────────────

// [band base row, [group ids in order]]
const BANDS = [
  [3, ["mending", "general", "fishing", "armor", "melee", "tools"]],
  [0, ["ranged", "fire", "water"]],
];

// Every board cell in board terms: column (0 = left as you face it), row
// (0 = bottom), depth (0 = the backing wall, 1 = the face hung on it).
const CELLS = (() => {
  const cells = [];
  for (let col = 0; col < WIDTH; col++) {
    for (let row = 0; row < HEIGHT; row++) cells.push({ kind: "backing", col, row, depth: 0 });
  }
  for (const [base, groupIds] of BANDS) {
    let col = 0;
    for (const groupId of groupIds) {
      const group = GROUPS.find((g) => g.id === groupId);
      const first = col;
      for (const book of group.books) {
        cells.push({ kind: "frame", col, row: base + 1, depth: 1, book });
        cells.push({ kind: "status", col, row: base, depth: 1, book });
        col++;
      }
      cells.push({ kind: "group", col: Math.floor((first + col - 1) / 2), row: base + 2, depth: 1, group });
    }
  }
  return cells;
})();

function lookDirection(player) {
  const yaw = ((player.getRotation().y % 360) + 360) % 360; // 0 south, 90 west, 180 north, 270 east
  if (yaw >= 45 && yaw < 135) return "west";
  if (yaw >= 135 && yaw < 225) return "north";
  if (yaw >= 225 && yaw < 315) return "east";
  return "south";
}

// The board's backing wall stands 3 blocks ahead of where the command was
// run, centred on that spot, with its bottom row at foot level.
function worldPos(board, cell) {
  const d = DIRS[board.look];
  const r = DIRS[RIGHT_OF[board.look]];
  const ahead = 3 - cell.depth;
  const across = cell.col - Math.floor(WIDTH / 2);
  return {
    x: board.anchor.x + ahead * d.dx + across * r.dx,
    y: board.anchor.y + cell.row,
    z: board.anchor.z + ahead * d.dz + across * r.dz,
  };
}

function bounds(board) {
  const all = CELLS.map((cell) => worldPos(board, cell));
  const pick = (f, axis) => f(...all.map((p) => p[axis]));
  return {
    min: { x: pick(Math.min, "x"), y: pick(Math.min, "y"), z: pick(Math.min, "z") },
    max: { x: pick(Math.max, "x"), y: pick(Math.max, "y"), z: pick(Math.max, "z") },
  };
}

const fmt = (pos) => `${pos.x} ${pos.y} ${pos.z}`;
const keyOf = (dimId, pos) => `${dimId}|${pos.x}|${pos.y}|${pos.z}`;

// ── Saved state ─────────────────────────────

function readJson(key) {
  try {
    const text = world.getDynamicProperty(key);
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key, value) {
  world.setDynamicProperty(key, value === undefined ? undefined : JSON.stringify(value));
}

let board; // { dim, anchor, look, filling, placed: { bookId: true } } or undefined
let capture; // { look, flip } or undefined
let cellIndex = new Map(); // keyOf(dim, pos) -> cell, for the current board
let loaded = false;

function loadBoard() {
  if (loaded) return;
  loaded = true;
  board = readJson(BOARD_KEY);
  capture = readJson(CAPTURE_KEY);
  reindex();
}

function saveBoard() {
  writeJson(BOARD_KEY, board);
  reindex();
}

function reindex() {
  cellIndex = new Map();
  if (!board) return;
  for (const cell of CELLS) cellIndex.set(keyOf(board.dim, worldPos(board, cell)), cell);
}

function cellAt(block) {
  loadBoard();
  return cellIndex.get(keyOf(block.dimension.id, block));
}

// ── Blocks ──────────────────────────────────

let signBlock;
function signBlockId() {
  if (signBlock) return signBlock;
  for (const id of SIGN_BLOCKS) {
    try {
      BlockPermutation.resolve(id, { facing_direction: 2 });
      return (signBlock = id);
    } catch {
      // not in this version
    }
  }
  return (signBlock = SIGN_BLOCKS.at(-1));
}

const faceDirection = () => DIRS[OPPOSITE[board.look]].facing;

function blockAt(pos) {
  try {
    return world.getDimension(board.dim).getBlock(pos);
  } catch {
    return undefined; // chunk not loaded
  }
}

function signText(cell) {
  if (cell.kind === "group") return `\n§l§5${cell.group.name}`;
  const book = cell.book;
  const s = bookStatus(book);
  const lines = [`§l${book.signName}`];
  if (s.level === 0) {
    lines.push("§8Locked", "");
  } else {
    lines.push(`Level ${ROMAN[s.level]} of ${ROMAN[book.max]}`, emeralds(s.price));
  }
  if (!isOpen()) lines.push("§8Library closed");
  else if (!s.next) lines.push("§2Complete");
  else if (s.next.kind === "level") lines.push(`§1${ROMAN[s.next.level]}: ${s.progress}/${s.next.cost} tokens`);
  else lines.push(`§1Cheaper: ${s.progress}/${s.next.cost}`);
  return lines.join("\n");
}

// Places (or fixes) one cell. `frames` says whether an empty frame may be
// put down where a frame is missing (only before the board is captured).
function placeCell(cell, { frames }) {
  const pos = worldPos(board, cell);
  const block = blockAt(pos);
  if (!block) return false;
  if (cell.kind === "backing") {
    if (block.typeId !== BACKING) block.setPermutation(BlockPermutation.resolve(BACKING));
    return true;
  }
  if (cell.kind === "frame") {
    if (block.typeId === "minecraft:frame") return true;
    if (capture && !board.filling) return restoreFrame(cell.book);
    if (frames) {
      block.setPermutation(BlockPermutation.resolve("minecraft:frame", { facing_direction: faceDirection() }));
      if (board.placed[cell.book.id]) {
        delete board.placed[cell.book.id];
        saveBoard();
      }
    }
    return true;
  }
  // A sign: put it back if it's gone, then make sure it says the right thing.
  const id = signBlockId();
  if (block.typeId !== id) block.setPermutation(BlockPermutation.resolve(id, { facing_direction: faceDirection() }));
  const sign = block.getComponent("minecraft:sign");
  if (!sign) return true;
  const text = signText(cell);
  if (sign.getText() !== text) sign.setText(text);
  if (!sign.isWaxed) sign.setWaxed(true);
  return true;
}

function refreshSigns() {
  loadBoard();
  if (!board) return;
  for (const cell of CELLS) {
    if (cell.kind !== "status" && cell.kind !== "group") continue;
    try {
      placeCell(cell, { frames: false });
    } catch (error) {
      console.warn(`[Library] Couldn't redraw a board sign: ${error}`);
    }
  }
}

// Checks every board block and fixes anything missing or wrong.
function repairBoard() {
  loadBoard();
  if (!board) return;
  for (const cell of CELLS) {
    try {
      placeCell(cell, { frames: true });
    } catch (error) {
      console.warn(`[Library] Couldn't repair the board: ${error}`);
    }
  }
}

function clearBoardBlocks() {
  for (const cell of CELLS) {
    const block = blockAt(worldPos(board, cell));
    if (block && block.typeId !== "minecraft:air") block.setPermutation(BlockPermutation.resolve("minecraft:air"));
  }
  removeDroppedDecoys(bounds(board), 2);
}

// Clears decoy books lying on the ground around an area.
function removeDroppedDecoys(area, margin) {
  const dimension = world.getDimension(board.dim);
  const center = {
    x: (area.min.x + area.max.x + 1) / 2,
    y: (area.min.y + area.max.y + 1) / 2,
    z: (area.min.z + area.max.z + 1) / 2,
  };
  const reach = Math.max(area.max.x - area.min.x, area.max.y - area.min.y, area.max.z - area.min.z) / 2 + 1 + margin;
  let removed = 0;
  for (const entity of dimension.getEntities({ type: "minecraft:item", location: center, maxDistance: reach })) {
    const stack = entity.getComponent("minecraft:item")?.itemStack;
    if (stack?.getLore().includes(DECOY_LORE)) {
      entity.remove();
      removed++;
    }
  }
  return removed;
}

// ── Structures ──────────────────────────────

function rotation(fromLook, toLook, flip) {
  let steps = (CLOCKWISE.indexOf(toLook) - CLOCKWISE.indexOf(fromLook) + 4) % 4;
  if (flip && steps % 2 === 1) steps = 4 - steps;
  return `${steps * 90}_degrees`;
}

function restoreFrame(book) {
  const cell = CELLS.find((c) => c.kind === "frame" && c.book === book);
  const pos = worldPos(board, cell);
  const dimension = world.getDimension(board.dim);
  dimension.runCommand(`structure load ${bookStructure(book)} ${fmt(pos)} ${rotation(capture.look, board.look, capture.flip)}`);
  return true;
}

// True when the frame where Mending belongs is a frame facing out from the wall.
function boardLooksRight() {
  const cell = CELLS.find((c) => c.kind === "frame" && c.book.id === "mending");
  const block = blockAt(worldPos(board, cell));
  return block?.typeId === "minecraft:frame" && block.permutation.getState("facing_direction") === faceDirection();
}

function loadCaptured(reply) {
  const dimension = world.getDimension(board.dim);
  const { min } = bounds(board);
  dimension.runCommand(`structure load ${BOARD_STRUCTURE} ${fmt(min)} ${rotation(capture.look, board.look, capture.flip)}`);
  // Some versions turn structures the other way: check, and if the board
  // came out mirrored, load it again turned the other way and remember that.
  system.runTimeout(() => {
    if (boardLooksRight()) return finishPlacing(reply);
    const steps = (CLOCKWISE.indexOf(board.look) - CLOCKWISE.indexOf(capture.look) + 4) % 4;
    if (steps % 2 === 0) return reply("§cThe board didn't come out right. Try placing it again.");
    clearBoardBlocks();
    capture.flip = !capture.flip;
    writeJson(CAPTURE_KEY, capture);
    dimension.runCommand(`structure load ${BOARD_STRUCTURE} ${fmt(min)} ${rotation(capture.look, board.look, capture.flip)}`);
    system.runTimeout(() => {
      if (boardLooksRight()) return finishPlacing(reply);
      reply("§cThe board didn't come out right. Try placing it again.");
    }, 2);
  }, 2);
}

function finishPlacing(reply) {
  refreshSigns();
  reply(`§aBoard placed at ${fmt(worldPos(board, CELLS[0]))}, facing ${OPPOSITE[board.look]}.`);
}

// ── Decoy books ─────────────────────────────

function decoyName(book) {
  return `§b${book.name}`;
}

function decoyBook(book) {
  const item = new ItemStack("minecraft:enchanted_book", 1);
  item.getComponent("minecraft:enchantable").addEnchantment({ type: EnchantmentTypes.get("vanishing"), level: 1 });
  item.nameTag = decoyName(book);
  item.setLore([DECOY_LORE]);
  return item;
}

const isDecoy = (item) => item?.typeId === "minecraft:enchanted_book" && item.getLore().includes(DECOY_LORE);

export function giveDecoys(player, reply) {
  const container = player.getComponent("minecraft:inventory").container;
  if (container.emptySlotsCount < BOOKS.length) {
    return reply(
      `§cYou need ${BOOKS.length} free inventory slots for the display books (you have ${container.emptySlotsCount}). ` +
        "Make room, then run §lboard books§r§c."
    );
  }
  for (const book of BOOKS) container.addItem(decoyBook(book));
  reply(`§aGave you all ${BOOKS.length} display books, in board order (top band left to right, then the bottom band).`);
}

// ── Commands (called from commands.js) ──────

function blockedCells(candidate) {
  let count = 0;
  const dimension = world.getDimension(candidate.dim);
  for (const cell of CELLS) {
    const pos = worldPos(candidate, cell);
    const block = dimension.getBlock(pos);
    if (!block) return -1; // not loaded
    if (!CLEARABLE.has(block.typeId) && !cellIndex.has(keyOf(candidate.dim, pos))) count++;
  }
  return count;
}

// `board [force|fresh]`: places the board in front of the player, or moves it there.
export function placeBoard(player, options, reply) {
  loadBoard();
  const candidate = {
    dim: player.dimension.id,
    anchor: { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) },
    look: lookDirection(player),
    filling: !capture || Boolean(options.fresh),
    placed: {},
  };
  const blocked = blockedCells(candidate);
  if (blocked < 0) return reply("§cPart of that spot isn't loaded. Move closer and try again.");
  if (blocked > 0 && !options.force) {
    return reply(
      `§c${blocked} block(s) are in the way of the ${WIDTH}×${HEIGHT} board. Clear the space, or run §lboard force§r§c to replace them.`
    );
  }

  if (board) clearBoardBlocks();
  board = candidate;
  saveBoard();

  if (!board.filling) return loadCaptured(reply);

  // An empty board, to be filled by hand and then captured.
  for (const cell of CELLS) placeCell(cell, { frames: true });
  refreshSigns();
  reply(
    `§aEmpty board built, facing ${OPPOSITE[board.look]}. Put each display book in the frame above its sign, then run §lboard capture§r§a.`
  );
  giveDecoys(player, reply);
}

export function removeBoard(reply) {
  loadBoard();
  if (!board) return reply("§7There's no board to remove.");
  clearBoardBlocks();
  board = undefined;
  saveBoard();
  reply("§aBoard removed. The ledger is untouched; §lboard§r§a puts it back.");
}

export function captureBoard(reply) {
  loadBoard();
  if (!board) return reply("§cBuild the board first with §lboard§r§c.");
  if (board.filling) {
    const missing = BOOKS.filter((book) => !board.placed[book.id]);
    if (missing.length) {
      return reply(
        `§c${missing.length} frame(s) still need their book: ${missing
          .slice(0, 8)
          .map((b) => b.name)
          .join(", ")}${missing.length > 8 ? ", …" : ""}.`
      );
    }
  }
  const dimension = world.getDimension(board.dim);
  const { min, max } = bounds(board);
  try {
    dimension.runCommand(`structure save ${BOARD_STRUCTURE} ${fmt(min)} ${fmt(max)} false disk true`);
    for (const cell of CELLS) {
      if (cell.kind !== "frame") continue;
      const pos = worldPos(board, cell);
      dimension.runCommand(`structure save ${bookStructure(cell.book)} ${fmt(pos)} ${fmt(pos)} false disk true`);
    }
  } catch (error) {
    return reply(`§cCouldn't save the board: ${error}`);
  }
  capture = { look: board.look, flip: capture?.flip ?? false };
  writeJson(CAPTURE_KEY, capture);
  board.filling = false;
  board.placed = {};
  saveBoard();
  reply("§aBoard captured. From now on §lboard§r§a places this saved copy, and punched-out books are put back automatically.");
}

export function boardInfo() {
  loadBoard();
  if (!board) return `§7No board placed.${capture ? " A captured board is saved; §lboard§r§7 places it." : ""}`;
  const placed = Object.keys(board.placed).length;
  const where = `§6Board§r at ${fmt(worldPos(board, CELLS[0]))} (${board.dim.replace("minecraft:", "")}), facing ${OPPOSITE[board.look]}.`;
  return board.filling ? `${where} Being filled: ${placed} of ${BOOKS.length} books placed.` : `${where} Captured and live.`;
}

// ── Players at the board ────────────────────

const lastClick = new Map(); // player id -> tick; the interact event repeats while the button is held

function takeOneToken(player) {
  const equippable = player.getComponent("minecraft:equippable");
  const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
  if (held?.typeId !== TOKEN_ID) return false;
  if (held.amount > 1) {
    held.amount -= 1;
    equippable.setEquipment(EquipmentSlot.Mainhand, held);
  } else {
    equippable.setEquipment(EquipmentSlot.Mainhand);
  }
  return true;
}

function deposit(player, book) {
  if (board.filling) return player.sendMessage("§7The board isn't finished yet.");
  if (!isOpen()) return player.sendMessage("§7The Mystic Library isn't open yet. Keep your token for now.");
  if (!bookStatus(book).next) return player.sendMessage(`§7${book.name} is complete. It can't take any more tokens.`);
  if (!takeOneToken(player)) return;
  addTokens(book, 1, player.name, "p");
  const s = bookStatus(book);
  const progress = s.next
    ? `${s.next.kind === "level" ? `Level ${ROMAN[s.next.level]}` : `next price drop`}: ${s.progress}/${s.next.cost}`
    : "complete!";
  player.sendMessage(`§aYour token went to §b${book.name}§a. ${progress}`);
}

function placeDecoy(player, book, held) {
  if (board.placed[book.id]) return player.sendMessage(`§7${book.name} is already in place.`);
  if (held.nameTag !== decoyName(book)) {
    return player.sendMessage(`§cThat's the wrong book. This frame is for §b${book.name}§c.`);
  }
  // The book goes in on its own (the click wasn't cancelled); record it.
  board.placed[book.id] = true;
  saveBoard();
  const placed = Object.keys(board.placed).length;
  player.sendMessage(
    placed === BOOKS.length
      ? `§a${book.name} placed. All ${BOOKS.length} are in: run §lboard capture§r§a.`
      : `§a${book.name} placed (${placed} of ${BOOKS.length}).`
  );
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  const { block, player, itemStack } = event;
  if (block.typeId !== "minecraft:frame") return;
  const cell = cellAt(block);
  if (cell?.kind !== "frame") return;

  const now = system.currentTick;
  const repeat = now - (lastClick.get(player.id) ?? -100) < 8;
  lastClick.set(player.id, now);

  // While the board is being filled, the right display book may go in.
  const filling = board.filling;
  if (filling && isDecoy(itemStack) && !board.placed[cell.book.id] && itemStack.nameTag === decoyName(cell.book)) {
    if (!repeat) system.run(() => placeDecoy(player, cell.book, itemStack));
    return;
  }

  // Everything else is cancelled, so books can't be turned or taken out.
  event.cancel = true;
  if (repeat) return;
  system.run(() => {
    if (itemStack?.typeId === TOKEN_ID) return deposit(player, cell.book);
    if (filling && isDecoy(itemStack)) return placeDecoy(player, cell.book, itemStack);
    if (!filling) player.sendMessage(`§7Hold a Wyatt Token and use it here to put it toward §b${cell.book.name}§7.`);
  });
});

// ── Protection ──────────────────────────────

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  const cell = cellAt(event.block);
  if (!cell) return;
  if (event.block.typeId === "minecraft:air") return;
  event.cancel = true;
  // A cancelled break wipes a sign's text, so write it straight back.
  if (cell.kind === "status" || cell.kind === "group") system.runTimeout(() => placeCell(cell, { frames: false }), 2);
});

// Punching a frame in survival takes its book out, and that can't be
// cancelled. Put the book back a moment later and clear the dropped decoy.
world.afterEvents.entityHitBlock.subscribe((event) => {
  const { hitBlock } = event;
  if (hitBlock.typeId !== "minecraft:frame") return;
  const cell = cellAt(hitBlock);
  if (cell?.kind !== "frame") return;
  system.runTimeout(() => {
    try {
      const pos = worldPos(board, cell);
      removeDroppedDecoys({ min: pos, max: pos }, 2);
      if (capture && !board.filling) restoreFrame(cell.book);
      else if (board.placed[cell.book.id]) {
        delete board.placed[cell.book.id];
        saveBoard();
      }
    } catch (error) {
      console.warn(`[Library] Couldn't put a book back: ${error}`);
    }
  }, 2);
});

// Explosions still go off, but board blocks are taken off their list.
world.beforeEvents.explosion.subscribe((event) => {
  loadBoard();
  if (!board) return;
  const blocks = event.getImpactedBlocks();
  const kept = blocks.filter((block) => !cellAt(block));
  if (kept.length !== blocks.length) event.setImpactedBlocks(kept);
});

// ── Upkeep ──────────────────────────────────

onLedgerChange(() => system.run(refreshSigns));

system.runInterval(() => {
  try {
    repairBoard();
  } catch (error) {
    console.warn(`[Library] Board repair failed: ${error}`);
  }
}, REPAIR_INTERVAL);
