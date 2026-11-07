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
| `/function season/toggle` | Pauses or resumes the cleanup sweep and banned-mob despawning (not portals). Announces the new state. Resets to on when the world reloads. Same as `/scriptevent season:toggle`. |
| `/function season/cleanup` | Runs the banned-item cleanup sweep once, right now. Same as `/scriptevent season:cleanup`. |

## Portals

| Command | What it does |
|---|---|
| `/scriptevent season:nether_portals on` | Opens Nether portals for everyone: anyone may light one and travel. Saved with the world. |
| `/scriptevent season:nether_portals off` | Closes them again (the default). Only operators may light or enter. Anyone already in the Nether is sent home at once, except operators and a running Mending Rescue party. |
| `/scriptevent season:nether_portals` | Says whether they're open or closed. |

The End stays sealed either way.

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
| `/scriptevent season:nether_mob_removal_log off` | Stops them in chat and the content log (the default). Mobs are still removed. |
| `/scriptevent season:nether_mob_removal_log` | Says whether it's on or off. |
| `/scriptevent season:entities` | Lists every entity type within 16 blocks of you, with counts. Marks dungeon mobs and non-mobs. |

## Mending Rescue event

Run everything from chat.

### Running the event

**One-time setup** (saved with the world; redo only if the dungeon moves):

1. `/tag @s add season:operator` — if you haven't already.
2. `/scriptevent season:mending_rescue set_origin <x> <y> <z>` — the dungeon structure's minimum corner (structure block position plus its offset; placed unrotated).
3. Stand on the Room 1 dais and run `/scriptevent season:mending_rescue where`. It should say `Fortress Gate (structure 20 65 4)`. If not, the origin is off.

**Every run:**

1. `/scriptevent season:nether_portals on` — players can light portals and go in.
2. Players gather in Room 1 and open the gate: four players stand on the four corner pads at once. (Testing solo? `test_mode on` first: each pad stays lit.)
3. Everyone walks through the gate into the first airlock. Once **every** player in the Nether is inside (at least 4) and they hold still for 3 seconds, the run starts on its own: the party is locked in, the gate closes behind them, the way into Room 2 opens and Nether portals close.
4. At each later airlock, once every online party member is inside for 3 seconds, the run moves on to the next room on its own.
5. `/scriptevent season:mending_rescue off` — when the run is over. Anyone still in the dungeon is sent home, and the Room 1 gate resets.

`/scriptevent season:mending_rescue` on its own shows where things stand. If anything gets stuck, `/scriptevent season:mending_rescue reset` puts it all back. If an airlock doesn't trigger, `seal` and `stage <n>` do the same by hand.

### All Mending Rescue commands

| Command | What it does |
|---|---|
| `/scriptevent season:mending_rescue set_origin <x> <y> <z>` | Once: where the structure was placed (its minimum corner, unrotated). Every room, airlock and checkpoint follows from it. |
| `/scriptevent season:mending_rescue seal` | Override (normally automatic at the first airlock). Starts a run: the party is whoever is in the Nether now, the run moves to Room 2 and Nether portals switch off. Dead party members respawn at the checkpoint, even with portals closed. |
| `/scriptevent season:mending_rescue stage <2-8>` | Override (normally automatic at each airlock). The party has moved on to that room. The checkpoint becomes the airlock before it. |
| `/scriptevent season:mending_rescue off` | Ends the run. Sends anyone left in the Nether home (bed, else world spawn), except operators. |
| `/scriptevent season:mending_rescue test_mode on` | Solo testing: each Room 1 pad stays lit once stepped on, so one player can open the gate; the first airlock needs 1 player instead of 4; Room 2's pity ladder comes after 30 seconds instead of 10 minutes; Room 3's guards are killed 3 seconds after they appear; Room 5's mobs 5 seconds after they appear. Saved with the world. |
| `/scriptevent season:mending_rescue test_mode off` | Back to normal: all four pads must be stood on at once. |
| `/scriptevent season:mending_rescue reset` | Puts everything back for the next group, whatever state it's in: ends any run, closes and darkens the Room 1 gate, closes Nether portals and sends non-operators in the Nether home. Keeps the origin and test mode. |
| `/scriptevent season:mending_rescue reset_gate` | Closes both Room 1 portcullises and darkens the wards and crown. |
| `/scriptevent season:mending_rescue jump <2-8>` | Testing: go straight to that room. Starts a run if none is on (party = everyone in the Nether plus you, even from the Overworld), sets the gates as if the party just came through the airlock, and teleports the party to the room's checkpoint. |
| `/scriptevent season:mending_rescue answer` | Shows Room 3's counts for this run (testing). |
| `/scriptevent season:mending_rescue where` | Which room or airlock you're in, and whether that's inside the current zone. |
| `/scriptevent season:mending_rescue` | Shows the run, stage, checkpoint, portal switch and the online party. |

While a run is on, a party member who leaves the current room (and the airlocks either side) is brought back to the checkpoint; anyone else in the Nether who isn't an operator is held to Room 1.

## Always on (no command)

- Banned mobs (iron golems, piglins, brutes, zombified piglins) removed on spawn.
- Farm animal cap: 160 pigs, chickens, cows and sheep combined in the Overworld.
- Nether: non-operators in adventure there (survival within 4 blocks of a gravestone, so it can be collected; nothing else can be broken) and survival elsewhere; any mob the pack didn't spawn is removed.
- Login message shows the pack version.
