import { world, system, BlockPermutation, ItemStack, EnchantmentTypes, EquipmentSlot } from "@minecraft/server";
import { GROUPS, BOOKS, ROMAN } from "./books.js";
import { isOpen, bookStatus, addTokens, emeralds, onLedgerChange, isFound, markFound, isAvailable } from "./ledger.js";

// ─────────────────────────────────────────────
//  MYSTIC LIBRARY: THE TOKEN BOARD
//  The library's book stacks: three double-sided bookshelf stacks with
//  aisles between them. Each book has an item frame holding a decoy copy
//  (a Curse of Vanishing book with the real book's name), a status sign
//  under it, and each group has a name sign above its books. Players
//  right-click a book's frame with an Overseer's Favor to put it toward
//  that book.
//
//  Scripts can't put items into frames, so the books are filled by hand
//  once and each filled frame is saved as its own one-block structure
//  ("capture"). After that the script builds the shelves and signs itself
//  and loads the 33 saved frames into place, and a book punched out of its
//  frame is put back from its saved copy.
//
//  Top view, as seen from the entrance (row 0 at the back):
//
//        aisle A  S1  aisle B   S2  aisle C   S3  aisle D
//         . . .   |   . . . @   |   @ . . .   |   . . .     row 0   Tools, General
//         . . @   #   M . . T   #   G . . @   #   W . .     row 1   Ranged, Armor
//         . . R   #   M . . T   #   G . . A   #   W . .     row 2
//         . . R   #   M . . T   #   G . . A   #   W . .     row 3
//         . . R   #   M . . .   #   G . . A   #   W . .     row 4
//         . . R   #   M . . .   |   . . . A   #   W . .     row 5   divider
//         . . R   #   M . . F   #   H . . A   #   W . .     row 6
//         . . R   #   M . . F   #   H . . A   #   W . .     row 7
//         . . R   #   M . . @   #   @ . . .   #   @ . .     row 8   Fire, Fishing, Water
//         . . .   |   @ . . .   |   . . . .   |   . . .     row 9   Melee, end caps
//         . . .   .   . . . @   *   . . . .   .   . . .     row 10  Mending + its librarian
//                                ^ entrance (row 12): where `board` is run
//
//  @ librarian, standing beside their group's books and facing into the
//  aisle. Armor includes Swift Sneak and Soul Speed and Melee includes Wind
//  Burst: treasure books whose frames stay empty until someone brings a
//  real copy home. Each stack is 4 high: bookshelves at the bottom, status
//  signs at eye level, frames above them, group name signs on top.
// ─────────────────────────────────────────────

const TOKEN_ID = "newhaven:wyatt_token";
const DECOY_LORE = "§7Display copy";
const BOARD_KEY = "season:library_board"; // where the board stands now
const CAPTURE_KEY = "season:library_board_capture"; // which way each saved frame faced
const bookStructure = (book) => `season:library_book_${book.id}`;

const LAYOUT_VERSION = 8; // 1: obsidian wall, 2: 9-long stacks, 3: with lecterns, 4: 33 books, 5: 39 books with treasure, 6: Fire centred, 7: treasure books last, 8: 40 books (Lunge; Looting to General)
const BOOKSHELF = "minecraft:bookshelf";
const LOG = "minecraft:dark_oak_log";
const SIGN_BLOCKS = ["minecraft:birch_wall_sign", "minecraft:crimson_wall_sign"]; // first that resolves; birch keeps dark text readable
const REPAIR_INTERVAL = 1200; // ticks: check and rebuild the board every 60 s

const ENTRANCE = { col: 8, row: 12 }; // where the person placing it stands
const STACK_COLS = [3, 8, 13];
const STACK_ROWS = 10; // rows 0..9
const LOG_ROWS = (col, row) => row === 0 || row === STACK_ROWS - 1 || (col === 8 && row === 5);
const HEIGHT = 4; // y 0 shelves, 1 status signs, 2 frames, 3 group signs

// Each face: the aisle column its frames hang in, which way they face
// (left/right as seen from the entrance, or front for the entrance), and
// its groups with the rows of their books in reading order (left to right
// for someone standing in front of them).
const FACES = [
  { col: 2, facing: "left", groups: [["ranged", [2, 3, 4, 5, 6, 7, 8]]] },
  { col: 4, facing: "right", groups: [["melee", [8, 7, 6, 5, 4, 3, 2, 1]]] },
  { col: 7, facing: "left", groups: [["tools", [1, 2, 3]], ["fire", [6, 7]]] },
  { col: 9, facing: "right", groups: [["fishing", [7, 6]], ["general", [4, 3, 2, 1]]] },
  { col: 12, facing: "left", groups: [["armor", [2, 3, 4, 5, 6, 7]]] },
  { col: 14, facing: "right", groups: [["water", [7, 6, 5, 4, 3, 2, 1]]] },
  { col: 8, facing: "front", groups: [["mending", [10]]] },
];

// Where each group's librarian stands (plan col, row), and the spot they
// face: one step out into their aisle (the entrance, for Mending).
const LIBRARIANS = {
  ranged: { at: [2, 1], face: [1, 1] },
  melee: { at: [4, 9], face: [5, 9] },
  tools: { at: [7, 0], face: [6, 0] },
  fire: { at: [7, 8], face: [6, 8] },
  general: { at: [9, 0], face: [10, 0] },
  fishing: { at: [9, 8], face: [10, 8] },
  armor: { at: [12, 1], face: [11, 1] },
  water: { at: [14, 8], face: [15, 8] },
  mending: { at: [7, 10], face: [7, 11] },
};

// Hidden light blocks above head height, down the middle of each aisle and
// over the entrance, so the signs read clearly at night (sign text can't
// be made to glow by script).
const LIGHT_LEVEL = 15;
const LIGHT_SPOTS = [
  ...[1, 5, 11, 15].flatMap((col) => [1, 4, 8].map((row) => ({ col, row }))),
  { col: 8, row: 11 },
];

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

// Every block the board owns, in plan terms: col (0 = left as seen from
// the entrance), row (0 = back), y (0 = floor level).
const CELLS = (() => {
  const cells = [];
  for (const col of STACK_COLS) {
    for (let row = 0; row < STACK_ROWS; row++) {
      for (let y = 0; y < HEIGHT; y++) cells.push({ kind: "shelf", col, row, y, log: LOG_ROWS(col, row) });
    }
  }
  for (const face of FACES) {
    for (const [groupId, rows] of face.groups) {
      const group = GROUPS.find((g) => g.id === groupId);
      group.books.forEach((book, i) => {
        const row = rows[i];
        cells.push({ kind: "frame", col: face.col, row, y: 2, facing: face.facing, book });
        cells.push({ kind: "status", col: face.col, row, y: 1, facing: face.facing, book });
      });
      const middle = rows[Math.floor((rows.length - 1) / 2)];
      cells.push({ kind: "group", col: face.col, row: middle, y: 3, facing: face.facing, group });
    }
  }
  for (const { col, row } of LIGHT_SPOTS) cells.push({ kind: "light", col, row, y: 3 });
  return cells;
})();

const FRAME_CELLS = new Map(CELLS.filter((c) => c.kind === "frame").map((c) => [c.book.id, c]));
const SHELF_CELLS = CELLS.filter((c) => c.kind === "shelf");

// Every open spot touching a shelf, where fire could sit and burn it.
const FIRE_WATCH = (() => {
  const shelves = new Set(SHELF_CELLS.map((c) => `${c.col}|${c.row}|${c.y}`));
  const spots = new Map();
  for (const c of SHELF_CELLS) {
    for (const [dc, dr, dy] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const spot = { col: c.col + dc, row: c.row + dr, y: c.y + dy };
      const key = `${spot.col}|${spot.row}|${spot.y}`;
      if (spot.y >= 0 && !shelves.has(key)) spots.set(key, spot);
    }
  }
  return [...spots.values()];
})();
const FIRE = new Set(["minecraft:fire", "minecraft:soul_fire"]);
const FIRE_INTERVAL = 20; // ticks: look for fire on the stacks every second

function lookDirection(player) {
  const yaw = ((player.getRotation().y % 360) + 360) % 360; // 0 south, 90 west, 180 north, 270 east
  if (yaw >= 45 && yaw < 135) return "west";
  if (yaw >= 135 && yaw < 225) return "north";
  if (yaw >= 225 && yaw < 315) return "east";
  return "south";
}

function worldPos(b, cell) {
  const d = DIRS[b.look];
  const r = DIRS[RIGHT_OF[b.look]];
  const ahead = ENTRANCE.row - cell.row;
  const across = cell.col - ENTRANCE.col;
  return {
    x: b.anchor.x + ahead * d.dx + across * r.dx,
    y: b.anchor.y + cell.y,
    z: b.anchor.z + ahead * d.dz + across * r.dz,
  };
}

// The world direction a frame or sign faces.
function facingName(b, cell) {
  if (cell.facing === "left") return OPPOSITE[RIGHT_OF[b.look]];
  if (cell.facing === "right") return RIGHT_OF[b.look];
  if (cell.facing === "back") return b.look;
  return OPPOSITE[b.look];
}

const fmt = (pos) => `${pos.x} ${pos.y} ${pos.z}`;
const keyOf = (dimId, pos) => `${dimId}|${pos.x}|${pos.y}|${pos.z}`;

// The first board (a 17 × 6 obsidian wall) stood 3 blocks ahead of its
// anchor; these are its blocks, so it can be cleared away once.
function legacyPositions(b) {
  const d = DIRS[b.look];
  const r = DIRS[RIGHT_OF[b.look]];
  const out = [];
  for (let col = 0; col < 17; col++) {
    for (let row = 0; row < 6; row++) {
      for (const depth of [0, 1]) {
        const ahead = 3 - depth;
        const across = col - 8;
        out.push({ x: b.anchor.x + ahead * d.dx + across * r.dx, y: b.anchor.y + row, z: b.anchor.z + ahead * d.dz + across * r.dz });
      }
    }
  }
  return out;
}

// The earlier stacks layouts (2: entrance at row 11, 3: at row 12).
// Clearing them only removes the kinds of block they were built from, so
// nothing else in their area is touched.
function oldStacksPositions(b) {
  const entranceRow = b.version === 2 ? 11 : 12;
  const d = DIRS[b.look];
  const r = DIRS[RIGHT_OF[b.look]];
  const out = [];
  for (let col = 0; col < 17; col++) {
    for (let row = 0; row < entranceRow; row++) {
      for (let y = 0; y < HEIGHT; y++) {
        const ahead = entranceRow - row;
        const across = col - 8;
        out.push({ x: b.anchor.x + ahead * d.dx + across * r.dx, y: b.anchor.y + y, z: b.anchor.z + ahead * d.dz + across * r.dz });
      }
    }
  }
  return out;
}
const OLD_STACKS_BLOCKS = new Set([
  BOOKSHELF,
  LOG,
  "minecraft:frame",
  ...SIGN_BLOCKS,
  "minecraft:light_block",
  ...Array.from({ length: 16 }, (_, i) => `minecraft:light_block_${i}`),
]);

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

let board; // { version, dim, anchor, look, filling, placed: { bookId: true } } or undefined
let legacyBoard; // a first-layout board still standing, to be cleared
let capture; // { facings: { bookId: direction }, flip } or undefined
let cellIndex = new Map(); // keyOf(dim, pos) -> cell, for the current board
let loaded = false;

function loadBoard() {
  if (loaded) return;
  loaded = true;
  board = readJson(BOARD_KEY);
  if (board && board.version !== LAYOUT_VERSION) {
    legacyBoard = board;
    board = undefined;
  }
  capture = readJson(CAPTURE_KEY);
  // A capture from the first layout: every frame faced away from its wall.
  if (capture && !capture.facings && capture.look) {
    const facing = OPPOSITE[capture.look];
    capture = { facings: Object.fromEntries(BOOKS.map((b) => [b.id, facing])), flip: capture.flip ?? false };
  }
  reindex();
}

const boardListeners = [];

// Called after the stacks are placed, moved, captured or removed, so the
// librarians can follow.
export function onBoardChange(listener) {
  boardListeners.push(listener);
}

function saveBoard() {
  writeJson(BOARD_KEY, board);
  reindex();
  for (const listener of boardListeners) system.run(listener);
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

const resolved = new Map();
function firstResolving(ids, states) {
  const cacheKey = ids.join(",");
  if (!resolved.has(cacheKey)) {
    resolved.set(
      cacheKey,
      ids.find((id) => {
        try {
          BlockPermutation.resolve(id, states);
          return true;
        } catch {
          return false;
        }
      }) ?? ids.at(-1)
    );
  }
  return resolved.get(cacheKey);
}

const signBlockId = () => firstResolving(SIGN_BLOCKS, { facing_direction: 2 });

function logPermutation() {
  try {
    return BlockPermutation.resolve(LOG, { pillar_axis: "y" });
  } catch {
    return BlockPermutation.resolve(LOG);
  }
}

// Newer versions have one block id per light level; older ones a single
// light block with a level state.
let lightPermutationCache;
function lightPermutation() {
  if (lightPermutationCache) return lightPermutationCache;
  try {
    lightPermutationCache = BlockPermutation.resolve(`minecraft:light_block_${LIGHT_LEVEL}`);
  } catch {
    lightPermutationCache = BlockPermutation.resolve("minecraft:light_block", { block_light_level: LIGHT_LEVEL });
  }
  return lightPermutationCache;
}

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
  if (!isAvailable(book)) return [`§l${book.signName}`, "§8Not in this", "§8version yet", ""].join("\n");
  // While the library is closed, a treasure book reads like any other locked book.
  if (!isFound(book) && isOpen()) return [`§l${book.signName}`, "§8Not yet found", `§8${book.treasure}`, "§1Bring one here"].join("\n");
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
// put down where a frame is missing (only while the board is being filled).
// `force` rewrites a sign's text even when it already matches: after a
// cancelled break the server still has the text but players see a blank
// sign, and only writing it again sends it back to them.
function placeCell(cell, { frames, force = false }) {
  const pos = worldPos(board, cell);
  const block = blockAt(pos);
  if (!block) return false;
  if (cell.kind === "shelf") {
    const want = cell.log ? LOG : BOOKSHELF;
    if (block.typeId !== want) block.setPermutation(cell.log ? logPermutation() : BlockPermutation.resolve(BOOKSHELF));
    return true;
  }
  if (cell.kind === "light") {
    const light = lightPermutation();
    if (block.typeId !== light.type.id) block.setPermutation(light);
    return true;
  }
  const facing = DIRS[facingName(board, cell)].facing;
  if (cell.kind === "frame") {
    if (waitingForCopy(cell.book)) {
      if (block.typeId !== "minecraft:frame") block.setPermutation(BlockPermutation.resolve("minecraft:frame", { facing_direction: facing }));
      return true;
    }
    if (block.typeId === "minecraft:frame") return true;
    if (capture && !board.filling) return restoreFrame(cell.book);
    if (frames) {
      block.setPermutation(BlockPermutation.resolve("minecraft:frame", { facing_direction: facing }));
      if (board.placed[cell.book.id]) {
        delete board.placed[cell.book.id];
        saveBoard();
      }
    }
    return true;
  }
  // A sign: put it back if it's gone, then make sure it says the right thing.
  const id = signBlockId();
  if (block.typeId !== id) block.setPermutation(BlockPermutation.resolve(id, { facing_direction: facing }));
  const sign = block.getComponent("minecraft:sign");
  if (!sign) return true;
  const text = signText(cell);
  if (force || sign.getText() !== text) sign.setText(text);
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

// Checks every board block and fixes anything missing or wrong. Signs are
// always rewritten, so one that shows blank to players heals within a
// minute. Scripts can't see whether a frame still holds its book, so on the
// live stacks every book is reloaded from its saved copy too.
function repairBoard() {
  loadBoard();
  if (!board) return;
  for (const cell of CELLS) {
    try {
      placeCell(cell, { frames: true, force: true });
    } catch (error) {
      console.warn(`[Library] Couldn't repair the board: ${error}`);
    }
  }
  if (!capture || board.filling) return;
  for (const book of BOOKS) {
    try {
      if (!blockAt(worldPos(board, FRAME_CELLS.get(book.id)))) continue;
      // A treasure book nobody has found yet keeps an empty frame.
      if (waitingForCopy(book)) emptyFrame(book);
      else restoreFrame(book);
    } catch (error) {
      console.warn(`[Library] Couldn't reload ${book.name}: ${error}`);
    }
  }
}

function clearPositions(dimId, positions, onlyTypes) {
  const dimension = world.getDimension(dimId);
  for (const pos of positions) {
    try {
      const block = dimension.getBlock(pos);
      if (block && block.typeId !== "minecraft:air" && (!onlyTypes || onlyTypes.has(block.typeId))) block.setPermutation(BlockPermutation.resolve("minecraft:air"));
    } catch {
      // chunk not loaded
    }
  }
  removeDroppedDecoys(dimId, positions, 2);
}

function clearBoardBlocks() {
  clearPositions(
    board.dim,
    CELLS.map((cell) => worldPos(board, cell))
  );
}

function clearLegacyBoard() {
  if (!legacyBoard) return;
  if (!legacyBoard.version) clearPositions(legacyBoard.dim, legacyPositions(legacyBoard));
  else clearPositions(legacyBoard.dim, oldStacksPositions(legacyBoard), OLD_STACKS_BLOCKS);
  legacyBoard = undefined;
}

// Clears decoy books lying on the ground around some positions.
function removeDroppedDecoys(dimId, positions, margin) {
  const dimension = world.getDimension(dimId);
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  const zs = positions.map((p) => p.z);
  const min = { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) };
  const max = { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) };
  const center = { x: (min.x + max.x + 1) / 2, y: (min.y + max.y + 1) / 2, z: (min.z + max.z + 1) / 2 };
  const reach = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) / 2 + 1 + margin;
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

// ── Saved frames ────────────────────────────

function rotation(fromDir, toDir, flip) {
  let steps = (CLOCKWISE.indexOf(toDir) - CLOCKWISE.indexOf(fromDir) + 4) % 4;
  if (flip && steps % 2 === 1) steps = 4 - steps;
  return `${steps * 90}_degrees`;
}

// A treasure book's frame stays empty on the live stacks until someone
// brings home a real copy.
const waitingForCopy = (book) => Boolean(capture) && !board.filling && !isFound(book);

// Empties a book's frame (the decoy goes too).
function emptyFrame(book) {
  const cell = FRAME_CELLS.get(book.id);
  const pos = worldPos(board, cell);
  const block = blockAt(pos);
  if (!block) return;
  block.setPermutation(BlockPermutation.resolve("minecraft:air"));
  block.setPermutation(BlockPermutation.resolve("minecraft:frame", { facing_direction: DIRS[facingName(board, cell)].facing }));
  removeDroppedDecoys(board.dim, [pos], 2);
}

// After a treasure book is marked found or not found: show its display
// copy, or empty its frame again.
export function refreshTreasureFrame(book) {
  loadBoard();
  if (!board || board.filling || !capture || !book.treasure) return;
  if (isFound(book)) restoreFrame(book);
  else emptyFrame(book);
  refreshSigns();
}

// Loads a book's saved frame into its spot, turned to face the right way.
function restoreFrame(book) {
  const cell = FRAME_CELLS.get(book.id);
  const from = capture.facings[book.id];
  if (!from) return false;
  const result = world.getDimension(board.dim).runCommand(
    `structure load ${bookStructure(book)} ${fmt(worldPos(board, cell))} ${rotation(from, facingName(board, cell), capture.flip)}`
  );
  // A failed command doesn't throw: it just reports no successes.
  if (result && result.successCount === 0) console.warn(`[Library] Loading the saved copy of ${book.name} failed (structure ${bookStructure(book)}).`);
  return true;
}

function frameFacesRight(book) {
  const cell = FRAME_CELLS.get(book.id);
  const block = blockAt(worldPos(board, cell));
  return block?.typeId === "minecraft:frame" && block.permutation.getState("facing_direction") === DIRS[facingName(board, cell)].facing;
}

// Puts the given books' saved frames in place, then calls done(). Some
// versions turn structures the other way round: if frames come out facing
// backwards, turn them the other way and remember that for next time.
function loadFrames(books, done, reply) {
  if (!books.length) return done();
  for (const book of books) restoreFrame(book);
  system.runTimeout(() => {
    const wrong = books.filter((book) => !frameFacesRight(book));
    if (!wrong.length) return done();
    capture.flip = !capture.flip;
    writeJson(CAPTURE_KEY, capture);
    for (const book of wrong) {
      const block = blockAt(worldPos(board, FRAME_CELLS.get(book.id)));
      block?.setPermutation(BlockPermutation.resolve("minecraft:air"));
      restoreFrame(book);
    }
    system.runTimeout(() => {
      const still = books.filter((book) => !frameFacesRight(book));
      if (!still.length) return done();
      reply(`§c${still.length} frame(s) didn't come out right: ${still.map((b) => b.name).join(", ")}. Try placing the board again.`);
    }, 2);
  }, 2);
}

function finishPlacing(reply) {
  refreshSigns();
  reply(`§aLibrary stacks placed in front of you, entrance facing ${OPPOSITE[board.look]}.`);
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

// The display books in walking order for filling the frames: Mending at
// the entrance first, then one wall at a time in a straight line, snaking
// left to right: up the Ranged wall (aisle A), down the Melee wall and up
// the Armor/Fire wall (aisle B), down the General/Fishing wall and up the
// Tools wall (aisle C), and down the Water wall (aisle D). "Up" is front
// to back.
const WALL_COLS = [2, 4, 7, 9, 12, 14];
const WALKING_ORDER = (() => {
  const frames = [...FRAME_CELLS.values()];
  const order = frames.filter((cell) => !WALL_COLS.includes(cell.col)); // Mending, at the entrance
  WALL_COLS.forEach((col, i) => {
    const up = i % 2 === 0;
    const wall = frames.filter((cell) => cell.col === col).sort((a, b) => (up ? b.row - a.row : a.row - b.row));
    order.push(...wall);
  });
  return order.map((cell) => cell.book);
})();

// The display books still to be put in frames: all of them, or while the
// stacks are being filled, just the ones not placed yet.
function booksToPlace() {
  loadBoard();
  if (!board?.filling) return BOOKS;
  return BOOKS.filter((book) => !board.placed[book.id]);
}

const HOTBAR_SLOTS = 9;

// Gives the display books one section (group) at a time, in walking order,
// straight into empty hotbar slots: the next section that still has frames
// to fill. When its last book goes in, the next section's books follow on
// their own (see placeDecoy). Books the player already holds aren't given
// again. The biggest section has 8 books, so a clear hotbar always fits one.
export function giveDecoys(player, reply, books = booksToPlace()) {
  const container = player.getComponent("minecraft:inventory").container;
  const wanted = new Set(books.map((book) => book.id));
  const ordered = WALKING_ORDER.filter((book) => wanted.has(book.id));
  if (!ordered.length) return reply("§7Every frame already has its display book.");
  const group = GROUPS.find((g) => g.id === ordered[0].group);
  const section = ordered.filter((book) => book.group === group.id);

  const held = new Set();
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (isDecoy(item)) held.add(item.nameTag);
  }
  const toGive = section.filter((book) => !held.has(decoyName(book)));
  if (toGive.length > container.emptySlotsCount) {
    return reply(`§cYou need ${toGive.length} free slots for the ${group.name} display books. Make room, then run §lboard books§r§c.`);
  }

  // Empty hotbar slots first, in order, then anywhere.
  let slot = 0;
  for (const book of toGive) {
    while (slot < HOTBAR_SLOTS && container.getItem(slot)) slot++;
    if (slot < HOTBAR_SLOTS) container.setItem(slot++, decoyBook(book));
    else container.addItem(decoyBook(book));
  }
  const left = ordered.length - section.length;
  reply(
    (section.length === 1
      ? `§aHere is the §e${group.name}§a display book: ${section[0].name}.`
      : `§aHere are the §e${group.name}§a display books, in the order you'll walk past them: ${section.map((b) => b.name).join(", ")}.`) +
      (left ? ` When they're all in, the next section's books follow (${left} more to go).` : " That's the last section.")
  );
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

// `board [force|fresh]`: builds the stacks in front of the player, or moves
// them there. Saved books are loaded into their frames; any book without a
// saved frame (all of them with `fresh`) gets an empty frame and its display
// book, to be filled by hand and captured.
export function placeBoard(player, options, reply) {
  loadBoard();
  const fresh = Boolean(options.fresh) || !capture;
  const missing = BOOKS.filter((book) => fresh || !capture.facings[book.id]);
  const candidate = {
    version: LAYOUT_VERSION,
    dim: player.dimension.id,
    anchor: { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) },
    look: lookDirection(player),
    filling: missing.length > 0,
    placed: Object.fromEntries(BOOKS.filter((book) => !missing.includes(book)).map((book) => [book.id, true])),
  };
  clearLegacyBoard();
  const blocked = blockedCells(candidate);
  if (blocked < 0) return reply("§cPart of that spot isn't loaded. Move closer and try again.");
  if (blocked > 0 && !options.force) {
    return reply(
      `§c${blocked} block(s) are in the way of the stacks (17 wide, 13 deep, 4 high, starting just ahead of you). ` +
        "Clear the space, or run §lboard force§r§c to replace them."
    );
  }

  if (board) clearBoardBlocks();
  board = candidate;
  saveBoard();

  // Shelves, lights and signs first, then empty frames where no saved book
  // goes, then the saved books.
  for (const cell of CELLS) if (cell.kind !== "frame") placeCell(cell, { frames: false, force: true });
  const toLoad = BOOKS.filter((book) => !missing.includes(book) && (board.filling || isFound(book)));
  for (const book of BOOKS) {
    if (toLoad.includes(book)) continue;
    const cell = FRAME_CELLS.get(book.id);
    blockAt(worldPos(board, cell))?.setPermutation(
      BlockPermutation.resolve("minecraft:frame", { facing_direction: DIRS[facingName(board, cell)].facing })
    );
  }
  loadFrames(
    toLoad,
    () => {
      if (!board.filling) return finishPlacing(reply);
      refreshSigns();
      reply(
        `§aStacks built, entrance facing ${OPPOSITE[board.look]}. ${missing.length} frame(s) still need their display book. ` +
          "With an empty hand, look at an empty frame (or the sign under it): its display book appears in your hand. " +
          "Right-click the frame to place it. When they're all in, run §lboard capture§r§a."
      );
    },
    reply
  );
}

export function removeBoard(reply) {
  loadBoard();
  const hadLegacy = Boolean(legacyBoard);
  clearLegacyBoard();
  if (!board) return reply(hadLegacy ? "§aOld board removed." : "§7There's no board to remove.");
  clearBoardBlocks();
  board = undefined;
  saveBoard();
  reply("§aStacks removed. The ledger and the saved books are kept; §lboard§r§a puts them back.");
}

export function captureBoard(reply) {
  loadBoard();
  if (!board) return reply("§cBuild the stacks first with §lboard§r§c.");
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
  // On live stacks, a treasure book not found yet has an empty frame: keep
  // its earlier saved copy instead of saving the empty frame over it.
  const toSave = board.filling ? BOOKS : BOOKS.filter((book) => isFound(book));
  const facings = { ...(capture?.facings ?? {}) };
  try {
    for (const book of toSave) {
      const cell = FRAME_CELLS.get(book.id);
      const pos = worldPos(board, cell);
      dimension.runCommand(`structure save ${bookStructure(book)} ${fmt(pos)} ${fmt(pos)} false disk true`);
      facings[book.id] = facingName(board, cell);
    }
  } catch (error) {
    return reply(`§cCouldn't save the books: ${error}`);
  }
  capture = { facings, flip: capture?.flip ?? false };
  writeJson(CAPTURE_KEY, capture);
  board.filling = false;
  board.placed = {};
  saveBoard();
  // Treasure books nobody has brought home yet: empty their frames.
  const waiting = BOOKS.filter((book) => !isFound(book));
  for (const book of waiting) emptyFrame(book);
  refreshSigns();
  reply(
    "§aBooks captured. From now on §lboard§r§a places the stacks with these books, and punched-out books are put back automatically." +
      (waiting.length ? ` §e${waiting.map((b) => b.name).join(", ")} wait in empty frames until someone brings home a real copy.` : "")
  );
}

// The librarians' spots on the live stacks (see LIBRARIANS), each with the
// point to face. Undefined while there are no live stacks.
export function librarianSpots() {
  loadBoard();
  if (!board || board.filling) return undefined;
  return {
    dim: board.dim,
    spots: GROUPS.map((group) => {
      const { at, face } = LIBRARIANS[group.id];
      const stand = worldPos(board, { col: at[0], row: at[1], y: 0 });
      const toward = worldPos(board, { col: face[0], row: face[1], y: 0 });
      return {
        group,
        pos: { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 },
        face: { x: toward.x + 0.5, y: toward.y + 1.6, z: toward.z + 0.5 },
      };
    }),
  };
}

export function boardInfo() {
  loadBoard();
  const legacy = legacyBoard ? " §eAn older version of the board is still standing: run §lboard§r§e or §lboard remove§r§e to clear it." : "";
  if (!board) return `§7No stacks placed.${capture ? " Books are captured; §lboard§r§7 places them." : ""}${legacy}`;
  const placed = Object.keys(board.placed).length;
  const where = `§6Stacks§r entered from ${fmt(board.anchor)} (${board.dim.replace("minecraft:", "")}), entrance facing ${OPPOSITE[board.look]}.`;
  const state = board.filling ? ` Being filled: ${placed} of ${BOOKS.length} books placed.` : " Captured and live.";
  return where + state + legacy;
}

// ── Players at the stacks ───────────────────

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
  if (board.filling) return player.sendMessage("§7The stacks aren't finished yet.");
  if (!isFound(book)) return player.sendMessage(`§7${book.name} hasn't been found yet. Bring a real copy to this frame first.`);
  if (!isAvailable(book)) return player.sendMessage(`§7${book.name} isn't in this version of the game yet.`);
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

// A real enchanted book with this book's enchantment on it (other
// enchantments alongside are fine). Display copies don't count.
function teachesBook(item, book) {
  if (item?.typeId !== "minecraft:enchanted_book" || isDecoy(item)) return false;
  try {
    return Boolean(item.getComponent("minecraft:enchantable")?.getEnchantment(book.id));
  } catch {
    return false;
  }
}

// A player brings home a treasure book: the library keeps their copy, the
// display copy goes in the frame, and everyone hears who found it.
function donate(player, book) {
  if (isFound(book)) return;
  const equippable = player.getComponent("minecraft:equippable");
  const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
  if (!teachesBook(held, book)) return;
  let level = 0;
  try {
    level = held.getComponent("minecraft:enchantable")?.getEnchantment(book.id)?.level ?? 0;
  } catch {
    level = 0;
  }
  if (held.amount > 1) {
    held.amount -= 1;
    equippable.setEquipment(EquipmentSlot.Mainhand, held);
  } else {
    equippable.setEquipment(EquipmentSlot.Mainhand);
  }
  markFound(book, player.name, false, level);
  restoreFrame(book);
  const rest = level >= book.max ? "" : " Overseer's Favors unlock the rest.";
  player.sendMessage(
    level
      ? `§aThe library keeps your book. §b${book.name}§a is unlocked up to Level ${ROMAN[Math.min(level, book.max)]} for everyone.${rest}`
      : `§aThe library keeps your book. §b${book.name}§a can now be unlocked with Overseer's Favors.`
  );
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

// ── Filling by looking ──────────────────────
// While the stacks are being filled, a player with an empty hand (or a
// display book in it) who looks at an empty frame, or the sign under it,
// is handed that frame's display book. Right-clicking then places it. Only
// display books are ever swapped out of a hand.

const FILL_LOOK_INTERVAL = 4; // ticks
const FACE_STEPS = { North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0], Up: [0, 1, 0], Down: [0, -1, 0] };

function bookInView(player) {
  let hit;
  try {
    hit = player.getBlockFromViewDirection({ maxDistance: 6, includePassableBlocks: true });
  } catch {
    return undefined;
  }
  if (!hit?.block) return undefined;
  let cell = cellAt(hit.block);
  // Looking at the shelf behind a frame: the frame is on the face that was hit.
  if (cell?.kind === "shelf" && FACE_STEPS[hit.face]) {
    const [dx, dy, dz] = FACE_STEPS[hit.face];
    const { x, y, z } = hit.block;
    cell = cellIndex.get(keyOf(board.dim, { x: x + dx, y: y + dy, z: z + dz }));
  }
  return cell?.kind === "frame" || cell?.kind === "status" ? cell.book : undefined;
}

system.runInterval(() => {
  loadBoard();
  if (!board?.filling) return;
  for (const player of world.getPlayers()) {
    try {
      if (player.dimension.id !== board.dim) continue;
      const book = bookInView(player);
      if (!book || board.placed[book.id]) continue;
      const equippable = player.getComponent("minecraft:equippable");
      const held = equippable?.getEquipment(EquipmentSlot.Mainhand);
      if (held && !isDecoy(held)) {
        player.onScreenDisplay?.setActionBar(`§7Empty your hand to get the §b${book.name}§7 display book`);
        continue;
      }
      if (held?.nameTag === decoyName(book)) continue;
      equippable.setEquipment(EquipmentSlot.Mainhand, decoyBook(book));
      player.onScreenDisplay?.setActionBar(`§b${book.name}§r: right-click the frame to place it`);
    } catch (error) {
      console.warn(`[Library] Couldn't hand a display book to ${player.name}: ${error}`);
    }
  }
}, FILL_LOOK_INTERVAL);

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  const { block, player, itemStack } = event;
  if (block.typeId !== "minecraft:frame") return;
  const cell = cellAt(block);
  if (cell?.kind !== "frame") return;

  const now = system.currentTick;
  const repeat = now - (lastClick.get(player.id) ?? -100) < 8;
  lastClick.set(player.id, now);

  // While the stacks are being filled, the right display book may go in.
  const filling = board.filling;
  if (filling && isDecoy(itemStack) && !board.placed[cell.book.id] && itemStack.nameTag === decoyName(cell.book)) {
    if (!repeat) system.run(() => placeDecoy(player, cell.book, itemStack));
    return;
  }

  // Everything else is cancelled, so books can't be turned or taken out.
  event.cancel = true;
  if (repeat) return;
  system.run(() => {
    if (waitingForCopy(cell.book)) {
      if (!isOpen()) {
        if (teachesBook(itemStack, cell.book)) return player.sendMessage("§7The Mystic Library isn't open yet. Keep your book for now.");
        return player.sendMessage("§7The Mystic Library isn't open yet.");
      }
      if (teachesBook(itemStack, cell.book)) return donate(player, cell.book);
      return player.sendMessage(
        `§7This frame is waiting for a real §b${cell.book.name}§7 book. Find one (try: ${cell.book.treasure}) and bring it here. Books with other enchantments too are fine.`
      );
    }
    if (itemStack?.typeId === TOKEN_ID) return deposit(player, cell.book);
    if (filling && isDecoy(itemStack)) return placeDecoy(player, cell.book, itemStack);
    if (!filling) player.sendMessage(`§7Hold an Overseer's Favor and use it here to put it toward §b${cell.book.name}§7.`);
  });
});

// ── Protection ──────────────────────────────

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  const cell = cellAt(event.block);
  if (!cell) return;
  if (event.block.typeId === "minecraft:air") return;
  event.cancel = true;
  // A cancelled break wipes a sign's text, so write it straight back.
  if (cell.kind === "status" || cell.kind === "group") system.runTimeout(() => placeCell(cell, { frames: false, force: true }), 2);
});

// Punching a frame in survival takes its book out, and that can't be
// cancelled. Put the book back a moment later and clear the dropped decoy.
// Hitting a frame quickly over and over can knock its book out again after
// a put-back, and not every knock-out reports a hit. So each hit puts the
// book back at once, and again once the frame has gone a second without
// being hit, so the last word always comes after the last punch. (The
// 60-second repair also reloads every book, as a final safety net.)
const SETTLE_TICKS = 20;
const lastHitAt = new Map(); // book id -> tick of the latest hit on its frame

function putBack(cell, settled) {
  try {
    const pos = worldPos(board, cell);
    const cleared = removeDroppedDecoys(board.dim, [pos], 2);
    if (capture && !board.filling) {
      if (waitingForCopy(cell.book)) return;
      const loaded = restoreFrame(cell.book);
      if (settled) {
        console.warn(
          `[Library] ${cell.book.name} frame was hit: ` +
            (loaded ? `put its saved copy back; removed ${cleared} dropped decoy(s)` : "no saved copy to put back")
        );
      }
    } else if (board.placed[cell.book.id]) {
      delete board.placed[cell.book.id];
      saveBoard();
    }
  } catch (error) {
    console.warn(`[Library] Couldn't put a book back: ${error}`);
  }
}

world.afterEvents.entityHitBlock.subscribe((event) => {
  const { hitBlock } = event;
  if (hitBlock.typeId !== "minecraft:frame") return;
  const cell = cellAt(hitBlock);
  if (cell?.kind !== "frame") return;
  const id = cell.book.id;
  lastHitAt.set(id, system.currentTick);
  system.runTimeout(() => putBack(cell, false), 2);
  system.runTimeout(() => {
    if (system.currentTick - (lastHitAt.get(id) ?? 0) < SETTLE_TICKS) return; // hit again since: that hit's check will run
    lastHitAt.delete(id);
    putBack(cell, true);
  }, SETTLE_TICKS);
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

// Bookshelves burn, and burning isn't a break the pack can cancel. So every
// second: put out any fire touching the stacks, and if a shelf has burned
// away, rebuild it straight away along with anything that fell off it.
function guardFire() {
  loadBoard();
  if (!board) return;
  let air;
  for (const spot of FIRE_WATCH) {
    const block = blockAt(worldPos(board, spot));
    if (block && FIRE.has(block.typeId)) block.setPermutation((air ??= BlockPermutation.resolve("minecraft:air")));
  }
  const burned = SHELF_CELLS.some((cell) => {
    const block = blockAt(worldPos(board, cell));
    return block && block.typeId !== (cell.log ? LOG : BOOKSHELF);
  });
  if (!burned) return;
  repairBoard();
  removeDroppedDecoys(
    board.dim,
    SHELF_CELLS.map((cell) => worldPos(board, cell)),
    2
  );
}

system.runInterval(() => {
  try {
    guardFire();
  } catch (error) {
    console.warn(`[Library] Fire guard failed: ${error}`);
  }
}, FIRE_INTERVAL);
