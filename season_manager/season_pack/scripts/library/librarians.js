import { world, system, ItemStack, EnchantmentTypes } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { GROUPS, ROMAN, LEVEL_COSTS, DISCOUNT_COSTS, PRICES } from "./books.js";
import { isOpen, bookStatus, emeralds, onLedgerChange, stepContributions, isFound, foundBy, isAvailable } from "./ledger.js";
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
const forSale = (group) => group.books.filter((book) => isAvailable(book) && bookStatus(book).level > 0);
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
  const locked = group.books.filter((book) => isAvailable(book) && isFound(book) && bookStatus(book).level === 0);
  const unfound = group.books.filter((book) => !isFound(book));
  let body = `You have §6${emeralds(countEmeralds(player))}§r.`;
  if (locked.length) body += `\n\n§7Still locked: ${locked.map((b) => b.name).join(", ")}. Put Overseer's Favors on them at the stacks.`;
  if (unfound.length) {
    body += `\n\n§7Not found yet: ${unfound.map((b) => `${b.name} (${b.treasure})`).join(", ")}. Bring a real copy to its frame at the stacks.`;
  }
  const form = new ActionFormData().title(librarianName(group)).body(body);
  for (const book of books) {
    const s = bookStatus(book);
    form.button(`${book.name}\n§8${levelRange(s.level)} · ${emeralds(s.price)}`, "textures/items/book_enchanted");
  }
  form.button("Who helped", "textures/items/book_writable");
  form.button("How it works", "textures/items/wyatt_token"); // the Overseer's Favor coin
  form.button("Close");
  const response = await show(player, form);
  if (response.canceled) return undefined;
  if (response.selection === books.length) return HELPERS;
  if (response.selection === books.length + 1) return HOW_IT_WORKS;
  if (response.selection > books.length + 1) return undefined;
  return books[response.selection];
}

const HELPERS = Symbol("helpers");
const HOW_IT_WORKS = Symbol("how it works");

// What every Favor on this group's books did: each step (a level, or a
// price drop) and who paid for it. Favors added by admin commands are
// credited to the Overseer.
function stepLabel(step) {
  return step.kind === "level" ? `Level ${ROMAN[step.level]}` : `Down to ${emeralds(step.price)}`;
}

async function showHelpers(player, group) {
  const sections = group.books.map((book) => {
    const lines = [];
    if (book.treasure) {
      lines.push(isFound(book) ? `Found by: ${foundBy(book)}` : `§7not found yet (seek: ${book.treasure})§r`);
    }
    if (book.freeLevels > 0) lines.push(`Level ${ROMAN[book.freeLevels]}: §7unlocked from the start§r`);
    for (const { step, givers, paid, cost } of stepContributions(book)) {
      const names = givers.map(([who, count]) => (count > 1 && !who.endsWith("(found)") ? `${who} ×${count}` : who)).join(", ");
      const progress = paid < cost ? ` §7(${paid} of ${cost} so far)§r` : "";
      lines.push(`${stepLabel(step)}: ${names}${progress}`);
    }
    if (!lines.length || (book.treasure && lines.length === 1 && isFound(book))) lines.push("§7no Favors yet§r");
    return `§l${book.name}§r\n${lines.join("\n")}`;
  });
  const form = new ActionFormData()
    .title(`Who helped: ${group.name}`)
    .body(`What every Overseer's Favor on these books paid for, and who gave it.\n\n${sections.join("\n\n")}`)
    .button("« Back");
  const response = await show(player, form);
  return !response.canceled;
}

// The rules, read from the pack's own costs so this page never goes stale.
async function showHowItWorks(player) {
  const levelCosts = LEVEL_COSTS.map((cost, i) => `${ROMAN[i + 1]}: ${cost}`).join(", ");
  const discounts = DISCOUNT_COSTS.map((cost, i) => `${i === 0 ? "" : "then "}${cost} more → ${emeralds(PRICES[i + 1])}`).join(", ");
  const body = [
    "§lEarning Favors§r\nThe Overseer still watches. Prove your resilience (show up for events, play exceptionally, bring good ideas) and you may be given an Overseer's Favor.",
    "§lSpending a Favor§r\nEvery book hangs in a frame on the stacks, with a sign under it. Hold a Favor and right-click a book's frame to put it toward that book. Favors from everyone add up on the same book, and every unlock is shared by everyone. A book never takes a Favor it doesn't need.",
    `§lUnlocking levels§r\nFavors per level: ${levelCosts}.`,
    `§lBuying§r\nPick a book here, then a level, then confirm. Every unlocked level costs ${emeralds(PRICES[0])}, or less once the book has been made cheaper. The emeralds come from your inventory.`,
    `§lCheaper books§r\nOnce a book is at its top level, more Favors lower its price for everyone: ${discounts}.`,
    "§lTreasure books§r\nSome books can only be found out in the world: Swift Sneak (Ancient City), Soul Speed (Bastion) and Wind Burst (Trial Chamber). Their frames start empty. Bring a real copy (one with other enchantments too is fine) and right-click its empty frame: the library keeps your book, everyone hears you found it, and the book starts unlocked up to the level of the copy you brought. Favors unlock the rest, like any other book.",
    "§lKeeping track§r\nThe sign under each book shows its level, price and progress. Who helped lists everyone who put Favors on this librarian's books, and who found each treasure book.",
  ].join("\n\n");
  const form = new ActionFormData().title("How it works").body(body).button("« Back");
  const response = await show(player, form);
  return !response.canceled;
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
      if (book === HELPERS || book === HOW_IT_WORKS) {
        const shownOk = book === HELPERS ? await showHelpers(player, group) : await showHowItWorks(player);
        if (!shownOk || !player.isValid()) return;
        continue; // back to the book list
      }
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
