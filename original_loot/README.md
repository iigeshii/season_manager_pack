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
- `recipes/leather_helmet.json`, `leather_chestplate.json`,
  `leather_leggings.json`, `leather_boots.json` — the four vanilla leather
  armor recipes, pulled 2026-09-19, kept here to diff against once they're
  overridden to use Rabbit Hide instead of Leather.
- `recipes/iron_helmet.json`, `iron_chestplate.json`, `iron_leggings.json`,
  `iron_boots.json` — the four vanilla iron armor recipes, pulled
  2026-09-26, kept as a shape/quantity reference for the new Chainmail
  armor recipes (Chainmail has no real crafting-table recipe of its own
  in vanilla — only a furnace recipe for smelting a damaged piece back
  into a fresh one).
- `recipes/*_armor_trim_smithing_template_duplicate.json` (18 patterns —
  Bolt, Coast, Dune, Eye, Flow, Host, Raiser, Rib, Sentry, Shaper,
  Silence, Snout, Spire, Tide, Vex, Ward, Wayfinder, Wild — plus Bolt's
  separate waxed-copper variant), pulled 2026-09-26. The vanilla Armor
  Trim Smithing Template duplication recipes, showing the original
  7-Diamond-plus-base-material cost before the real pack's versions
  dropped the diamonds for a single Copper Ingot instead. The Netherite
  Upgrade Smithing Template's own duplication recipe is a different
  template, not an armor trim, and isn't included here.
- `entities/skeleton.json` — the vanilla Skeleton entity definition,
  pulled 2026-09-26. Kept as a reference for the base
  `minecraft:behavior.ranged_attack` fire rate (3 seconds normally, 2 on
  Hard) before the real pack's version added a `season:elite_guard_skeleton`
  component group that fires arrows every 1 second, applied only to
  Skeletons summoned as guards for the Elite Zombie event.
- `loot_tables/entities/sea_turtle.json` — the vanilla Turtle loot table
  (the entity is `minecraft:turtle`, but vanilla names the loot table
  file `sea_turtle.json`), pulled 2026-09-26. Vanilla only drops
  Seagrass here — no Scute; Scute is normally only obtained when a baby
  turtle grows into an adult, a separate mechanic from this loot table.
  Kept here to show that baseline before the real pack's version added a
  guaranteed 1-2 Turtle Scute drop.

When changing a table in the actual pack, diff against the matching file
here to see exactly what vanilla shipped.
