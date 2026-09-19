import { Router } from "express";
import { pool } from "../db.js";
import { authenticate } from "./players.js";
import { computeLiveResources, productionForLevel, upgradeCost } from "../game/resources.js";
import { resolveCombat } from "../game/combat.js";
import { loadSettings } from "../game/settings.js";
import type { Settings } from "../game/settings.js";
import type { Player, TileRow } from "../types.js";

export const tilesRouter = Router();

function serializeTile(tile: TileRow, settings: Settings, now: number) {
  const live = computeLiveResources(tile, settings, now);
  return {
    id: tile.id,
    x: tile.x,
    y: tile.y,
    ownerId: tile.owner_id,
    tileType: tile.tile_type,
    level: tile.level,
    goldPerHour: tile.gold_per_hour,
    troopsPerHour: tile.troops_per_hour,
    gold: Math.floor(live.gold),
    troops: Math.floor(live.troops),
  };
}

// Public: full map view (used to render the grid)
tilesRouter.get("/", async (_req, res) => {
  try {
    const now = Date.now();
    const settings = await loadSettings();
    const { rows } = await pool.query<TileRow>("SELECT * FROM tiles");
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

    const live = computeLiveResources(tile, settings, now);
    const cost = upgradeCost(tile.level, settings);
    if (live.gold < cost) {
      return res.status(400).json({ error: `Yetersiz altın. Gerekli: ${cost}` });
    }

    const newLevel = tile.level + 1;
    const production = productionForLevel(newLevel, settings);

    const { rows: updatedRows } = await pool.query<TileRow>(
      `UPDATE tiles
       SET level = $1, gold_per_hour = $2, troops_per_hour = $3,
           stored_gold = $4, stored_troops = $5, last_collected_at = $6
       WHERE id = $7
       RETURNING *`,
      [newLevel, production.gold_per_hour, production.troops_per_hour, live.gold - cost, live.troops, now, tileId]
    );

    res.json(serializeTile(updatedRows[0], settings, now));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

function isAdjacent(a: TileRow, b: TileRow) {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && a.id !== b.id;
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
    if (targetTile.owner_id === player.id)
      return res.status(400).json({ error: "Kendi karene saldıramazsın." });
    if (!isAdjacent(fromTile, targetTile))
      return res.status(400).json({ error: "Sadece komşu karelere saldırabilirsin." });

    const fromLive = computeLiveResources(fromTile, settings, now);
    const troopsSent = Math.floor(troopsSentRaw);
    if (!troopsSent || troopsSent <= 0 || troopsSent > fromLive.troops) {
      return res.status(400).json({ error: "Geçersiz asker sayısı." });
    }

    const targetLive = computeLiveResources(targetTile, settings, now);
    const combat = resolveCombat(troopsSent, targetLive.troops, settings);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
        [fromLive.troops - troopsSent, now, fromTile.id]
      );

      if (combat.attackerWins) {
        const production = productionForLevel(targetTile.level, settings);
        await client.query(
          `UPDATE tiles
           SET owner_id = $1, tile_type = 'PLAYER',
               gold_per_hour = $2, troops_per_hour = $3,
               stored_gold = 0, stored_troops = $4, last_collected_at = $5
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
