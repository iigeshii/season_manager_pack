# Chat Logging — @minecraft/server 2.x Migration Notes

What it actually takes to get chat logging working, learned the hard way
across several rounds of "Content Log says X, so try Y." Written so this
branch can be picked back up without re-deriving any of it.

## The original problem

`world.afterEvents.chatSend` (and `world.beforeEvents.chatSend`) don't
exist on the `@minecraft/server` module version this pack normally
resolves to. Subscribing to either throws `TypeError: cannot read
property 'subscribe' of undefined` at script load time — and because
that line runs at the top level during module evaluation, it silently
prevents everything registered *after* it in the file from ever being
set up, not just chat logging itself. (This is what made the original
bug confusing: it looked like death logging was independently broken,
when it was actually just collateral damage from chat log's crash
sitting earlier in the file.)

## How Bedrock resolves module versions (observed behavior)

- Every dependency — this pack's own `manifest.json` entries, plus
  whatever version other loaded bindings internally request — gets
  reconciled to the **highest** version requested across all of them.
  Content Log shows this as `"promoted [@minecraft/server] from [X] to
  [Y] requested by [...]"` lines.
- Requesting a version **lower** than the current ceiling does nothing —
  it just gets promoted back up to whatever the ceiling already was.
  (First attempt: bumped `1.14.0` → `1.17.0`, still resolved to `1.19.0`,
  because `1.19.0` was already the floor from elsewhere. No new
  information from that test.)
- Requesting a version **higher** than the ceiling can actually unlock a
  newer module generation, if the installed Minecraft client has one
  available. Requesting `2.0.0` revealed `2.10.0` is genuinely available
  on this client — `1.19.0` was never a hard ceiling, just under-asked.
- **Mixing generations across dependencies fails hard.** Bumping only
  `@minecraft/server` to `2.0.0` while leaving `@minecraft/server-ui` at
  `1.3.0` produced a real load failure (`"version conflict... failed to
  create context"`), because the two dependencies pulled in incompatible
  versions of the shared `@minecraft/server-bindings` module (`2.10.0` vs
  `1.19.0`). **All interdependent modules need to move to a compatible
  generation together, not one at a time.**

### Confirmed-working version pairing

```json
{ "module_name": "@minecraft/server", "version": "2.0.0" },
{ "module_name": "@minecraft/server-ui", "version": "2.0.0" }
```

This resolves cleanly (`@minecraft/server` → `2.10.0`,
`@minecraft/server-ui` → `2.2.0`) with no version-conflict error — the
module loads and the script actually starts running. This is what's
currently in this branch's `manifest.json`.

## What breaks once you're actually on 2.x

`world.beforeEvents.itemUseOn` / `world.afterEvents.itemUseOn` — the
event this pack already relies on for Portal Lock and for most of the
grief log's item-use detection (flint & steel, lava bucket, water
bucket) — **was removed entirely in `@minecraft/server` 2.0.0.**
Confirmed via Microsoft's own changelog
(https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/changelog),
which lists it under 2.0.0 as a removal, not a rename, alongside
`entityHurt` and `worldInitialize` (replaced by `worldLoad`).

There's no direct drop-in replacement. The 2.x model for per-item
behavior is `ItemCustomComponent` — items declare their own custom
components (e.g. an `onUseOn` callback) in the item's own JSON
definition, rather than a single global listener that fires for any
item-on-block interaction and gets filtered in script. This is a
different architecture, not a renamed function:

- **Old (1.x):** one `world.beforeEvents.itemUseOn.subscribe(...)`
  handler, filtering by `event.itemStack.typeId` / `event.block.typeId`
  inside the callback. This is what `PORTAL_IGNITERS` and
  `GRIEF_LOG_ITEMS` both do today.
- **New (2.x):** each item that needs custom on-use-on behavior
  registers its own component, declared per-item rather than globally.

This pack's `itemUseOn` use cases are all **vanilla items**
(`flint_and_steel`, `lava_bucket`, `water_bucket`, `fire_charge`,
`ender_eye`), not custom ones — so using `ItemCustomComponent` here
would mean overriding vanilla item definitions via the behavior pack's
own item JSON files, the same general pattern this pack already uses to
extend vanilla *entities* (see `entities/zombie.json`,
`entities/skeleton.json` — partial component-group overrides merged
onto the vanilla definition). **Whether that same override pattern
actually works for items the way it does for entities in this engine
version is unverified** — it's a reasonable bet based on precedent in
this codebase, not something that's been tested.

## What's actually been verified vs. not

This is the important part for picking the work back up — the 2.x
migration's scope is **not fully known yet**, because the script crashes
very early:

- ✅ Module resolution to 2.x works cleanly with the matched
  `@minecraft/server` + `@minecraft/server-ui` versions above.
- ✅ `itemUseOn` is confirmed gone and confirmed to be *why* the script
  dies early (crash is at the Portal Lock section, one of the first
  `world.*Events.*.subscribe()` calls in the file).
- ❌ **`chatSend` itself has never actually been exercised under 2.x.**
  The crash happens at the Portal Lock line (near the top of the file),
  which runs *before* the chat log section (near the bottom) is ever
  reached. Getting past module resolution did not get us far enough to
  confirm `beforeEvents.chatSend.subscribe` actually works — only that
  it's no longer blocked by a version-resolution conflict. That's still
  an open question.
- ❓ **Everything else in this file past the Portal Lock crash point is
  equally unverified under 2.x** — login log, grief log's TNT/pet-kill
  handling, death log, `playerSpawn`, `playerLeave`, `entityDie`,
  `playerPlaceBlock`, `scriptEventReceive`, all of it. None of these
  have been confirmed broken, but none have been confirmed *working*
  under 2.x either, simply because the script never got far enough to
  run them. Don't assume 1.x-verified behavior carries over — assume
  nothing downstream of Portal Lock is proven until it's actually been
  tested again under this module generation.

## Suggested order of operations for resuming this

1. Rebuild Portal Lock on `ItemCustomComponent` (or confirm there's no
   way to do it without per-item declarations, and decide if that's
   worth it for a lock/disable feature).
2. Rebuild the grief log's flint & steel / lava bucket / water bucket
   detection the same way.
3. Once those no longer crash the script at load, the rest of the file
   will finally get a chance to run — re-verify login log, grief log,
   death log, and `clear_logs` all still work exactly as they do on 1.x
   (don't assume; confirm).
4. *Then*, for the first time, actually find out whether
   `beforeEvents.chatSend.subscribe` works the way the chat log code in
   this branch assumes it does.
5. If anything else throws along the way, same diagnostic loop that got
   us this far: Content Log → exact file:line → read what's actually
   there → fix → rebuild → retest. Guessing from code review alone did
   not work this round; the Content Log was what actually resolved each
   step.

## Current state of this branch

- `manifest.json`: `@minecraft/server` and `@minecraft/server-ui` both
  at `2.0.0` (resolves to `2.10.0` / `2.2.0`).
- `scripts/main.js`: full chat log implementation present
  (`createRotatingLog("chat", 10, 150)`, `beforeEvents.chatSend`
  subscription, `/function season/chat_log` retrieval, wired into
  `clear_logs`) — written and believed correct, but **not yet
  confirmed working**, since it's never actually been reached by a
  running script (see above).
- Everything else (login/grief/death logs, `clear_logs`, the
  `getActiveIndex` rotating-log fix) is identical to `master` as of the
  point this branch split off — those parts are 1.x-proven, just
  untested again under 2.x specifically.
