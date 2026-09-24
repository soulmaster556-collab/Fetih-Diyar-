import { pool } from "../db.js";
import { computeLiveTroops, productionForLevel } from "./resources.js";
import { settlePlayerGold } from "./economy.js";
import { resolveCombat } from "./combat.js";
import { addReport } from "./reports.js";
import type { Settings } from "./settings.js";
import { loadSettings } from "./settings.js";
import type { Player, TileRow } from "../types.js";

// Zamanlı saldırı akışının tamamı: saldırı anında değil, bir "yolda"
// (attack_orders) kaydı olarak yaşıyor -- süre hesabı + askerler
// ulaştığında (arrives_at geçince) asıl çarpışmanın çözülmesi. Eski senkron
// /attack ucundaki çarpışma mantığı birebir buraya taşındı, tek fark artık
// `now` "isteğin geldiği an" değil "askerlerin fiilen ulaştığı an".

export interface AttackOrderRow {
  id: number;
  attacker_id: string;
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

// tiles.ts'teki canReach/tileDistance ile birebir aynı axial hex mesafe
// formülü -- döngüsel import'a girmemek için burada bağımsız küçük bir kopyası
// tutuluyor (bkz. https://www.redblobgames.com/grids/hexagons/#distances-axial).
function tileDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dq = a.x - b.x;
  const dr = a.y - b.y;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Seyahat süresi: mesafe × (karo başına süre / oyun hızı), ama animasyonun
// her zaman görünür/anlamlı olması için bir taban süreden (attack_min_travel_
// seconds) asla daha kısa değil -- bitişik karodaki bir NPC'ye "saldırı"
// dahi gözle görülür şekilde yola çıkıp ulaşsın istiyoruz.
export function travelDurationMs(
  from: { x: number; y: number },
  target: { x: number; y: number },
  settings: Settings
): number {
  const dist = Math.max(1, tileDistance(from, target));
  const seconds = Math.max(
    settings.attack_min_travel_seconds,
    (dist * settings.attack_travel_seconds_per_tile) / Math.max(0.01, settings.game_speed)
  );
  return seconds * 1000;
}

// Periyodik tur (bkz. index.ts setInterval): süresi dolmuş TÜM siparişleri
// bulup tek tek çözer. Tek seferde en fazla 50 -- olağan koşullarda hiçbir
// zaman bu kadar birikmez, sadece sunucu bir süre kapalı kaldıysa aynı anda
// büyük bir yığın oluşmasın diye bir güvenlik sınırı.
export async function resolveDueAttackOrders(): Promise<void> {
  const now = Date.now();
  const { rows: due } = await pool.query<AttackOrderRow>(
    "SELECT * FROM attack_orders WHERE arrives_at <= $1 ORDER BY arrives_at ASC LIMIT 50",
    [now]
  );
  for (const order of due) {
    try {
      await resolveOneAttackOrder(order, now);
    } catch (err) {
      console.error("[attack] saldırı çözülürken hata, kayıt atlandı:", order.id, err);
    }
  }
}

export async function resolveOneAttackOrder(order: AttackOrderRow, now: number): Promise<void> {
  const settings = await loadSettings();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Kaydı hemen sil -- "tüketildi" işareti, aynı sipariş iki kere
    // çözülemesin (bu proseste zaten mümkün değil, ama gelecekte birden
    // fazla worker olursa güvenli olsun diye).
    const { rowCount } = await client.query("DELETE FROM attack_orders WHERE id = $1", [order.id]);
    if (!rowCount) {
      await client.query("ROLLBACK");
      return;
    }

    const { rows: attackerRows } = await client.query<Player>(
      "SELECT * FROM players WHERE id = $1",
      [order.attacker_id]
    );
    const attacker = attackerRows[0];
    if (!attacker) {
      // Hesap askerler yoldayken silinmiş (admin panelinden) -- askerler
      // kayboldu, çözülecek bir şey kalmadı.
      await client.query("COMMIT");
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

    // Askerler yoldayken hedef zaten SALDIRANIN eline geçmiş olabilir
    // (başka bir fetih ile) -- saldırmanın artık anlamı yok, askerleri
    // kaynağa (hâlâ kendisininse) iade ediyoruz.
    if (targetTile.owner_id === order.attacker_id) {
      const { rows: fromRows } = await client.query<TileRow>(
        "SELECT * FROM tiles WHERE id = $1",
        [order.from_tile_id]
      );
      const fromTile = fromRows[0];
      if (fromTile && fromTile.owner_id === order.attacker_id) {
        const liveFrom = computeLiveTroops(fromTile, settings, now);
        await client.query(
          "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
          [liveFrom + order.troops_sent, now, fromTile.id]
        );
      }
      await client.query("COMMIT");
      await addReport(
        order.attacker_id,
        "attack_lost",
        "Saldırı iptal edildi",
        `(${order.target_x}, ${order.target_y}) karesi yolda giderken zaten senin oldu, askerler geri döndü.`,
        now
      ).catch(() => {});
      return;
    }

    const targetHomeLiveTroops = computeLiveTroops(targetTile, settings, now);
    const { rows: reinforcementRows } = await client.query<{ id: number; troops: number }>(
      "SELECT id, troops FROM tile_reinforcements WHERE tile_id = $1",
      [targetTile.id]
    );
    const reinforcementTotal = reinforcementRows.reduce((sum, r) => sum + Number(r.troops), 0);
    const targetTotalTroops = targetHomeLiveTroops + reinforcementTotal;
    const combat = resolveCombat(order.troops_sent, targetTotalTroops, settings);

    if (combat.attackerWins) {
      await settlePlayerGold(client, attacker, settings, now);
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
        [order.attacker_id, production.gold_per_hour, production.troops_per_hour, combat.survivingAttackerTroops, now, targetTile.id]
      );
      await client.query("DELETE FROM tile_reinforcements WHERE tile_id = $1", [targetTile.id]);
    } else {
      const ratio = targetTotalTroops > 0 ? combat.survivingDefenderTroops / targetTotalTroops : 0;
      await client.query(
        "UPDATE tiles SET stored_troops = $1, last_collected_at = $2 WHERE id = $3",
        [targetHomeLiveTroops * ratio, now, targetTile.id]
      );
      for (const r of reinforcementRows) {
        const survivingTroops = Number(r.troops) * ratio;
        if (survivingTroops < 1) {
          await client.query("DELETE FROM tile_reinforcements WHERE id = $1", [r.id]);
        } else {
          await client.query("UPDATE tile_reinforcements SET troops = $1 WHERE id = $2", [survivingTroops, r.id]);
        }
      }
    }

    await client.query(
      `INSERT INTO battle_log (attacker_id, defender_tile_id, attacker_power, defender_power, result, troops_sent, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        order.attacker_id,
        targetTile.id,
        combat.attackerPower,
        combat.defenderPower,
        combat.attackerWins ? "ATTACKER_WINS" : "DEFENDER_WINS",
        order.troops_sent,
        now,
      ]
    );

    await client.query("COMMIT");

    const coordText = `(${targetTile.x}, ${targetTile.y})`;
    if (combat.attackerWins) {
      await addReport(
        order.attacker_id,
        "attack_won",
        "Zafer!",
        `${coordText} karesini ele geçirdin. Güç: ${Math.round(combat.attackerPower)} / ${Math.round(combat.defenderPower)}.`,
        now
      ).catch(() => {});
      if (targetTile.owner_id) {
        await addReport(
          targetTile.owner_id,
          "defended_loss",
          "Kalen ele geçirildi",
          `${attacker.nickname ?? attacker.username}, ${coordText} karesindeki kaleni ele geçirdi. Güç: ${Math.round(combat.attackerPower)} / ${Math.round(combat.defenderPower)}.`,
          now
        ).catch(() => {});
      }
    } else {
      await addReport(
        order.attacker_id,
        "attack_lost",
        "Saldırı püskürtüldü",
        `${coordText} karesine saldırın başarısız oldu. Güç: ${Math.round(combat.attackerPower)} / ${Math.round(combat.defenderPower)}.`,
        now
      ).catch(() => {});
      if (targetTile.owner_id) {
        await addReport(
          targetTile.owner_id,
          "defended_win",
          "Saldırıyı savuşturdun",
          `${attacker.nickname ?? attacker.username}, ${coordText} karesindeki kaleni ele geçirmeye çalıştı ama başarısız oldu. Güç: ${Math.round(combat.attackerPower)} / ${Math.round(combat.defenderPower)}.`,
          now
        ).catch(() => {});
      }
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
