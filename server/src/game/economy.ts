import { pool } from "../db.js";
import type { Player } from "../types.js";
import type { Settings } from "./settings.js";
import { computeLivePlayerGold } from "./resources.js";

// pg.Pool ve pg.PoolClient'ın ortak arayüzü — hem havuzla hem de bir
// transaction'ın client'ıyla çağrılabilsin diye.
type Queryable = { query: (typeof pool)["query"] };

export async function getTotalGoldPerHour(playerId: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ sum: string }>(
    "SELECT COALESCE(SUM(gold_per_hour), 0)::float8 AS sum FROM tiles WHERE owner_id = $1 AND tile_type = 'PLAYER'",
    [playerId]
  );
  return Number(rows[0].sum);
}

export async function getTotalTroopsPerHour(playerId: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ sum: string }>(
    "SELECT COALESCE(SUM(troops_per_hour), 0)::float8 AS sum FROM tiles WHERE owner_id = $1 AND tile_type = 'PLAYER'",
    [playerId]
  );
  return Number(rows[0].sum);
}

/**
 * Oyuncunun ortak altın havuzunu, hâlâ ESKİ üretim hızıyla şu ana kadar
 * işletip DB'ye yazar (last_collected_at'i şimdiye çeker) ve sonucu döner.
 * Bir kalenin gold_per_hour'ı değişmeden (yükseltme, fetih, kayıp) HEMEN
 * ÖNCE çağrılmalı ki eski hız üzerinden hak edilen altın kaybolmasın.
 */
export async function settlePlayerGold(
  db: Queryable,
  player: Player,
  settings: Settings,
  now: number = Date.now()
): Promise<number> {
  const goldPerHour = await getTotalGoldPerHour(player.id, db);
  const live = computeLivePlayerGold(player, goldPerHour, settings, now);
  await db.query("UPDATE players SET gold = $1, gold_collected_at = $2 WHERE id = $3", [
    live,
    now,
    player.id,
  ]);
  // Aynı obje bu istek içinde tekrar kullanılırsa (ör. iki settle art arda)
  // güncel kalsın diye bellekteki kopyayı da güncelliyoruz.
  player.gold = live;
  player.gold_collected_at = now;
  return live;
}
