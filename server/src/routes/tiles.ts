import { Router } from "express";
import { pool } from "../db.js";
import { authenticate, optionalAuthenticate } from "./players.js";
import { computeLivePlayerGold, computeLiveTroops, productionForLevel, upgradeCost } from "../game/resources.js";
import { getTotalGoldPerHour } from "../game/economy.js";
import { travelDurationMs } from "../game/attacks.js";
import { loadSettings } from "../game/settings.js";
import { addReport } from "../game/reports.js";
import type { Settings } from "../game/settings.js";
import type { Player, TileRow } from "../types.js";

export const tilesRouter = Router();

interface ReinforcementInfo {
  id: number;
  fromPlayerId: string;
  fromUsername: string;
  troops: number;
}

interface ScoutSnapshot {
  level: number;
  troops: number;
  gold_per_hour: number;
  troops_per_hour: number;
  owner_username: string | null;
  scouted_at: number;
}

// Haritayı görüntüleyenin (varsa) kendi kimliği + klanı: kendi/klan
// kaleleri her zaman canlı bilgiyle, geri kalan (düşman oyuncu/NPC) kaleler
// sadece gözcülenmişse görünür (bkz. serializeTile'daki "vis" parametresi).
interface VisibilityContext {
  viewerId: string | null;
  guildIds: Set<string>;
  scoutMap: Map<number, ScoutSnapshot>;
}

async function fetchGuildMemberIds(playerId: string | null): Promise<Set<string>> {
  if (!playerId) return new Set();
  const { rows } = await pool.query<{ player_id: string }>(
    `SELECT gm2.player_id FROM guild_members gm1
     JOIN guild_members gm2 ON gm1.guild_id = gm2.guild_id
     WHERE gm1.player_id = $1`,
    [playerId]
  );
  return new Set(rows.map((r) => r.player_id));
}

async function fetchScoutMap(viewerId: string | null, tileIds: number[]): Promise<Map<number, ScoutSnapshot>> {
  const map = new Map<number, ScoutSnapshot>();
  if (!viewerId || tileIds.length === 0) return map;
  const { rows } = await pool.query<ScoutSnapshot & { tile_id: number }>(
    `SELECT tile_id, level, troops, gold_per_hour, troops_per_hour, owner_username, scouted_at
     FROM scout_reports WHERE scout_player_id = $1 AND tile_id = ANY($2)`,
    [viewerId, tileIds]
  );
  for (const r of rows) map.set(r.tile_id, r);
  return map;
}

// Bir veya birden fazla karo için klan takviyesi kayıtlarını TEK sorguda
// toplu çeker (N+1 sorgu olmasın diye) -- tile_id -> takviye listesi.
async function fetchReinforcementsMap(tileIds: number[]): Promise<Map<number, ReinforcementInfo[]>> {
  const map = new Map<number, ReinforcementInfo[]>();
  if (tileIds.length === 0) return map;
  const { rows } = await pool.query<{
    id: number;
    tile_id: number;
    from_player_id: string;
    from_username: string;
    troops: number;
  }>(
    `SELECT tr.id, tr.tile_id, tr.from_player_id, p.username as from_username, tr.troops
     FROM tile_reinforcements tr
     JOIN players p ON p.id = tr.from_player_id
     WHERE tr.tile_id = ANY($1)`,
    [tileIds]
  );
  for (const r of rows) {
    const list = map.get(r.tile_id) ?? [];
    list.push({ id: r.id, fromPlayerId: r.from_player_id, fromUsername: r.from_username, troops: Number(r.troops) });
    map.set(r.tile_id, list);
  }
  return map;
}

async function sameGuild(playerIdA: string, playerIdB: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM guild_members gm1
     JOIN guild_members gm2 ON gm1.guild_id = gm2.guild_id
     WHERE gm1.player_id = $1 AND gm2.player_id = $2`,
    [playerIdA, playerIdB]
  );
  return rows.length > 0;
}

// Altın artık kale başına değil, oyuncunun ortak havuzunda tutulduğu için
// bir karonun kendi "gold" alanı yok — sadece üretim hızı (goldPerHour) ve
// (kale ise) canlı asker sayısı gösterilir. `reinforcements`: klan
// arkadaşlarından gelen, sahiplenilemeyen (sadece savunma için) takviye
// askerleri -- bu askerler `troops` alanına dahil DEĞİL, ayrı gösteriliyor.
//
// Gözcü/casusluk sistemi (Eren'in isteği): `vis` verilmişse (harita
// görünümü GET /) kendi/klan kaleleri hâlâ CANLI bilgiyle gösterilir, ama
// düşman oyuncu ya da NPC kaleleri sadece o kareye daha önce gözcü
// gönderilmişse (scout_reports'ta bir kayıt varsa) görünür -- ve o zaman da
// CANLI değil, gözcünün gönderildiği ANDAKİ donmuş bilgiyle. `vis`
// verilmezse (upgrade/reinforce/attack/scout gibi doğrudan eylem yanıtları,
// veya GET /me) hep tam görünür -- zaten oyuncunun kendi eylemiyle ilgili
// bir kareyi görüyor. Seviye (level) her zaman herkese açık.
function serializeTile(
  tile: TileRow & { owner_username?: string | null },
  settings: Settings,
  now: number,
  reinforcements: ReinforcementInfo[] = [],
  vis?: VisibilityContext
) {
  const isMineOrGuild =
    !vis || tile.tile_type === "EMPTY" || (!!tile.owner_id && (tile.owner_id === vis.viewerId || vis.guildIds.has(tile.owner_id)));

  let troops: number | null;
  let goldPerHour: number | null;
  let troopsPerHour: number | null;
  let reinforcementTroops = 0;
  let reinforcementsOut: { id: number; fromPlayerId: string; fromUsername: string; troops: number }[] = [];
  let scoutedAt: number | null = null;

  if (isMineOrGuild) {
    troops = Math.floor(computeLiveTroops(tile, settings, now));
    goldPerHour = tile.gold_per_hour;
    troopsPerHour = tile.troops_per_hour;
    reinforcementTroops = Math.floor(reinforcements.reduce((sum, r) => sum + r.troops, 0));
    reinforcementsOut = reinforcements.map((r) => ({ ...r, troops: Math.floor(r.troops) }));
  } else {
    const snap = vis!.scoutMap.get(tile.id);
    if (snap) {
      troops = Math.floor(snap.troops);
      goldPerHour = snap.gold_per_hour;
      troopsPerHour = snap.troops_per_hour;
      scoutedAt = Number(snap.scouted_at);
    } else {
      troops = null;
      goldPerHour = null;
      troopsPerHour = null;
    }
  }

  return {
    id: tile.id,
    x: tile.x,
    y: tile.y,
    islandId: tile.island_id,
    ownerId: tile.owner_id,
    // Eren: yeni altıgen aksiyon menüsündeki üst "banner" için -- kale
    // sahibinin kullanıcı adı, seviye gibi her zaman herkese açık (istihbarat
    // gerekmiyor, sadece KİM'in kalesi olduğunu gösteriyor -- asker/altın
    // gibi hassas bilgiler hâlâ gözcü/klan kuralına tabi).
    ownerUsername: tile.owner_username ?? null,
    tileType: tile.tile_type,
    level: tile.level,
    goldPerHour,
    troopsPerHour,
    troops,
    reinforcementTroops,
    reinforcements: reinforcementsOut,
    scoutedAt,
  };
}

// Dünya büyüdükçe (binlerce karo) tüm haritayı her seferinde çekmek hem API
// yanıtını hem de istemci tarafında çizilen DOM eleman sayısını şişirir.
// Bu yüzden istemci sadece o an ekranda görünen bölgeyi (+ küçük bir pay)
// minX/maxX/minY/maxY ile isteyebiliyor. Parametre verilmezse (geriye dönük
// uyumluluk için) tüm harita döner — küçük haritalarda/testte hâlâ işe yarar.
const MAX_BBOX_SPAN = 200;

function parseBoundingBox(req: import("express").Request) {
  const { minX, maxX, minY, maxY } = req.query;
  if (minX === undefined && maxX === undefined && minY === undefined && maxY === undefined) {
    return null;
  }
  const nMinX = Number(minX);
  const nMaxX = Number(maxX);
  const nMinY = Number(minY);
  const nMaxY = Number(maxY);
  if ([nMinX, nMaxX, nMinY, nMaxY].some((n) => !Number.isFinite(n))) {
    return null;
  }
  // Aşırı geniş bir bbox istenirse (kötü niyetli ya da hatalı istemci)
  // sunucuyu tüm haritayı dönmeye zorlamasın diye sınırlıyoruz.
  const clampedMaxX = Math.min(nMaxX, nMinX + MAX_BBOX_SPAN);
  const clampedMaxY = Math.min(nMaxY, nMinY + MAX_BBOX_SPAN);
  return { minX: nMinX, maxX: clampedMaxX, minY: nMinY, maxY: clampedMaxY };
}

// Public: harita görünümü — bbox verilirse sadece o bölge, verilmezse tüm
// harita. Token varsa (optionalAuthenticate) gözcü/klan görünürlüğü
// uygulanır; yoksa hiçbir kale bilgisi (asker/üretim) görünmez, sadece
// seviye ve tür (herkese açık).
tilesRouter.get("/", optionalAuthenticate, async (req: any, res) => {
  try {
    const viewer = req.player as Player | undefined;
    const now = Date.now();
    const settings = await loadSettings();
    const bbox = parseBoundingBox(req);
    // Eren'in isteği: yeni aksiyon menüsü banner'ında kalenin sahibinin adı
    // görünüyor -- players tablosuna LEFT JOIN ile tek sorguda ekleniyor
    // (N+1 sorgu yok, boş/NPC karolarda owner_id NULL olduğu için
    // owner_username de doğal olarak NULL geliyor).
    const { rows } = bbox
      ? await pool.query<TileRow & { owner_username: string | null }>(
          `SELECT t.*, p.username AS owner_username
           FROM tiles t LEFT JOIN players p ON p.id = t.owner_id
           WHERE t.x BETWEEN $1 AND $2 AND t.y BETWEEN $3 AND $4`,
          [bbox.minX, bbox.maxX, bbox.minY, bbox.maxY]
        )
      : await pool.query<TileRow & { owner_username: string | null }>(
          `SELECT t.*, p.username AS owner_username
           FROM tiles t LEFT JOIN players p ON p.id = t.owner_id`
        );
    const tileIds = rows.map((t) => t.id);
    const [reinforcementMap, guildIds, scoutMap] = await Promise.all([
      fetchReinforcementsMap(tileIds),
      fetchGuildMemberIds(viewer?.id ?? null),
      fetchScoutMap(viewer?.id ?? null, tileIds),
    ]);
    const vis: VisibilityContext = { viewerId: viewer?.id ?? null, guildIds, scoutMap };
    res.json(rows.map((t) => serializeTile(t, settings, now, reinforcementMap.get(t.id), vis)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

tilesRouter.get("/me", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const now = Date.now();
    const settings = await loadSettings();
    const { rows } = await pool.query<TileRow & { owner_username: string | null }>(
      `SELECT t.*, p.username AS owner_username
       FROM tiles t LEFT JOIN players p ON p.id = t.owner_id
       WHERE t.owner_id = $1`,
      [player.id]
    );
    const reinforcementMap = await fetchReinforcementsMap(rows.map((t) => t.id));
    res.json(rows.map((t) => serializeTile(t, settings, now, reinforcementMap.get(t.id))));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

tilesRouter.post("/:id/upgrade", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const tileId = Number(req.params.id);
    const now = Date.now();
    const settings = await loadSettings();

    const { rows } = await pool.query<TileRow>("SELECT * FROM tiles WHERE id = $1", [tileId]);
    const tile = rows[0];
    if (!tile) return res.status(404).json({ error: "Kare bulunamadı." });
    if (tile.owner_id !== player.id)
      return res.status(403).json({ error: "Bu kare sana ait değil." });

    // Maliyeti düşmeden önce ortak altın havuzunu ŞU ANKİ (henüz
    // değişmemiş) üretim hızıyla güncel değerine getiriyoruz.
    const goldPerHour = await getTotalGoldPerHour(player.id);
    const liveGold = computeLivePlayerGold(player, goldPerHour, settings, now);
    const cost = upgradeCost(tile.level, settings);
    if (liveGold < cost) {
      return res.status(400).json({ error: `Yetersiz altın. Gerekli: ${cost}` });
    }

    const newLevel = tile.level + 1;
    const production = productionForLevel(newLevel, settings);
    const liveTroops = computeLiveTroops(tile, settings, now);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE players SET gold = $1, gold_collected_at = $2 WHERE id = $3", [
        liveGold - cost,
        now,
        player.id,
      ]);
      const { rows: updatedRows } = await client.query<TileRow>(
        `UPDATE tiles
         SET level = $1, gold_per_hour = $2, troops_per_hour = $3,
             stored_troops = $4, last_collected_at = $5
         WHERE id = $6
         RETURNING *`,
        [newLevel, production.gold_per_hour, production.troops_per_hour, liveTroops, now, tileId]
      );
      await client.query("COMMIT");
      const reinforcements = (await fetchReinforcementsMap([tileId])).get(tileId);
      res.json(serializeTile(updatedRows[0], settings, now, reinforcements));
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Asker takviyesi (Madde: klan arkadaşlarına destek). İki durum var:
//  1) Hedef KENDİ kalen -> askerler doğrudan hedefin stored_troops'una
//     karışır (zaten senin ordun, aynı krallık içi yeniden konuşlanma).
//  2) Hedef bir KLAN ARKADAŞININ kalesi -> askerler hedefin stored_troops'una
//     KARIŞMAZ (Eren'in isteği: "sahiplenemezler, sadece savunma için") --
//     ayrı bir tile_reinforcements satırı olarak tutulur, savunma gücüne
//     eklenir ve gönderen istediği an geri çağırabilir (bkz. /recall).
// Şimdilik anında ve mesafe sınırı yok — mesafeye bağlı süre/menzil kısıtı
// ileride saldırı/casusluk gibi özelliklerle birlikte eklenecek.
tilesRouter.post("/:id/reinforce", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const targetId = Number(req.params.id);
    const fromTileId = Number(req.body?.fromTileId);
    const troopsSentRaw = Number(req.body?.troopsSent);
    const now = Date.now();
    const settings = await loadSettings();

    if (fromTileId === targetId) {
      return res.status(400).json({ error: "Aynı kaleye takviye gönderilemez." });
    }

    const [{ rows: fromRows }, { rows: targetRows }] = await Promise.all([
      pool.query<TileRow>("SELECT * FROM tiles WHERE id = $1", [fromTileId]),
      pool.query<TileRow>("SELECT * FROM tiles WHERE id = $1", [targetId]),
    ]);
    const fromTile = fromRows[0];
    const targetTile = targetRows[0];

    if (!fromTile || !targetTile) return res.status(404).json({ error: "Kare bulunamadı." });
    if (fromTile.owner_id !== player.id)
      return res.status(403).json({ error: "Gönderen kale sana ait değil." });
    if (!targetTile.owner_id) {
      return res.status(400).json({ error: "Sahipsiz bir kareye takviye gönderilemez." });
    }

    const isSelf = targetTile.owner_id === player.id;
    const isGuildmate = !isSelf && (await sameGuild(player.id, targetTile.owner_id));
    if (!isSelf && !isGuildmate) {
      return res
        .status(403)
        .json({ error: "Sadece kendi kalelerine veya klan arkadaşlarının kalelerine takviye gönderebilirsin." });
    }

    const fromLiveTroops = computeLiveTroops(fromTile, settings, now);
    const troopsSent = Math.floor(troopsSentRaw);
    if (!troopsSent || troopsSent <= 0 || troopsSent > fromLiveTroops) {
      return res.status(400).json({ error: "Geçersiz asker sayısı." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
        [fromLiveTroops - troopsSent, now, fromTile.id]
      );

      if (isSelf) {
        const targetLiveTroops = computeLiveTroops(targetTile, settings, now);
        await client.query(
          "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
          [targetLiveTroops + troopsSent, now, targetTile.id]
        );
      } else {
        await client.query(
          `INSERT INTO tile_reinforcements (tile_id, from_player_id, from_tile_id, troops, sent_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [targetTile.id, player.id, fromTile.id, troopsSent, now]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const { rows: freshTargetRows } = await pool.query<TileRow>("SELECT * FROM tiles WHERE id = $1", [targetTile.id]);
    const reinforcements = (await fetchReinforcementsMap([targetTile.id])).get(targetTile.id);
    res.json(serializeTile(freshTargetRows[0], settings, now, reinforcements));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Klan arkadaşına gönderilen (henüz savaşta kaybedilmemiş) takviyeyi geri
// çağırma. Sadece gönderen kişi çağırabilir. Askerler, gönderildiği kale
// hâlâ gönderenin ise oraya, değilse gönderenin herhangi bir kalesine döner.
tilesRouter.post("/reinforcements/:id/recall", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const reinforcementId = Number(req.params.id);
    const now = Date.now();
    const settings = await loadSettings();

    const { rows } = await pool.query<{
      id: number;
      tile_id: number;
      from_player_id: string;
      from_tile_id: number;
      troops: number;
    }>("SELECT * FROM tile_reinforcements WHERE id = $1", [reinforcementId]);
    const reinforcement = rows[0];
    if (!reinforcement) return res.status(404).json({ error: "Takviye bulunamadı (belki zaten geri çağrıldı ya da savaşta kaybedildi)." });
    if (reinforcement.from_player_id !== player.id) {
      return res.status(403).json({ error: "Sadece kendi gönderdiğin takviyeyi geri çağırabilirsin." });
    }

    let destTileId = reinforcement.from_tile_id;
    const { rows: destRows } = await pool.query<TileRow>(
      "SELECT * FROM tiles WHERE id = $1 AND owner_id = $2",
      [destTileId, player.id]
    );
    let destTile = destRows[0];
    if (!destTile) {
      const { rows: anyOwnedRows } = await pool.query<TileRow>(
        "SELECT * FROM tiles WHERE owner_id = $1 LIMIT 1",
        [player.id]
      );
      destTile = anyOwnedRows[0];
      if (!destTile) {
        return res.status(400).json({ error: "Askerlerini geri çağırmak için en az bir kalen olmalı." });
      }
      destTileId = destTile.id;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const destLiveTroops = computeLiveTroops(destTile, settings, now);
      await client.query(
        "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
        [destLiveTroops + Number(reinforcement.troops), now, destTileId]
      );
      await client.query("DELETE FROM tile_reinforcements WHERE id = $1", [reinforcementId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true, returnedTo: destTileId, troops: Math.floor(Number(reinforcement.troops)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Eren: harita altıgene çevrildi -- x,y artık axial hex koordinatı (q,r),
// düz Öklid mesafesi (Math.hypot) artık YANLIŞ sonuç verir (axial eksenler
// birbirine dik değil). Standart axial hex mesafe formülü kullanılıyor --
// bkz. https://www.redblobgames.com/grids/hexagons/#distances-axial
function tileDistance(a: TileRow, b: TileRow) {
  const dq = a.x - b.x;
  const dr = a.y - b.y;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// BUG FİX (Eren): naval_attack_range sadece FARKLI adadaki bir kareye
// saldırırken (deniz aşımı) uygulanmalı -- aynı adadaki herhangi bir kareye
// (komşu olsun olmasın) HER ZAMAN, bu sınırdan tamamen bağımsız
// saldırılabilmeli. Önceki sürüm aynı adada da "isAdjacent" (sadece bitişik
// karo) şartı arıyordu, bu da aynı adadaki uzak bir NPC'ye ulaşılamaması
// gibi "mesafe sınırı" hissi veren bir kısıtlamaya yol açıyordu.
function canReach(from: TileRow, target: TileRow, settings: Settings) {
  if (from.island_id === target.island_id) return true;
  return tileDistance(from, target) <= settings.naval_attack_range;
}

// Eren: "Oyunda artık saldırılar zamanlamalı olsun. Direk tıkla saldır değil
// ve saldırdığın kaleden saldırdığın kaleye gidildiğini belli eden bir
// saldırı hattı olsun" -- bu uç nokta artık çarpışmayı ANINDA çözmüyor,
// sadece askerleri kaynak kaleden düşüp bir "yolda" (attack_orders) kaydı
// açıyor ve o kaydın kendisini dönüyor. Asıl çarpışma askerler fiilen
// ulaştığında arka planda çözülüyor (bkz. game/attacks.ts
// resolveDueAttackOrders, index.ts'teki periyodik tur) -- sonuç saldırana
// (ve savunuyorsa savunana) mesaj/rapor kutusuna düşüyor.
tilesRouter.post("/:id/attack", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const targetId = Number(req.params.id);
    const fromTileId = Number(req.body?.fromTileId);
    const troopsSentRaw = Number(req.body?.troopsSent);
    const now = Date.now();
    const settings = await loadSettings();

    const [{ rows: fromRows }, { rows: targetRows }] = await Promise.all([
      pool.query<TileRow>("SELECT * FROM tiles WHERE id = $1", [fromTileId]),
      pool.query<TileRow>("SELECT * FROM tiles WHERE id = $1", [targetId]),
    ]);
    const fromTile = fromRows[0];
    const targetTile = targetRows[0];

    if (!fromTile || !targetTile) return res.status(404).json({ error: "Kare bulunamadı." });
    if (fromTile.owner_id !== player.id)
      return res.status(403).json({ error: "Saldırı başlatılan kare sana ait değil." });
    // Madde 4: haritada ilerleme sadece NPC kampları ve gerçek oyuncu
    // kaleleri üzerinden olur — boş (EMPTY) karolara saldırı yok.
    if (targetTile.tile_type === "EMPTY")
      return res
        .status(400)
        .json({ error: "Boş kareye saldırılamaz. Sadece NPC kampına veya bir oyuncunun kalesine saldırabilirsin." });
    if (targetTile.owner_id === player.id)
      return res.status(400).json({ error: "Kendi karene saldıramazsın." });
    if (!canReach(fromTile, targetTile, settings))
      return res.status(400).json({ error: "Bu kareye ulaşamazsın (çok uzak)." });

    const fromLive = computeLiveTroops(fromTile, settings, now);
    const troopsSent = Math.floor(troopsSentRaw);
    if (!troopsSent || troopsSent <= 0 || troopsSent > fromLive) {
      return res.status(400).json({ error: "Geçersiz asker sayısı." });
    }

    const durationMs = travelDurationMs(fromTile, targetTile, settings);
    const arrivesAt = now + durationMs;

    const { rows: orderRows } = await pool.query<{ id: number }>(
      `INSERT INTO attack_orders
         (attacker_id, from_tile_id, target_tile_id, from_x, from_y, target_x, target_y, troops_sent, departed_at, arrives_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [player.id, fromTile.id, targetTile.id, fromTile.x, fromTile.y, targetTile.x, targetTile.y, troopsSent, now, arrivesAt]
    );
    // Askerler yola çıktı -- kaynak kaleden hemen düşülüyor (ordunun geri
    // kalanı yolda gidenler beklemeden büyümeye devam etsin diye
    // last_collected_at da şimdiye çekiliyor, tıpkı takviye/gözcüde olduğu gibi).
    await pool.query(
      "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
      [fromLive - troopsSent, now, fromTile.id]
    );

    res.json({
      orderId: orderRows[0].id,
      fromTileId: fromTile.id,
      targetTileId: targetTile.id,
      fromX: fromTile.x,
      fromY: fromTile.y,
      targetX: targetTile.x,
      targetY: targetTile.y,
      troopsSent,
      departedAt: now,
      arrivesAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Eren: saldırı hattını haritada göstermek için istemcinin sık sık çektiği
// "hâlâ yolda olan" saldırılar. Görüneni sadece kendi saldırıları ve
// kendi/klan kalelerine gelen saldırılarla sınırlıyoruz -- düşmanın haritanın
// tamamen başka bir ucundaki alakasız saldırısını görmesine gerek yok.
tilesRouter.get("/attacks/active", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const guildIds = await fetchGuildMemberIds(player.id);
    const relevantOwnerIds = [player.id, ...Array.from(guildIds)];
    const { rows } = await pool.query<{
      id: number;
      attacker_id: string;
      attacker_username: string;
      from_x: number;
      from_y: number;
      target_x: number;
      target_y: number;
      troops_sent: number;
      departed_at: number;
      arrives_at: number;
    }>(
      `SELECT ao.id, ao.attacker_id, p.username AS attacker_username,
              ao.from_x, ao.from_y, ao.target_x, ao.target_y,
              ao.troops_sent, ao.departed_at, ao.arrives_at
       FROM attack_orders ao
       JOIN players p ON p.id = ao.attacker_id
       WHERE ao.attacker_id = $1
          OR ao.target_tile_id IN (SELECT id FROM tiles WHERE owner_id = ANY($2::text[]))`,
      [player.id, relevantOwnerIds]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        attackerId: r.attacker_id,
        attackerUsername: r.attacker_username,
        fromX: r.from_x,
        fromY: r.from_y,
        targetX: r.target_x,
        targetY: r.target_y,
        troopsSent: Math.floor(Number(r.troops_sent)),
        departedAt: Number(r.departed_at),
        arrivesAt: Number(r.arrives_at),
        isMine: r.attacker_id === player.id,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Gözcü/casusluk: kendi kalenden bir miktar asker göndererek hedef
// karenin ANLIK bilgisini (seviye, toplam asker -- ev garnizonu + klan
// takviyeleri, altın/asker üretimi) öğrenirsin. Gönderilen askerler bir
// keşif/istihbarat maliyeti olarak tüketilir (MVP: risksiz, her zaman
// başarılı -- yakalanma/keşfedilme mekaniği yok). Rapor `scout_reports`'a
// UPSERT edilir: aynı kareye tekrar gözcü göndermeden bilgi GÜNCELLENMEZ
// (Eren'in isteği).
tilesRouter.post("/:id/scout", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const targetId = Number(req.params.id);
    const fromTileId = Number(req.body?.fromTileId);
    const troopsSentRaw = Number(req.body?.troopsSent);
    const now = Date.now();
    const settings = await loadSettings();

    const [{ rows: fromRows }, { rows: targetRows }] = await Promise.all([
      pool.query<TileRow>("SELECT * FROM tiles WHERE id = $1", [fromTileId]),
      pool.query<TileRow>("SELECT * FROM tiles WHERE id = $1", [targetId]),
    ]);
    const fromTile = fromRows[0];
    const targetTile = targetRows[0];

    if (!fromTile || !targetTile) return res.status(404).json({ error: "Kare bulunamadı." });
    if (fromTile.owner_id !== player.id)
      return res.status(403).json({ error: "Gözcü gönderilen kale sana ait değil." });
    if (targetTile.id === fromTile.id)
      return res.status(400).json({ error: "Kendi kaleni gözetlemene gerek yok." });
    if (targetTile.tile_type === "EMPTY")
      return res.status(400).json({ error: "Boş bir kareyi gözetlemeye gerek yok." });
    if (!canReach(fromTile, targetTile, settings))
      return res.status(400).json({ error: "Bu kareye ulaşamazsın (çok uzak)." });

    const fromLive = computeLiveTroops(fromTile, settings, now);
    const troopsSent = Math.floor(troopsSentRaw);
    if (!troopsSent || troopsSent <= 0 || troopsSent > fromLive) {
      return res.status(400).json({ error: "Geçersiz asker sayısı." });
    }

    const targetLive = computeLiveTroops(targetTile, settings, now);
    const { rows: reinforcementRows } = await pool.query<{ troops: number }>(
      "SELECT troops FROM tile_reinforcements WHERE tile_id = $1",
      [targetTile.id]
    );
    const reinforcementTotal = reinforcementRows.reduce((sum, r) => sum + Number(r.troops), 0);
    const totalTroops = targetLive + reinforcementTotal;

    let ownerUsername: string | null = null;
    if (targetTile.owner_id) {
      const { rows: ownerRows } = await pool.query<{ username: string }>(
        "SELECT username FROM players WHERE id = $1",
        [targetTile.owner_id]
      );
      ownerUsername = ownerRows[0]?.username ?? null;
    }

    await pool.query(
      "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
      [fromLive - troopsSent, now, fromTile.id]
    );

    await pool.query(
      `INSERT INTO scout_reports (scout_player_id, tile_id, level, troops, gold_per_hour, troops_per_hour, owner_username, scouted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (scout_player_id, tile_id) DO UPDATE SET
         level = EXCLUDED.level, troops = EXCLUDED.troops, gold_per_hour = EXCLUDED.gold_per_hour,
         troops_per_hour = EXCLUDED.troops_per_hour, owner_username = EXCLUDED.owner_username,
         scouted_at = EXCLUDED.scouted_at`,
      [player.id, targetTile.id, targetTile.level, totalTroops, targetTile.gold_per_hour, targetTile.troops_per_hour, ownerUsername, now]
    );

    const coordText = `(${targetTile.x}, ${targetTile.y})`;
    await addReport(
      player.id,
      "scout_sent",
      "Gözcü raporu",
      `${coordText} karesine gözcü gönderdin: Seviye ${targetTile.level}, ~${Math.floor(totalTroops)} asker, +${Math.floor(targetTile.gold_per_hour)}/sa altın.`,
      now
    ).catch(() => {});
    if (targetTile.owner_id) {
      await addReport(
        targetTile.owner_id,
        "scouted_by",
        "Kalen gözetlendi",
        `${player.username}, ${coordText} karesindeki kaleni gözetledi.`,
        now
      ).catch(() => {});
    }

    res.json({
      ok: true,
      tileId: targetTile.id,
      level: targetTile.level,
      troops: Math.floor(totalTroops),
      goldPerHour: targetTile.gold_per_hour,
      troopsPerHour: targetTile.troops_per_hour,
      scoutedAt: now,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});
