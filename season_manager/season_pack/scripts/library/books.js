// ─────────────────────────────────────────────
//  MYSTIC LIBRARY: BOOKS AND COSTS
//  Every book the library sells, in board order (top band left to right,
//  then the bottom band), and the token ladder each one climbs.
// ─────────────────────────────────────────────

// Tokens to unlock each level (index 0 = Level I). Never more than 3.
export const LEVEL_COSTS = [1, 2, 3, 3, 3];
// Tokens for each discount step once a book is maxed.
export const DISCOUNT_COSTS = [2, 2, 3];
// Emerald price by discount step: none, 1, 2, 3.
export const PRICES = [32, 16, 8, 1];
// Levels a book starts with. Mending comes unlocked: Rescue the Librarian gave out the first one.
const FREE_LEVELS = { mending: 1 };

export const ROMAN = ["0", "I", "II", "III", "IV", "V"];

// Shorter names for board signs, where long names would wrap.
const SIGN_NAMES = {
  feather_falling: "Feather Fall",
  luck_of_the_sea: "Luck of Sea",
  blast_protection: "Blast Prot",
  projectile_protection: "Proj. Prot",
  bane_of_arthropods: "Bane of Arth.",
  fire_protection: "Fire Prot",
};

// [group id, group name, [[enchantment id, book name, max level], ...]]
const CATALOG = [
  ["mending", "Mending", [["mending", "Mending", 1]]],
  [
    "general",
    "General",
    [
      ["unbreaking", "Unbreaking", 3],
      ["feather_falling", "Feather Falling", 4],
      ["thorns", "Thorns", 3],
    ],
  ],
  [
    "fishing",
    "Fishing",
    [
      ["luck_of_the_sea", "Luck of the Sea", 3],
      ["lure", "Lure", 3],
    ],
  ],
  [
    "armor",
    "Armor",
    [
      ["protection", "Protection", 4],
      ["blast_protection", "Blast Protection", 4],
      ["projectile_protection", "Projectile Protection", 4],
    ],
  ],
  [
    "melee",
    "Melee",
    [
      ["sharpness", "Sharpness", 5],
      ["smite", "Smite", 5],
      ["bane_of_arthropods", "Bane of Arthropods", 5],
      ["knockback", "Knockback", 2],
      ["looting", "Looting", 3],
    ],
  ],
  [
    "tools",
    "Tools",
    [
      ["efficiency", "Efficiency", 5],
      ["fortune", "Fortune", 3],
      ["silk_touch", "Silk Touch", 1],
    ],
  ],
  [
    "ranged",
    "Ranged",
    [
      ["power", "Power", 5],
      ["punch", "Punch", 2],
      ["infinity", "Infinity", 1],
      ["piercing", "Piercing", 4],
      ["quick_charge", "Quick Charge", 3],
      ["multishot", "Multishot", 1],
      ["flame", "Flame", 1],
    ],
  ],
  [
    "fire",
    "Fire",
    [
      ["fire_aspect", "Fire Aspect", 2],
      ["fire_protection", "Fire Protection", 4],
    ],
  ],
  [
    "water",
    "Water",
    [
      ["respiration", "Respiration", 3],
      ["aqua_affinity", "Aqua Affinity", 1],
      ["depth_strider", "Depth Strider", 3],
      ["impaling", "Impaling", 5],
      ["loyalty", "Loyalty", 3],
      ["riptide", "Riptide", 3],
      ["channeling", "Channeling", 1],
    ],
  ],
];

// The steps a book climbs, in order: each level it doesn't start with, then the discounts.
function stepsFor(freeLevels, max) {
  const steps = [];
  for (let level = freeLevels + 1; level <= max; level++) {
    steps.push({ kind: "level", level, cost: LEVEL_COSTS[level - 1] });
  }
  DISCOUNT_COSTS.forEach((cost, i) => steps.push({ kind: "discount", discount: i + 1, cost, price: PRICES[i + 1] }));
  return steps;
}

export const GROUPS = CATALOG.map(([id, name, books]) => ({
  id,
  name,
  books: books.map(([bookId, bookName, max]) => {
    const freeLevels = FREE_LEVELS[bookId] ?? 0;
    const steps = stepsFor(freeLevels, max);
    return {
      id: bookId,
      name: bookName,
      max,
      group: id,
      groupName: name,
      signName: SIGN_NAMES[bookId] ?? bookName,
      freeLevels,
      steps,
      maxTokens: steps.reduce((sum, step) => sum + step.cost, 0),
    };
  }),
}));

export const BOOKS = GROUPS.flatMap((group) => group.books);

const squash = (text) => text.toLowerCase().replace(/[^a-z]/g, "");

// Finds a book from what an admin typed: its id or name, any case, spaces
// optional ("bane_of_arthropods", "Bane of Arthropods", "bane"). Returns
// { book } or { error }.
export function findBook(text) {
  const wanted = squash(text ?? "");
  if (!wanted) return { error: "Name a book." };
  const exact = BOOKS.find((book) => squash(book.id) === wanted || squash(book.name) === wanted);
  if (exact) return { book: exact };
  const partial = BOOKS.filter((book) => squash(book.name).startsWith(wanted));
  if (partial.length === 1) return { book: partial[0] };
  if (partial.length > 1) return { error: `"${text}" could be ${partial.map((b) => b.name).join(", ")}.` };
  return { error: `No book called "${text}".` };
}
