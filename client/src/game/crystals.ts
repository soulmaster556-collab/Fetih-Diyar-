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
//      (png, kendi alfa kanalıyla) kullanılıyor (bkz. public/decor/crystals).
//      DÜZELTME: orijinal webp dosyaları kenarlarında (özellikle ALTTA,
//      ~%10-17) büyük şeffaf boşluk taşıyordu -- object-position:bottom
//      center bu boşluğu kutunun tabanına hizaladığı için görsel kristal
//      kümesi kutunun GERÇEK tabanından (ve altındaki .crystal-cluster-shadow
//      elipsinden) belirgin bir boşlukla yukarıda duruyordu (kullanıcı geri
//      bildirimi: "kristaller neden havada duruyor"). Her 9 görsel canvas'ın
//      gerçek (alfa>0) sınırına ~%4 pay bırakılarak yeniden kırpıldı (bkz.
//      decode_crystal.py + tarayıcı canvas script'i, tek seferlik -- tekrar
//      çalıştırmaya gerek yok, sonuç dosyaları commit'e girdi).
//   2) Boyut kayalık kümelere (0.85-1.2) yakın, "normal/ideal" bir dekor
//      boyutu -- kırpma öncesi kale kutusunun (bkz. MapView.tsx castleBoxWidth)
//      YARISI kadar (~0.55 ortalama) render ediliyordu, kullanıcı geri
//      bildirimiyle ("normal ideal boyuta getir") ~1.8x büyütüldü. Kırpma
//      SONRASI aynı GERÇEK (algılanan) boyutu korumak için `scale` değerleri
//      kırpma oranına göre aşağı ayarlandı -- görsel artık kutusunun
//      ~%93'ünü dolduruyor (öncesinde ~%40-50), yani aynı ekran boyutu için
//      daha küçük bir `scale` yeterli.
//   3) YOĞUNLUK bilerek düşük -- kullanıcı isteği: "az olmalı, çünkü
//      ileride başka renklerde kristaller de eklenecek" (bkz. CRYSTAL_DENSITY).
//      DÜZELTME: ilk sürümde kale/NPC karolarının 6 komşusu da (mountains.ts
//      GİBİ değil, forests.ts gibi) dışlanıyordu -- yoğun bir NPC haritasında
//      bu, aday havuzunu neredeyse tamamen siliyordu (kullanıcı geri
//      bildirimi: "haritada kristalleri hiç göremiyorum"). Artık mountains.ts
//      ile AYNI, daha hafif kural: sadece kale/NPC'nin KENDİ hex'i dışlanıyor.
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
  { id: "crystal-purple-1", img: "/decor/crystals/crystal-purple-1.png", color: "purple", scale: 0.48 },
  { id: "crystal-purple-2", img: "/decor/crystals/crystal-purple-2.png", color: "purple", scale: 0.43 },
  { id: "crystal-purple-3", img: "/decor/crystals/crystal-purple-3.png", color: "purple", scale: 0.53 },
  { id: "crystal-gold-1", img: "/decor/crystals/crystal-gold-1.png", color: "gold", scale: 0.59 },
  { id: "crystal-gold-2", img: "/decor/crystals/crystal-gold-2.png", color: "gold", scale: 0.37 },
  { id: "crystal-gold-3", img: "/decor/crystals/crystal-gold-3.png", color: "gold", scale: 0.51 },
  { id: "crystal-blue-1", img: "/decor/crystals/crystal-blue-1.png", color: "blue", scale: 0.60 },
  { id: "crystal-blue-2", img: "/decor/crystals/crystal-blue-2.png", color: "blue", scale: 0.45 },
  { id: "crystal-blue-3", img: "/decor/crystals/crystal-blue-3.png", color: "blue", scale: 0.34 },
];

const CRYSTAL_SEED = 911;
// Kristaller haritada nadir/özel bir "define rastladım" hissi versin diye
// mountains.ts'teki MOUNTAIN_DENSITY'den (320) BİRAZ daha seyrek tutulmak
// istenmişti, ama harita boyu sabit (WORLD_SIZE'a göre değil, gerçekte
// üretilen tek ada ~birkaç bin karo) olduğu için 420 -- özellikle eski
// (madde 3 yukarısı) 6-komşu dışlama hatasıyla birleşince -- pratikte
// SIFIRA yakın bir sayı üretiyordu. Kullanıcı geri bildirimiyle ("hiç yok")
// gerçek bir keşfedilebilir yoğunluğa çekildi.
export const CRYSTAL_DENSITY = 130;

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
    if (t.tileType !== "EMPTY") occupied.add(`${t.x},${t.y}`);
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
