import { Router } from "express";
import { pool } from "../db.js";
import { authenticate } from "./players.js";
import { computeLivePlayerGold, computeLiveTroops, productionForLevel, upgradeCost } from "../game/resources.js";
import { getTotalGoldPerHour, settlePlayerGold } from "../game/economy.js";
import { resolveCombat } from "../game/combat.js";
import { loadSettings } from "../game/settings.js";
import type { Settings } from "../game/settings.js";
import type { Player, TileRow } from "../types.js";

export const tilesRouter = Router();

// Altın artık kale başına değil, oyuncunun ortak havuzunda tutulduğu için
// bir karonun kendi "gold" alanı yok — sadece üretim hızı (goldPerHour) ve
// (kale ise) canlı asker sayısı gösterilir.
function serializeTile(tile: TileRow, settings: Settings, now: number) {
  const troops = computeLiveTroops(tile, settings, now);
  return {
    id: tile.id,
    x: tile.x,
    y: tile.y,
    islandId: tile.island_id,
    ownerId: tile.owner_id,
    tileType: tile.tile_type,
    level: tile.level,
    goldPerHour: tile.gold_per_hour,
    troopsPerHour: tile.troops_per_hour,
    troops: Math.floor(troops),
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

// Public: harita görünümü — bbox verilirse sadece o bölge, verilmezse tüm harita.
tilesRouter.get("/", async (req, res) => {
  try {
    const now = Date.now();
    const settings = await loadSettings();
    const bbox = parseBoundingBox(req);
    const { rows } = bbox
      ? await pool.query<TileRow>(
          "SELECT * FROM tiles WHERE x BETWEEN $1 AND $2 AND y BETWEEN $3 AND $4",
          [bbox.minX, bbox.maxX, bbox.minY, bbox.maxY]
        )
      : await pool.query<TileRow>("SELECT * FROM tiles");
    res.json(rows.map((t) => serializeTile(t, settings, now)));
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
    const { rows } = await pool.query<TileRow>("SELECT * FROM tiles WHERE owner_id = $1", [
      player.id,
    ]);
    res.json(rows.map((t) => serializeTile(t, settings, now)));
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
      res.json(serializeTile(updatedRows[0], settings, now));
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

// Kendi kaleleri arasında asker takviyesi (Madde 3). Asker üretimi kaleye
// özel kaldığı için oyuncu kendi kaleleri arasında serbestçe asker
// aktarabilmeli. Şimdilik anında ve mesafe sınırı yok — mesafeye bağlı
// süre/menzil kısıtı ileride saldırı/casusluk gibi özelliklerle birlikte
// eklenecek.
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
    if (targetTile.owner_id !== player.id)
      return res.status(403).json({ error: "Sadece kendi kalelerin arasında takviye yapabilirsin." });

    const fromLiveTroops = computeLiveTroops(fromTile, settings, now);
    const troopsSent = Math.floor(troopsSentRaw);
    if (!troopsSent || troopsSent <= 0 || troopsSent > fromLiveTroops) {
      return res.status(400).json({ error: "Geçersiz asker sayısı." });
    }
    const targetLiveTroops = computeLiveTroops(targetTile, settings, now);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
        [fromLiveTroops - troopsSent, now, fromTile.id]
      );
      await client.query(
        "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
        [targetLiveTroops + troopsSent, now, targetTile.id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json(serializeTile({ ...targetTile, stored_troops: targetLiveTroops + troopsSent, last_collected_at: now }, settings, now));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

function isAdjacent(a: TileRow, b: TileRow) {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && a.id !== b.id;
}

function tileDistance(a: TileRow, b: TileRow) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Same island: must be directly touching (contiguous land expansion, as
// before). Different island: reachable within the admin-configured naval
// range, representing ships crossing open water — no adjacency required.
function canReach(from: TileRow, target: TileRow, settings: Settings) {
  if (from.island_id === target.island_id) {
    return isAdjacent(from, target);
  }
  return tileDistance(from, target) <= settings.naval_attack_range;
}

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

    const targetLiveTroops = computeLiveTroops(targetTile, settings, now);
    const combat = resolveCombat(troopsSent, targetLiveTroops, settings);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
        [fromLive - troopsSent, now, fromTile.id]
      );

      if (combat.attackerWins) {
        // Fetih, hem saldıranın hem de (eğer varsa) eski sahibinin toplam
        // altın/saat üretimini değiştirir — üretim hızı değişmeden hemen
        // önce, ortak altın havuzlarını ESKİ hızla şu ana kadar işletip
        // kalıcı hale getiriyoruz.
        await settlePlayerGold(client, player, settings, now);
        if (targetTile.tile_type === "PLAYER" && targetTile.owner_id) {
          const { rows: ownerRows } = await client.query<Player>(
            "SELECT * FROM players WHERE id = $1",
            [targetTile.owner_id]
          );
          const previousOwner = ownerRows[0];
          if (previousOwner) await settlePlayerGold(client, previousOwner, settings, now);
        }

        const production = productionForLevel(targetTile.level, settings);
        await client.query(
          `UPDATE tiles
           SET owner_id = $1, tile_type = 'PLAYER',
               gold_per_hour = $2, troops_per_hour = $3,
               stored_troops = $4, last_collected_at = $5
           WHERE id = $6`,
          [player.id, production.gold_per_hour, production.troops_per_hour, combat.survivingAttackerTroops, now, targetTile.id]
        );
      } else {
        await client.query(
          "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
          [combat.survivingDefenderTroops, now, targetTile.id]
        );
      }

      await client.query(
        `INSERT INTO battle_log (attacker_id, defender_tile_id, attacker_power, defender_power, result, troops_sent, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          player.id,
          targetTile.id,
          combat.attackerPower,
          combat.defenderPower,
          combat.attackerWins ? "ATTACKER_WINS" : "DEFENDER_WINS",
          troopsSent,
          now,
        ]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({
      result: combat.attackerWins ? "ATTACKER_WINS" : "DEFENDER_WINS",
      attackerPower: combat.attackerPower,
      defenderPower: combat.defenderPower,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});
