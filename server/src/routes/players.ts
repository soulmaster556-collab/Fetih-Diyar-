import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { pickRandomEmptyTile } from "../game/mapgen.js";
import { productionForLevel } from "../game/resources.js";
import type { Player } from "../types.js";

export const playersRouter = Router();

playersRouter.post("/register", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  if (!username || username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: "Kullanıcı adı 3-20 karakter olmalı." });
  }

  const existing = db
    .prepare("SELECT id FROM players WHERE username = ?")
    .get(username);
  if (existing) {
    return res.status(409).json({ error: "Bu kullanıcı adı zaten alınmış." });
  }

  const startingTileId = pickRandomEmptyTile();
  if (startingTileId === null) {
    return res.status(503).json({ error: "Haritada boş kare kalmadı." });
  }

  const id = randomUUID();
  const token = randomUUID();
  const now = Date.now();

  const insertPlayer = db.prepare(`
    INSERT INTO players (id, username, token, created_at, season_points)
    VALUES (?, ?, ?, ?, 0)
  `);

  const production = productionForLevel(1);
  const foundCity = db.prepare(`
    UPDATE tiles
    SET owner_id = ?, tile_type = 'PLAYER', level = 1,
        gold_per_hour = ?, troops_per_hour = ?,
        stored_gold = 0, stored_troops = 20, last_collected_at = ?
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    insertPlayer.run(id, username, token, now);
    foundCity.run(id, production.gold_per_hour, production.troops_per_hour, now, startingTileId);
  });
  tx();

  res.json({ playerId: id, username, token, startingTileId });
});

export function authenticate(req: any, res: any, next: any) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Giriş gerekli." });

  const player = db.prepare("SELECT * FROM players WHERE token = ?").get(token) as
    | Player
    | undefined;
  if (!player) return res.status(401).json({ error: "Geçersiz oturum." });

  req.player = player;
  next();
}
