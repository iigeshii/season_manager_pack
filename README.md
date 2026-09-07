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
[`main.js`](season_manager/season_pack/scripts/main.js) — currently
`elytra`, `hopper`, `hopper_minecart`, `piston`, `sticky_piston`,
`dispenser`, `dropper`, `observer`, `slime`, and `honey_block` — to keep
those items out of players' hands. When an item is actually removed from a
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
