import { world, system, ItemStack, EnchantmentTypes } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { GROUPS, ROMAN } from "./books.js";
import { isOpen, bookStatus, emeralds, onLedgerChange } from "./ledger.js";
import { librarianSpots, onBoardChange } from "./board.js";

// ─────────────────────────────────────────────
//  MYSTIC LIBRARY: THE LIBRARIANS AND THEIR SHOPS
//  One librarian per group, standing at the back of the aisle its books
//  face (the Mending Librarian at the entrance). A librarian is there only
//  while the library is open, the stacks are live, and the group has at
//  least one unlocked book. Librarians never move, can't be hurt, and
//  can't be renamed (villager_v2's season:library_librarian group).
//
//  Right-clicking one opens a menu instead of the trade screen: pick a
//  book, pick a level, confirm, and the emeralds are taken from the
//  player's inventory. Prices come straight from the ledger.
// ─────────────────────────────────────────────

const TAG = "season:library_librarian";
const GROUP_TAG_PREFIX = "season:lib_";
const groupTag = (group) => GROUP_TAG_PREFIX + group.id;
const SPAWN_EVENT = "season:become_library_librarian";
const OLD_LIBRARIAN_TAGS = ["season:rescue_empty_librarian", "season:rescue_mending_librarian"];
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const SYNC_INTERVAL = 100; // ticks: check the librarians every 5 s
const LOAD_GRACE = 2; // syncs a spot must be loaded before spawning, so a librarian still loading in isn't doubled
const BUSY_RETRIES = 10;
const BUSY_RETRY_TICKS = 10;

const librarianName = (group) => (group.id === "mending" ? "Mending Librarian" : `${group.name} Librarian`);
const forSale = (group) => group.books.filter((book) => bookStatus(book).level > 0);
const groupOf = (entity) => {
  const tag = entity.getTags().find((t) => t.startsWith(GROUP_TAG_PREFIX));
  return GROUPS.find((g) => tag === groupTag(g));
};

// ── Keeping the librarians in place ─────────

const loadedFor = new Map(); // group id -> consecutive syncs its spot has been loaded

function spawnLibrarian(dimension, spot) {
  const entity = dimension.spawnEntity("minecraft:villager_v2", spot.pos);
  entity.triggerEvent(SPAWN_EVENT);
  entity.addTag(TAG);
  entity.addTag(groupTag(spot.group));
  entity.nameTag = librarianName(spot.group);
  entity.teleport(spot.pos, { facingLocation: spot.face });
  return entity;
}

function settle(entity, spot) {
  const at = entity.location;
  const off = Math.abs(at.x - spot.pos.x) > 0.3 || Math.abs(at.z - spot.pos.z) > 0.3 || Math.abs(at.y - spot.pos.y) > 0.6;
  if (off) entity.teleport(spot.pos, { facingLocation: spot.face });
  if (entity.nameTag !== librarianName(spot.group)) entity.nameTag = librarianName(spot.group);
}

function syncLibrarians() {
  const info = librarianSpots();
  const open = isOpen();

  // Anyone who shouldn't be there any more (stacks gone or moved to
  // another dimension, library closed, nothing left to sell) is removed.
  for (const dimId of DIMENSIONS) {
    let entities;
    try {
      entities = world.getDimension(dimId).getEntities({ tags: [TAG] });
    } catch {
      continue;
    }
    for (const entity of entities) {
      const group = groupOf(entity);
      if (!info || !open || dimId !== info.dim || !group || !forSale(group).length) entity.remove();
    }
  }
  if (!info || !open) return;

  const dimension = world.getDimension(info.dim);
  // The board's Mending Librarian replaces the one from the rescue event.
  for (const tag of OLD_LIBRARIAN_TAGS) {
    for (const entity of dimension.getEntities({ tags: [tag] })) entity.remove();
  }

  for (const spot of info.spots) {
    if (!forSale(spot.group).length) continue;
    let loaded = false;
    try {
      loaded = Boolean(dimension.getBlock(spot.pos));
    } catch {
      loaded = false;
    }
    if (!loaded) {
      loadedFor.set(spot.group.id, 0);
      continue;
    }
    const streak = (loadedFor.get(spot.group.id) ?? 0) + 1;
    loadedFor.set(spot.group.id, streak);

    const found = dimension.getEntities({ tags: [groupTag(spot.group)] });
    for (const extra of found.slice(1)) extra.remove();
    if (found[0]) settle(found[0], spot);
    else if (streak >= LOAD_GRACE) spawnLibrarian(dimension, spot);
  }
}

function safeSync() {
  try {
    syncLibrarians();
  } catch (error) {
    console.warn(`[Library] Librarian check failed: ${error}`);
  }
}

system.runInterval(safeSync, SYNC_INTERVAL);
onLedgerChange(() => system.run(safeSync));
onBoardChange(safeSync);

// ── Emeralds ────────────────────────────────

function countEmeralds(player) {
  const container = player.getComponent("minecraft:inventory").container;
  let total = 0;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item?.typeId === "minecraft:emerald") total += item.amount;
  }
  return total;
}

function takeEmeralds(player, count) {
  const container = player.getComponent("minecraft:inventory").container;
  let left = count;
  for (let i = 0; i < container.size && left > 0; i++) {
    const item = container.getItem(i);
    if (item?.typeId !== "minecraft:emerald") continue;
    if (item.amount > left) {
      item.amount -= left;
      container.setItem(i, item);
      left = 0;
    } else {
      left -= item.amount;
      container.setItem(i);
    }
  }
}

function giveBook(player, book, level) {
  const item = new ItemStack("minecraft:enchanted_book", 1);
  item.getComponent("minecraft:enchantable").addEnchantment({ type: EnchantmentTypes.get(book.id), level });
  const container = player.getComponent("minecraft:inventory").container;
  const left = container.addItem(item);
  if (left) player.dimension.spawnItem(left, player.location);
}

// ── The shop menu ───────────────────────────

const inMenu = new Set();

async function show(player, form) {
  for (let i = 0; i <= BUSY_RETRIES; i++) {
    const response = await form.show(player);
    if (response.cancelationReason !== "UserBusy") return response;
    await new Promise((resolve) => system.runTimeout(resolve, BUSY_RETRY_TICKS));
    if (!player.isValid()) return response;
  }
  return { canceled: true };
}

const levelRange = (level) => (level === 1 ? "Level I" : `Levels I–${ROMAN[level]}`);

async function chooseBook(player, group) {
  const books = forSale(group);
  const locked = group.books.filter((book) => bookStatus(book).level === 0);
  let body = `You have §6${emeralds(countEmeralds(player))}§r.`;
  if (locked.length) body += `\n\n§7Still locked: ${locked.map((b) => b.name).join(", ")}. Put Overseer's Favors on them at the stacks.`;
  const form = new ActionFormData().title(librarianName(group)).body(body);
  for (const book of books) {
    const s = bookStatus(book);
    form.button(`${book.name}\n§8${levelRange(s.level)} · ${emeralds(s.price)}`, "textures/items/book_enchanted");
  }
  form.button("Close");
  const response = await show(player, form);
  if (response.canceled || response.selection >= books.length) return undefined;
  return books[response.selection];
}

async function chooseLevel(player, book) {
  const s = bookStatus(book);
  if (s.level === 1) return 1;
  const form = new ActionFormData().title(book.name).body(`Every level costs §6${emeralds(s.price)}§r.`);
  for (let level = 1; level <= s.level; level++) form.button(`${book.name} ${ROMAN[level]}`, "textures/items/book_enchanted");
  form.button("« Back");
  const response = await show(player, form);
  if (response.canceled) return undefined;
  if (response.selection >= s.level) return 0; // back
  return response.selection + 1;
}

async function confirm(player, book, level) {
  const price = bookStatus(book).price;
  const have = countEmeralds(player);
  const title = `${book.name}${book.max > 1 ? " " + ROMAN[level] : ""}`;
  const form = new ActionFormData()
    .title(`Buy ${title}?`)
    .body(`Price: §6${emeralds(price)}§r\nYou have: ${have >= price ? "§a" : "§c"}${emeralds(have)}§r`)
    .button(`Buy for ${emeralds(price)}`)
    .button("« Back");
  const response = await show(player, form);
  return !response.canceled && response.selection === 0;
}

function buy(player, book, level) {
  // Checked again: the ledger or the inventory can change while a menu is up.
  const s = bookStatus(book);
  if (s.level < level) return player.sendMessage(`§c${book.name} ${ROMAN[level]} isn't for sale any more.`);
  const have = countEmeralds(player);
  if (have < s.price) {
    player.playSound("note.bass");
    return player.sendMessage(`§cYou need ${emeralds(s.price)} for that (you have ${have}).`);
  }
  takeEmeralds(player, s.price);
  giveBook(player, book, level);
  player.playSound("random.levelup");
  const name = `${book.name}${book.max > 1 ? " " + ROMAN[level] : ""}`;
  player.sendMessage(`§aYou bought §b${name}§a for ${emeralds(s.price)}.`);
  console.warn(`[Library] ${player.name} bought ${name} for ${s.price} emeralds`);
}

async function runShop(player, group) {
  inMenu.add(player.id);
  try {
    for (;;) {
      const book = await chooseBook(player, group);
      if (!book || !player.isValid()) return;
      const level = await chooseLevel(player, book);
      if (level === undefined || !player.isValid()) return;
      if (level === 0) continue; // back to the book list
      if (await confirm(player, book, level)) return buy(player, book, level);
    }
  } catch (error) {
    console.warn(`[Library] Shop menu failed for ${player.name}: ${error}`);
  } finally {
    inMenu.delete(player.id);
  }
}

// Right-clicking a librarian opens the shop instead of the trade screen.
const interact = world.beforeEvents.playerInteractWithEntity;
if (interact) {
  interact.subscribe((event) => {
    const { target, player } = event;
    if (target?.typeId !== "minecraft:villager_v2" || !target.hasTag(TAG)) return;
    event.cancel = true;
    if (inMenu.has(player.id)) return;
    const group = groupOf(target);
    if (!group) return;
    system.run(() => {
      if (!player.isValid() || inMenu.has(player.id)) return;
      if (!isOpen() || !forSale(group).length) return player.sendMessage("§7This librarian has nothing for sale yet.");
      runShop(player, group);
    });
  });
} else {
  console.warn("[Library] This version has no beforeEvents.playerInteractWithEntity: the librarians' shops won't open.");
}
