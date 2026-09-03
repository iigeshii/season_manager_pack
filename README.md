# Custom Manager

A Minecraft Bedrock Edition behavior pack for customizing and managing a
season of play, built on `@minecraft/server` and `@minecraft/server-ui`.

By [Gesh Giezel](https://github.com/iigeshii/season_manager_pack). Licensed
under the [MIT License](LICENSE).

## Layout

- `season_manager/season_pack/` — the behavior pack itself
  (`manifest.json`, `scripts/main.js`, `functions/`)
- `scripts/build.sh` — packages the behavior pack into a `.mcpack`
- `dist/` — build output (git-ignored)

## Building

```sh
./scripts/build.sh
```

Produces `dist/season_manager.mcpack`. Double-click it (with Minecraft
installed) or copy it into your `development_behavior_packs` folder to
install.

## Usage

### Cleanup sequence

The pack automatically sweeps every online player every
`CLEANUP_INTERVAL_TICKS` (default 20 ticks = 1 second) and clears each item
in the `CLEANUP_ITEMS` list in
[`main.js`](season_manager/season_pack/scripts/main.js) — currently
`elytra`, `hopper`, and `hopper_minecart` — to keep those items out of players' hands. When an
item is actually removed from a player, that player gets a chat message
telling them it isn't permitted this season. No command block or redstone
clock needed; it starts as soon as the pack loads.

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

### Portal lock

Nether portals and the End portal are blocked from being activated: using
flint and steel on obsidian, or an eye of ender on an end portal frame,
does nothing and tells the player it's disabled this season. Configured
via the `PORTAL_IGNITERS` list in
[`main.js`](season_manager/season_pack/scripts/main.js).

This only stops *ignition* — a ruined portal or bastion remnant that
already generates lit is unaffected, since there's no ignition action to
intercept. See dimension bounce-back below for the fallback that covers
that case.

### Dimension bounce-back

Any player who ends up in a dimension listed in `DISABLED_DIMENSIONS` in
[`main.js`](season_manager/season_pack/scripts/main.js) — currently the
Nether and The End — has the portal that let them through destroyed
(every matching block within `PORTAL_BLOCKS`' configured radius is set to
air directly, not via a command) and is immediately teleported back to
exactly where they left from, with a chat
message telling them they entered a forbidden dimension. This is the
fallback for anything the portal lock doesn't catch (pre-lit ruined
portals, bastion remnants, or any other way in), since it reacts to the
dimension change itself rather than the portal that caused it.

Destroying the portal before teleporting back is what stops it from just
sending the player right back in — `fromLocation` is exactly the spot
that triggered it, so without that the player would land back on a
still-active portal and bounce forever. As a backstop for a portal bigger than
its configured radius, a player who still bounces twice in a row within
`BOUNCE_COOLDOWN_TICKS` is sent to world spawn instead — dropped onto the
ground nearest spawn's X/Z rather than its raw Y, since a world spawn
point that was never explicitly set can report a nonsensical height.

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
