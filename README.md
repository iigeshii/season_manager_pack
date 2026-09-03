# Custom Manager

A Minecraft Bedrock Edition behavior pack for customizing and managing a
season of play, built on `@minecraft/server` and `@minecraft/server-ui`.

By [Gesh Giezel](https://github.com/iigeshii/season_manager_pack). Licensed
under the [MIT License](LICENSE).

## Layout

- `season_manager/season_pack/` — the behavior pack itself
  (`manifest.json`, `scripts/main.js`)
- `scripts/build.sh` — packages the behavior pack into a `.mcpack`
- `scripts/deploy.sh` — installs the pack into Minecraft's
  `development_behavior_packs` folder
- `dist/` — build output (git-ignored)

## Building

```sh
./scripts/build.sh
```

Produces `dist/season_manager.mcpack`. Double-click it (with Minecraft
installed) or copy it into your `development_behavior_packs` folder to
install.

## Deploying (dev)

```sh
./scripts/deploy.sh
```

Copies the pack straight into `development_behavior_packs` for fast
iteration — reload the world in-game to pick up changes.

## Usage

### Cleanup sequence

The pack automatically sweeps every online player every
`CLEANUP_INTERVAL_TICKS` (default 20 ticks = 1 second) and runs the
`CLEANUP_COMMANDS` sequence in
[`main.js`](season_manager/season_pack/scripts/main.js) — currently
`clear @a elytra` followed by `clear @a hopper` — to keep those items out
of players' hands. No command block or redstone clock needed; it starts as
soon as the pack loads.

To ban more items, add commands to the `CLEANUP_COMMANDS` array. To change
how often the sweep runs, adjust `CLEANUP_INTERVAL_TICKS`.

For manual testing you can also trigger a single sweep on demand from a
command block (no leading slash needed inside a command block):

```
scriptevent season:cleanup
```

This requires cheats to be enabled in the world settings.
