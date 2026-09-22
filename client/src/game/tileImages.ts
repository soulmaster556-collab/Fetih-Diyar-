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
// NPC kampları da kendi seviyesine göre (bkz. mapgen.ts: NPC'ler hep 1-3
// arası doğuyor) 3 farklı görselden birini kullanıyor.
export const NPC_LEVEL_TIERS: [number, string][] = [
  [3, "/buildings/npc_castle_levels/npc_level_3.png"],
  [2, "/buildings/npc_castle_levels/npc_level_2.png"],
  [1, "/buildings/npc_castle_levels/npc_level_1.png"],
];
export function npcCastleImageForLevel(level: number): string {
  for (const [threshold, src] of NPC_LEVEL_TIERS) {
    if (level >= threshold) return src;
  }
  return NPC_LEVEL_TIERS[NPC_LEVEL_TIERS.length - 1][1];
}

// Üç çim dokusundan hangisinin kullanılacağı rastgele DEĞİL, axial hex
// koordinatına göre (x - y) mod 3 ile seçiliyor. Sebep: Math.random()
// her yeniden çizimde titrer ve komşu iki karo aynı dokuyu alabilir.
// (x - y) mod 3, altıgen komşulukta (6 komşu) HER zaman komşudan farklı
// bir değer üretir -- aynı doku asla yan yana gelmez.
export const GRASS_TEXTURES = [
  "/terrain/grass-tuft-a.png",
  "/terrain/grass-tuft-b.png",
  "/terrain/grass-tuft-c.png",
];
export function grassTextureForTile(x: number, y: number): string {
  const idx = (((x - y) % 3) + 3) % 3;
  return GRASS_TEXTURES[idx];
}
