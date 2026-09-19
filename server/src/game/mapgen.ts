import { pool } from "../db.js";
import { productionForLevel } from "./resources.js";
import type { Settings } from "./settings.js";

const MAP_SIZE = 16;

export async function ensureMapGenerated(settings: Settings) {
  const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*)::int as count FROM tiles");
  if (Number(rows[0].count) > 0) return;

  const now = Date.now();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let x = 0; x < MAP_SIZE; x++) {
      for (let y = 0; y < MAP_SIZE; y++) {
        const isNpc = Math.random() < settings.npc_spawn_chance;
        const level = isNpc ? 1 + Math.floor(Math.random() * 3) : 1;
        const production = productionForLevel(level, settings);
        await client.query(
          `INSERT INTO tiles (x, y, owner_id, tile_type, level, gold_per_hour, troops_per_hour,
                              stored_gold, stored_troops, last_collected_at)
           VALUES ($1, $2, NULL, $3, $4, $5, 0, 0, $6, $7)`,
          [
            x,
            y,
            isNpc ? "NPC" : "EMPTY",
            level,
            production.gold_per_hour,
            isNpc ? level * 20 : 0, // NPC garrison, static
            now,
          ]
        );
      }
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
