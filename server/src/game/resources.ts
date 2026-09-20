import type { Player, TileRow } from "../types.js";
import type { Settings } from "./settings.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Idle-game style lazy accrual: instead of a server tick loop, we compute
 * how many hours have passed since last_collected_at and derive the current
 * stored amount on read.
 *
 * Asker üretimi kalelere özeldir (her kale kendi garnizonunu büyütür), bu
 * yüzden askerler hâlâ karo (tile) bazında hesaplanır.
 */
export function computeLiveTroops(tile: TileRow, settings: Settings, now: number = Date.now()) {
  const elapsedHours = Math.max(0, (now - tile.last_collected_at) / HOUR_MS);
  const capHours = settings.resource_cap_hours;

  // Static garrisons (NPC camps) have troops_per_hour = 0 but still hold a
  // fixed stored_troops value — the cap must never clamp that below what's
  // already stored, or NPC defense would incorrectly read as 0. The same
  // guard also protects manually reinforced troops above the natural cap.
  const troopsCap = Math.max(tile.troops_per_hour * capHours, tile.stored_troops);

  return Math.min(troopsCap, tile.stored_troops + tile.troops_per_hour * elapsedHours);
}

/**
 * Altın artık kale başına değil, oyuncunun krallığı genelinde ortak bir
 * havuzda birikir: `totalGoldPerHour` (tüm PLAYER karolarının toplamı)
 * `player.gold_collected_at`'ten bu yana geçen saatle çarpılıp
 * `player.gold`'a eklenir. Üretim hızı her değiştiğinde (yükseltme, kale
 * fethi/kaybı) çağıran taraf önce ESKİ hızla bu fonksiyonu çalıştırıp
 * sonucu kalıcı hale getirmeli (bkz. game/economy.ts settlePlayerGold).
 */
export function computeLivePlayerGold(
  player: Pick<Player, "gold" | "gold_collected_at">,
  totalGoldPerHour: number,
  settings: Settings,
  now: number = Date.now()
) {
  const elapsedHours = Math.max(0, (now - player.gold_collected_at) / HOUR_MS);
  const capHours = settings.resource_cap_hours;
  const goldCap = Math.max(totalGoldPerHour * capHours, player.gold);

  return Math.min(goldCap, player.gold + totalGoldPerHour * elapsedHours);
}

export function upgradeCost(level: number, settings: Settings): number {
  return Math.round(settings.upgrade_cost_multiplier * Math.pow(level, settings.upgrade_cost_exponent));
}

export function productionForLevel(level: number, settings: Settings) {
  return {
    gold_per_hour: settings.gold_per_level * level,
    troops_per_hour: settings.troops_per_level * level,
  };
}
