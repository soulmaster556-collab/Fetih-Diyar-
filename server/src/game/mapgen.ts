import { db } from "../db.js";
import { productionForLevel } from "./resources.js";

const MAP_SIZE = 16;
const NPC_CHANCE = 0.25;

export function ensureMapGenerated() {
  const count = (db.prepare("SELECT COUNT(*) as c FROM tiles").get() as { c: number }).c;
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO tiles (x, y, owner_id, tile_type, level, gold_per_hour, troops_per_hour,
                        stored_gold, stored_troops, last_collected_at)
    VALUES (@x, @y, NULL, @tile_type, @level, @gold_per_hour, @troops_per_hour, 0, @stored_troops, @now)
  `);

  const now = Date.now();
  const insertMany = db.transaction(() => {
    for (let x = 0; x < MAP_SIZE; x++) {
      for (let y = 0; y < MAP_SIZE; y++) {
        const isNpc = Math.random() < NPC_CHANCE;
        const level = isNpc ? 1 + Math.floor(Math.random() * 3) : 1;
        const production = productionForLevel(level);
        insert.run({
          x,
          y,
          tile_type: isNpc ? "NPC" : "EMPTY",
          level,
          gold_per_hour: production.gold_per_hour,
          troops_per_hour: 0, // NPC/empty tiles don't produce troops for a player
          stored_troops: isNpc ? level * 20 : 0, // NPC garrison, static
          now,
        });
      }
    }
  });
  insertMany();
}

export function pickRandomEmptyTile() {
  const row = db
    .prepare("SELECT id FROM tiles WHERE tile_type = 'EMPTY' ORDER BY RANDOM() LIMIT 1")
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}
