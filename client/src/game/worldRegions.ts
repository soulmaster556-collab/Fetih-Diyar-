import { isoCenter } from "./hexMath";
import { hashXY } from "./mountains";

// ---------------------------------------------------------------------
// FAZ 1 — Continuous World Terrain (bkz. MapView.tsx .world-terrain)
// ---------------------------------------------------------------------
// Zemin artık hex başına ayrı ayrı boyanmıyor (eski .iso-ground/.iso-ground-
// grass sistemi kaldırıldı). Bunun yerine TEK bir zemin katmanının üzerine,
// dünya koordinatına göre (hex sınırlarından bağımsız) yumuşak geçişli
// "biyom lekesi" gradyanları bindiriliyor. Bir hex'in tam olarak hangi
// biyoma ait olduğu diye bir kavram YOK -- her nokta, üstündeki lekelerin
// alfa karışımından rengini alıyor, bu yüzden sınırlar doğası gereği
// pürüzsüz.
export type BiomeType =
  | "meadow"
  | "denseMeadow"
  | "dry"
  | "rocky"
  | "forestFloor"
  | "mountainFoot";

// RGB üçlüleri -- rgba() içinde alfa ile birlikte kullanılabilsin diye
// string değil sayı dizisi olarak tutuluyor. Palet bilerek dar/muted tutuldu
// (hepsi yeşil-kahverengi-gri tonlarında) ki lekeler "farklı bir oyun" gibi
// değil, aynı çayırın doğal varyasyonu gibi hissettirsin.
export const BIOME_COLORS: Record<BiomeType, [number, number, number]> = {
  meadow: [156, 204, 101], // eski düz zemin rengiyle aynı (#9ccc65) -- taban
  denseMeadow: [108, 155, 77],
  dry: [189, 173, 107],
  rocky: [158, 155, 140],
  forestFloor: [90, 122, 70],
  mountainFoot: [138, 140, 120],
};

const BIOME_ORDER: BiomeType[] = [
  "meadow",
  "denseMeadow",
  "dry",
  "rocky",
  "forestFloor",
  "mountainFoot",
];

export type BiomeAnchor = {
  x: number; // hex/dünya koordinatı (isoCenter ile aynı uzayda)
  y: number;
  radius: number; // hex birimi -- render sırasında tileWidth ile çarpılıp piksele çevrilir
  biome: BiomeType;
};

// Anchor'lar elle yerleştirilmiş bir liste DEĞİL -- hashXY (dağ/orman
// sisteminde de kullanılan aynı deterministik hash, bkz. mountains.ts)
// ile kaba bir ızgara üzerinde üretiliyor, sonra jitter'lanıyor. Amaç:
// tamamen rastgele hissettiren ama sayfa her açıldığında AYNI dünyayı
// üreten, elle ayarlamaya gerek duymayan bir dağılım (grass texture'daki
// deterministiklik prensibiyle aynı -- Math.random() değil).
const ANCHOR_GRID_STEP = 26;
const ANCHOR_SEED = 7;

export function generateBiomeAnchors(worldSize: number): BiomeAnchor[] {
  const anchors: BiomeAnchor[] = [];
  for (let gy = 0; gy < worldSize; gy += ANCHOR_GRID_STEP) {
    for (let gx = 0; gx < worldSize; gx += ANCHOR_GRID_STEP) {
      // ~%30'unu atla ki ızgara adımı görsel olarak fark edilmesin --
      // kalanlar zaten geniş yarıçapla üst üste bindiği için boşluk kalmıyor.
      if (hashXY(gx, gy, ANCHOR_SEED) % 10 < 3) continue;
      const jitterX = (hashXY(gx, gy, ANCHOR_SEED + 1) % 100) / 100 - 0.5;
      const jitterY = (hashXY(gx, gy, ANCHOR_SEED + 2) % 100) / 100 - 0.5;
      const x = Math.min(worldSize - 1, Math.max(0, gx + jitterX * ANCHOR_GRID_STEP));
      const y = Math.min(worldSize - 1, Math.max(0, gy + jitterY * ANCHOR_GRID_STEP));
      const biome = BIOME_ORDER[hashXY(gx, gy, ANCHOR_SEED + 3) % BIOME_ORDER.length];
      const radiusJitter = (hashXY(gx, gy, ANCHOR_SEED + 4) % 100) / 100;
      const radius = ANCHOR_GRID_STEP * (0.9 + radiusJitter * 0.7);
      anchors.push({ x, y, radius, biome });
    }
  }
  return anchors;
}

// Anchor listesini tek bir CSS background-image (radial-gradient dizisi)
// değerine çeviriyor. Her leke: merkezde düz bir "plato" (0-35%), sonra
// kenara doğru şeffaflığa yumuşak geçiş (35-100%) -- sert bir daire/nokta
// değil, geniş ve pürüzsüz bir bölge hissi versin diye. Konumlar isoCenter
// ile PİKSEL cinsinden hesaplandığı için .world-terrain'in .iso-map'in
// birebir aynı koordinat uzayını paylaşması yeterli, ayrı bir dönüşüme
// gerek yok (bkz. MapView.tsx .world-terrain yorumu).
export function buildBiomeBackground(anchors: BiomeAnchor[], tileWidth: number): string {
  return anchors
    .map((a) => {
      const { cx, cy } = isoCenter(a.x, a.y, tileWidth);
      const r = a.radius * tileWidth;
      const [red, green, blue] = BIOME_COLORS[a.biome];
      return (
        `radial-gradient(circle ${r}px at ${cx}px ${cy}px, ` +
        `rgba(${red},${green},${blue},0.5) 0%, ` +
        `rgba(${red},${green},${blue},0.5) 35%, ` +
        `rgba(${red},${green},${blue},0) 100%)`
      );
    })
    .join(", ");
}

// Yakın zoomda zemine ince bir doku hissi veren gürültü deseni -- gerçek
// bir PNG asset'i YOK (bilerek: mimari asset-agnostic kalsın diye), SVG
// feTurbulence ile üretilip data URI olarak gömülüyor. İleride gerçek bir
// fantasy zemin dokusuyla değiştirilecekse tek satır (bu sabit) değişir,
// render koduna dokunmaya gerek kalmaz.
const GRAIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
  <filter id="n">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="t"/>
    <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.45 0"/>
  </filter>
  <rect width="120" height="120" filter="url(#n)"/>
</svg>`;

export const TERRAIN_GRAIN_BACKGROUND = `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")`;

// ---------------------------------------------------------------------
// FAZ 3 — forests.ts / rockyAreas.ts bu tek fonksiyonla "region field"i
// sorguluyor (bkz. dosya başı yorumu -- FAZ 1'deki anchor/render kodu
// yukarısı hiç değişmedi, bu SADECE yeni bir okuma fonksiyonu).
// ---------------------------------------------------------------------
// Bir (x,y) koordinatında verilen biyomun ne kadar "baskın" olduğunu
// 0..1 arası döndürür -- aynı anchor listesini, buildBiomeBackground'daki
// AYNI plato+düşüş şeklini (0-35% tam, 35-100% yumuşak sıfıra iniş)
// kullanarak. Bu sayede orman/kayalık yoğunluğu, zeminin görsel biyom
// lekeleriyle (ör. "forestFloor" rengiyle) DAİMA örtüşüyor -- ayrı bir
// veri kümesi değil, aynı anchor'ların farklı bir okunuşu. isoCenter
// referans genişlik 1 ile çağrılıyor (gerçek piksel değil, SADECE
// anchor'larla aynı oranlı/skewed uzayda tutarlı mesafe karşılaştırması
// için -- tileWidth'ten bağımsız, tamamen koordinat-tabanlı).
export function sampleBiomeIntensity(x: number, y: number, anchors: BiomeAnchor[], biome: BiomeType): number {
  const p = isoCenter(x, y, 1);
  let intensity = 0;
  for (const a of anchors) {
    if (a.biome !== biome) continue;
    const ap = isoCenter(a.x, a.y, 1);
    const dist = Math.hypot(p.cx - ap.cx, p.cy - ap.cy);
    if (dist >= a.radius) continue;
    const t = dist / a.radius;
    const local = t <= 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
    if (local > intensity) intensity = local;
  }
  return intensity;
}
