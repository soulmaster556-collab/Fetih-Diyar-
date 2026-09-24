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

// Takma ad, `username`'den (giriş kimlik bilgisi) BİLEREK farklı kurallara
// tabi -- Türkçe harfler/boşluk/rakam serbest (kale/oyuncu ismi gibi
// hissettirsin diye), ama art arda/baştan-sondan boşluk sadeleştiriliyor.
function validateNickname(nickname: unknown) {
  const n = String(nickname ?? "").trim().replace(/\s+/g, " ");
  if (n.length < 2 || n.length > 20) {
    return { error: "Takma ad 2-20 karakter olmalı." };
  }
  if (!/^[\p{L}\p{N} _'-]+$/u.test(n)) {
    return { error: "Takma ad sadece harf, rakam, boşluk, alt çizgi, tire ve kesme işareti içerebilir." };
  }
  return { nickname: n };
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
    // Kayıtta rastgele bir flama atanıyor (bkz. client/src/game/
    // playerFlags.ts) -- kozmetik olduğu için kripto rastgelelik gerekmiyor.
    const flagShape = 1 + Math.floor(Math.random() * 10);
    const flagColor = 1 + Math.floor(Math.random() * 20);
    const flagLogo = 1 + Math.floor(Math.random() * 20);

    let homeX: number | null = null;
    let homeY: number | null = null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO players (id, username, password_hash, token, created_at, season_points, home_tile_id, flag_shape, flag_color, flag_logo)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)`,
        [id, username, passwordHash, token, now, startingTileId, flagShape, flagColor, flagLogo]
      );
      const tileResult = await client.query<{ x: number; y: number }>(
        `UPDATE tiles
         SET owner_id = $1, tile_type = 'PLAYER', level = 1,
             gold_per_hour = $2, troops_per_hour = $3,
             stored_gold = 0, stored_troops = $4, last_collected_at = $5
         WHERE id = $6
         RETURNING x, y`,
        [id, production.gold_per_hour, production.troops_per_hour, settings.starting_troops, now, startingTileId]
      );
      if (tileResult.rows[0]) {
        homeX = tileResult.rows[0].x;
        homeY = tileResult.rows[0].y;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({ playerId: id, username, nickname: null, token, startingTileId, homeX, homeY });
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
    // Admin panelinden yasaklanmış oyuncu -- şifre doğru olsa bile giriş yok.
    if (player.banned) {
      return res.status(403).json({ error: "Hesabınız yasaklandı." });
    }

    const newToken = randomUUID();
    await pool.query("UPDATE players SET token = $1 WHERE id = $2", [newToken, player.id]);

    // Her login'de client'ın haritayı ana kaleye ortalayabilmesi için ilk
    // ana kalenin koordinatları da cevaba ekleniyor.
    let homeX: number | null = null;
    let homeY: number | null = null;
    if (player.home_tile_id !== null) {
      const { rows: homeRows } = await pool.query<{ x: number; y: number }>(
        "SELECT x, y FROM tiles WHERE id = $1",
        [player.home_tile_id]
      );
      if (homeRows[0]) {
        homeX = homeRows[0].x;
        homeY = homeRows[0].y;
      }
    }

    res.json({
      playerId: player.id,
      username: player.username,
      nickname: player.nickname ?? null,
      token: newToken,
      homeX,
      homeY,
    });
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

// Profil widget'ının kendi verisini (kullanıcı adı + varsa avatar) çekmesi
// için basit bir uç nokta.
playersRouter.get("/me", authenticate, async (req: any, res) => {
  const player = req.player as Player;
  res.json({
    playerId: player.id,
    username: player.username,
    nickname: player.nickname ?? null,
    avatarData: player.avatar_data ?? null,
    flagShape: player.flag_shape,
    flagColor: player.flag_color,
    flagLogo: player.flag_logo,
  });
});

// Takma ad SADECE bir kere seçilebilir (zaten dolu bir oyuncu 409 alır) --
// oyunun her yerinde gösterilen kimliğin kararsız/sık değişen bir şey
// olmaması için bilerek kısıtlandı (bkz. db.ts sütun yorumu). Eşzamanlı iki
// isteğin aynı adı almaya çalışması SELECT kontrolüyle çoğunlukla yakalanır,
// ama asıl garanti DB'deki unique index -- 23505 burada da ayrıca ele
// alınıyor.
playersRouter.post("/me/nickname", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    if (player.nickname) {
      return res.status(409).json({ error: "Takma adın zaten belirlendi, tekrar değiştirilemez." });
    }

    const parsed = validateNickname(req.body?.nickname);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const { nickname } = parsed;

    const existing = await pool.query("SELECT id FROM players WHERE lower(nickname) = lower($1)", [nickname]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Bu takma ad zaten kullanımda, farklı bir tane dene." });
    }

    await pool.query("UPDATE players SET nickname = $1 WHERE id = $2", [nickname, player.id]);
    res.json({ ok: true, nickname });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Bu takma ad zaten kullanımda, farklı bir tane dene." });
    }
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

const MAX_AVATAR_DATA_URL_LENGTH = 400_000; // ~300kb ham veri (base64 şişkinliğiyle)

playersRouter.post("/me/avatar", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const avatarData = req.body?.avatarData;

    // null/boş göndererek avatarı kaldırmaya da izin ver.
    if (avatarData === null || avatarData === "") {
      await pool.query("UPDATE players SET avatar_data = NULL WHERE id = $1", [player.id]);
      return res.json({ ok: true, avatarData: null });
    }

    if (typeof avatarData !== "string" || !avatarData.startsWith("data:image/")) {
      return res.status(400).json({ error: "Geçersiz görsel verisi." });
    }
    if (avatarData.length > MAX_AVATAR_DATA_URL_LENGTH) {
      return res.status(413).json({ error: "Görsel çok büyük. Daha küçük bir fotoğraf dene." });
    }

    await pool.query("UPDATE players SET avatar_data = $1 WHERE id = $2", [avatarData, player.id]);
    res.json({ ok: true, avatarData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Flama tasarım ekranından (bkz. client PlayerFlagModal.tsx) kaydetme --
// avatar ucuyla aynı desen, ama guild'in normalizeFlagId'sinden farklı
// olarak aralık dışı bir değeri SESSİZCE clamp etmek yerine 400 döner ki
// istemci zar/seçim mantığında bir hata varsa fark edilsin.
function isValidFlagAxis(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

playersRouter.post("/me/flag", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const { flagShape, flagColor, flagLogo } = req.body ?? {};

    if (!isValidFlagAxis(flagShape, 10) || !isValidFlagAxis(flagColor, 20) || !isValidFlagAxis(flagLogo, 20)) {
      return res.status(400).json({ error: "Geçersiz flama seçimi." });
    }

    await pool.query(
      "UPDATE players SET flag_shape = $1, flag_color = $2, flag_logo = $3 WHERE id = $4",
      [flagShape, flagColor, flagLogo, player.id]
    );
    res.json({ ok: true, flagShape, flagColor, flagLogo });
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
    // Admin panelinden yasaklanan oyuncunun token'ı ban anında zaten
    // döndürülüyor (bkz. routes/admin.ts), ama tutarlılık için burada da
    // kontrol ediyoruz -- ban kaldırılıp token hâlâ eskiyse bile reddedilsin.
    if (player.banned) return res.status(403).json({ error: "Hesabınız yasaklandı." });

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
      // Yasaklı oyuncu burada reddedilmiyor (bu uç nokta herkese açık), ama
      // req.player hiç doldurulmuyor ki yasaklı kullanıcı anonim biri gibi
      // davranılsın (kendi/klan kalesi ayrıcalığı görmesin).
      if (rows[0] && !rows[0].banned) req.player = rows[0];
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
    // `username` alanı burada aslında takma adı taşıyor (COALESCE) -- diğer
    // oyunculara gösterilen HER yerde artık nickname esas (bkz. db.ts sütun
    // yorumu), login kullanıcı adı sadece onboarding tamamlanmamış (nickname
    // hâlâ NULL) çok nadir bir ara durumun geri düşüşü.
    const { rows } = await pool.query<TileRow & { username: string }>(
      `SELECT t.*, COALESCE(p.nickname, p.username) as username FROM tiles t
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
