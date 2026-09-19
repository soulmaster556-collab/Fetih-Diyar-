import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { pickRandomEmptyTile } from "../game/mapgen.js";
import { productionForLevel } from "../game/resources.js";
import type { Player } from "../types.js";

export const playersRouter = Router();

playersRouter.post("/register", async (req, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    if (!username || username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: "Kullanıcı adı 3-20 karakter olmalı." });
    }

    const existing = await pool.query("SELECT id FROM players WHERE username = $1", [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Bu kullanıcı adı zaten alınmış." });
    }

    const startingTileId = await pickRandomEmptyTile();
    if (startingTileId === null) {
      return res.status(503).json({ error: "Haritada boş kare kalmadı." });
    }

    const id = randomUUID();
    const token = randomUUID();
    const now = Date.now();
    const production = productionForLevel(1);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO players (id, username, token, created_at, season_points)
         VALUES ($1, $2, $3, $4, 0)`,
        [id, username, token, now]
      );
      await client.query(
        `UPDATE tiles
         SET owner_id = $1, tile_type = 'PLAYER', level = 1,
             gold_per_hour = $2, troops_per_hour = $3,
             stored_gold = 0, stored_troops = 20, last_collected_at = $4
         WHERE id = $5`,
        [id, production.gold_per_hour, production.troops_per_hour, now, startingTileId]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({ playerId: id, username, token, startingTileId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

export async function authenticate(req: any, res: any, next: any) {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Giriş gerekli." });

    const { rows } = await pool.query<Player>("SELECT * FROM players WHERE token = $1", [token]);
    const player = rows[0];
    if (!player) return res.status(401).json({ error: "Geçersiz oturum." });

    req.player = player;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
}
