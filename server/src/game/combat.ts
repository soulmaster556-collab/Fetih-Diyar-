import type { Settings } from "./settings.js";

export interface CombatResult {
  attackerPower: number;
  defenderPower: number;
  attackerWins: boolean;
  survivingAttackerTroops: number;
  survivingDefenderTroops: number;
}

export function resolveCombat(
  troopsSent: number,
  defenderTroops: number,
  settings: Settings
): CombatResult {
  const bonus = settings.combat_defense_bonus;
  const attackerPower = troopsSent;
  const defenderPower = defenderTroops * bonus;

  if (attackerPower > defenderPower) {
    return {
      attackerPower,
      defenderPower,
      attackerWins: true,
      survivingAttackerTroops: Math.max(0, attackerPower - defenderPower),
      survivingDefenderTroops: 0,
    };
  }

  return {
    attackerPower,
    defenderPower,
    attackerWins: false,
    survivingAttackerTroops: 0,
    survivingDefenderTroops: Math.max(0, defenderPower - attackerPower) / bonus,
  };
}
