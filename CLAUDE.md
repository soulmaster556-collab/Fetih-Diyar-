# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Fetih Diyarı is a browser-based, "Million Lords"-style territory-conquest strategy game
(prototype). Design rationale, data model, and combat formulas are documented in **DESIGN.md**
(Turkish) — read it for the "why" behind game mechanics before changing them. Code comments and
commit messages in this repo are written in Turkish; match that style when editing existing files.

Two independent npm packages, no workspace/monorepo tooling tying them together:

```
server/   Node + Express + TypeScript API, Postgres (Neon) via `pg`
client/   React 19 + Vite + TypeScript SPA
```

## Commands

Run from within `server/` or `client/` respectively (there is no root package.json).

```bash
# server (needs DATABASE_URL env var — a Postgres/Neon connection string)
npm run dev      # tsx watch src/index.ts — http://localhost:4000
npm run build    # tsc -p tsconfig.json
npm start        # node dist/index.js (run build first)

# client
npm run dev      # vite — http://localhost:5173, proxies /api to localhost:4000
npm run build    # tsc -b && vite build
npm run lint     # oxlint
npm run preview
```

There is no test suite in this repo currently.

## Architecture

### Server (`server/src`)

- `index.ts` — process entrypoint. Starts listening on `PORT` *before* running slow one-time
  migrations (Render requires the port to open quickly), then runs schema init, one-time map
  migrations, settings seeding, and map generation. Also starts a `setInterval` loop (every 2s)
  that resolves attack orders whose travel time has elapsed — this is the only "tick" in the
  system.
- `db.ts` — single `pg.Pool` plus `initSchema()`, which is a hand-rolled, idempotent
  `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS` migration script run on
  every boot. **There is no migration framework** — schema changes are made by appending more
  `IF NOT EXISTS` statements to `initSchema()`, in order, with a comment explaining the change.
  One-off *data* migrations (e.g. regenerating the whole map, backfilling a column from derived
  data) live in `game/mapgen.ts` and are guarded by the `schema_migrations` table
  (`hasMigration`/`markMigration`) so they run exactly once.
- `types.ts` — shared DB row shapes (`Player`, `TileRow`, `TileView`).
- `routes/` — Express routers, one per resource area (`players`, `tiles`, `guilds`, `admin`),
  mounted under `/api/*` in `index.ts`. Player auth is a bare bearer token (`Authorization: Bearer
  <token>`, checked against `players.token` — no JWT/sessions). Admin auth is a static shared
  secret (`ADMIN_KEY` env var, header `x-admin-key`, see `requireAdmin` in `routes/admin.ts`).
- `game/` — game logic, deliberately kept separate from HTTP handling:
  - `resources.ts` — lazy/idle-game resource accrual. Nothing is computed on a server tick;
    instead `computeLiveTroops` / `computeLivePlayerGold` derive the current amount on read from
    `last_collected_at` (or `gold_collected_at`) and the production rate, capped by
    `resource_cap_hours`. **Gold is pooled per-player** (sum of all owned tiles' production),
    while **troops are per-tile** (each castle has its own garrison).
    Any time a tile's production rate changes (upgrade, conquest, loss), the caller must persist
    the live value under the *old* rate first — see `economy.ts`'s doc comment.
  - `economy.ts` — `settlePlayerGold`: freezes a player's live gold into the DB row under the old
    production rate; must be called immediately before any change to owned-tile production.
  - `combat.ts` — pure combat math (`resolveCombat`): attacker power vs. defender power (with a
    `combat_defense_bonus` multiplier), no I/O.
  - `attacks.ts` — attacks are **not resolved synchronously**. `createAttackOrder`-style flow
    inserts a row into `attack_orders` with a computed `arrives_at` (travel time = hex distance ×
    `attack_travel_seconds_per_tile`, divided by `game_speed`, floored by
    `attack_min_travel_seconds`). The `index.ts` interval loop finds due orders and calls
    `resolveOneAttackOrder`, which runs the actual `resolveCombat` at arrival time. Tiles store
    denormalized `from_x/from_y/target_x/target_y` so the client can draw travel-line animations
    without joining.
  - `mapgen.ts` — procedural map generation on an **axial hex grid** (not square). Currently
    generates a single large rectangular island (`ISLAND_COUNT = 1`); the multi-island/organic
    generators are still present but unused — see the comments for how to revert. `WORLD_SIZE`
    here must stay in sync with the client's copy in `client/src/game/constants.ts`. Also owns one-shot data
    migrations for schema/gameplay changes to an already-populated map (each guarded by
    `schema_migrations`).
  - `settings.ts` — `SETTING_DEFS` is the single source of truth for every tunable game constant
    (production rates, combat bonus, travel speed, NPC density, etc.), each with a default,
    label, and description. Values live in the `game_settings` table and are editable live from
    the admin panel (`routes/admin.ts` + client `AdminPanel.tsx`) without a redeploy.
  - `reports.ts` — per-player notification/report feed (battle results, scout results, "you were
    scouted") stored in `player_reports`.
- Guilds (clans): a player belongs to at most one guild. Guild members can send *reinforcements*
  to each other's tiles — reinforcement troops boost defense power but are never absorbable by
  the tile owner and can be recalled by the sender (`tile_reinforcements` table, distinct from a
  tile's own `stored_troops`).
- Scouting: sending a scout to a tile snapshots that tile's level/troops/production into
  `scout_reports` (one row per `(scout_player_id, tile_id)`, upserted). This information is
  **frozen at scout time**, not live — re-scout to refresh. Own/guild tiles are always shown live
  without needing a scout.

### Client (`client/src`)

- No router or state library. `App.tsx` owns all shared game state (session, tiles, myTiles,
  guild, reports, active attacks, selection/action flow, which panel is open), the polling
  effects, map scroll/zoom/drag handling, and the action handlers; it passes data and callbacks
  down as props. Open only the file for the feature you are changing:

  | Feature | File |
  |---|---|
  | Login / register screen | `components/LoginScreen.tsx` |
  | Map drawing (tiles, castles, mountains, level badges, attack lines) | `components/MapView.tsx` |
  | Top bar (avatar, gold/troops, menu buttons) | `components/TopBar.tsx` |
  | Castle click menu (hex action arc / info card) | `components/TileMenu.tsx` |
  | Troop count + ETA confirm card | `components/PendingActionCard.tsx` |
  | Guild modal (create/join/leave/invite, flag picker) | `components/GuildModal.tsx` |
  | Kingdom list (search/sort/paging) | `components/KingdomPanel.tsx` |
  | Leaderboard / Reports modals | `components/LeaderboardModal.tsx`, `components/ReportsModal.tsx` |
  | Guild flag SVG / action icons | `components/GuildFlag.tsx`, `components/icons/ActionIcons.tsx` |
  | Constants (WORLD_SIZE, zoom levels, icon thresholds) | `game/constants.ts` |
  | Hex ↔ screen math (`isoCenter`, `screenToWorld`) | `game/hexMath.ts` |
  | Castle/NPC/grass image selection | `game/tileImages.ts` |
  | Mountain decor placement, attack-line bending | `game/mountains.ts` |
  | Guild flag definitions | `game/guildFlags.ts` |
  | Action types, session load, avatar resize, `timeAgo` | `game/types.ts`, `game/utils.ts` |

  Panel-only UI state (search boxes, filters, form inputs, troop count) lives inside that panel
  component and resets when the panel closes.
- `AdminPanel.tsx` is a separate top-level view for the admin settings/moderation panel.
- `api.ts` — thin fetch wrappers for every backend endpoint plus the shared TypeScript types
  mirrored from the server's response shapes (`Tile`, `Session`, `PlayerSummary`, etc.). This is
  the contract between client and server — when a route's response shape changes on the server,
  update the matching type/function here.
- API base URL: `VITE_API_URL` env var in production builds; empty in dev, where Vite's proxy
  (`vite.config.ts`) forwards `/api` to `localhost:4000`.
- The map is rendered isometrically from axial hex coordinates; the hex-distance and travel-time
  math must match `server/src/game/mapgen.ts`'s `WORLD_SIZE` and `server/src/game/attacks.ts`'s
  distance formula.

## Environment variables

- **server**: `DATABASE_URL` (required, Postgres connection string), `PORT` (Render sets this
  automatically), `CORS_ORIGIN` (comma-separated allowed origins), `ADMIN_KEY` (enables the admin
  API; without it, admin routes return 503).
- **client**: `VITE_API_URL` (full backend URL for production builds; leave unset locally to use
  the Vite proxy).

## Deployment

Backend: Render Web Service (Node), connected to Neon Postgres. Frontend: Render Static Site.
Both deploy from `main`.

## Deploy (güncel)

- Oyun Eka VDS sunucusunda (Ubuntu 22.04) çalışıyor: Nginx + PM2 + yerel PostgreSQL 18.
  Render, Vercel ve Neon artık KULLANILMIYOR.
- Canlı adres: https://88-209-248-192.sslip.io (web + /api aynı domain; admin: /#admin).
- `main` dalına her push, .github/workflows/deploy.yml ile otomatik olarak sunucuya deploy
  edilir (git pull → server build → pm2 restart → client build). Bu dosyayı değiştirme.
- client/src/api.ts içindeki BASE boş kalmalı (relative "/api"); VITE_API_URL ayarlama.
- mobile/ klasörü Expo WebView kabuğu; mobile/config.ts WEB_URL canlı adresi gösterir.
- Veri sıfırlayan migration'lar canlı oyuncu hesaplarını siler — ekip onayı olmadan ekleme.
- Sunucu .env dosyası sadece sunucuda durur; asla commit etme.
