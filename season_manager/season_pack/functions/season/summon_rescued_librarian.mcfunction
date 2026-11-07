summon minecraft:minecart ~ ~ ~
summon minecraft:villager_v2 ~ ~ ~
tag @e[type=minecraft:villager_v2,c=1] add season:rescue_empty_librarian
event entity @e[type=minecraft:villager_v2,tag=season:rescue_empty_librarian,c=1] season:become_empty_librarian
ride @e[type=minecraft:villager_v2,tag=season:rescue_empty_librarian,c=1] start_riding @e[type=minecraft:minecart,c=1] teleport_rider
