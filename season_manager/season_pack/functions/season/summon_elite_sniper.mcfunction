summon minecraft:skeleton ^ ^5 ^7
tag @e[type=minecraft:skeleton,c=1] add season:elite_sniper
tag @e[type=minecraft:skeleton,tag=season:elite_sniper,c=1] add season:elite_sniper_needs_setup
event entity @e[type=minecraft:skeleton,tag=season:elite_sniper,c=1] season:become_elite_sniper

scriptevent season:elite_sniper_spawned
