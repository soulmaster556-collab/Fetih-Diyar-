import type { TileRow } from "../types.js";
import type { Settings } from "./settings.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Idle-game style lazy accrual: instead of a server tick loop, we compute
 * how many hours have passed since last_collected_at and derive the current
 * stored amounts on read. This mirrors the time-based production pattern
 * already used in Kadim Topraklar.
 */
export function computeLiveResources(tile: TileRow, settings: Settings, now: number = Date.now()) {
  const elapsedHours = Math.max(0, (now - tile.last_collected_at) / HOUR_MS);
  const capHours = settings.resource_cap_hours;

  // Static garrisons (NPC camps) have troops_per_hour = 0 but still hold a
  // fixed stored_troops value — the cap must never clamp that below what's
  // already stored, or NPC defense would incorrectly read as 0.
  const goldCap = Math.max(tile.gold_per_hour * capHours, tile.stored_gold);
  const troopsCap = Math.max(tile.troops_per_hour * capHours, tile.stored_troops);

  const gold = Math.min(
    goldCap,
    tile.stored_gold + tile.gold_per_hour * elapsedHours
  );
  const troops = Math.min(
    troopsCap,
    tile.stored_troops + tile.troops_per_hour * elapsedHours
  );

  return { gold, troops };
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
