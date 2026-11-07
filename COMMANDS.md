# Season Manager Commands

Quick reference. Details for each feature are in the [README](README.md#usage).
All commands need cheats enabled; `/scriptevent` and `/function` need operator permission.

## Setup

| Command | What it does |
|---|---|
| `/tag @s add season:operator` | Marks you as an operator for the pack: you may light and enter any Nether portal and keep any game mode. One-time. |
| `/tag @s remove season:operator` | Removes it. |

## Pack control

| Command | What it does |
|---|---|
| `/function season/toggle` | Pauses or resumes the cleanup sweep, banned-mob despawning, portal lock and dimension bounce-back. Announces the new state. Resets to on when the world reloads. Same as `/scriptevent season:toggle`. |
| `/function season/cleanup` | Runs the banned-item cleanup sweep once, right now. Same as `/scriptevent season:cleanup`. |

## Logs

| Command | What it does |
|---|---|
| `/function season/login_log` | Shows you the last 20 logins and logouts. |
| `/function season/death_log` | Shows you the last 20 deaths, with causes. |
| `/function season/grief_log` | Shows you the last 20 uses of flint and steel, lava buckets and water buckets (who, what, where). |
| `/function season/clear_logs` | Wipes the login, death and grief logs. No undo. |

## Villagers and encounters

| Command | What it does |
|---|---|
| `/function season/reset_cartographer` | Look at a cartographer within 8 blocks first. Replaces her with a fresh one (same name and facing) so she rolls new trades. |
| `/function season/summon_mending_librarian` | Summons the Mending Librarian where you stand. |
| `/function season/summon_froglight_cleric` | Summons the Froglight Cleric where you stand. |
| `/function season/summon_elite_zombie` | Summons the Elite Zombie and its 12 guards in front of you. |

## Nether (dungeon)

Run these from chat, not from a function.

| Command | What it does |
|---|---|
| `/scriptevent season:nether_mob_removal_log on` | Shows Nether mob removals in operators' chat, e.g. `[Nether] removed 4× minecraft:piglin (last at …)`. Saved with the world. |
| `/scriptevent season:nether_mob_removal_log off` | Hides them again (the default). They always go to the content log. |
| `/scriptevent season:nether_mob_removal_log` | Says whether it's on or off. |
| `/scriptevent season:entities` | Lists every entity type within 16 blocks of you, with counts. Marks dungeon mobs and non-mobs. |

## Mending Rescue event

Run from chat. Setup is saved with the world; run a setup command again to change it.

| Command | What it does |
|---|---|
| `/scriptevent season:mending_rescue set_origin <x> <y> <z>` | The corner you gave `/structure load` (placed unrotated). Every room, airlock and checkpoint follows from it. |
| `/scriptevent season:mending_rescue set_portal` | Look at the Overworld portal's obsidian frame. Registers it as the one portal that works. |
| `/scriptevent season:mending_rescue set_return` | Stand outside the Overworld portal facing away. Where players are sent back to. |
| `/scriptevent season:mending_rescue on` | Starts a run in Room 1. Anyone may light and use the registered portal; it takes them to the Room 1 dais. |
| `/scriptevent season:mending_rescue seal` | Locks the party to whoever is in the Nether now and moves to Room 2. Everyone else is turned away at the portal. Dead party members respawn at the checkpoint. |
| `/scriptevent season:mending_rescue stage <2-8>` | The party has moved on to that room. The checkpoint becomes the airlock before it. |
| `/scriptevent season:mending_rescue off` | Ends the run. Sends non-operators in the Nether to the return point. |
| `/scriptevent season:mending_rescue where` | Which room or airlock you're in, and whether that's inside the current zone. |
| `/scriptevent season:mending_rescue` | Shows state, stage, saved points and the online party. |

While a run is on, anyone who leaves the current room (and the airlocks either side) is brought back to the checkpoint.

## Always on (no command)

- Banned mobs (iron golems, piglins, brutes) removed on spawn.
- Farm animal cap: 160 pigs, chickens, cows and sheep combined in the Overworld.
- Nether: non-operators in adventure there and survival elsewhere; any mob the pack didn't spawn is removed.
- Login message shows the pack version.
