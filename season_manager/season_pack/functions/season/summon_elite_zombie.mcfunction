summon minecraft:zombie ^ ^5 ^7
tag @e[type=minecraft:zombie,c=1] add season:elite_zombie
event entity @e[type=minecraft:zombie,c=1] season:become_elite_zombie
effect @e[tag=season:elite_zombie] slow_falling 30 0 true

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 0 0 run summon minecraft:zombie ^ ^1 ^12
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 22.5 0 run summon minecraft:skeleton ^ ^1 ^12
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 45 0 run summon minecraft:zombie ^ ^1 ^12
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 67.5 0 run summon minecraft:skeleton ^ ^1 ^12
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 90 0 run summon minecraft:zombie ^ ^1 ^12
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 112.5 0 run summon minecraft:skeleton ^ ^1 ^12
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 135 0 run summon minecraft:zombie ^ ^1 ^12
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 157.5 0 run summon minecraft:skeleton ^ ^1 ^12
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 180 0 run summon minecraft:zombie ^ ^1 ^12
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 202.5 0 run summon minecraft:skeleton ^ ^1 ^12
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 225 0 run summon minecraft:zombie ^ ^1 ^12
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 247.5 0 run summon minecraft:skeleton ^ ^1 ^12
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 270 0 run summon minecraft:zombie ^ ^1 ^12
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 292.5 0 run summon minecraft:skeleton ^ ^1 ^12
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 315 0 run summon minecraft:zombie ^ ^1 ^12
tag @e[type=minecraft:zombie,tag=!season:elite_zombie,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_zombie,c=1] at @s rotated 337.5 0 run summon minecraft:skeleton ^ ^1 ^12
tag @e[type=minecraft:skeleton,tag=!season:elite_guard,c=1] add season:elite_guard

execute as @e[tag=season:elite_guard] run replaceitem entity @s slot.armor.head 0 minecraft:iron_helmet
effect @e[tag=season:elite_guard] strength 1000000 0 true
effect @e[tag=season:elite_guard] speed 1000000 0 true
effect @e[tag=season:elite_guard] slow_falling 30 0 true
execute as @e[type=minecraft:skeleton,tag=season:elite_guard] run event entity @s season:become_elite_guard_skeleton
execute as @e[type=minecraft:zombie,tag=season:elite_guard] run event entity @s season:become_elite_guard_zombie
