# Custom Manager

A Minecraft Bedrock Edition behavior pack for customizing and managing a
season of play, built on `@minecraft/server` and `@minecraft/server-ui`.

By [Gesh Giezel](https://github.com/iigeshii/season_manager_pack). Licensed
under the [MIT License](LICENSE).

## Layout

- `season_manager/season_pack/` — the behavior pack itself
  (`manifest.json`, `scripts/main.js`, `functions/`, `trading/`,
  `recipes/`)
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
[`main.js`](season_manager/season_pack/scripts/main.js) — currently just
`minecraft:iron_golem` — is removed the instant it spawns, whether it
appears naturally or gets built (e.g. pumpkin + iron blocks). It's
despawned outright rather than killed, so no death event fires and it
drops no loot.

To ban more mobs, add their type IDs to the `BANNED_MOBS` set.

### Villager trades

Trade tables in [`trading/economy_trades/`](season_manager/season_pack/trading/economy_trades/)
override the vanilla files at those same paths — same filenames, same
location, just with specific trades stripped out. Every other trade in
each file is untouched.

- **`librarian_trades.json`** — no enchanted books at any tier (every
  trade using the `enchant_book_for_trading` function removed).
- **`armorer_trades.json`** / **`weapon_smith_trades.json`** — no diamond
  gear at any tier (every trade giving a `minecraft:diamond_*` item
  removed — helmet/chestplate/leggings/boots/sword/axe). Two tiers in
  each file had *only* a diamond-gear trade, so those tiers now offer
  nothing new when a villager levels into them; the plain
  diamond-for-emerald sell trades are untouched since those aren't gear.

This is data, not script — none of it is gated by `enabled` or affected
by `scriptevent season:toggle`. To restore a removed trade, look up the
file's git history for the unmodified vanilla version committed just
before the removal.

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

Same caveats as the trading overrides: this is data, not gated by
`enabled`/`scriptevent season:toggle`, and it freezes at whatever vanilla
recipe shape was copied in, so a future game update to this recipe won't
reach this pack until someone re-syncs it. One UX wrinkle: the recipe
book will still show it as unlocked once you hold a blaze rod (the
`unlock` condition is untouched), it just won't actually complete when
attempted — restore by deleting the file.

### Portal lock

Nether portals and the End portal are blocked from being activated: using
flint and steel on obsidian, or an eye of ender on an end portal frame,
does nothing and tells the player it's currently disabled. Configured
via the `PORTAL_IGNITERS` list in
[`main.js`](season_manager/season_pack/scripts/main.js).

This only stops *ignition* — a ruined portal or bastion remnant that
already generates lit is unaffected, since there's no ignition action to
intercept. See dimension bounce-back below for the fallback that covers
that case.

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
