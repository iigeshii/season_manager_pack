summon minecraft:zombie ^ ^ ^7
tag @e[type=minecraft:zombie,c=1] add season:elite_zombie
event entity @e[type=minecraft:zombie,c=1] season:become_elite_zombie

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 0 0 run summon minecraft:zombie ^ ^ ^5
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 30 0 run summon minecraft:skeleton ^ ^ ^5
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 60 0 run summon minecraft:zombie ^ ^ ^5
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 90 0 run summon minecraft:skeleton ^ ^ ^5
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 120 0 run summon minecraft:zombie ^ ^ ^5
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 150 0 run summon minecraft:skeleton ^ ^ ^5
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 180 0 run summon minecraft:zombie ^ ^ ^5
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 210 0 run summon minecraft:skeleton ^ ^ ^5
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 240 0 run summon minecraft:zombie ^ ^ ^5
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 270 0 run summon minecraft:skeleton ^ ^ ^5
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 300 0 run summon minecraft:zombie ^ ^ ^5
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 330 0 run summon minecraft:skeleton ^ ^ ^5
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_guard] run item replace entity @s slot.armor.head 0 with minecraft:iron_helmet
effect @e[tag=season:elite_guard] strength 1000000 0 true
effect @e[tag=season:elite_guard] speed 1000000 0 true
execute as @e[type=minecraft:skeleton,tag=season:elite_guard] run event entity @s season:become_elite_guard_skeleton
