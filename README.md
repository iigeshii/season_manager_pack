# Custom Manager

A Minecraft Bedrock Edition behavior pack for customizing and managing a
season of play, built on `@minecraft/server` and `@minecraft/server-ui`.

By [Gesh Giezel](https://github.com/iigeshii/season_manager_pack). Licensed
under the [MIT License](LICENSE).

## Layout

- `season_manager/season_pack/` — the behavior pack itself
  (`manifest.json`, `scripts/main.js`, `functions/`, `trading/`,
  `recipes/`, `loot_tables/`, `entities/`)
- `scripts/build.sh` — packages the behavior pack into a `.mcpack`
- `dist/` — build output; the `.mcpack` files get committed for release,
  everything else in here is git-ignored

## Building

```sh
./scripts/build.sh
```

Produces `dist/season_manager-<version>.mcpack` (e.g.
`dist/season_manager-1.0.42.mcpack`), versioned so each build gets its own
file instead of overwriting the last one. Double-click it (with Minecraft
installed) or copy it into your `development_behavior_packs` folder to
install.

Every build stamps the patch digit of both `manifest.json` `"version"`
arrays (header and script module) with the repo's current commit count,
so it always increases — the tracked source keeps `[1, 0, 0]` as a
placeholder. Minecraft only replaces an already-imported pack if the new
one has a higher version, so without this a rebuilt `.mcpack` can silently
get ignored on reimport. This means the version only advances when you
actually commit — if you're testing uncommitted changes, the reimport
won't be seen as an update.

## Usage

### Cleanup sequence

The pack automatically sweeps every online player every
`CLEANUP_INTERVAL_TICKS` (default 20 ticks = 1 second) and clears each item
in the `CLEANUP_ITEMS` list in
[`main.js`](season_manager/season_pack/scripts/main.js) — currently every
banned item except the diamond tools/weapon/armor set and Honey Block
(see below): `elytra`, `dispenser`, `dropper`, `sticky_piston`, `piston`,
`conduit`, `hopper`, `hopper_minecart`, `crafter`, `observer`,
`blaze_powder`, `enchanting_table`, `comparator`, `repeater`, and `daylight_detector`.
Elytra is here because it can turn up as loot (End ships) with no
crafting step involved, so a recipe lock wouldn't apply to it anyway —
it has no vanilla recipe at all.

Dispenser, Dropper, Sticky Piston, and Piston went further than the rest
of the list: all four originally had recipe locks (matching the technique
used everywhere else in this pack — see git history), but dropper, sticky
piston, and piston stopped showing up in the survival recipe book for
reasons that were never fully root-caused. Dispenser's lock was working
fine on its own; removing it as a diagnostic test brought Dispenser back
in the recipe book immediately, but dropper still didn't reappear, which
ruled out the leading theory (that dropper and dispenser were colliding
with each other over their near-identical vanilla shape) — and
piston/sticky piston aren't shape-twins with anything else in this pack,
so that theory didn't fit them either. Rather than ship four recipe files
with an unexplained, unreliable display quirk, all four were simplified
down to destroy-on-pickup only — their recipe lock files have been
removed entirely, so this is now the sole mechanism restricting them.
Repeater, added later after one turned up in the world, never had a
recipe lock at all for the same reason — it's destroy-on-pickup only
from the start.

Everything else on the list (conduit, hopper, hopper_minecart, crafter,
observer, blaze_powder, enchanting_table, comparator, daylight_detector)
still keeps its recipe lock too — this is belt-and-suspenders, not a
replacement for it. The reason it got added: a player found a loose
hopper in a trial chambers loot room, proving a recipe lock alone doesn't
stop something found rather than crafted, and there was no reason to
assume hopper was the only banned item with a real find-it-in-the-world
path.

The tradeoff versus a working recipe lock alone: a found/looted copy of
anything on this list doesn't survive either, where a pure recipe lock
(like the ten diamond items, which are deliberately excluded from this
list) leaves found/looted copies alone. If a milestone reopens one of
these items later, remember it needs removing from both places —
deleting its recipe lock file only stops crafting; it'll still get
destroyed on pickup until it's also taken out of `CLEANUP_ITEMS`. Anvil
(plus `chipped_anvil`/`damaged_anvil`) is the first real example of this
— though via a direct group vote (specifically to allow nametags) rather
than The Forge Reopens milestone, which hasn't actually been reached. All
three were removed from `CLEANUP_ITEMS` and `anvil.json` was deleted —
both halves had to change either way.
`heart_of_the_sea` is deliberately not on this list at all: it's inert on
its own, and the only thing it's good for (a Conduit) is already covered
by `conduit` being on the list, so restricting the raw item too would add
nothing.
When an item is actually removed from a
player, that player gets a chat message telling them it's currently
disabled. No command block or redstone clock needed; it starts as soon as
the pack loads.

To ban more items, add their item IDs to the `CLEANUP_ITEMS` array. To
change how often the sweep runs, adjust `CLEANUP_INTERVAL_TICKS`.

For manual testing you can also trigger a single sweep on demand from a
command block (no leading slash needed inside a command block):

```
scriptevent season:cleanup
```

or from chat/a command block via the bundled function:

```
/function season/cleanup
```

This requires cheats to be enabled in the world settings.

### Banned mobs

Any mob in the `BANNED_MOBS` set in
[`main.js`](season_manager/season_pack/scripts/main.js) — currently
`minecraft:iron_golem`, `minecraft:piglin`, and
`minecraft:piglin_brute` — is removed the instant it spawns, whether it
appears naturally, gets built (e.g. pumpkin + iron blocks), or is
converted (e.g. a zombified piglin reverting in the Overworld). It's
despawned outright rather than killed, so no death event fires and it
drops no loot.

The piglin ban is a standing rule, not month-gated, so it's already in
effect even though piglins can't reach the Overworld until the Nether
opens (Month 5). It's still in effect afterward too — including during
Month 6's Bastion Remnant push, so bastions will be effectively
undefended until this is revisited.

To ban more mobs, add their type IDs to the `BANNED_MOBS` set.

### Villager trades

All 13 villager professions plus the wandering trader have their trades
disabled entirely. Trade tables in
[`trading/economy_trades/`](season_manager/season_pack/trading/economy_trades/)
override the vanilla files at those same paths — same filenames, same
location — with `{"tiers": []}`, so no trades ever populate regardless
of profession or level: `armorer_trades.json`, `butcher_trades.json`,
`cartographer_trades.json`, `cleric_trades.json`, `farmer_trades.json`,
`fisherman_trades.json`, `fletcher_trades.json`,
`leather_worker_trades.json`, `librarian_trades.json`,
`shepherd_trades.json`, `stone_mason_trades.json`,
`tool_smith_trades.json`, `wandering_trader_trades.json`, and
`weapon_smith_trades.json`.

This doesn't affect the [Rescue Villagers](#rescue-villagers) below —
their tables (`mending_librarian_trades.json`,
`froglight_cleric_trades.json`) are separate files, referenced only by
the custom rescue component groups, not by any vanilla profession name.

This is data, not script — none of it is gated by `enabled` or affected
by `scriptevent season:toggle`. To restore trading for a profession,
look up that file's git history for the unmodified vanilla version
committed just before it was emptied.

### Fishing

[`loot_tables/gameplay/fishing/treasure.json`](season_manager/season_pack/loot_tables/gameplay/fishing/treasure.json)
overrides the vanilla treasure pool (shared by both the regular and
jungle fishing tables). Bow and Fishing Rod catches restore vanilla's
`enchant_with_levels` (30 levels, treasure-only enchants), so they can
come pre-enchanted again same as vanilla. Book catches keep that function
removed — a fished-up book still never comes pre-enchanted. Fish and junk
pools are untouched. See
`original_loot/loot_tables/gameplay/fishing/treasure.json` for the
unmodified vanilla version.

### Turtle scute drop

[`loot_tables/entities/sea_turtle.json`](season_manager/season_pack/loot_tables/entities/sea_turtle.json)
overrides the vanilla Turtle loot table (the entity is `minecraft:turtle`,
but vanilla names the loot table file `sea_turtle.json`) to add a
guaranteed 1-2 Turtle Scute on death, on top of the existing Seagrass
drop. Vanilla doesn't drop Scute here at all — the only vanilla source is
a baby turtle growing into an adult, an entirely separate mechanic from
this loot table. See `original_loot/loot_tables/entities/sea_turtle.json`
for the unmodified vanilla version.

### Locked recipes

Recipes in [`recipes/`](season_manager/season_pack/recipes/) override
the vanilla recipe with the same `identifier` (recipes are matched by
identifier, not file path, but same idea as the trade table overrides:
highest-priority pack wins). Each locked recipe adds `minecraft:barrier`
as an extra required ingredient — a technical block with no way to
obtain it in survival — so the recipe still exists but can never actually
be crafted.

- **`blaze_powder.json`** — blaze rods can be found/used, but can't yet
  be ground into blaze powder. Also backed by `blaze_powder` in
  `CLEANUP_ITEMS` — see Cleanup sequence above.
- **`enchanting_table.json`** — diamonds, obsidian, and a book can all be
  gathered, but they can't yet be assembled into an enchanting table.
  Also backed by `enchanting_table` in `CLEANUP_ITEMS`.
- **`diamond_pickaxe.json`**, **`diamond_axe.json`**,
  **`diamond_shovel.json`**, **`diamond_hoe.json`**,
  **`diamond_sword.json`**, **`diamond_spear.json`**,
  **`diamond_helmet.json`**, **`diamond_chestplate.json`**,
  **`diamond_leggings.json`**, **`diamond_boots.json`** — all ten diamond
  tool/weapon/armor recipes are locked. Diamonds can be mined and held,
  they just can't be crafted into anything yet. Found/looted diamond gear
  (chest loot, mob drops) isn't affected — only crafting is blocked, since
  this is a recipe lock, not an item ban. Netherite Spear doesn't need its
  own lock, same as the other netherite upgrades — `smithing_netherite_spear`
  requires a Diamond Spear as its base ingredient, so it's already
  unreachable with the diamond recipe locked.
- **`conduit.json`** — Heart of the Sea is fully obtainable (buried
  treasure) and unrestricted on its own; it's inert without a Conduit, so
  this is the only lock that actually matters for it. Also backed by
  `conduit` in `CLEANUP_ITEMS`, so a found Conduit doesn't survive either.
- **`comparator.json`** — one of three vanilla crafting-table recipes
  (besides Quartz Block) that needs raw Nether Quartz. Also backed by
  `comparator` in `CLEANUP_ITEMS`.
- **`daylight_detector.json`**, **`daylight_detector_from_crimson_slab.json`**,
  **`daylight_detector_from_mangrove_slab.json`**,
  **`daylight_detector_from_warped_slab.json`** — vanilla actually ships
  four separate recipe identifiers for Daylight Detector (the base one
  plus a variant for each Nether wood slab), all needing raw quartz. All
  four are locked here — locking only the base one would leave the
  Nether-wood variants as an open bypass. The three wood-slab variants
  needed one more thing beyond the barrier: vanilla's own versions of
  these files have no `unlock` field at all, but Bedrock 1.20+ rejects
  any recipe missing one outright (visible as a `[Recipes][error] ...
  1.20+ Recipes require unlock data` line in the content log) — so
  mirroring vanilla exactly here actually breaks the override. Each one
  now has its own `"unlock": [{"item": "minecraft:quartz"}]`, same as
  the base recipe. Also backed by `daylight_detector` in `CLEANUP_ITEMS`.
- **`observer.json`** — the third quartz recipe. Also backed by
  `observer` in `CLEANUP_ITEMS`.
- **`hopper.json`**, **`hopper_minecart.json`** — a found hopper (chest
  loot in a few structures) could otherwise still be combined with a
  minecart, so the minecart recipe is locked too, not just the hopper's.
  Also backed by `hopper` and `hopper_minecart` in `CLEANUP_ITEMS` — this
  is exactly the found-hopper case that prompted adding the rest of this
  list to destroy-on-pickup in the first place.
- **`crafter.json`** — needs a Dropper as an ingredient, same as vanilla.
  Dropper itself is handled by destroy-on-pickup now (`dropper` in
  `CLEANUP_ITEMS`, see Cleanup sequence above) rather than a recipe lock —
  see that section for why — but a Dropper destroyed a tick after pickup
  could still theoretically get used in the same crafting action before
  cleanup runs, so this stays locked independently too, same reasoning as
  `hopper_minecart.json`. Also backed by `crafter` in `CLEANUP_ITEMS`
  itself, on top of that.

Anvil has no lock at all anymore — the group voted to allow it back
(specifically for nametags), not The Forge Reopens milestone, which
hasn't actually been reached. `anvil.json` was deleted and
`anvil`/`chipped_anvil`/`damaged_anvil` came off `CLEANUP_ITEMS` too. See
Cleanup sequence above.

Quartz Block itself, and anything crafted purely from a Quartz Block
(Quartz Pillar, Quartz Bricks, Chiseled Quartz Block, Quartz Stairs/Slabs,
Smooth Quartz and its stairs/slabs) are deliberately left alone — none of
those recipes need raw quartz as an ingredient, only the block, so once
the Nether's open and quartz ore is minable, all of that stays craftable.
Comparator, Daylight Detector, and Observer are the only three recipes
that need the raw item itself, which is why they're the ones locked.

Note on shape: crafting-table grids cap out at 3x3 — a shaped recipe
can't be wider or taller than that, full stop, so widening a pattern to
make room for the barrier only works if the vanilla recipe wasn't
already 3 wide. Most of these recipes had at least one empty cell in
their vanilla grid, so the barrier just fills that gap without changing
the recipe's footprint. `diamond_shovel.json` and `diamond_sword.json`
are vanilla single columns, so widening them to 2 columns for the
barrier is still well inside the 3x3 cap. `conduit.json`,
`daylight_detector.json` and its three wood-slab variants, and
`observer.json` are different: their vanilla grids are already a
completely full 3x3 (conduit's 8 nautilus shells around 1 heart of the
sea; daylight detector's 3 glass / 3 quartz / 3 slabs; observer's 6
cobblestone, 2 redstone, 1 quartz), so there's no room to add a 10th
cell. Those five instead have the barrier swap in for one of the
original filled cells (one nautilus shell or one glass) rather than sit
in new space — same effect, just one fewer of that particular vanilla
ingredient asked for, since the recipe can never be finished anyway.
`comparator.json`, `hopper.json`, and `diamond_spear.json` all had a
spare cell already in their vanilla 3x3 grid, so those three kept the
vanilla footprint. `crafter.json`'s vanilla grid is also a
completely full 3x3 (5 iron ingots, 1 crafting table, 2 redstone, 1
dropper), so it uses the same swap-in-a-filled-cell approach — one iron
ingot, in this case.
`hopper_minecart.json` is shapeless (like `blaze_powder.json`), so grid
size doesn't apply — the barrier is just a third required ingredient
alongside the hopper and minecart.

Same caveats as the trading overrides: this is data, not gated by
`enabled`/`scriptevent season:toggle`, and it freezes at whatever vanilla
recipe shape was copied in, so a future game update to this recipe won't
reach this pack until someone re-syncs it. One UX wrinkle: the recipe
book will still show it as unlocked once you hold a blaze rod (the
`unlock` condition is untouched), it just won't actually complete when
attempted — restore by deleting the file.

### Added recipes

Unlike everything in [Locked recipes](#locked-recipes) above, these
aren't overriding a vanilla identifier — they're new. A few vanilla
recipes only go one direction between two items, with no recipe for the
reverse; these fill that gap.

- **`rabbit_hide_from_leather.json`** — vanilla has 4 Rabbit Hide → 1
  Leather (`minecraft:leather`'s recipe) but nothing going back the other
  way. This is the exact mirror, just flipped: 1 Leather → 4 Rabbit Hide.
  Shapeless (no specific grid arrangement needed for a single
  ingredient), under its own `season:rabbit_hide_from_leather` identifier
  so it can't collide with any real or future vanilla recipe.
  Round-tripping through both recipes nets zero material gain or loss
  either direction, so this doesn't introduce a duplication exploit.
- **`melon_from_melon_block.json`** — same situation: vanilla has 9
  Melon (the slice item is actually called `minecraft:melon` in Bedrock)
  → 1 Melon Block (`minecraft:melon_block`'s recipe), but nothing going
  back. This is the mirror: 1 Melon Block → 9 Melon. Shapeless, under
  `season:melon_from_melon_block`. Same no-duplication-exploit reasoning
  as the Rabbit Hide recipe above — 9 slices in either direction, no net
  gain.
- **`chainmail_helmet.json`**, **`chainmail_chestplate.json`**,
  **`chainmail_leggings.json`**, **`chainmail_boots.json`** — Chainmail
  armor has no real crafting-table recipe in vanilla at all (only a
  furnace recipe for smelting a damaged piece back into a fresh one —
  see `original_loot/recipes/` for the vanilla iron armor recipes these
  were shaped after), so these are entirely new, under the real
  `minecraft:chainmail_*` identifiers since nothing else claims them.
  Same silhouette as the matching iron armor piece, but built from a mix
  of Chain (the frame — brow band, shoulder straps, waistband, ankle
  cuffs) and Iron Nugget (the mesh fill) instead of solid Iron Ingots:
  helmet 3 Chain + 2 Nugget, chestplate 2 Chain + 6 Nugget, leggings 3
  Chain + 4 Nugget, boots 2 Chain + 2 Nugget. Works out to roughly
  3.9/3.1/4.1/2.7 Iron Ingots' worth of material respectively (Chain
  itself costs 1 Ingot + 2 Nuggets to make, and 9 Nuggets = 1 Ingot) —
  cheaper than the matching iron piece across the board, which fits
  Chainmail's spot between Leather and Iron in vanilla's armor values.

### Swapped-ingredient recipes

Same vanilla `identifier`, same shape, same quantities — only the
material changed. Unlike [Locked recipes](#locked-recipes), these still
craft normally; nothing here is disabled.

- **`leather_helmet.json`**, **`leather_chestplate.json`**,
  **`leather_leggings.json`**, **`leather_boots.json`** — all four use
  Rabbit Hide (`minecraft:rabbit_hide`) instead of Leather now, in the
  exact same pattern and quantity vanilla used for Leather (3/6/7/4
  respectively — see each file's `pattern`). Plain Leather can still be
  worn if already owned, and still converts to/from Rabbit Hide via
  the vanilla recipe and `rabbit_hide_from_leather.json` above — it's
  just no longer what these four recipes ask for. `leather_horse_armor.json`
  was deliberately left alone; "leather armor" was read as the four
  player-wearable pieces, not horse armor.

### Rescue Villagers

Permanent, single-trade villagers that bypass the standing "all trades
disabled" rule above, summoned on demand via a bundled function. Each
one is a real `minecraft:villager_v2` whose profession is overridden in
[`entities/villager_v2.json`](season_manager/season_pack/entities/villager_v2.json)
with a custom component group carrying its own `economy_trade_table`
and `minecraft:dweller: {"can_find_poi": false}` (so it can't wander
off and reclaim a real job site, which would otherwise silently wipe
its trade). A script watchdog in
[`main.js`](season_manager/season_pack/scripts/main.js) re-fires the
becoming-event on a short interval as a backstop.

Each `summon_*.mcfunction` summons the entity, then targets it with
`@e[type=<type>,c=1]` for the `tag` and `/event entity` that follow.
Note for anyone touching this: Bedrock's `c=<n>` on `@e`/`@a`/`@p`
already sorts by increasing distance from the command's execution
position — there's no `sort=` keyword like Java Edition has, and adding
one is a hard parse error that fails the whole function to load. Since
the summon happens at the same position the function runs from, `c=1`
alone reliably resolves to the entity that was just created.

- **Mending Librarian** — `/function season/summon_mending_librarian`
  spawns a villager with exactly one trade: 20 emeralds for a book with
  Mending. Trade table:
  [`mending_librarian_trades.json`](season_manager/season_pack/trading/economy_trades/mending_librarian_trades.json).
- **Froglight Cleric** — `/function season/summon_froglight_cleric`
  spawns a villager offering all three froglight colors (ochre,
  verdant, pearlescent) for 5 emeralds each. Trade table:
  [`froglight_cleric_trades.json`](season_manager/season_pack/trading/economy_trades/froglight_cleric_trades.json).

Both functions require cheats to be enabled. Like the trade and recipe
overrides above, this is data plus a small always-on watchdog, not
gated by `enabled`/`scriptevent season:toggle`.

### Elite mobs

Standalone mini-bosses, summoned on demand, that stay permanently
tougher than their vanilla counterpart — same tag-and-event pattern as
the Rescue Villagers, just applied to a hostile mob instead of a
villager.

- **Elite Zombie** — `/function season/summon_elite_zombie` spawns 7
  blocks ahead of whichever way the caster is facing (`^ ^ ^7`, not
  `~ ~ ~`) so it doesn't land right on top of them. It's a hostile mob,
  so it won't stick around — or spawn at all — on Peaceful difficulty;
  that's vanilla behavior, not a pack bug. The zombie itself has 80
  health (vanilla: 20), 10 attack damage (vanilla: 3),
  full knockback resistance, a permanent Strength II / Resistance I /
  Fire Resistance / Regeneration effect stack (re-applied every 5
  seconds by a watchdog in
  [`main.js`](season_manager/season_pack/scripts/main.js), since potion
  effects expire on their own and the stat components don't), and a
  guaranteed enchanted iron sword plus a full iron armor set (see
  [`entities/zombie.json`](season_manager/season_pack/entities/zombie.json)
  and
  [`season_elite_zombie_equipment.json`](season_manager/season_pack/loot_tables/entities/season_elite_zombie_equipment.json)).

It's still `minecraft:zombie` under the hood (not a new custom
identifier), specifically so it renders normally without needing a
resource pack override — the same rendering pitfall that sank the
abandoned biome-trader villager work on `feature/biome_trader`.

Requires cheats to be enabled. Not gated by
`enabled`/`scriptevent season:toggle` — this is a standalone encounter,
not a season restriction.

### Leather armor speed bonus

Leather armor is crafted from Rabbit Hide now (see
[Swapped-ingredient recipes](#swapped-ingredient-recipes) above), and
wearing it grants a speed buff to match: 2 or 3 pieces of leather armor
worn grants Speed I, and a full 4-piece set grants Speed II instead (not
stacked on top of Speed I — it's one or the other). Checked and
re-applied every 5 seconds by a watchdog in
[`main.js`](season_manager/season_pack/scripts/main.js)
(`LEATHER_ARMOR_SLOTS`), since potion effects expire on their own and
armor doesn't trigger a re-check by itself. Mixing leather with other
armor materials still counts each leather piece — a leather helmet with
three diamond pieces is 1 leather piece worn (no buff), not disqualified
from the count entirely.

Like Elite Mobs, this isn't gated by `enabled`/`scriptevent
season:toggle` — it's a standing mechanic, not a season restriction.

### Chainmail armor haste bonus

Same idea as the Leather Armor Speed Bonus above, just Chainmail and
Haste instead of Leather and Speed: 2 or 3 pieces of Chainmail armor
worn grants Haste I, and a full 4-piece set grants Haste II instead (not
stacked on top of Haste I). Same watchdog pattern too — checked and
re-applied every 5 seconds (`CHAINMAIL_ARMOR_SLOTS` in
[`main.js`](season_manager/season_pack/scripts/main.js)), and mixing
Chainmail with other armor materials still counts each Chainmail piece
individually toward the total.

Not gated by `enabled`/`scriptevent season:toggle`, same as the Leather
bonus.

### Cheaper trim template duplication

All 19 Armor Trim Smithing Template duplication recipes (see
`original_loot/recipes/` for the vanilla originals this replaced) are
overridden to drop their cost from 7 Diamonds down to a single Copper
Ingot. Everything else about each recipe stays the same: same template,
same pattern-specific base material (e.g. Dune still needs Sandstone,
Coast still needs Cobblestone), same 2-copies result. Vanilla's version
of each recipe is shaped (a specific 3x3 arrangement); these are
shapeless instead, since there's no reason to force a particular grid
position once it's down to three distinct ingredients with no
duplicates. Bolt's separate waxed-copper variant is included too. The
Netherite Upgrade Smithing Template's duplication recipe is untouched —
it's a different template, not an armor trim, and wasn't part of this
change.

### Portal lock

Nether portals and the End portal are blocked from being activated:
using flint and steel, a lava bucket, or a fire charge on obsidian, or
an eye of ender on an end portal frame, does nothing and tells the
player it's currently disabled. Configured via the `PORTAL_IGNITERS`
list in [`main.js`](season_manager/season_pack/scripts/main.js). The
lava bucket case matters because pouring lava directly into a completed
obsidian frame ignites it too, same as flint and steel — a
Bedrock-specific mechanic Java doesn't have, easy to miss if you're only
picturing flint and steel.

This only intercepts a *player* actually using the item — it hooks
`itemUseOn`, which never fires for a dispenser or hopper clock
triggering the same item with no player involved. An automated ignition
setup (e.g. a dispenser-fed lava bucket or fire charge on a timer) will
still light the portal; nothing currently catches that, since there's
no ignition-side event to intercept and no reliable way to detect "a
portal just turned on" from script. Closing that gap would mean
periodically scanning for lit portals and breaking the obsidian frame
outright (not just the portal's air blocks, which self-heal from an
intact frame) — deliberately not implemented yet, since it would be the
first thing in this pack that destroys player-placed blocks
automatically.

This also only stops *ignition* — a ruined portal or bastion remnant
that already generates lit is unaffected, since there's no ignition
action to intercept. See dimension bounce-back below for the fallback
that covers that case (though note dimension bounce-back only helps
once a player actually travels through — a farm that never sends a
player into the Nether isn't touched by it either).

### Dimension bounce-back

Any player who ends up in a dimension listed in `DISABLED_DIMENSIONS` in
[`main.js`](season_manager/season_pack/scripts/main.js) — currently the
Nether and The End — is immediately teleported back to exactly where they
left from, with a chat message telling them they entered a forbidden
dimension. This is the fallback for anything the portal lock doesn't catch
(pre-lit ruined portals, bastion remnants, or any other way in), since it
reacts to the dimension change itself rather than the portal that caused
it.

The portal itself is left standing — an earlier version tried to destroy
it after the fact, but nether/end portals resist being torn down
piecemeal via script (nether portals in particular re-validate their own
shape and silently refill anything removed from an intact frame), so a
player standing right next to it can just walk back in immediately. A
flat "bounces twice, send to spawn" backstop turned out not to be
reliable in practice — players could get stuck cycling in and out faster
than it caught. Instead, each consecutive bounce (tracked per-player in
`bounceCounts`, within `BOUNCE_COOLDOWN_TICKS` of the last one) nudges the
return point that many extra blocks away — 2nd bounce lands 2 blocks off,
3rd lands 3, and so on — so someone standing right on the portal frame
keeps landing further clear of it each time instead of walking straight
back onto it. `BOUNCE_GIVE_UP_COUNT` (10) is a hard cap: if nudging still
somehow hasn't cleared the portal after 10 tries, the player is sent to
world spawn instead — dropped onto the ground nearest spawn's X/Z rather
than its raw Y, since a world spawn point that was never explicitly set
can report a nonsensical height.

To ban/unban a dimension, add or remove its ID in `DISABLED_DIMENSIONS`.

### Pausing/resuming

The cleanup sweep, banned-mob despawning, portal lock, and dimension
bounce-back can all be toggled off without uninstalling the pack — handy
for testing or if you need any of them back temporarily. Toggle from a
command block (no leading slash needed):

```
scriptevent season:toggle
```

or from chat/a command block via the bundled function:

```
/function season/toggle
```

Each call flips the state and announces it to everyone in chat (`Season
Manager paused.` / `Season Manager resumed.`). It starts enabled on world
load. This requires cheats to be enabled in the world settings.
