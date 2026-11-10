# Enchantment Tokens: Automated Mystic Library

**Status:** design only, nothing implemented yet.

This replaces the hand-edited token ledger in `season_planner/index.html` with an in-game system. Players spend tokens at a single board in the Mystic Library. The pack tracks every token, and the librarians' stock and prices update automatically.

## How it works

### Opening the library
- Eric opens the library once, after Rescue the Librarian, with `/scriptevent season:library open`.
- From that point every book is open. There are no group-by-group openings and no tier gate, so players can put tokens on any book they like. If they pour everything into one book, that's their choice.
- In the starting state, **Mending is the only unlocked book**. It's free because the rescue already handed out the first one. Every other book starts at Level 0 and needs tokens from Level I up.
- Before the library is opened, the board refuses tokens and no group librarians appear.

### Tokens
- Tokens are a custom item called the **Overseer's Favor** (item ID `newhaven:wyatt_token`). It's named for The Overseer: Wyatt Reeves, the god who gathered the group, rewards those who prove their resilience, and whose name has been lost over the seasons. The ID keeps the old working name (Wyatt Token) so tokens already handed out keep working.
- They're handed out with the regular `/give` command, for example `/give Fredo newhaven:wyatt_token 4`. Event scripts can also award them.
- Eric decides when and why tokens are given out: events, exceptional play, good ideas or any other reward. The pack sets no payout rules.
- Players can't craft tokens.
- Any player can put tokens on any book at any time. Tokens from several players pool toward the same level.

### The library stacks (the board)
- There is **one set of stacks** for the whole library: three double-sided bookshelf stacks with aisles between them, **17 wide × 13 deep × 4 high**. (The first version was a single 17 × 6 obsidian wall; it was replaced to look like a real library.)

  ```
          aisle A  S1  aisle B   S2  aisle C   S3  aisle D
           . . .   |   . . . @   |   @ . . .   |   . . .     ← Tools, General
           . . @   #   M . . T   #   G . . @   #   W . .     ← Ranged, Armor
           . . R   #   M . . T   #   G . . A   #   W . .
           . . R   #   M . . T   #   G . . A   #   W . .
           . . R   #   M . . .   |   . . . A   #   W . .     ← divider
           . . R   #   M . . F   #   . . . A   #   W . .
           . . R   #   M . . F   #   H . . A   #   W . .
           . . R   #   M . . @   #   H . . A   #   W . .     ← Fire
           . . R   #   M . . .   #   @ . . .   #   @ . .     ← Fishing, Water
           . . .   |   @ . . .   |   . . . .   |   . . .     ← Melee, end caps
           . . .   .   . . . @   ★   . . . .   .   . . .     ← Mending + its librarian
                                  ↑ entrance: where `board` is run
    #  bookshelf   |  dark oak log   @ librarian
    R Ranged  M Melee  A Armor  F Fire  G General  H Fishing  T Tools  W Water  ★ Mending
  ```

- Each stack is 4 high: bookshelves at the bottom, a status sign under each book at eye level, the book's frame above it, and a group name sign on top. Dark oak log pillars cap every stack end and divide Tools from Fire and General from Fishing. Signs are birch so their dark text stays readable. Books read left to right for someone standing in the aisle.
- Eric stands at the entrance facing in and runs `/scriptevent season:library board`. Running it again somewhere else moves the stacks, along with their librarians.
- **One-time setup.** Scripts can't put items into frames, so the books are filled in by hand once:
  1. Before anything is captured, `board` builds the stacks with empty frames and hands Eric the display books **one section (group) at a time**, straight into empty hotbar slots, in walking order. When a section's last book goes in, the next section's books follow on their own. The biggest section has 8 books, so a clear hotbar always fits one. `board books` gives the current section again.
  2. Eric right-clicks each decoy into the frame above its matching sign. A decoy put into the wrong frame is refused, with a message naming the book that belongs there. Chat counts progress ("12 of 39 placed").
  3. `board capture` saves each filled frame as its own one-block structure, with the way it faced. It refuses to run until all 39 are placed, and then empties the frames of treasure books nobody has found yet.

  After that, `board` builds the shelves and signs by script and loads the saved frames, turned to the new facing. When books are added to the library later, only their frames need filling: `board` loads every saved frame, leaves the new ones empty, hands out just their display books, and `board capture` saves them. Only the board's own blocks are touched, so the aisles are never overwritten. Books captured on the first obsidian board carry over, and that board is cleared away the first time `board` or `board remove` runs.
- Each book is an item frame holding a display copy of the book (a named decoy, explained below), with a sign under it that the pack rewrites, for example:

  ```
  Sharpness
  Level III of V
  32 emeralds
  IV: 1/3 tokens
  ```

  Once a book is maxed, its sign shows discount progress. At 1 emerald it shows that it's fully discounted.
- The stacks are protected, and only the board commands can remove them:
  - **Breaking blocks:** any block break inside the board's area is cancelled, in survival or creative.
  - **Explosions:** creepers, TNT, ghasts and withers still explode, but the board's blocks are taken off their list of blocks to destroy.
  - **Frames:** right-clicking is already taken over by token deposits, so books can't be rotated or pulled out that way. If a book is knocked out by hitting the frame, it's only a decoy (see below), and the rebuild puts it back.
  - **Fire:** bookshelves burn, and burning can't be cancelled. A fire guard runs every second: it puts out any fire touching the stacks, and if a shelf has burned away it rebuilds it at once, with any frame or sign that fell off it.
  - **Pistons:** bookshelves can be pushed. The 60-second self-repair rebuilds them.
  - **Self-repair:** every 60 seconds, the pack checks every board block and rebuilds anything missing or wrong, including framed books, and rewrites every sign (a sign can show blank to players after a cancelled break even though the server still has its text). Signs are also redrawn whenever the ledger changes.
  - **Display books are decoys:** the framed books are Curse of Vanishing books given the name of the book they stand for (for example "Sharpness"), with a "Display copy" lore line. They still have the enchanted glint, but a stolen one is worthless, so the board can't be farmed for free books.

### Putting tokens on a book
- A player right-clicks a book's frame while holding a token. The pack cancels the frame interaction, takes one token and credits that book in the player's name.
- Every token is recorded against the player who gave it.
- Tokens go in one at a time, and a frame only takes a token its book can use. Nothing ever overflows. The frame refuses the token, and the player keeps it, when:
  - the library hasn't been opened yet, or
  - the book is at its max level and already at its lowest price (1 emerald).
- The player is told why the token was refused. Because a token that can't be used is never taken, there are no refunds.
- When a level unlocks or a price drops, a message goes to the whole server.

### Librarians
- Each group has one librarian, tied to the board and named after the group (for example "Ranged Librarian"). Mending has the Mending Librarian.
- A group's librarian appears as soon as the group has at least one book that can be bought. When the board is first placed, that's only the Mending Librarian. The others arrive as their group's first book unlocks.
- Librarians stand at fixed spots and never move. They don't wander, follow a villager schedule, or run from raids. Each librarian stands just left of their group's books, as you face them. Where two groups share a side of a stack (Armor and Fire, Fishing and General), the second group's librarian stands just right of it instead, so the two are at opposite ends. The Mending Librarian stands just left of Mending's frame at the entrance.
- Librarians face into their aisle. (A version with a custom "Library Lectern" in front of each librarian was tried and dropped; the stacks were tuned by eye in game instead, so each librarian stands where it looked right next to their books.)
- The stacks are 10 long, which leaves room for every librarian beside their books with the aisles clear.

  A spot stays empty until its librarian appears. The name over each librarian's head shows the group.
- Librarians can't be hurt, killed or turned into zombie villagers. A damage filter on their villager variant ignores all damage, so nothing needs respawning. The same filter stops lightning from turning them into witches.
- Librarians can't change profession.
- **The board's Mending Librarian is the real one.** The rescued librarian from the event sells nothing (`summon_rescued_librarian` makes an empty librarian tagged `season:rescue_empty_librarian`). When the board is first created, the pack removes any villager tagged `season:rescue_empty_librarian` or `season:rescue_mending_librarian`. It can only reach villagers in loaded chunks, so stand near the old one or remove it by hand.
- The old `summon_mending_librarian` function, which sells Mending at 20 emeralds through vanilla trades, is no longer needed once the board exists.

### The shop
- Right-clicking a librarian cancels the vanilla trade screen and opens a menu (`@minecraft/server-ui`).
- The menu lists only that librarian's group: its unlocked books with their price, and the still-locked books named underneath. Then pick a level (skipped for single-level books), then confirm, with the price and the emeralds you have shown.
- On a purchase, the pack takes the emeralds from the player's inventory and hands over the enchanted book at that level. Every unlocked level of a book costs the same. Purchases are noted in the content log.
- The librarians are checked every 5 seconds: one that has drifted is put back on its spot, duplicates are removed, and missing ones are summoned once their spot has been loaded for a moment.

### The in-game ledger is the master
- The pack's own record of tokens is the only source of truth.
- The librarians' stock and prices are read straight from it. Players can put tokens on books whenever they want, and the shops update straight away with no change to the pack.

### Admin commands
| Command | What it does |
|---|---|
| `season:library open` | Opens the library. Run once, after Rescue the Librarian. |
| `season:library board` | Builds the stacks in front of you (stand at the entrance facing in). Existing stacks are removed first, so this also moves them. Before the first capture it builds empty frames and gives you the 33 decoy books. After that it loads the saved books. `board force` replaces whatever is in the way. |
| `season:library board books` | Gives you the full set of 33 decoy books again. |
| `season:library board capture` | Saves each filled frame on its own. It only runs once all 33 books are placed. |
| `season:library board fresh` | Builds the stacks with empty frames, to fill and capture again. |
| `season:library board info` | Where the stacks are, and whether they're captured. |
| `season:library board remove` | Removes the stacks and their librarians. The ledger and saved books are kept. |
| `season:library status [book]` | Shows the whole library, or one book: level, tokens toward the next step, price. |
| `season:library add <book> <n>` | Adds tokens to a book, recorded as an admin change. |
| `season:library remove <book> <n>` | Takes tokens back off a book. It can drop the book a level. |
| `season:library set <book> <level> [discount]` | Puts a book at an exact state. |
| `season:library history [player]` | Shows who put tokens where. |
| `season:library reset` | Wipes the ledger back to the starting state (Mending only), with a confirmation step. |

All of these are run as `/scriptevent season:library ...`. Tokens are handed out with the regular `/give`.

## Pricing

### Unlocking levels
| Level | Tokens |
|---|---|
| I | 1 |
| II | 2 |
| III | 3 |
| IV | 3 |
| V | 3 |

- A level never costs more than 3 tokens.
- Every unlocked level sells for **32 emeralds**, whatever the level.
- There are no free books apart from Mending, and no tier gate.

### Discounts
Once a book reaches its max level, more tokens lower its price. A discount covers every level of that book.

| Step | Tokens | Price |
|---|---|---|
| Discount 1 | 2 | 32 → 16 |
| Discount 2 | 2 | 16 → 8 |
| Discount 3 | 3 | 8 → **1** |

A full discount costs 7 tokens for any book. (It was 1, 2, 3 at first; the first step was raised to 2.)

### Mending
- Mending starts unlocked. The rescue handed out the first book, so Level I costs no tokens.
- It sells for 32 emeralds like every other book, replacing the current 20.
- It discounts like any other book: 2, 2 and 3 tokens.

### Treasure books
- Three books can only be found out in the world, never bought from a vanilla villager: **Swift Sneak** (Ancient City), **Soul Speed** (Bastion, Piglin bartering) and **Wind Burst** (Trial Chamber ominous vaults). A player asked for them so nobody has to find another Ancient City or Trial Chamber every time they want one.
- Their frames start **empty** on the live stacks, with a sign reading "Not yet found", where to look, and "Bring one here". Until found, they can't take tokens and no librarian sells them.
- The first player to right-click the empty frame holding a **real** enchanted book with that enchantment (other enchantments on the same book are fine; display copies don't count) donates it: the library keeps the book, the display copy is loaded into the frame, and the whole server hears who found it ("Fredo brought home Swift Sneak!"). From then on it's an ordinary book: tokens unlock its levels, its librarian sells it, and it can be discounted.
- Who helped shows "Found by: <player>". Admins can mark one found without a copy (`found <book>`, credited to the Overseer) or undo a find (`lost <book>`).
- Three more books joined the library as ordinary token books at the same time: **Frost Walker** (often found anyway, so a find requirement would just be a chore), and the mace books **Density** and **Breach** (enchanting-table books, missing only because there's no enchanting table). Armor holds Swift Sneak, Soul Speed and Frost Walker; Melee holds Density, Breach and Wind Burst. Curses are left out.

## Examples

**Sharpness (max V)**

| Step | Tokens | Running total | Price |
|---|---|---|---|
| Level I | 1 | 1 | 32 |
| Level II | 2 | 3 | 32 |
| Level III | 3 | 6 | 32 |
| Level IV | 3 | 9 | 32 |
| Level V | 3 | 12 | 32 |
| Discount 1 | 2 | 14 | 16 |
| Discount 2 | 2 | 16 | 8 |
| Discount 3 | 3 | **19** | **1** |

**Mending (max I)**

| Step | Tokens | Running total | Price |
|---|---|---|---|
| Level I | 0 (unlocked from the start) | 0 | 32 |
| Discount 1 | 2 | 2 | 16 |
| Discount 2 | 2 | 4 | 8 |
| Discount 3 | 3 | **7** | **1** |

## Whole-library totals

The library has 38 books across the 8 groups, plus Mending (39 in all).

| Max level | Books | Tokens to max each | Subtotal |
|---|---|---|---|
| V | Sharpness, Smite, Bane of Arthropods, Density, Efficiency, Power, Impaling | 12 | 84 |
| IV | Feather Falling, Protection, Blast Protection, Projectile Protection, Breach, Piercing, Fire Protection | 9 | 63 |
| III | Unbreaking, Thorns, Luck of the Sea, Lure, Swift Sneak, Soul Speed, Looting, Wind Burst, Fortune, Quick Charge, Respiration, Depth Strider, Loyalty, Riptide | 6 | 84 |
| II | Frost Walker, Knockback, Punch, Fire Aspect | 3 | 12 |
| I | Silk Touch, Infinity, Multishot, Flame, Aqua Affinity, Channeling | 1 | 6 |

| | Tokens | 4-person events |
|---|---|---|
| Max every book | 249 | ~63 |
| Discount every book to 1 emerald, including Mending (39 × 7) | 273 | ~69 |
| **Total** | **522** | **~131** |

(Before the treasure books and mace books joined, it was 33 books and 438 tokens.)

## Planner changes needed
The planner (`season_planner/index.html`) is a static page and can't show live progress, so it stops tracking tokens once this goes live.
- Remove the token ledger (`EVENTS`, `SPENDS` and the Token Ledger card), the per-book progress display, and the group opening flags and tier gate.
- Replace them with a short note: the token system is now active in game, with the rules (level costs 1, 2, 3, 3, 3; every book 32 emeralds; discounts 2, 2, 3 tokens → 16, 8, 1) and where to find the board in the Mystic Library.

## Later
- **Libraries in several towns.** For now there's one library and one board. If more towns get libraries, every board would share the same ledger: the board state becomes a list of named boards (`board add <town>`, `board remove [town]`, `board list`), all placed from the one captured copy. Each board's signs update when the ledger changes, or when its area loads, and each board gets its own librarians.

## Open questions
- **The token item's look:** named the Overseer's Favor. The look is "Wyatt's eye", shown below, out to the group for feedback.

  <img src="wyatt_token_preview.png" width="128" alt="Wyatt's eye token draft: a gold coin with a watching eye in Wyatt's cyan">

  The 16×16 texture is `wyatt_token.png`. The iris uses the cyan of Wyatt's skin.

## Technical findings
Tested in game with the temporary rig in `scripts/library/frame_test.js` (`/scriptevent season:library_test ...`), in survival and creative.

| Check | Result |
|---|---|
| Script places a frame, a wall sign and obsidian, and writes the sign | Works. |
| Script puts a book into a frame | **Doesn't work.** No frame component is exposed, and `replaceitem` silently does nothing. Books must come from a saved structure. |
| Decoy book (Curse of Vanishing, custom name, lore) goes into a frame by hand | Works, with the glint. |
| Right-click on a frame with a token is caught and cancelled | Works. The token is taken and the book stays. |
| Break blocking on frame, sign and obsidian | Works, in survival and creative. **A cancelled break on a sign wipes its text**, so the pack writes it back two ticks later. |
| Punching a book out of a frame in survival | **Can't be cancelled.** It isn't a break. `entityHitBlock` does fire, so the pack removes the dropped decoy and reloads that one frame from a 1-block structure two ticks later. This was tested and the book comes back straight away. |
| Saving a rig with `/structure save` and loading it elsewhere, rotated to a new facing | Works. The book survives and the frame faces the right way. |

**What this means for the board:** it's placed from a saved structure that already holds the decoy books, not built block by block. Each book's frame is also saved as its own 1-block structure for put-backs.

Enchanting books from script already works in this pack (`scripts/dungeon/room8_rewards.js`), and its reward menu is the pattern the shop will follow.

Still to check: whether the explosion before-event lets the script remove board blocks from an explosion's list of blocks to destroy.

Ledger state lives in world dynamic properties: tokens per book and level by player, the discount step per book, and the board's position and facing. The librarian spots are worked out from the board's position.
