import { world, system } from "@minecraft/server";
import { GROUPS, ROMAN, findBook } from "./books.js";
import {
  isOpen,
  openLibrary,
  bookStatus,
  describeStep,
  emeralds,
  addTokens,
  removeTokens,
  setBook,
  resetLibrary,
  historyLines,
  giversOf,
  booksOf,
} from "./ledger.js";

// ─────────────────────────────────────────────
//  MYSTIC LIBRARY: ADMIN COMMANDS
//    /scriptevent season:library open
//    /scriptevent season:library status [book]
//    /scriptevent season:library add <book> <tokens>
//    /scriptevent season:library remove <book> <tokens>
//    /scriptevent season:library set <book> <level> [discount]
//    /scriptevent season:library history [player]
//    /scriptevent season:library reset            (then: reset confirm)
//  Tokens themselves are handed out with /give @p newhaven:wyatt_token <n>.
// ─────────────────────────────────────────────

const EVENT_ID = "season:library";
const RESET_WINDOW = 600; // ticks (30 s) to confirm a reset

let resetAskedAt = -Infinity;

// One book, short: "Unbreaking II (1/3)", "Sharpness V · 16em (1/2)", "Lure III · 1em ✔".
function shortStatus(book) {
  const s = bookStatus(book);
  const level = s.level ? ROMAN[s.level] : "—";
  const price = s.level >= book.max ? ` · ${s.price}em` : "";
  const next = s.next ? ` §7(${s.progress}/${s.next.cost})§r` : " §a✔§r";
  return `${book.name} ${level}${price}${next}`;
}

function libraryStatus() {
  const lines = [`§6Mystic Library§r ${isOpen() ? "§aopen" : "§cnot open yet"}§r. Level, price once maxed, (tokens toward next step):`];
  for (const group of GROUPS) lines.push(`§e${group.name}:§r ${group.books.map(shortStatus).join(", ")}`);
  return lines.join("\n");
}

function bookDetail(book) {
  const s = bookStatus(book);
  const group = book.groupName === book.name ? "" : ` (${book.groupName})`;
  const lines = [`§6${book.name}§r${group}: Level ${s.level ? ROMAN[s.level] : "0"} of ${ROMAN[book.max]}.`];
  if (s.level > 0) lines.push(`Sells for §6${emeralds(s.price)}§r.`);
  else lines.push("Not for sale yet.");
  if (s.next) lines.push(`Next: ${describeStep(book, s.next)}, §b${s.progress}/${s.next.cost}§r tokens.`);
  else lines.push("§aComplete:§r maxed and fully discounted.");
  lines.push(`Tokens so far: ${s.total} of ${book.maxTokens}.`);
  const givers = giversOf(book);
  if (givers.length) lines.push(`Given by: ${givers.map(([who, n]) => `${who} ${n}`).join(", ")}.`);
  return lines.join("\n");
}

// Splits "<book words...> <n> [<n>]" into the book text and up to `max` trailing numbers.
function splitNumbers(words, max) {
  const numbers = [];
  while (numbers.length < max && words.length > 1 && /^-?\d+$/.test(words.at(-1))) numbers.unshift(Number(words.pop()));
  return { text: words.join(" "), numbers };
}

function handle(word, args, who, reply) {
  switch (word) {
    case "open": {
      if (!openLibrary()) return reply("§7The library is already open.");
      world.sendMessage("§dThe Mystic Library is open! Bring Wyatt Tokens to the board to unlock its books.");
      return;
    }

    case "status":
    case "": {
      if (!args.length) return reply(libraryStatus());
      const { book, error } = findBook(args.join(" "));
      return reply(error ? `§c${error}` : bookDetail(book));
    }

    case "add":
    case "remove": {
      const { text, numbers } = splitNumbers([...args], 1);
      const [count] = numbers;
      if (!Number.isInteger(count) || count < 1) return reply(`§cUse: ${word} <book> <tokens>`);
      const { book, error } = findBook(text);
      if (error) return reply(`§c${error}`);
      if (word === "add") {
        const taken = addTokens(book, count, who, "a");
        if (!taken) return reply(`§c${book.name} is already complete. No tokens added.`);
        reply(`§aAdded ${taken} to ${book.name}${taken < count ? ` (it only needed ${taken})` : ""}.`);
      } else {
        const removed = removeTokens(book, count, who);
        if (!removed) return reply(`§c${book.name} has no tokens to remove.`);
        reply(`§aRemoved ${removed} from ${book.name}.`);
      }
      return reply(bookDetail(book));
    }

    case "set": {
      const { text, numbers } = splitNumbers([...args], 2);
      const [level, discount = 0] = numbers;
      if (level === undefined) return reply("§cUse: set <book> <level> [discount]");
      const { book, error } = findBook(text);
      if (error) return reply(`§c${error}`);
      const problem = setBook(book, level, discount, who);
      if (problem) return reply(`§c${problem}`);
      reply(`§a${book.name} set.`);
      return reply(bookDetail(book));
    }

    case "history": {
      const player = args.join(" ") || undefined;
      const lines = historyLines(player);
      if (!lines.length) return reply(player ? `§7No tokens from ${player} yet.` : "§7No tokens given yet.");
      const header = player ? `§6Last ${lines.length} entries for ${player}:` : `§6Last ${lines.length} entries:`;
      const out = [header, ...lines];
      if (player) {
        const books = booksOf(player);
        if (books.length) out.push(`§eTotals:§r ${books.map(([name, n]) => `${name} ${n}`).join(", ")}`);
      }
      return reply(out.join("\n"));
    }

    case "reset": {
      if (args[0]?.toLowerCase() !== "confirm") {
        resetAskedAt = system.currentTick;
        return reply("§cThis wipes every token and the whole history, and closes the library. Type §lreset confirm§r§c within 30 seconds to go ahead.");
      }
      if (system.currentTick - resetAskedAt > RESET_WINDOW) return reply("§cType §lreset§r§c first, then §lreset confirm§r§c.");
      resetAskedAt = -Infinity;
      resetLibrary();
      return reply("§aLibrary reset: no tokens, no history, Mending only, and closed. Run §lopen§r§a to open it again.");
    }

    default:
      return reply(
        "§7Use: /scriptevent season:library <open | status [book] | add <book> <n> | remove <book> <n> | set <book> <level> [discount] | history [player] | reset>"
      );
  }
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== EVENT_ID) return;
  const player = event.sourceEntity?.typeId === "minecraft:player" ? event.sourceEntity : undefined;
  const reply = (text) => (player ? player.sendMessage(text) : console.warn(text));
  const [word = "", ...args] = event.message.trim().split(/\s+/).filter(Boolean);
  try {
    handle(word.toLowerCase(), args, player?.name ?? "console", reply);
  } catch (error) {
    reply(`§cLibrary command failed: ${error}`);
    console.warn(`[Library] ${error}\n${error?.stack ?? ""}`);
  }
});
