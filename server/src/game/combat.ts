const DEFENSE_TERRAIN_BONUS = 1.1; // small home-turf advantage

export interface CombatResult {
  attackerPower: number;
  defenderPower: number;
  attackerWins: boolean;
  survivingAttackerTroops: number;
  survivingDefenderTroops: number;
}

export function resolveCombat(
  troopsSent: number,
  defenderTroops: number
): CombatResult {
  const attackerPower = troopsSent;
  const defenderPower = defenderTroops * DEFENSE_TERRAIN_BONUS;

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
    survivingDefenderTroops: Math.max(0, defenderPower - attackerPower) / DEFENSE_TERRAIN_BONUS,
  };
}
