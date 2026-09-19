import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL ortam değişkeni tanımlı değil.");
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at BIGINT NOT NULL,
      season_points INTEGER NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tiles (
      id SERIAL PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      owner_id TEXT NULL REFERENCES players(id),
      tile_type TEXT NOT NULL CHECK (tile_type IN ('NPC','PLAYER','EMPTY')),
      level INTEGER NOT NULL DEFAULT 1,
      gold_per_hour DOUBLE PRECISION NOT NULL,
      troops_per_hour DOUBLE PRECISION NOT NULL,
      stored_gold DOUBLE PRECISION NOT NULL DEFAULT 0,
      stored_troops DOUBLE PRECISION NOT NULL DEFAULT 0,
      last_collected_at BIGINT NOT NULL,
      UNIQUE (x, y)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS battle_log (
      id SERIAL PRIMARY KEY,
      attacker_id TEXT NOT NULL,
      defender_tile_id INTEGER NOT NULL,
      attacker_power DOUBLE PRECISION NOT NULL,
      defender_power DOUBLE PRECISION NOT NULL,
      result TEXT NOT NULL,
      troops_sent DOUBLE PRECISION NOT NULL,
      occurred_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_settings (
      key TEXT PRIMARY KEY,
      value DOUBLE PRECISION NOT NULL
    );
  `);
}
