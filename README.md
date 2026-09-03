# Custom Manager

A Minecraft Bedrock Edition behavior pack scaffold, built on
`@minecraft/server` and `@minecraft/server-ui`.

## Layout

- `custom_manager/custom_pack/` — the behavior pack itself
  (`manifest.json`, `scripts/main.js`)
- `scripts/build.sh` — packages the behavior pack into a `.mcpack`
- `scripts/deploy.sh` — installs the pack into Minecraft's
  `development_behavior_packs` folder
- `dist/` — build output (git-ignored)

## Building

```sh
./scripts/build.sh
```

Produces `dist/custom_manager.mcpack`. Double-click it (with Minecraft
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

Place a command block and set its console command to (no leading slash
needed inside a command block):

```
scriptevent custom:cleanup
```

This runs the `CLEANUP_COMMANDS` sequence in
[`main.js`](custom_manager/custom_pack/scripts/main.js) — currently
`clear @a elytra` followed by `clear @a hopper`. Add more commands to that
array to extend the sequence.

For a repeating command block, set it to **Repeat** + **Needs Redstone**
(not **Always Active**) unless you actually want it firing every tick.

`scriptevent` requires cheats to be enabled in the world settings.
