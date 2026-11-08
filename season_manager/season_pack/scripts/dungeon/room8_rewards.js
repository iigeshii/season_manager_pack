import { world, system, BlockPermutation, ItemStack, ItemTypes, EnchantmentTypes } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { P, NETHER_ID, origin } from "./run_state.js";
import { isMember, sendHome } from "./mending_rescue.js";

// ─────────────────────────────────────────────
//  ROOM 8: THE LIBRARIAN'S THANKS (rewards)
//  After the librarian is gone, chests appear along the hall's east wall.
//  Opening any of them shows a menu instead of the chest's inventory: each
//  party member picks PICKS rewards (the same one twice is fine). Rewards
//  never run out, so there's nothing to refill. A pick only goes through
//  if the player has room for all of it (FREE_SLOTS). After their last
//  pick a player leaves the party and is sent home. room8.js decides when
//  the chests open and when the event ends (everyone done, or a timeout).
// ─────────────────────────────────────────────

const PICKS = 2;
const SEND_HOME_DELAY = 40; // ticks after the last pick
const BUSY_RETRIES = 5; // form couldn't show (e.g. chat open): try again
const BUSY_RETRY_TICKS = 10;

// Structure-relative spots, on the floor against the east wall of the
// hall's south half, facing into the room.
const CHESTS = [
  [16, 1, 25],
  [16, 1, 27],
  [16, 1, 29],
];
const CHEST_FACING = "west";
// A sign on the wall above the middle chest.
const SIGN = [16, 2, 27];
const SIGN_BLOCK = "minecraft:crimson_wall_sign";
const SIGN_FACING = 4; // facing_direction: west, hanging on the east wall
const SIGN_TEXT = "§lPick your\nprizes!§r\n\nOpen a chest";

// ── The rewards ─────────────────────────────

const DIAMOND_TOOLS = [
  ["diamond_pickaxe", "Diamond Pickaxe"],
  ["diamond_axe", "Diamond Axe"],
  ["diamond_shovel", "Diamond Shovel"],
  ["diamond_sword", "Diamond Sword"],
];

const DIAMOND_ARMOR = [
  ["diamond_helmet", "Diamond Helmet"],
  ["diamond_chestplate", "Diamond Chestplate"],
  ["diamond_leggings", "Diamond Leggings"],
  ["diamond_boots", "Diamond Boots"],
];

// Every book at its max level, Mending included; the curses are left out.
// Ids this version of the game doesn't have are skipped.
const BOOK_GROUPS = [
  [
    "Mending & Unbreaking",
    [
      ["mending", "Mending"],
      ["unbreaking", "Unbreaking"],
    ],
  ],
  [
    "Armor",
    [
      ["protection", "Protection"],
      ["fire_protection", "Fire Protection"],
      ["blast_protection", "Blast Protection"],
      ["projectile_protection", "Projectile Protection"],
      ["thorns", "Thorns"],
      ["feather_falling", "Feather Falling"],
      ["respiration", "Respiration"],
      ["aqua_affinity", "Aqua Affinity"],
      ["depth_strider", "Depth Strider"],
      ["frost_walker", "Frost Walker"],
      ["soul_speed", "Soul Speed"],
      ["swift_sneak", "Swift Sneak"],
    ],
  ],
  [
    "Swords & Axes",
    [
      ["sharpness", "Sharpness"],
      ["smite", "Smite"],
      ["bane_of_arthropods", "Bane of Arthropods"],
      ["knockback", "Knockback"],
      ["fire_aspect", "Fire Aspect"],
      ["looting", "Looting"],
    ],
  ],
  [
    "Tools",
    [
      ["efficiency", "Efficiency"],
      ["silk_touch", "Silk Touch"],
      ["fortune", "Fortune"],
    ],
  ],
  [
    "Bows & Crossbows",
    [
      ["power", "Power"],
      ["punch", "Punch"],
      ["flame", "Flame"],
      ["infinity", "Infinity"],
      ["multishot", "Multishot"],
      ["piercing", "Piercing"],
      ["quick_charge", "Quick Charge"],
    ],
  ],
  [
    "Trident, Mace & Spear",
    [
      ["loyalty", "Loyalty"],
      ["riptide", "Riptide"],
      ["channeling", "Channeling"],
      ["impaling", "Impaling"],
      ["density", "Density"],
      ["breach", "Breach"],
      ["wind_burst", "Wind Burst"],
      ["lunge", "Lunge"],
    ],
  ],
  [
    "Fishing",
    [
      ["luck_of_the_sea", "Luck of the Sea"],
      ["lure", "Lure"],
    ],
  ],
];

const TOTEMS = 3; // one pick = this many totems

const APPLES = 8; // enchanted golden apples, one pick

const ROMAN = ["", "I", "II", "III", "IV", "V"];

// A reward: what to call it, how many free inventory slots it needs, and
// grant(player), which gives it (throws if it can't).
function addItems(player, items) {
  const container = player.getComponent("minecraft:inventory").container;
  for (const item of items) container.addItem(item);
}

function gearReward(id, name) {
  return { name, slots: 1, grant: (player) => addItems(player, [new ItemStack("minecraft:" + id, 1)]) };
}

function bookReward(id, name) {
  const type = EnchantmentTypes.get(id);
  const level = type?.maxLevel ?? 1;
  return {
    name: `${name}${level > 1 ? " " + (ROMAN[level] ?? level) : ""} Book`,
    slots: 1,
    grant: (player) => {
      const book = new ItemStack("minecraft:enchanted_book", 1);
      book.getComponent("minecraft:enchantable").addEnchantment({ type, level });
      addItems(player, [book]);
    },
  };
}

const TOTEM_REWARD = {
  name: `${TOTEMS} Totems of Undying`,
  slots: TOTEMS, // totems don't stack
  grant: (player) => addItems(player, Array.from({ length: TOTEMS }, () => new ItemStack("minecraft:totem_of_undying", 1))),
};

const APPLE_REWARD = {
  name: `${APPLES} Enchanted Golden Apples`,
  slots: 1, // they stack
  grant: (player) => addItems(player, [new ItemStack("minecraft:enchanted_golden_apple", APPLES)]),
};

const itemExists = (id) => ItemTypes.get("minecraft:" + id) !== undefined;
const enchantExists = (id) => EnchantmentTypes.get(id) !== undefined;

// ── State ───────────────────────────────────

let open = false;
const picks = new Map(); // player id → picks taken this time the chests are open
const inMenu = new Set(); // player ids with a menu up

const pickCount = (player) => picks.get(player.id) ?? 0;

function at(rel) {
  const o = origin();
  return { x: o.x + rel[0], y: o.y + rel[1], z: o.z + rel[2] };
}

function blockAt(rel) {
  try {
    return world.getDimension(NETHER_ID).getBlock(at(rel));
  } catch {
    return undefined; // chunk not loaded
  }
}

function isOurChest(block) {
  if (!origin() || block.typeId !== "minecraft:chest" || block.dimension.id !== NETHER_ID) return false;
  const o = origin();
  return CHESTS.some(([x, y, z]) => block.x === o.x + x && block.y === o.y + y && block.z === o.z + z);
}

function chestPermutation() {
  try {
    return BlockPermutation.resolve("minecraft:chest", { "minecraft:cardinal_direction": CHEST_FACING });
  } catch {
    return BlockPermutation.resolve("minecraft:chest"); // older state name: facing is cosmetic
  }
}

function placeSign() {
  const block = blockAt(SIGN);
  if (block?.typeId !== "minecraft:air") return; // something's there: no sign
  try {
    block.setPermutation(BlockPermutation.resolve(SIGN_BLOCK, { facing_direction: SIGN_FACING }));
    const sign = block.getComponent("minecraft:sign");
    sign?.setText(SIGN_TEXT);
    sign?.setWaxed(true); // can't be edited
  } catch (error) {
    console.warn(`[Mending Rescue] Couldn't place the prize sign: ${error}`);
  }
}

// ── Opening and closing (called by room8.js) ─

// Puts the chests out. Returns false if the hall isn't loaded yet.
export function openRewards() {
  if (CHESTS.some((p) => !blockAt(p))) return false;
  const chest = chestPermutation();
  for (const p of CHESTS) {
    const block = blockAt(p);
    if (block.typeId === "minecraft:air") block.setPermutation(chest);
  }
  placeSign();
  open = true;
  picks.clear();
  return true;
}

// Takes the chests away again. Safe to call any time.
export function closeRewards() {
  open = false;
  picks.clear();
  const sign = blockAt(SIGN);
  if (sign?.typeId === SIGN_BLOCK) sign.setPermutation(BlockPermutation.resolve("minecraft:air"));
  for (const p of CHESTS) {
    const block = blockAt(p);
    if (block?.typeId === "minecraft:chest") block.setPermutation(BlockPermutation.resolve("minecraft:air"));
  }
}

export const rewardsOpen = () => open;

// Party members who still have picks left.
export const stillChoosing = (player) => open && isMember(player) && pickCount(player) < PICKS;

export const REWARD_PICKS = PICKS;

// ── Menus ───────────────────────────────────

async function show(player, form) {
  for (let i = 0; i <= BUSY_RETRIES; i++) {
    const response = await form.show(player);
    if (response.cancelationReason !== "UserBusy") return response;
    await new Promise((resolve) => system.runTimeout(resolve, BUSY_RETRY_TICKS));
    if (!player.isValid()) return response;
  }
  return { canceled: true };
}

function freeSlots(player) {
  return player.getComponent("minecraft:inventory")?.container?.emptySlotsCount ?? 0;
}

function header(player) {
  return `Pick ${pickCount(player) + 1} of ${PICKS}. §7Free inventory slots: ${freeSlots(player)}`;
}

// Main menu: pick a kind of reward. Returns the reward, or undefined.
async function chooseReward(player) {
  for (;;) {
    const form = new ActionFormData()
      .title("Pick Your Prizes")
      .body(`The librarian's thanks for freeing him: take whatever you like.\n\n${header(player)}`)
      .button("Diamond Tool", "textures/items/diamond_pickaxe")
      .button("Diamond Armor", "textures/items/diamond_chestplate")
      .button(`Totems of Undying (${TOTEMS})`, "textures/items/totem")
      .button("Enchanted Book (max level)", "textures/items/book_enchanted")
      .button(`Enchanted Golden Apples (${APPLES})`, "textures/items/apple_golden");
    const response = await show(player, form);
    if (response.canceled) return undefined;
    let reward;
    if (response.selection === 0) reward = await chooseGear(player, "Diamond Tool", DIAMOND_TOOLS);
    else if (response.selection === 1) reward = await chooseGear(player, "Diamond Armor", DIAMOND_ARMOR);
    else if (response.selection === 2) reward = TOTEM_REWARD;
    else if (response.selection === 3) reward = await chooseBook(player);
    else reward = APPLE_REWARD;
    if (reward && (await confirm(player, reward))) return reward;
    // backed out: show the main menu again
  }
}

async function chooseGear(player, title, list) {
  const gear = list.filter(([id]) => itemExists(id));
  const form = new ActionFormData().title(title).body(header(player));
  for (const [id, name] of gear) form.button(name, `textures/items/${id}`);
  form.button("« Back");
  const response = await show(player, form);
  if (response.canceled || response.selection >= gear.length) return undefined;
  const [id, name] = gear[response.selection];
  return gearReward(id, name);
}

async function chooseBook(player) {
  for (;;) {
    const groups = BOOK_GROUPS.map(([group, books]) => [group, books.filter(([id]) => enchantExists(id))]).filter(
      ([, books]) => books.length > 0
    );
    const form = new ActionFormData().title("Enchanted Book").body(header(player));
    for (const [group] of groups) form.button(group, "textures/items/book_enchanted");
    form.button("« Back");
    const response = await show(player, form);
    if (response.canceled || response.selection >= groups.length) return undefined;

    const [group, books] = groups[response.selection];
    const choices = books.map(([id, name]) => bookReward(id, name));
    const list = new ActionFormData().title(group).body(header(player));
    for (const reward of choices) list.button(reward.name.replace(/ Book$/, ""), "textures/items/book_enchanted");
    list.button("« Back");
    const picked = await show(player, list);
    if (picked.canceled) return undefined;
    if (picked.selection < choices.length) return choices[picked.selection];
    // back: the group list again
  }
}

async function confirm(player, reward) {
  const last = pickCount(player) + 1 === PICKS;
  const form = new ActionFormData()
    .title("Take this reward?")
    .body(
      `§l${reward.name}§r\n\nThis is pick ${pickCount(player) + 1} of ${PICKS}.` +
        (last ? " After this you'll be sent home." : "") +
        `\nNeeds ${reward.slots} free inventory slot${reward.slots > 1 ? "s" : ""}.`
    )
    .button("Take it")
    .button("« Back");
  const response = await show(player, form);
  return !response.canceled && response.selection === 0;
}

// ── Giving ──────────────────────────────────

function give(player, reward) {
  // Checked again here: the inventory or the run can change while a menu
  // is up.
  if (!stillChoosing(player) || player.dimension.id !== NETHER_ID) return;
  const free = freeSlots(player);
  if (free < reward.slots) {
    player.sendMessage(
      `§cYou need ${reward.slots} free inventory slot${reward.slots > 1 ? "s" : ""} for ${reward.name} (you have ${free}). Make room and open a chest again.`
    );
    player.playSound("note.bass");
    return;
  }
  try {
    reward.grant(player);
  } catch (error) {
    console.warn(`[Mending Rescue] Couldn't give reward ${reward.name} to ${player.name}: ${error}`);
    player.sendMessage("§cSomething went wrong giving that prize, so it didn't count as a pick. Tell an operator.");
    return;
  }

  const taken = pickCount(player) + 1;
  picks.set(player.id, taken);
  player.playSound("random.levelup");
  console.warn(`[Mending Rescue] Reward: ${player.name} took ${reward.name} (pick ${taken} of ${PICKS})`);

  if (taken < PICKS) {
    player.sendMessage(`§aYou took ${reward.name}. §fOpen a chest again for your last pick.`);
    return;
  }
  player.sendMessage(`§aYou took ${reward.name}. §fThat's all your picks. Thank you for freeing the librarian!`);
  system.runTimeout(() => {
    if (!player.isValid()) return;
    // Off the party first, so a later death or login doesn't bring them
    // back to the dungeon.
    player.setDynamicProperty(P + "member", undefined);
    if (player.dimension.id === NETHER_ID) sendHome(player, "§7You've been sent home.");
  }, SEND_HOME_DELAY);
}

async function runMenu(player) {
  inMenu.add(player.id);
  try {
    const reward = await chooseReward(player);
    if (reward && player.isValid()) give(player, reward);
  } catch (error) {
    console.warn(`[Mending Rescue] Reward menu failed for ${player.name}: ${error}`);
  } finally {
    inMenu.delete(player.id);
  }
}

// ── The chests ──────────────────────────────

// Our chests never open as chests: they show the menu instead, so nothing
// can be put in or taken out of them directly.
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (!isOurChest(event.block)) return;
  event.cancel = true;
  const player = event.player;
  if (inMenu.has(player.id)) return; // the event repeats while held
  system.run(() => {
    if (!player.isValid() || inMenu.has(player.id)) return;
    if (!open) return;
    if (!isMember(player)) {
      player.sendMessage("§7These rewards are for the rescue party.");
      return;
    }
    if (pickCount(player) >= PICKS) {
      player.sendMessage("§7You've already taken your rewards.");
      return;
    }
    runMenu(player);
  });
});
