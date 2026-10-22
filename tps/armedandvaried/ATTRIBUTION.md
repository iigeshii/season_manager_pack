# Attribution — Armed and Varied (rose gold armor, tools, and weapons)

**Source:** Armed and Varied by Jouto
**Repo:** https://github.com/Jouto25/armed-and-varied
**Downloaded file:** `armedandvaried-1.1-1.20.1-fabric.jar` (kept in this `tps/` folder)
**License:** MIT

## License verification

This repo's `LICENSE.txt` and `CREDITS.txt` are **not** this mod's actual
terms — both are unedited Minecraft Forge/FML boilerplate (LGPL 2.1 text
and Forge's own 2012-era contributor credits), almost certainly leftover
from whatever mod template this project was started from. They don't
mention Jouto, this mod, or its content at all.

The real, deliberate license declaration is the `"license": "MIT"` field
in the mod's own `fabric.mod.json` — author-set metadata, not template
cruft. In Fabric/Forge modding convention that field is understood to
cover the whole mod package (code and bundled assets) unless stated
otherwise, so this is being treated as MIT for the textures used here.

## What's being used

Rose gold **armor, tool, and weapon** assets and stat numbers — nothing
else from this mod:

Textures:
- `assets/armedandvaried/textures/item/rose_gold_helmet.png`
- `assets/armedandvaried/textures/item/rose_gold_chestplate.png`
- `assets/armedandvaried/textures/item/rose_gold_leggings.png`
- `assets/armedandvaried/textures/item/rose_gold_boots.png`
- `assets/armedandvaried/textures/models/armor/rose_gold_layer_1.png`
  (helmet/chestplate/boots on-player render)
- `assets/armedandvaried/textures/models/armor/rose_gold_layer_2.png`
  (leggings on-player render)
- `assets/armedandvaried/textures/item/rose_gold_ingot.png`
- `assets/armedandvaried/textures/item/rose_gold_sword.png`
- `assets/armedandvaried/textures/item/rose_gold_axe.png`
- `assets/armedandvaried/textures/item/rose_gold_pickaxe.png`
- `assets/armedandvaried/textures/item/rose_gold_shovel.png`
- `assets/armedandvaried/textures/item/rose_gold_hoe.png`
- `assets/armedandvaried/textures/block/rose_gold_block.png` (storage block,
  cube_all — same texture on all 6 faces)

Tool/weapon stat numbers (durability, mining speed, attack damage/speed,
mining tier, enchantability), read directly out of the compiled
`ModToolMaterial.class` and `ModItems.class` bytecode (the mod ships no
source, so these weren't in a readable JSON/data file — they're literal
constructor arguments baked into the `.class` files, recovered by
disassembling the `<clinit>` methods):

- **Material tier** (`ModToolMaterial.ROSE_GOLD_INGOT`): durability 250,
  mining speed 8.0, attack damage bonus 3.0, mining level 3
  (diamond-tier ore/block access), enchantability 14.
- **Per-item base damage/speed** (`ModItems`, before adding the material
  bonus above): sword damage 3 @ speed 1.6, axe damage 5 @ speed 1.0,
  pickaxe damage 1 @ speed 1.2, shovel damage 1.5 @ speed 1.0, hoe
  damage -3 @ speed 4.0.
- These were ported into Bedrock's data model as closely as its item
  components allow (e.g. Bedrock's `minecraft:damage` is a single flat
  integer rather than Java's base+material split, so the two were summed
  and rounded; Bedrock has no attack-speed field on weapons at all).

## Required MIT notice

Per the MIT license, the copyright and permission notice below must ship
with the pack wherever these textures are included (e.g. a CREDITS file
in the resource pack).

```
MIT License

Copyright (c) 2025 Jouto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

(Copyright year taken from the repo's creation date, 2025-04-30 — adjust
if Jouto's own notice specifies otherwise.)
