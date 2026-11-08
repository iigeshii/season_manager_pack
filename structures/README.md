# Structures

`.mcstructure` files placed in the realm, and exactly how each was
placed. Re-placing a structure with the same block position and settings
puts it back block-for-block.

To load one: put a structure block (`/give @s structure_block`) at the
position below and set it to **Load**. Get the structure into it one of
two ways (see below), then enter the offset and settings and press
**Load**. Stand near the middle of the footprint while it loads. Only
loaded chunks get filled, so a structure loaded from far away comes out
partial.

## Getting the structures into a world

**Local world:** in the structure block, **Import** the
`.mcstructure` file. It's saved as `mystructure:<file name>`.

**Realm:** the structure block can't import there. Instead, add one of
these behavior packs to the realm world. It carries the structures
under the `andexsi:` namespace, so type that name in the structure
block (e.g. `andexsi:LibrarianDungeon`). Both were made with
[8Crafter's mcstructure loader](https://www.8crafter.com/utilities/mcstructure-loader).

| Pack | Structures inside |
|---|---|
| `DungeonImporter.mcpack` | `andexsi:LibrarianDungeon`, `andexsi:OverworldPortal`, `andexsi:RappStuff` (a 4 × 1 × 1 test piece, unused) |
| `DungeonOnlyImporter.mcpack` | `andexsi:LibrarianDungeon` |

The structures inside are byte-identical to the loose `.mcstructure`
files here. The pack only matters while loading; it can come off the
realm once the structures are placed.

`/structure load` works too and skips the offset math: it takes the
minimum corner directly, e.g.
`/structure load andexsi:LibrarianDungeon -303 18 -108`.

## Mending Librarian Rescue

### LibrarianDungeon.mcstructure: the dungeon (Nether)

| | |
|---|---|
| Dimension | Nether |
| Size | 64 × 91 × 64 |
| Structure block | `-273 38 -110` |
| Offset | X `-30`, Y `-20`, Z `2` |
| Rotation | 0 (none) |
| Mirror | none |
| Integrity | 100 |
| Include entities | on |
| Remove blocks | off |
| Waterlog blocks | off |
| Minimum corner | `-303 18 -108` |

The scripts locate every room from the minimum corner (structure block
position plus offset), so after loading run:

```
/scriptevent season:mending_rescue set_origin -303 18 -108
```

Then stand on the Room 1 dais and run
`/scriptevent season:mending_rescue where`. It should say
`Fortress Gate (structure 20 65 4)`.

**Keep it unrotated and unmirrored.** The scripts don't support rotation.
If it ever moves, load it the same way at the new spot and run
`set_origin` with the new minimum corner.

Built from the fabricator design `mending-librarian-rescue`, revision
`rooms1-8-v004` (`mlr16.schem`, sha256 `9a7cb36d…2ee4e0`). The pack's
`scripts/dungeon/layout.js` is generated from the same revision. If the
dungeon is rebuilt from a new revision, regenerate `layout.js` too.

You need the `season:operator` tag while building in the Nether.
Without it the pack puts you in adventure mode there and sends you home.

### OverworldPortal.mcstructure: the portal gateway (Overworld)

| | |
|---|---|
| Dimension | Overworld |
| Size | 28 × 22 × 29 |
| Structure block | `-2201 104 -911` |
| Offset | X `-8`, Y `-3`, Z `13` |
| Rotation | 90 |
| Minimum corner | `-2209 101 -898` |
| Mirror | none |
| Integrity | 100 |
| Include entities | on |
| Remove blocks | off |
| Waterlog blocks | off |

Decorative only: no script depends on where it is. Same placement by
command: `/structure load andexsi:OverworldPortal -2209 101 -898 90_degrees`.
