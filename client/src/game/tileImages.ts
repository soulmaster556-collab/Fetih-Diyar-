// Oyuncu kaleleri (kendi/klan/düşman fark etmez) kalenin seviyesine göre 6
// farklı görselden birini kullanıyor. Sahiplik görselden değil, seviye
// etiketinin renginden anlaşılıyor (bkz. MapView .iso-labels-layer).
export const CASTLE_LEVEL_TIERS: [number, string][] = [
  [200, "/buildings/castle_levels/level_200.png"],
  [100, "/buildings/castle_levels/level_100.png"],
  [50, "/buildings/castle_levels/level_50.png"],
  [25, "/buildings/castle_levels/level_25.png"],
  [10, "/buildings/castle_levels/level_10.png"],
  [1, "/buildings/castle_levels/level_1.png"],
];
export function castleImageForLevel(level: number): string {
  for (const [threshold, src] of CASTLE_LEVEL_TIERS) {
    if (level >= threshold) return src;
  }
  return CASTLE_LEVEL_TIERS[CASTLE_LEVEL_TIERS.length - 1][1];
}
// NPC kampları da kendi seviyesine göre 3 farklı görselden birini
// kullanıyor -- eşikler kullanıcı isteğiyle 10/20/30'a çıkarıldı (ileride
// daha güçlü NPC'ler için hazır); mapgen.ts'te NPC'ler hâlâ 1-5 arası
// doğduğu için haritadaki HİÇBİR NPC şu an 10 eşiğine ulaşmıyor, yani
// hepsi en düşük seviye (npc_level_1.png) görselini gösteriyor.
export const NPC_LEVEL_TIERS: [number, string][] = [
  [30, "/buildings/npc_castle_levels/npc_level_3.png"],
  [20, "/buildings/npc_castle_levels/npc_level_2.png"],
  [10, "/buildings/npc_castle_levels/npc_level_1.png"],
];
export function npcCastleImageForLevel(level: number): string {
  for (const [threshold, src] of NPC_LEVEL_TIERS) {
    if (level >= threshold) return src;
  }
  return NPC_LEVEL_TIERS[NPC_LEVEL_TIERS.length - 1][1];
}
