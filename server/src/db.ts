import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data.sqlite");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  season_points INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  owner_id TEXT NULL REFERENCES players(id),
  tile_type TEXT NOT NULL CHECK (tile_type IN ('NPC','PLAYER','EMPTY')),
  level INTEGER NOT NULL DEFAULT 1,
  gold_per_hour REAL NOT NULL,
  troops_per_hour REAL NOT NULL,
  stored_gold REAL NOT NULL DEFAULT 0,
  stored_troops REAL NOT NULL DEFAULT 0,
  last_collected_at INTEGER NOT NULL,
  UNIQUE (x, y)
);

CREATE TABLE IF NOT EXISTS battle_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attacker_id TEXT NOT NULL,
  defender_tile_id INTEGER NOT NULL,
  attacker_power REAL NOT NULL,
  defender_power REAL NOT NULL,
  result TEXT NOT NULL,
  troops_sent REAL NOT NULL,
  occurred_at INTEGER NOT NULL
);
`);
