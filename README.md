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
- `dist/` — build output (git-ignored)

## Building

```sh
./scripts/build.sh
```

Produces `dist/season_manager.mcpack`. Double-click it (with Minecraft
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
[`main.js`](season_manager/season_pack/scripts/main.js) — currently just
`elytra` and `dispenser`. Everything that used to be on this list is now a
recipe lock instead (see [Locked recipes](#locked-recipes) below), since a
recipe lock leaves found/looted copies of an item alone and only blocks
crafting new ones — a real improvement over destroy-on-pickup for anything
that's exclusively obtainable through crafting in survival. Elytra and
dispensers are the exception: both can turn up as loot or as part of a
generated structure (End ships; desert/jungle temple traps; trial
chambers) with no crafting step involved, so a recipe lock alone wouldn't
stop a lucky find — they still need the destroy-on-pickup treatment.
Dispenser also gets a recipe lock on top of that (`dispenser.json`), same
reasoning as `observer.json`: without it, a crafting attempt would still
quietly burn a bow, cobblestone, and redstone on an item that's just
going to get cleaned up anyway. Elytra has no vanilla recipe at all, so
there's nothing to lock for it.
`heart_of_the_sea` was dropped from the list entirely rather than
converted to a recipe lock: it's inert on its own, and the only thing it's
good for (a Conduit) is already covered by the `conduit.json` recipe lock,
so restricting the raw item added nothing.
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
jungle fishing tables) with the `enchant_with_levels` function removed
from the bow, fishing rod, and book entries — so treasure catches can
still happen, just never pre-enchanted. Fish and junk pools are
untouched.

### Locked recipes

Recipes in [`recipes/`](season_manager/season_pack/recipes/) override
the vanilla recipe with the same `identifier` (recipes are matched by
identifier, not file path, but same idea as the trade table overrides:
highest-priority pack wins). Each locked recipe adds `minecraft:barrier`
as an extra required ingredient — a technical block with no way to
obtain it in survival — so the recipe still exists but can never actually
be crafted.

- **`blaze_powder.json`** — blaze rods can be found/used, but can't yet
  be ground into blaze powder.
- **`enchanting_table.json`** — diamonds, obsidian, and a book can all be
  gathered, but they can't yet be assembled into an enchanting table.
- **`diamond_pickaxe.json`**, **`diamond_axe.json`**,
  **`diamond_shovel.json`**, **`diamond_hoe.json`**,
  **`diamond_sword.json`**, **`diamond_helmet.json`**,
  **`diamond_chestplate.json`**, **`diamond_leggings.json`**,
  **`diamond_boots.json`** — all nine diamond tool/armor recipes are
  locked. Diamonds can be mined and held, they just can't be crafted
  into anything yet. Found/looted diamond gear (chest loot, mob drops)
  isn't affected — only crafting is blocked, since this is a recipe
  lock, not an item ban.
- **`conduit.json`** — Heart of the Sea is fully obtainable (buried
  treasure) and unrestricted on its own; it's inert without a Conduit, so
  this is the only lock that actually matters for it.
- **`comparator.json`** — one of three vanilla crafting-table recipes
  (besides Quartz Block) that needs raw Nether Quartz.
- **`daylight_detector.json`**, **`daylight_detector_from_crimson_slab.json`**,
  **`daylight_detector_from_mangrove_slab.json`**,
  **`daylight_detector_from_warped_slab.json`** — vanilla actually ships
  four separate recipe identifiers for Daylight Detector (the base one
  plus a variant for each Nether wood slab), all needing raw quartz. All
  four are locked here — locking only the base one would leave the
  Nether-wood variants as an open bypass.
- **`observer.json`** — the third quartz recipe.
- **`dispenser.json`** — locked on top of the `dispenser` item ban, same
  reasoning as `observer.json`: the item ban alone only deletes a crafted
  Dispenser after the fact, so the recipe is locked too rather than let a
  crafting attempt waste a bow, cobblestone, and redstone for nothing.
- **`hopper.json`**, **`hopper_minecart.json`** — a found hopper (chest
  loot in a few structures) could otherwise still be combined with a
  minecart, so the minecart recipe is locked too, not just the hopper's.
- **`piston.json`**, **`sticky_piston.json`** — sticky piston is locked
  independently rather than relying on the piston lock alone, in case a
  piston is ever found rather than crafted.
- **`dropper.json`**
- **`slime.json`** — this is the Slime Block (Bedrock's item ID for it is
  literally `slime`), not the Slimeball — slimeballs themselves aren't
  restricted.
- **`honey_block.json`**
- **`anvil.json`** — locking the pristine anvil recipe is the only lock
  that makes sense here: `chipped_anvil` and `damaged_anvil` are wear
  states an anvil reaches through use, not separate recipes, so there's
  nothing to lock for them directly. A found/looted anvil (and whatever
  it wears down into with use) is unaffected, same as every other recipe
  lock on this list.

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
barrier is still well inside the 3x3 cap. `sticky_piston.json` is the
same story (vanilla is a single-cell-per-row 1x2), and `honey_block.json`
(vanilla 2x2) widened to 2x3, both still under the cap. `conduit.json`,
`daylight_detector.json` and its three wood-slab variants, `observer.json`,
`piston.json`, `slime.json`, and `dispenser.json` are different: their
vanilla grids are already a completely full 3x3 (conduit's 8 nautilus
shells around 1 heart of the sea; daylight detector's 3 glass / 3 quartz /
3 slabs; observer's 6 cobblestone, 2 redstone, 1 quartz; piston's 3
planks, 4 cobblestone, 1 iron, 1 redstone; slime block's 9 slimeballs;
dispenser's 7 cobblestone, 1 bow, 1 redstone), so there's no room to add a
10th cell. Those eight instead have the barrier swap in for one of the
original filled cells (one nautilus shell, one glass, one cobblestone, one
plank, or one slimeball) rather than sit in new space — same effect, just
one fewer of that particular vanilla ingredient asked for, since the
recipe can never be finished anyway. `comparator.json`, `hopper.json`,
`dropper.json`, and `anvil.json` all had a spare cell already in their
vanilla 3x3 grid, so those four kept the vanilla footprint.
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

- **Elite Zombie** — `/function season/summon_elite_zombie` spawns a
  zombie with 80 health (vanilla: 20), 10 attack damage (vanilla: 3),
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
player standing right next to it can just walk back in immediately. As a
backstop, a player who bounces twice in a row within
`BOUNCE_COOLDOWN_TICKS` is sent to world spawn instead of back onto the
portal — dropped onto the ground nearest spawn's X/Z rather than its raw
Y, since a world spawn point that was never explicitly set can report a
nonsensical height.

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
