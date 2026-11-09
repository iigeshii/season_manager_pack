import { world } from "@minecraft/server";
import { BOOKS, PRICES, ROMAN } from "./books.js";

// ─────────────────────────────────────────────
//  MYSTIC LIBRARY: THE LEDGER
//  The one record of every token put on a book. Everything else (the
//  board's signs, what the librarians sell, at what price) is read from
//  here. Saved with the world.
//
//  Each book just stores its running token total; its level, discount
//  and price all follow from that total and the book's step ladder.
// ─────────────────────────────────────────────

const STATE_KEY = "season:library";
const HISTORY_KEY = "season:library_history";
const CHUNK = 30000; // a dynamic property string holds at most 32767 characters

// ── Storage ─────────────────────────────────

function readChunked(key, fallback) {
  try {
    const count = world.getDynamicProperty(`${key}#n`) ?? 0;
    if (!count) return fallback;
    let text = "";
    for (let i = 0; i < count; i++) text += world.getDynamicProperty(`${key}#${i}`) ?? "";
    return JSON.parse(text);
  } catch (error) {
    console.warn(`[Library] Couldn't read ${key}: ${error}`);
    return fallback;
  }
}

function writeChunked(key, value) {
  const text = JSON.stringify(value);
  const count = Math.max(1, Math.ceil(text.length / CHUNK));
  const old = world.getDynamicProperty(`${key}#n`) ?? 0;
  for (let i = 0; i < count; i++) world.setDynamicProperty(`${key}#${i}`, text.slice(i * CHUNK, (i + 1) * CHUNK));
  for (let i = count; i < old; i++) world.setDynamicProperty(`${key}#${i}`, undefined);
  world.setDynamicProperty(`${key}#n`, count);
}

const freshState = () => ({ open: false, tokens: {} });

let state; // { open, tokens: { bookId: total } }
let history; // [[time, player, bookId, change, kind]], oldest first; kind: p = player, a = admin add, r = admin remove, s = admin set

function loadAll() {
  if (state) return;
  state = readChunked(STATE_KEY, freshState());
  history = readChunked(HISTORY_KEY, []);
}

const listeners = [];

// Called after every change to the ledger (tokens, open/closed, reset),
// so the board can redraw its signs.
export function onLedgerChange(listener) {
  listeners.push(listener);
}

function saveState() {
  writeChunked(STATE_KEY, state);
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn(`[Library] Change listener failed: ${error}`);
    }
  }
}

function record(player, book, change, kind) {
  history.push([Date.now(), player, book.id, change, kind]);
  writeChunked(HISTORY_KEY, history);
}

// ── Reading ─────────────────────────────────

export function isOpen() {
  loadAll();
  return state.open;
}

export function tokensFor(book) {
  loadAll();
  return state.tokens[book.id] ?? 0;
}

// Where a book stands for a given token total: its level, discount step,
// price, the next step and how far along it is. `next` is null once the
// book is maxed and fully discounted.
export function bookStatus(book, total = tokensFor(book)) {
  let left = total;
  let level = book.freeLevels;
  let discount = 0;
  for (const step of book.steps) {
    if (left < step.cost) return { level, discount, price: PRICES[discount], next: step, progress: left, total };
    left -= step.cost;
    if (step.kind === "level") level = step.level;
    else discount = step.discount;
  }
  return { level, discount, price: PRICES[discount], next: null, progress: 0, total };
}

export const emeralds = (count) => `${count} emerald${count === 1 ? "" : "s"}`;

export function describeStep(book, step) {
  return step.kind === "level" ? `Level ${ROMAN[step.level]}` : `price drops to ${emeralds(step.price)}`;
}

// Everything that happened between two totals, as announcement lines.
function milestones(book, before, after) {
  const lines = [];
  let spent = 0;
  for (const step of book.steps) {
    spent += step.cost;
    if (spent <= before || spent > after) continue;
    if (step.kind === "level") lines.push(`§b${book.name} ${ROMAN[step.level]}§d is now unlocked!`);
    else if (step.price === 1) lines.push(`§b${book.name}§d is fully discounted: §61 emerald§d!`);
    else lines.push(`§b${book.name}§d now costs §6${emeralds(step.price)}§d.`);
  }
  return lines;
}

function announce(lines) {
  for (const line of lines) world.sendMessage(line);
}

// ── Changing ────────────────────────────────

export function openLibrary() {
  loadAll();
  if (state.open) return false;
  state.open = true;
  saveState();
  return true;
}

// Puts up to `count` tokens on a book, never past its last step. Returns
// how many were taken; anything over that wasn't used and stays with the
// giver. `kind` is "p" for a player's own token, "a" for an admin add.
export function addTokens(book, count, player, kind = "p") {
  loadAll();
  const before = tokensFor(book);
  const taken = Math.max(0, Math.min(count, book.maxTokens - before));
  if (!taken) return 0;
  state.tokens[book.id] = before + taken;
  saveState();
  record(player, book, taken, kind);
  announce(milestones(book, before, before + taken));
  return taken;
}

// Takes up to `count` tokens back off a book. Returns how many came off.
export function removeTokens(book, count, player) {
  loadAll();
  const before = tokensFor(book);
  const removed = Math.max(0, Math.min(count, before));
  if (!removed) return 0;
  state.tokens[book.id] = before - removed;
  saveState();
  record(player, book, -removed, "r");
  return removed;
}

// Puts a book at an exact level and discount step. Returns an error string,
// or undefined when it worked.
export function setBook(book, level, discount, player) {
  loadAll();
  if (!Number.isInteger(level) || level < book.freeLevels || level > book.max) {
    return `${book.name} goes from Level ${ROMAN[book.freeLevels]} to ${ROMAN[book.max]}.`;
  }
  if (!Number.isInteger(discount) || discount < 0 || discount > PRICES.length - 1) {
    return `Discount steps go from 0 to ${PRICES.length - 1}.`;
  }
  if (discount > 0 && level < book.max) return `${book.name} has to be at Level ${ROMAN[book.max]} before it can be discounted.`;
  let total = 0;
  for (const step of book.steps) {
    const reached = step.kind === "level" ? step.level <= level : step.discount <= discount;
    if (reached) total += step.cost;
  }
  const before = tokensFor(book);
  state.tokens[book.id] = total;
  saveState();
  record(player, book, total - before, "s");
  return undefined;
}

export function resetLibrary() {
  loadAll();
  state = freshState();
  history = [];
  saveState();
  writeChunked(HISTORY_KEY, history);
}

// ── History ─────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function day(time) {
  const date = new Date(time);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

const bookById = (id) => BOOKS.find((book) => book.id === id);

const KIND_LABELS = { p: "", a: " (admin)", r: " (admin remove)", s: " (admin set)" };

export function historyLines(player, limit = 10) {
  loadAll();
  const wanted = player?.toLowerCase();
  const rows = history.filter(([, who]) => !wanted || who.toLowerCase() === wanted);
  return rows.slice(-limit).map(([time, who, bookId, change, kind]) => {
    const sign = change >= 0 ? "+" : "";
    return `§7${day(time)}§r ${who} → ${bookById(bookId)?.name ?? bookId} ${sign}${change}${KIND_LABELS[kind] ?? ""}`;
  });
}

export const OVERSEER = "the Overseer"; // who admin-added tokens are credited to

// What each token on a book did: replays the book's history token by token
// (admin adds credited to the Overseer, removals taking the newest tokens
// back off), then sorts the surviving tokens into the steps they paid for.
// Returns one entry per step that has at least one token, in order:
//   { step, givers: [[name, count], ...], paid, cost }
export function stepContributions(book) {
  loadAll();
  const tokens = []; // who gave each token on the book, oldest first
  for (const [, who, bookId, change, kind] of history) {
    if (bookId !== book.id || !change) continue;
    if (change > 0) {
      const giver = kind === "p" ? who : OVERSEER;
      for (let i = 0; i < change; i++) tokens.push(giver);
    } else {
      tokens.splice(Math.max(0, tokens.length + change));
    }
  }
  // Anything recorded before history existed is the Overseer's.
  while (tokens.length < tokensFor(book)) tokens.unshift(OVERSEER);
  tokens.splice(tokensFor(book));

  const out = [];
  let next = 0;
  for (const step of book.steps) {
    if (next >= tokens.length) break;
    const paidBy = tokens.slice(next, next + step.cost);
    next += step.cost;
    const counts = new Map();
    for (const name of paidBy) counts.set(name, (counts.get(name) ?? 0) + 1);
    out.push({ step, givers: [...counts.entries()], paid: paidBy.length, cost: step.cost });
  }
  return out;
}

// Tokens each player has put on a book (their own deposits only).
export function giversOf(book) {
  loadAll();
  const totals = {};
  for (const [, who, bookId, change, kind] of history) {
    if (bookId === book.id && kind === "p") totals[who] = (totals[who] ?? 0) + change;
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

// Tokens a player has put on each book (their own deposits only).
export function booksOf(player) {
  loadAll();
  const wanted = player.toLowerCase();
  const totals = {};
  for (const [, who, bookId, change, kind] of history) {
    if (who.toLowerCase() === wanted && kind === "p") totals[bookId] = (totals[bookId] ?? 0) + change;
  }
  return Object.entries(totals)
    .map(([bookId, count]) => [bookById(bookId)?.name ?? bookId, count])
    .sort((a, b) => b[1] - a[1]);
}
