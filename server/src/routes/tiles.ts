import { Router } from "express";
import { db } from "../db.js";
import { authenticate } from "./players.js";
import { computeLiveResources, productionForLevel, upgradeCost } from "../game/resources.js";
import { resolveCombat } from "../game/combat.js";
import type { Player, TileRow } from "../types.js";

export const tilesRouter = Router();

function serializeTile(tile: TileRow, now: number) {
  const live = computeLiveResources(tile, now);
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
tilesRouter.get("/", (_req, res) => {
  const now = Date.now();
  const tiles = db.prepare("SELECT * FROM tiles").all() as TileRow[];
  res.json(tiles.map((t) => serializeTile(t, now)));
});

tilesRouter.get("/me", authenticate, (req: any, res) => {
  const player = req.player as Player;
  const now = Date.now();
  const tiles = db
    .prepare("SELECT * FROM tiles WHERE owner_id = ?")
    .all(player.id) as TileRow[];
  res.json(tiles.map((t) => serializeTile(t, now)));
});

tilesRouter.post("/:id/upgrade", authenticate, (req: any, res) => {
  const player = req.player as Player;
  const tileId = Number(req.params.id);
  const now = Date.now();

  const tile = db.prepare("SELECT * FROM tiles WHERE id = ?").get(tileId) as
    | TileRow
    | undefined;
  if (!tile) return res.status(404).json({ error: "Kare bulunamadı." });
  if (tile.owner_id !== player.id)
    return res.status(403).json({ error: "Bu kare sana ait değil." });

  const live = computeLiveResources(tile, now);
  const cost = upgradeCost(tile.level);
  if (live.gold < cost) {
    return res.status(400).json({ error: `Yetersiz altın. Gerekli: ${cost}` });
  }

  const newLevel = tile.level + 1;
  const production = productionForLevel(newLevel);

  db.prepare(`
    UPDATE tiles
    SET level = ?, gold_per_hour = ?, troops_per_hour = ?,
        stored_gold = ?, stored_troops = ?, last_collected_at = ?
    WHERE id = ?
  `).run(
    newLevel,
    production.gold_per_hour,
    production.troops_per_hour,
    live.gold - cost,
    live.troops,
    now,
    tileId
  );

  const updated = db.prepare("SELECT * FROM tiles WHERE id = ?").get(tileId) as TileRow;
  res.json(serializeTile(updated, now));
});

function isAdjacent(a: TileRow, b: TileRow) {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && a.id !== b.id;
}

tilesRouter.post("/:id/attack", authenticate, (req: any, res) => {
  const player = req.player as Player;
  const targetId = Number(req.params.id);
  const fromTileId = Number(req.body?.fromTileId);
  const troopsSentRaw = Number(req.body?.troopsSent);
  const now = Date.now();

  const fromTile = db.prepare("SELECT * FROM tiles WHERE id = ?").get(fromTileId) as
    | TileRow
    | undefined;
  const targetTile = db.prepare("SELECT * FROM tiles WHERE id = ?").get(targetId) as
    | TileRow
    | undefined;

  if (!fromTile || !targetTile)
    return res.status(404).json({ error: "Kare bulunamadı." });
  if (fromTile.owner_id !== player.id)
    return res.status(403).json({ error: "Saldırı başlatılan kare sana ait değil." });
  if (targetTile.owner_id === player.id)
    return res.status(400).json({ error: "Kendi karene saldıramazsın." });
  if (!isAdjacent(fromTile, targetTile))
    return res.status(400).json({ error: "Sadece komşu karelere saldırabilirsin." });

  const fromLive = computeLiveResources(fromTile, now);
  const troopsSent = Math.floor(troopsSentRaw);
  if (!troopsSent || troopsSent <= 0 || troopsSent > fromLive.troops) {
    return res.status(400).json({ error: "Geçersiz asker sayısı." });
  }

  const targetLive = computeLiveResources(targetTile, now);
  const combat = resolveCombat(troopsSent, targetLive.troops);

  const tx = db.transaction(() => {
    // Deduct sent troops from attacker's origin tile
    db.prepare(`
      UPDATE tiles SET stored_troops = ?, last_collected_at = ? WHERE id = ?
    `).run(fromLive.troops - troopsSent, now, fromTile.id);

    if (combat.attackerWins) {
      const production = productionForLevel(targetTile.level);
      db.prepare(`
        UPDATE tiles
        SET owner_id = ?, tile_type = 'PLAYER',
            gold_per_hour = ?, troops_per_hour = ?,
            stored_gold = 0, stored_troops = ?, last_collected_at = ?
        WHERE id = ?
      `).run(
        player.id,
        production.gold_per_hour,
        production.troops_per_hour,
        combat.survivingAttackerTroops,
        now,
        targetTile.id
      );
    } else {
      db.prepare(`
        UPDATE tiles SET stored_troops = ?, last_collected_at = ? WHERE id = ?
      `).run(combat.survivingDefenderTroops, now, targetTile.id);
    }

    db.prepare(`
      INSERT INTO battle_log (attacker_id, defender_tile_id, attacker_power, defender_power, result, troops_sent, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      player.id,
      targetTile.id,
      combat.attackerPower,
      combat.defenderPower,
      combat.attackerWins ? "ATTACKER_WINS" : "DEFENDER_WINS",
      troopsSent,
      now
    );
  });
  tx();

  res.json({
    result: combat.attackerWins ? "ATTACKER_WINS" : "DEFENDER_WINS",
    attackerPower: combat.attackerPower,
    defenderPower: combat.defenderPower,
  });
});
