# Original Loot Reference

Unmodified vanilla trade and loot tables, kept here purely as a reference for
what we're nerfing/changing in the season pack. Nothing in this directory is
part of the behavior pack build — it's not under `season_manager/season_pack/`,
so it has no chance of being picked up or overriding anything.

Source: [Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples),
`behavior_pack/` on `main`, pulled 2026-09-07.

## Contents

- `trading/economy_trades/` — all 13 villager profession trade tables
  (armorer, butcher, cartographer, cleric, farmer, fisherman, fletcher,
  leather_worker, librarian, shepherd, stone_mason, tool_smith, weapon_smith)
  plus the wandering trader's.
- `loot_tables/gameplay/fishing.json`, `jungle_fishing.json`, and
  `loot_tables/gameplay/fishing/*.json` — the fish/junk/treasure pools that
  back the fishing rod loot table.

When changing a table in the actual pack, diff against the matching file
here to see exactly what vanilla shipped.
