import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { SETTING_DEFS, loadSettings, updateSettings } from "../game/settings.js";
import { computeLivePlayerGold, computeLiveTroops } from "../game/resources.js";
import { hashPassword } from "../game/password.js";
import { ensureMapGenerated } from "../game/mapgen.js";
import type { Player, TileRow } from "../types.js";

export const adminRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: "Admin paneli yapılandırılmamış (ADMIN_KEY eksik)." });
  }
  const provided = req.headers["x-admin-key"];
  if (provided !== adminKey) {
    return res.status(401).json({ error: "Geçersiz admin anahtarı." });
  }
  next();
}

adminRouter.get("/settings", requireAdmin, async (_req, res) => {
  try {
    const values = await loadSettings();
    res.json({
      defs: SETTING_DEFS.map(({ key, label, description, default: def }) => ({
        key,
        label,
        description,
        default: def,
      })),
      values,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

adminRouter.post("/settings", requireAdmin, async (req, res) => {
  try {
    const updates = req.body?.values;
    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ error: "Geçersiz istek gövdesi." });
    }
    await updateSettings(updates);
    const values = await loadSettings();
    res.json({ values });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Sunucu hatası." });
  }
});

// ---------------------------------------------------------------------------
// Oyuncular bölümü -- liste + detay + birkaç müdahale (altın ayarla, kale
// başına asker ayarla, şifre sıfırla, banla/kaldır, loncadan at, hesabı
// sil) -- hepsi requireAdmin ile aynı ADMIN_KEY duvarının arkasında.
// ---------------------------------------------------------------------------

interface GuildMembershipRow {
  guild_id: number;
  leader_id: string;
  name: string;
}

async function getGuildMembership(playerId: string, db: { query: (typeof pool)["query"] } = pool) {
  const { rows } = await db.query<GuildMembershipRow>(
    `SELECT g.id as guild_id, g.leader_id, g.name
     FROM guild_members gm
     JOIN guilds g ON g.id = gm.guild_id
     WHERE gm.player_id = $1`,
    [playerId]
  );
  return rows[0] ?? null;
}

// Bir oyuncuyu bir loncadan çıkarır; lider oysa loncayı en eski üyeye
// devreder, başka üye yoksa loncayı tamamen siler. Hem "loncadan at" hem
// "hesabı sil" aksiyonlarında aynı mantık gerektiği için ortak fonksiyon.
async function removeFromGuild(client: { query: (typeof pool)["query"] }, playerId: string) {
  const membership = await getGuildMembership(playerId, client);
  if (!membership) return false;
  await client.query("DELETE FROM guild_members WHERE player_id = $1", [playerId]);
  if (membership.leader_id === playerId) {
    const { rows: remaining } = await client.query<{ player_id: string }>(
      "SELECT player_id FROM guild_members WHERE guild_id = $1 ORDER BY joined_at ASC LIMIT 1",
      [membership.guild_id]
    );
    if (remaining.length > 0) {
      await client.query("UPDATE guilds SET leader_id = $1 WHERE id = $2", [
        remaining[0].player_id,
        membership.guild_id,
      ]);
    } else {
      await client.query("DELETE FROM guilds WHERE id = $1", [membership.guild_id]);
    }
  }
  return true;
}
    await client.query("DELETE FROM chat_messages WHERE player_id = $1", [id]);
    await client.query("DELETE FROM reinforcement_orders WHERE from_player_id = $1", [id]);

// GET /admin/players?q=&limit=&offset= -- aranabilir, sayfalanabilir liste.
// Canlı altın/asker leaderboard'daki (players.ts) aynı yaklaşımla, tüm
// PLAYER karoları JS tarafında sahibine göre toplanarak hesaplanıyor -- dünya
// küçük olduğu için bu iş yükü ihmal edilebilir düzeyde.
adminRouter.get("/players", requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const { rows: playerRows } = await pool.query<Player>(
      `SELECT * FROM players
       WHERE ($1 = '' OR username ILIKE '%' || $1 || '%')
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [q, limit, offset]
    );
    const { rows: countRows } = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM players WHERE ($1 = '' OR username ILIKE '%' || $1 || '%')`,
      [q]
    );
    const total = countRows[0]?.count ?? 0;

    if (playerRows.length === 0) {
      return res.json({ players: [], total });
    }

    const settings = await loadSettings();
    const now = Date.now();
    const ids = playerRows.map((p) => p.id);

    const { rows: tileRows } = await pool.query<TileRow>(
      `SELECT * FROM tiles WHERE tile_type = 'PLAYER' AND owner_id = ANY($1::text[])`,
      [ids]
    );
    const { rows: guildRows } = await pool.query<{ player_id: string; name: string }>(
      `SELECT gm.player_id, g.name FROM guild_members gm
       JOIN guilds g ON g.id = gm.guild_id
       WHERE gm.player_id = ANY($1::text[])`,
      [ids]
    );
    const guildByPlayer = new Map(guildRows.map((r) => [r.player_id, r.name]));

    const statsByOwner = new Map<
      string,
      { castles: number; goldPerHour: number; troopsPerHour: number; liveTroops: number }
    >();
    for (const t of tileRows) {
      const ownerId = t.owner_id as string;
      const s = statsByOwner.get(ownerId) ?? { castles: 0, goldPerHour: 0, troopsPerHour: 0, liveTroops: 0 };
      s.castles += 1;
      s.goldPerHour += t.gold_per_hour;
      s.troopsPerHour += t.troops_per_hour;
      s.liveTroops += computeLiveTroops(t, settings, now);
      statsByOwner.set(ownerId, s);
    }

    const players = playerRows.map((p) => {
      const s = statsByOwner.get(p.id) ?? { castles: 0, goldPerHour: 0, troopsPerHour: 0, liveTroops: 0 };
      const liveGold = computeLivePlayerGold(p, s.goldPerHour, settings, now);
      return {
        id: p.id,
        username: p.username,
        nickname: p.nickname,
        createdAt: Number(p.created_at),
        seasonPoints: p.season_points,
        banned: p.banned,
        gold: Math.floor(liveGold),
        goldPerHour: s.goldPerHour,
        troops: Math.floor(s.liveTroops),
        troopsPerHour: s.troopsPerHour,
        castles: s.castles,
        guildName: guildByPlayer.get(p.id) ?? null,
      };
    });

    res.json({ players, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// GET /admin/players/:id -- tek oyuncunun tüm kaleleri + lonca bilgisiyle
// birlikte tam görünümü (detay paneli / müdahale ekranı için).
adminRouter.get("/players/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query<Player>("SELECT * FROM players WHERE id = $1", [id]);
    const player = rows[0];
    if (!player) return res.status(404).json({ error: "Oyuncu bulunamadı." });

    const settings = await loadSettings();
    const now = Date.now();
    const { rows: tiles } = await pool.query<TileRow>(
      "SELECT * FROM tiles WHERE owner_id = $1 AND tile_type = 'PLAYER' ORDER BY level DESC, id ASC",
      [id]
    );
    const goldPerHour = tiles.reduce((sum, t) => sum + t.gold_per_hour, 0);
    const troopsPerHour = tiles.reduce((sum, t) => sum + t.troops_per_hour, 0);
    const liveGold = computeLivePlayerGold(player, goldPerHour, settings, now);
    const guild = await getGuildMembership(id);

    res.json({
      id: player.id,
      username: player.username,
      nickname: player.nickname,
      createdAt: Number(player.created_at),
      seasonPoints: player.season_points,
      banned: player.banned,
      gold: Math.floor(liveGold),
      goldPerHour,
      troopsPerHour,
      guild: guild ? { id: guild.guild_id, name: guild.name, isLeader: guild.leader_id === id } : null,
      tiles: tiles.map((t) => ({
        id: t.id,
        x: t.x,
        y: t.y,
        islandId: t.island_id,
        level: t.level,
        goldPerHour: t.gold_per_hour,
        troopsPerHour: t.troops_per_hour,
        troops: Math.floor(computeLiveTroops(t, settings, now)),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// POST /admin/players/:id/gold { gold } -- ortak altın havuzunu doğrudan
// verilen değere sabitler (birikmiş/hak edilmiş tutarı DEĞİL, admin'in
// yazdığı sayıyı kalıcı yapar -- bu yüzden "ayarla", "ekle" değil).
adminRouter.post("/players/:id/gold", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const gold = Number(req.body?.gold);
    if (!Number.isFinite(gold) || gold < 0) {
      return res.status(400).json({ error: "Geçersiz altın miktarı." });
    }
    const { rowCount } = await pool.query(
      "UPDATE players SET gold = $1, gold_collected_at = $2 WHERE id = $3",
      [gold, Date.now(), id]
    );
    if (!rowCount) return res.status(404).json({ error: "Oyuncu bulunamadı." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// POST /admin/tiles/:tileId/troops { troops } -- tek bir kalenin garnizonunu
// doğrudan verilen değere sabitler. Asker üretimi altından farklı olarak
// kale bazlı olduğu için (bkz. game/resources.ts) oyuncu değil karo hedefli.
adminRouter.post("/tiles/:tileId/troops", requireAdmin, async (req, res) => {
  try {
    const tileId = Number(req.params.tileId);
    const troops = Number(req.body?.troops);
    if (!Number.isFinite(tileId)) return res.status(400).json({ error: "Geçersiz kale." });
    if (!Number.isFinite(troops) || troops < 0) {
      return res.status(400).json({ error: "Geçersiz asker sayısı." });
    }
    const { rows } = await pool.query(
      "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3 AND tile_type = 'PLAYER' RETURNING id",
      [troops, Date.now(), tileId]
    );
    if (!rows.length) return res.status(404).json({ error: "Kale bulunamadı." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// POST /admin/players/:id/password { password } -- admin şifreyi doğrudan
// değiştirir (oyuncu şifresini unuttuğunda ya da güvenlik şüphesinde).
// Token da döndürülür ki değişiklikle birlikte açık oturumlar kapansın.
adminRouter.post("/players/:id/password", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const password = String(req.body?.password ?? "");
    if (password.length < 6) {
      return res.status(400).json({ error: "Şifre en az 6 karakter olmalı." });
    }
    const passwordHash = hashPassword(password);
    const { rowCount } = await pool.query(
      "UPDATE players SET password_hash = $1, token = $2 WHERE id = $3",
      [passwordHash, randomUUID(), id]
    );
    if (!rowCount) return res.status(404).json({ error: "Oyuncu bulunamadı." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// POST /admin/players/:id/ban ve /unban -- ban anında token döndürülür ki
// oyuncu açık oturumdaysa bile bir sonraki istekte hemen dışarı düşsün
// (bkz. routes/players.ts authenticate/login banned kontrolü).
adminRouter.post("/players/:id/ban", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query("UPDATE players SET banned = true, token = $1 WHERE id = $2", [
      randomUUID(),
      id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Oyuncu bulunamadı." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

adminRouter.post("/players/:id/unban", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query("UPDATE players SET banned = false WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Oyuncu bulunamadı." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// POST /admin/players/:id/kick-guild -- loncadan çıkarır, liderse loncayı
// devreder/gerekirse siler (bkz. removeFromGuild).
adminRouter.post("/players/:id/kick-guild", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const removed = await removeFromGuild(client, id);
    if (!removed) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Oyuncu bir loncaya üye değil." });
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  } finally {
    client.release();
  }
});

// DELETE /admin/players/:id -- hesabı tamamen siler. Kaleleri silmek yerine
// EMPTY'e döndürür (harita bütünlüğü bozulmasın diye), lonca üyeliğini
// temizler/devreder, oyuncuya ait takviye/gözcü/rapor kayıtlarını siler.
// Geri alınamaz -- client tarafında ayrıca onay isteniyor.
adminRouter.delete("/players/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query("SELECT id FROM players WHERE id = $1", [id]);
    if (!existing.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Oyuncu bulunamadı." });
    }

    const { rows: ownedTiles } = await client.query<{ id: number }>(
      "SELECT id FROM tiles WHERE owner_id = $1",
      [id]
    );
    const ownedTileIds = ownedTiles.map((t) => t.id);

    if (ownedTileIds.length > 0) {
      await client.query(
        "DELETE FROM tile_reinforcements WHERE tile_id = ANY($1::int[]) OR from_player_id = $2",
        [ownedTileIds, id]
      );
    } else {
      await client.query("DELETE FROM tile_reinforcements WHERE from_player_id = $1", [id]);
    }

    // Hesap silinirken yolda olan (henüz sonuçlanmamış) saldırı siparişleri
    // de temizlenmeli, yoksa attacker_id -> players FK ihlali yüzünden bu
    // silme başarısız olur. Askerler zaten kayboluyor (tıpkı diğer kaynaklar
    // gibi).
    await client.query("DELETE FROM attack_orders WHERE attacker_id = $1", [id]);
    await client.query(
      "DELETE FROM guild_invites WHERE invited_player_id = $1 OR invited_by_id = $1",
      [id]
    );

    await client.query(
      `UPDATE tiles SET owner_id = NULL, tile_type = 'EMPTY', level = 1,
         gold_per_hour = 0, troops_per_hour = 0, stored_gold = 0, stored_troops = 0,
         last_collected_at = $1
       WHERE owner_id = $2`,
      [Date.now(), id]
    );

    await removeFromGuild(client, id);
    await client.query("DELETE FROM scout_reports WHERE scout_player_id = $1", [id]);
    await client.query("DELETE FROM player_reports WHERE player_id = $1", [id]);
    await client.query("DELETE FROM players WHERE id = $1", [id]);

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /admin/reset-game -- TÜM oyun verisini (oyuncular, kaleler, loncalar,
// davetler, saldırı/takviye siparişleri, gözcü/rapor/savaş kayıtları) siler
// ve haritayı SIFIRDAN yeniden üretir. `game_settings` (admin'in ayarladığı
// tüm oyun sabitleri) ve `schema_migrations` (bkz. mapgen.ts'teki tek
// seferlik geçiş kayıtları) BİLEREK dokunulmuyor -- aksi halde eski TRUNCATE
// tabanlı migration'lar (ör. applyRectSingleIslandMigration) "hiç
// çalışmamış" gibi görünüp bir sonraki boot'ta yanlışlıkla tekrar
// tetiklenebilirdi (bkz. mapgen.ts dosya başı yorumları, aynı TRUNCATE
// deseni). GERİ ALINAMAZ -- client tarafında çift onay isteniyor (bkz.
// AdminPanel.tsx).
// ---------------------------------------------------------------------------
adminRouter.post("/reset-game", requireAdmin, async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE TABLE
         tile_reinforcements, scout_reports, player_reports, battle_log,
         attack_orders, reinforcement_orders, guild_invites, guild_members,
         guilds, tiles, players
       RESTART IDENTITY CASCADE`
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ error: "Sunucu hatası." });
  } finally {
    client.release();
  }

  try {
    const settings = await loadSettings();
    await ensureMapGenerated(settings);
  } catch (err) {
    console.error("[admin] reset-game sonrası harita üretimi başarısız oldu:", err);
    return res.status(500).json({
      error: "Oyun verisi silindi ama harita yeniden üretilemedi -- sunucu loglarını kontrol et.",
    });
  }

  res.json({ ok: true });
});
