import { pool } from "../db.js";
import { computeLiveTroops } from "./resources.js";
import { addReport } from "./reports.js";
import { loadSettings } from "./settings.js";
import type { TileRow } from "../types.js";

// Zamanlı takviye akışı: attack_orders/attacks.ts'in BİREBİR aynı deseni --
// takviye artık anında değil, bir "yolda" (reinforcement_orders) kaydı
// olarak yaşıyor, askerler fiilen ulaştığında (arrives_at geçince) hedefe
// eklenip/tile_reinforcements'a düşüyor (bkz. resolveDueReinforcementOrders,
// index.ts'teki periyodik tur). Eski senkron /reinforce ucundaki "hemen
// uygula" mantığı birebir buraya taşındı.

export interface ReinforcementOrderRow {
  id: number;
  from_player_id: string;
  from_tile_id: number;
  target_tile_id: number;
  from_x: number;
  from_y: number;
  target_x: number;
  target_y: number;
  troops_sent: number;
  departed_at: number;
  arrives_at: number;
}

// routes/tiles.ts'teki sameGuild ile birebir aynı sorgu -- döngüsel
// import'a girmemek için (game/ klasörü routes/'a bağımlı olmamalı, bkz.
// CLAUDE.md mimari notu) burada bağımsız küçük bir kopyası tutuluyor,
// tıpkı attacks.ts'teki tileDistance kopyası gibi.
async function sameGuild(playerIdA: string, playerIdB: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM guild_members gm1
     JOIN guild_members gm2 ON gm1.guild_id = gm2.guild_id
     WHERE gm1.player_id = $1 AND gm2.player_id = $2`,
    [playerIdA, playerIdB]
  );
  return rows.length > 0;
}

export async function resolveDueReinforcementOrders(): Promise<void> {
  const now = Date.now();
  const { rows: due } = await pool.query<ReinforcementOrderRow>(
    "SELECT * FROM reinforcement_orders WHERE arrives_at <= $1 ORDER BY arrives_at ASC LIMIT 50",
    [now]
  );
  for (const order of due) {
    try {
      await resolveOneReinforcementOrder(order, now);
    } catch (err) {
      console.error("[reinforce] takviye çözülürken hata, kayıt atlandı:", order.id, err);
    }
  }
}

export async function resolveOneReinforcementOrder(order: ReinforcementOrderRow, now: number): Promise<void> {
  const settings = await loadSettings();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Kaydı hemen sil -- attacks.ts'teki aynı "tüketildi" işareti.
    const { rowCount } = await client.query("DELETE FROM reinforcement_orders WHERE id = $1", [order.id]);
    if (!rowCount) {
      await client.query("ROLLBACK");
      return;
    }

    const { rows: targetRows } = await client.query<TileRow>(
      "SELECT * FROM tiles WHERE id = $1",
      [order.target_tile_id]
    );
    const targetTile = targetRows[0];
    if (!targetTile) {
      await client.query("COMMIT");
      return;
    }

    const isSelf = targetTile.owner_id === order.from_player_id;
    const isGuildmate = !isSelf && !!targetTile.owner_id && (await sameGuild(order.from_player_id, targetTile.owner_id));

    // Askerler yoldayken hedef artık dost değilse (el değiştirmiş, ya da
    // loncadan ayrılınmış) -- takviyenin bir anlamı kalmadı, askerler
    // gönderenin (hâlâ onunsa) kaynak kalesine, değilse herhangi bir
    // kalesine iade edilir.
    if (!isSelf && !isGuildmate) {
      const { rows: fromRows } = await client.query<TileRow>(
        "SELECT * FROM tiles WHERE id = $1",
        [order.from_tile_id]
      );
      let destTile = fromRows[0]?.owner_id === order.from_player_id ? fromRows[0] : undefined;
      if (!destTile) {
        const { rows: anyOwnedRows } = await client.query<TileRow>(
          "SELECT * FROM tiles WHERE owner_id = $1 LIMIT 1",
          [order.from_player_id]
        );
        destTile = anyOwnedRows[0];
      }
      if (destTile) {
        const liveDest = computeLiveTroops(destTile, settings, now);
        await client.query(
          "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
          [liveDest + order.troops_sent, now, destTile.id]
        );
      }
      await client.query("COMMIT");
      await addReport(
        order.from_player_id,
        "reinforce_returned",
        "Takviye iptal edildi",
        `(${order.target_x}, ${order.target_y}) karesi yolda giderken artık dost olmayan birinin oldu, askerler geri döndü.`,
        now
      ).catch(() => {});
      return;
    }

    if (isSelf) {
      const liveTarget = computeLiveTroops(targetTile, settings, now);
      await client.query(
        "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
        [liveTarget + order.troops_sent, now, targetTile.id]
      );
    } else {
      await client.query(
        `INSERT INTO tile_reinforcements (tile_id, from_player_id, from_tile_id, troops, sent_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetTile.id, order.from_player_id, order.from_tile_id, order.troops_sent, now]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
