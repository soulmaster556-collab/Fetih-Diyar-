import type { Tile } from "../api";
import { HEX_DIRECTIONS, hashXY } from "./mountains";
import { isWaterAtWorldPosition, type WaterFeatures } from "./riversLakes";
import type { ReservedRoot } from "./forests";

// ---------------------------------------------------------------------
// Kristal dekor sistemi
// ---------------------------------------------------------------------
// mountains.ts/rockyAreas.ts ile AYNI genel mekanik (kök hex + ölçekli
// taşan sprite + painter's algorithm'a frontSortKey ile katılma, bkz.
// MapView.tsx) -- ama üç bilinçli farkla:
//   1) SVG data-URI değil, kullanıcının verdiği gerçek raster görsel
//      (webp, kendi alfa kanalıyla) kullanılıyor (bkz. public/decor/crystals).
//   2) Diğer TÜM dekorlardan (dağ 2.2, orman 1.1-1.5, kayalık 0.85-1.2)
//      belirgin şekilde KÜÇÜK render ediliyor -- kullanıcı isteği: "haritada
//      küçük olacak".
//   3) YOĞUNLUK bilerek çok düşük -- kullanıcı isteği: "az olmalı, çünkü
//      ileride başka renklerde kristaller de eklenecek" (bkz. CRYSTAL_DENSITY,
//      dağdan bile seyrek).
// 3 renk (purple/gold/blue) × 3 varyant = 9 sabit görsel; hangisinin
// seçileceği (mountains.ts'teki gibi) deterministik hash'e göre.
export type CrystalColor = "purple" | "gold" | "blue";

export type CrystalDef = {
  id: string;
  img: string;
  color: CrystalColor;
  // Görsel, kendi hex'inin kaç katı bir kutuya sığdırılıp ortalanacak --
  // kompozisyonu daha "dolu" olan varyantlar (geniş taç/daha çok döküntü)
  // hafifçe daha büyük, tek sivri uçlu/kompakt varyantlar daha küçük.
  scale: number;
};

export const CRYSTAL_DEFS: CrystalDef[] = [
  { id: "crystal-purple-1", img: "/decor/crystals/crystal-purple-1.webp", color: "purple", scale: 0.62 },
  { id: "crystal-purple-2", img: "/decor/crystals/crystal-purple-2.webp", color: "purple", scale: 0.55 },
  { id: "crystal-purple-3", img: "/decor/crystals/crystal-purple-3.webp", color: "purple", scale: 0.65 },
  { id: "crystal-gold-1", img: "/decor/crystals/crystal-gold-1.webp", color: "gold", scale: 0.68 },
  { id: "crystal-gold-2", img: "/decor/crystals/crystal-gold-2.webp", color: "gold", scale: 0.52 },
  { id: "crystal-gold-3", img: "/decor/crystals/crystal-gold-3.webp", color: "gold", scale: 0.62 },
  { id: "crystal-blue-1", img: "/decor/crystals/crystal-blue-1.webp", color: "blue", scale: 0.65 },
  { id: "crystal-blue-2", img: "/decor/crystals/crystal-blue-2.webp", color: "blue", scale: 0.55 },
  { id: "crystal-blue-3", img: "/decor/crystals/crystal-blue-3.webp", color: "blue", scale: 0.42 },
];

const CRYSTAL_SEED = 911;
// mountains.ts'teki MOUNTAIN_DENSITY'den (320, bkz. o dosya) bile daha
// seyrek -- kristaller haritada nadir/özel bir "define rastladım" hissi
// versin diye (madde 3, dosya başı yorumu).
export const CRYSTAL_DENSITY = 420;

export type PlacedCrystal = {
  key: string;
  def: CrystalDef;
  rootX: number;
  rootY: number;
  frontSortKey: number;
  jitterX: number;
  jitterY: number;
  scaleJitter: number;
  rotationDeg: number;
};

// `bigReservedRoots`: dağ kökleri (+6 komşu -- dağın scale 2.2 taşma payı
// yüzünden geniş dışlama gerekiyor, rockyAreas.ts'teki reservedRoots ile
// aynı prensip). `smallReservedRoots`: orman/kayalık kökleri -- SADECE
// kendi hex'i dışlanıyor (rockyAreas.ts'teki forestRoots kuralıyla aynı),
// bir kristal bir ağaç/kaya kümesinin hemen yanında durabilir ama aynı
// karoyu paylaşamaz.
export function computePlacedCrystals(
  tiles: Tile[],
  bigReservedRoots: ReservedRoot[],
  smallReservedRoots: ReservedRoot[],
  water: WaterFeatures
): PlacedCrystal[] {
  const occupied = new Set<string>();
  for (const t of tiles) {
    if (t.tileType === "EMPTY") continue;
    occupied.add(`${t.x},${t.y}`);
    for (const [dx, dy] of HEX_DIRECTIONS) occupied.add(`${t.x + dx},${t.y + dy}`);
  }
  for (const r of bigReservedRoots) {
    occupied.add(`${r.rootX},${r.rootY}`);
    for (const [dx, dy] of HEX_DIRECTIONS) occupied.add(`${r.rootX + dx},${r.rootY + dy}`);
  }
  for (const r of smallReservedRoots) {
    occupied.add(`${r.rootX},${r.rootY}`);
  }

  const candidates = tiles.filter(
    (t) => t.tileType === "EMPTY" && hashXY(t.x, t.y, CRYSTAL_SEED) % CRYSTAL_DENSITY === 0
  );
  candidates.sort((a, b) => a.x - b.x || a.y - b.y);

  const placed: PlacedCrystal[] = [];
  for (const t of candidates) {
    const key = `${t.x},${t.y}`;
    if (occupied.has(key)) continue;
    // Kristal sprite'ı kök hex'in biraz dışına taşabildiği için (scale
    // ~0.42-0.68 + jitter) küçük bir pay -- forests.ts/rockyAreas.ts'teki
    // "ağaçlar göle taşıyor" düzeltmesiyle aynı prensip, ama kristal küçük
    // olduğu için pay da daha düşük.
    if (isWaterAtWorldPosition(t.x, t.y, water, 0.4)) continue;

    const defIdx = hashXY(t.x, t.y, CRYSTAL_SEED + 1) % CRYSTAL_DEFS.length;
    const jitterX = ((hashXY(t.x, t.y, CRYSTAL_SEED + 2) % 100) / 100 - 0.5) * 0.4;
    const jitterY = ((hashXY(t.x, t.y, CRYSTAL_SEED + 3) % 100) / 100 - 0.5) * 0.4;
    const scaleJitter = 0.85 + ((hashXY(t.x, t.y, CRYSTAL_SEED + 4) % 100) / 100) * 0.3;
    const rotationDeg = ((hashXY(t.x, t.y, CRYSTAL_SEED + 5) % 100) / 100 - 0.5) * 14; // ±7°

    occupied.add(key);
    placed.push({
      key: `${key}:${CRYSTAL_DEFS[defIdx].id}`,
      def: CRYSTAL_DEFS[defIdx],
      rootX: t.x,
      rootY: t.y,
      frontSortKey: t.x + t.y,
      jitterX,
      jitterY,
      scaleJitter,
      rotationDeg,
    });
  }
  return placed;
}
