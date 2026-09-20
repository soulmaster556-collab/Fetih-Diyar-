import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { pickRandomEmptyTile } from "../game/mapgen.js";
import { computeLivePlayerGold, computeLiveTroops, productionForLevel } from "../game/resources.js";
import { getTotalGoldPerHour, getTotalTroopsPerHour } from "../game/economy.js";
import { loadSettings } from "../game/settings.js";
import { hashPassword, verifyPassword } from "../game/password.js";
import type { ReportRow } from "../game/reports.js";
import type { Player, TileRow } from "../types.js";

export const playersRouter = Router();

function validateCredentials(username: unknown, password: unknown) {
  const u = String(username ?? "").trim();
  const p = String(password ?? "");
  if (!u || u.length < 3 || u.length > 20) {
    return { error: "Kullanıcı adı 3-20 karakter olmalı." };
  }
  if (!p || p.length < 6) {
    return { error: "Şifre en az 6 karakter olmalı." };
  }
  return { username: u, password: p };
}

playersRouter.post("/register", async (req, res) => {
  try {
    const parsed = validateCredentials(req.body?.username, req.body?.password);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const { username, password } = parsed;

    const existing = await pool.query("SELECT id FROM players WHERE username = $1", [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Bu kullanıcı adı zaten alınmış." });
    }

    const startingTileId = await pickRandomEmptyTile();
    if (startingTileId === null) {
      return res.status(503).json({ error: "Haritada boş kare kalmadı." });
    }

    const settings = await loadSettings();
    const id = randomUUID();
    const token = randomUUID();
    const passwordHash = hashPassword(password);
    const now = Date.now();
    const production = productionForLevel(1, settings);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO players (id, username, password_hash, token, created_at, season_points)
         VALUES ($1, $2, $3, $4, $5, 0)`,
        [id, username, passwordHash, token, now]
      );
      await client.query(
        `UPDATE tiles
         SET owner_id = $1, tile_type = 'PLAYER', level = 1,
             gold_per_hour = $2, troops_per_hour = $3,
             stored_gold = 0, stored_troops = $4, last_collected_at = $5
         WHERE id = $6`,
        [id, production.gold_per_hour, production.troops_per_hour, settings.starting_troops, now, startingTileId]
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

playersRouter.post("/login", async (req, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!username || !password) {
      return res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli." });
    }

    const { rows } = await pool.query<Player>("SELECT * FROM players WHERE username = $1", [
      username,
    ]);
    const player = rows[0];
    if (!player || !verifyPassword(password, player.password_hash)) {
      return res.status(401).json({ error: "Kullanıcı adı veya şifre yanlış." });
    }

    const newToken = randomUUID();
    await pool.query("UPDATE players SET token = $1 WHERE id = $2", [newToken, player.id]);

    res.json({ playerId: player.id, username: player.username, token: newToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Tek yerde: krallığın toplam altın/asker üretimi ve ortak altın havuzu.
// (Madde 1 — "tek yerde toplam asker ve altın üretimini görebilme".)
playersRouter.get("/me/summary", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const settings = await loadSettings();
    const now = Date.now();
    const [goldPerHour, troopsPerHour] = await Promise.all([
      getTotalGoldPerHour(player.id),
      getTotalTroopsPerHour(player.id),
    ]);
    const gold = computeLivePlayerGold(player, goldPerHour, settings, now);
    res.json({ gold: Math.floor(gold), goldPerHour, troopsPerHour });
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

// Harita görünümü (GET /tiles) herkese açık kalmaya devam ediyor ama artık
// gözcü/casusluk sistemi yüzünden İSTEĞE BAĞLI olarak "kim bakıyor" bilgisine
// ihtiyaç duyuyor (kendi/klan kalelerin canlı, düşman/NPC'ler sadece
// gözcülenmişse görünür olsun diye). Token yoksa ya da geçersizse isteği
// REDDETMEZ, sadece req.player'ı boş bırakıp anonim gibi devam eder.
export async function optionalAuthenticate(req: any, _res: any, next: any) {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      const { rows } = await pool.query<Player>("SELECT * FROM players WHERE token = $1", [token]);
      if (rows[0]) req.player = rows[0];
    }
  } catch (err) {
    console.error(err);
  }
  next();
}

// Liderlik panosu: en çok asker / en çok kaleye sahip oyuncular. Canlı asker
// sayısı (computeLiveTroops) her PLAYER karosu için hesaplanıp sahibine göre
// toplanıyor -- dünya küçük olduğu için (sadece fethedilmiş kareler) bu iş
// yükü ihmal edilebilir düzeyde.
playersRouter.get("/leaderboard", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const now = Date.now();
    const { rows } = await pool.query<TileRow & { username: string }>(
      `SELECT t.*, p.username as username FROM tiles t
       JOIN players p ON p.id = t.owner_id
       WHERE t.tile_type = 'PLAYER' AND t.owner_id IS NOT NULL`
    );
    const byPlayer = new Map<string, { username: string; troops: number; castles: number }>();
    for (const t of rows) {
      const entry = byPlayer.get(t.owner_id as string) ?? { username: t.username, troops: 0, castles: 0 };
      entry.troops += computeLiveTroops(t, settings, now);
      entry.castles += 1;
      byPlayer.set(t.owner_id as string, entry);
    }
    const list = Array.from(byPlayer.values());
    const topTroops = [...list]
      .sort((a, b) => b.troops - a.troops)
      .slice(0, 10)
      .map((e) => ({ username: e.username, value: Math.floor(e.troops) }));
    const topCastles = [...list]
      .sort((a, b) => b.castles - a.castles)
      .slice(0, 10)
      .map((e) => ({ username: e.username, value: e.castles }));
    res.json({ topTroops, topCastles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Mesaj/rapor kutusu -- en yeni 50 olay.
playersRouter.get("/me/reports", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const { rows } = await pool.query<ReportRow>(
      "SELECT id, type, title, body, created_at, read_at FROM player_reports WHERE player_id = $1 ORDER BY created_at DESC LIMIT 50",
      [player.id]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        createdAt: Number(r.created_at),
        readAt: r.read_at !== null ? Number(r.read_at) : null,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

playersRouter.post("/me/reports/read-all", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    await pool.query(
      "UPDATE player_reports SET read_at = $1 WHERE player_id = $2 AND read_at IS NULL",
      [Date.now(), player.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});
