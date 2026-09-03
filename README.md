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

### Pausing/resuming

Both the cleanup sweep and banned-mob despawning can be toggled off without
uninstalling the pack — handy for testing or if you need banned items/mobs
back temporarily. Toggle from a command block (no leading slash needed):

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
