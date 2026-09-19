import { pool } from "../db.js";
import { productionForLevel } from "./resources.js";
import type { Settings } from "./settings.js";

const WORLD_SIZE = 80;
const ISLAND_COUNT = 32;
const ISLAND_MIN_SIZE = 15;
const ISLAND_MAX_SIZE = 35;
const MAX_SEED_ATTEMPTS_PER_ISLAND = 30;
const MAX_GROWTH_STALLS = 50;

interface LandTile {
  x: number;
  y: number;
  islandId: number;
}

function key(x: number, y: number) {
  return `${x},${y}`;
}

function neighbors8(x: number, y: number): [number, number][] {
  const result: [number, number][] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      result.push([x + dx, y + dy]);
    }
  }
  return result;
}

function inBounds(x: number, y: number) {
  return x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE;
}

/**
 * Generates a scattered archipelago instead of one solid landmass: each
 * island grows as a random blob, and a new tile is only accepted if none of
 * its neighbors already belong to a *different* island — that gap is what
 * keeps islands visually and mechanically separate (no accidental adjacency
 * across islands).
 */
function generateIslandLayout(): LandTile[] {
  const occupied = new Map<string, number>(); // "x,y" -> islandId
  const allTiles: LandTile[] = [];

  function canPlace(x: number, y: number, islandId: number) {
    if (!inBounds(x, y)) return false;
    if (occupied.has(key(x, y))) return false;
    for (const [nx, ny] of neighbors8(x, y)) {
      const owner = occupied.get(key(nx, ny));
      if (owner !== undefined && owner !== islandId) return false;
    }
    return true;
  }

  for (let islandId = 1; islandId <= ISLAND_COUNT; islandId++) {
    let seed: [number, number] | null = null;
    for (let t = 0; t < MAX_SEED_ATTEMPTS_PER_ISLAND; t++) {
      const sx = Math.floor(Math.random() * WORLD_SIZE);
      const sy = Math.floor(Math.random() * WORLD_SIZE);
      if (canPlace(sx, sy, islandId)) {
        seed = [sx, sy];
        break;
      }
    }
    if (!seed) continue; // map is full enough; fewer islands than requested is fine

    const targetSize =
      ISLAND_MIN_SIZE + Math.floor(Math.random() * (ISLAND_MAX_SIZE - ISLAND_MIN_SIZE + 1));
    const islandTiles: [number, number][] = [seed];
    occupied.set(key(seed[0], seed[1]), islandId);

    let stalls = 0;
    while (islandTiles.length < targetSize && stalls < MAX_GROWTH_STALLS) {
      const [bx, by] = islandTiles[Math.floor(Math.random() * islandTiles.length)];
      const candidates = neighbors8(bx, by).filter(([nx, ny]) => canPlace(nx, ny, islandId));
      if (candidates.length === 0) {
        stalls++;
        continue;
      }
      stalls = 0;
      const [cx, cy] = candidates[Math.floor(Math.random() * candidates.length)];
      occupied.set(key(cx, cy), islandId);
      islandTiles.push([cx, cy]);
    }

    for (const [x, y] of islandTiles) {
      allTiles.push({ x, y, islandId });
    }
  }

  return allTiles;
}

export async function ensureMapGenerated(settings: Settings) {
  const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*)::int as count FROM tiles");
  if (Number(rows[0].count) > 0) return;

  const now = Date.now();
  const layout = generateIslandLayout();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Bulk insert in chunks to keep each query at a reasonable size.
    const CHUNK_SIZE = 200;
    for (let i = 0; i < layout.length; i += CHUNK_SIZE) {
      const chunk = layout.slice(i, i + CHUNK_SIZE);
      const values: string[] = [];
      const params: unknown[] = [];
      let p = 1;

      for (const tile of chunk) {
        const isNpc = Math.random() < settings.npc_spawn_chance;
        const level = isNpc ? 1 + Math.floor(Math.random() * 3) : 1;
        const production = productionForLevel(level, settings);

        values.push(
          `($${p++}, $${p++}, NULL, $${p++}, $${p++}, $${p++}, $${p++}, 0, 0, $${p++}, $${p++})`
        );
        params.push(
          tile.x,
          tile.y,
          tile.islandId,
          isNpc ? "NPC" : "EMPTY",
          level,
          production.gold_per_hour,
          isNpc ? level * 20 : 0, // NPC garrison, static
          now
        );
      }

      await client.query(
        `INSERT INTO tiles (x, y, owner_id, island_id, tile_type, level, gold_per_hour,
                            troops_per_hour, stored_gold, stored_troops, last_collected_at)
         VALUES ${values.join(", ")}`,
        params
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function pickRandomEmptyTile(): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM tiles WHERE tile_type = 'EMPTY' ORDER BY RANDOM() LIMIT 1"
  );
  return rows[0]?.id ?? null;
}
