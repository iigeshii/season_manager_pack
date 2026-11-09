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
- Tokens are a custom item, working name the **Wyatt Token** (`newhaven:wyatt_token`), after Wyatt Reeves, the god the players say watches over them.
- They're handed out with the regular `/give` command, for example `/give Fredo newhaven:wyatt_token 4`. Event scripts can also award them.
- Eric decides when and why tokens are given out: events, exceptional play, good ideas or any other reward. The pack sets no payout rules.
- Players can't craft tokens.
- Any player can put tokens on any book at any time. Tokens from several players pool toward the same level.

### The library stacks (the board)
- There is **one set of stacks** for the whole library: three double-sided bookshelf stacks with aisles between them, **17 wide × 11 deep × 4 high**. (The first version was a single 17 × 6 obsidian wall; it was replaced to look like a real library.)

  ```
          aisle A  S1  aisle B   S2  aisle C   S3  aisle D
           . @ .   |   @ . @ @   |   @ @ . @   |   . @ .     ← librarians (back of each aisle)
           . . R   #   . . . A   #   G . . .   #   W . .
           . . R   #   M . . A   #   G . . .   #   W . .
           . . R   #   M . . A   #   G . . T   #   W . .
           . . R   #   M . . .   |   . . . T   #   W . .     ← divider
           . . R   #   M . . F   #   H . . T   #   W . .
           . . R   #   M . . F   #   H . . .   #   W . .
           . . R   #   . . . .   #   . . . .   #   W . .
           . . .   |   . . . .   |   . . . .   |   . . .     ← end caps
           . . .   .   . . . .   ★   . . . .   .   . . .     ← Mending, facing the entrance
           . . .   .   . . . .   . @ . . .   .   . . .     ← Mending Librarian
                                  ↑ entrance: where `board` is run
    #  bookshelf   |  dark oak log   R Ranged  M Melee  A Armor  F Fire
    G General  H Fishing  T Tools  W Water  ★ Mending   @ librarian
  ```

- Each stack is 4 high: bookshelves at the bottom, a status sign under each book at eye level, the book's frame above it, and a group name sign on top. Dark oak log pillars cap every stack end and divide Armor from Fire and General from Fishing. Signs are birch so their dark text stays readable. Books read left to right for someone standing in the aisle.
- Eric stands at the entrance facing in and runs `/scriptevent season:library board`. Running it again somewhere else moves the stacks, along with their librarians.
- **One-time setup.** Scripts can't put items into frames, so the books are filled in by hand once:
  1. Before anything is captured, `board` builds the stacks with empty frames and gives Eric all 33 decoy books (32 enchantments plus Mending). That needs 33 free inventory slots. If there isn't room, the command says so and gives nothing. `board books` gives the full set again.
  2. Eric right-clicks each decoy into the frame above its matching sign. A decoy put into the wrong frame is refused, with a message naming the book that belongs there. Chat counts progress ("12 of 33 placed").
  3. `board capture` saves each filled frame as its own one-block structure, with the way it faced. It refuses to run until all 33 are placed.

  After that, `board` builds the shelves and signs by script and loads the 33 saved frames, turned to the new facing. Only the board's own blocks are touched, so the aisles are never overwritten. Books captured on the first obsidian board carry over, and that board is cleared away the first time `board` or `board remove` runs.
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
- Librarians stand at fixed spots and never move. They don't wander, follow a villager schedule, or run from raids. Each group's librarian stands at the back of the aisle its books face, so the aisles stay clear (see the top view above):
  - **Aisle A:** Ranged.
  - **Aisle B:** Melee, Armor and Fire.
  - **Aisle C:** General, Fishing and Tools.
  - **Aisle D:** Water.
  - **Entrance:** the Mending Librarian, beside Mending's end cap.

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

The library has 32 books across the 8 groups, plus Mending.

| Max level | Books | Tokens to max each | Subtotal |
|---|---|---|---|
| V | Sharpness, Smite, Bane of Arthropods, Efficiency, Power, Impaling | 12 | 72 |
| IV | Feather Falling, Protection, Blast Protection, Projectile Protection, Piercing, Fire Protection | 9 | 54 |
| III | Unbreaking, Thorns, Luck of the Sea, Lure, Looting, Fortune, Quick Charge, Respiration, Depth Strider, Loyalty, Riptide | 6 | 66 |
| II | Knockback, Punch, Fire Aspect | 3 | 9 |
| I | Silk Touch, Infinity, Multishot, Flame, Aqua Affinity, Channeling | 1 | 6 |

| | Tokens | 4-person events |
|---|---|---|
| Max every book | 207 | ~52 |
| Discount every book to 1 emerald, including Mending (33 × 7) | 231 | ~58 |
| **Total** | **438** | **~110** |

## Planner changes needed
The planner (`season_planner/index.html`) is a static page and can't show live progress, so it stops tracking tokens once this goes live.
- Remove the token ledger (`EVENTS`, `SPENDS` and the Token Ledger card), the per-book progress display, and the group opening flags and tier gate.
- Replace them with a short note: the token system is now active in game, with the rules (level costs 1, 2, 3, 3, 3; every book 32 emeralds; discounts 2, 2, 3 tokens → 16, 8, 1) and where to find the board in the Mystic Library.

## Later
- **Libraries in several towns.** For now there's one library and one board. If more towns get libraries, every board would share the same ledger: the board state becomes a list of named boards (`board add <town>`, `board remove [town]`, `board list`), all placed from the one captured copy. Each board's signs update when the ledger changes, or when its area loads, and each board gets its own lecterns and librarians.

## Open questions
- **The token item:** its final name (Wyatt Token is the working name). The leading look is "Wyatt's eye", shown below, which is out to the group for feedback.

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

Ledger state lives in world dynamic properties: tokens per book and level by player, the discount step per book, and the board's position and facing. The lectern spots are worked out from the board's position.
