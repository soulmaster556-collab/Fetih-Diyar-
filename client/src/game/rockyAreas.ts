import type { Tile } from "../api";
import { HEX_DIRECTIONS, hashXY } from "./mountains";
import { sampleBiomeIntensity, type BiomeAnchor } from "./worldRegions";
import type { ReservedRoot } from "./forests";

// ---------------------------------------------------------------------
// FAZ 3 — Rocky Areas system
// ---------------------------------------------------------------------
// `forests.ts` ile AYNI genel mekanik (kök hex + ölçekli taşan sprite +
// region-field'e göre olasılıksal yoğunluk, bkz. forests.ts dosya başı
// yorumu) -- ama iki farkla: (1) "rocky" VE "mountainFoot" biyomlarının
// İKİSİNE de tepki veriyor (ikisi de "taşlık arazi" hissi, worldRegions.ts
// paletine bkz.), (2) orman kadar yoğun DEĞİL -- kayalıklar daha seyrek,
// daha izole kümeler halinde.
export type RockClusterDef = { id: string; img: string; scale: number };

// Not: forests.ts ile aynı -- <img src> olarak kullanılıyor, çıplak data
// URI dönüyor.
function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Tek bir kaya şekli, döndürülmüş/ölçekli -- cluster'lar 2-5 tanesini bir
// araya getiriyor (bkz. ROCK_CLUSTER_*).
function rockShape(cx: number, baseY: number, w: number, rot: number): string {
  const h = w * 0.6;
  return (
    `<g transform="translate(${cx} ${baseY}) rotate(${rot})">` +
    `<ellipse cx="0" cy="${h * 0.42}" rx="${(w / 2) * 1.05}" ry="${h * 0.14}" fill="rgba(0,0,0,0.18)"/>` +
    `<path d="M${-w / 2},${h * 0.3} L${-w * 0.3},${-h * 0.5} L${w * 0.15},${-h * 0.6} L${w / 2},${-h * 0.1} L${w * 0.3},${h * 0.35} Z" fill="#9b9788"/>` +
    `<path d="M${-w * 0.3},${-h * 0.5} L${w * 0.15},${-h * 0.6} L${w * 0.05},${-h * 0.15} L${-w * 0.2},${-h * 0.2} Z" fill="#b3af9e"/>` +
    `</g>`
  );
}

// FAZ 4B -- aynı kök sebep forests.ts'teki ağaçlarda olduğu gibi burada da
// geçerliydi: 3 kaya tek bir baseY (~68-74) sırasında, sadece x'te yan yana
// diziliyordu -- çizilen içerik ~170×24 gibi son derece yatay bir siluetti.
// Düzeltme: baseY'de de kademelendirme (bazı kayalar öne/aşağı, bazıları
// arkaya/yukarı) -- kaya yığınları doğası gereği tamamen dikey olmayacak
// (gerçek kaya kümeleri de birazcık geniş durur), o yüzden forests.ts kadar
// aşırı portre değil ama artık ~0.85-1.0 aralığında, karo kutusunun (~0.87)
// oranına çok daha yakın.
const ROCK_CLUSTER_01 = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 105 115">` +
    rockShape(32, 105, 46, -8) +
    rockShape(68, 90, 34, 12) +
    rockShape(52, 112, 38, -3) +
    `</svg>`
);
const ROCK_CLUSTER_02 = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85 100">` +
    rockShape(30, 92, 44, 6) +
    rockShape(56, 75, 34, -10) +
    `</svg>`
);
const ROCK_CLUSTER_03 = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 130">` +
    rockShape(24, 122, 30, 10) +
    rockShape(52, 105, 38, -6) +
    rockShape(85, 124, 26, 14) +
    rockShape(50, 85, 34, -4) +
    rockShape(88, 95, 22, 8) +
    `</svg>`
);

export const ROCK_CLUSTER_DEFS: RockClusterDef[] = [
  { id: "rock-cluster-01", img: ROCK_CLUSTER_01, scale: 1.05 },
  { id: "rock-cluster-02", img: ROCK_CLUSTER_02, scale: 0.85 },
  { id: "rock-cluster-03", img: ROCK_CLUSTER_03, scale: 1.2 },
];

const ROCK_SEED = 601;
// Orman'dan (0.4, bkz. forests.ts) belirgin şekilde düşük -- "merkezde daha
// yoğun, kenarda seyrek, dışında yok" ama hiçbir zaman ormanki kadar sık/
// duvar gibi değil. Kullanıcı isteğiyle ("dekorları azalt") eski 0.3'ten
// daha da düşürüldü.
const ROCK_MAX_COVERAGE = 0.18;

export type PlacedRock = {
  key: string;
  def: RockClusterDef;
  rootX: number;
  rootY: number;
  frontSortKey: number;
  jitterX: number;
  jitterY: number;
  scaleJitter: number;
  // FAZ 4B madde 3 -- "hepsine aynı açı verilmemeli, ama rastgele her
  // render'da değişmemeli": kümenin TAMAMINA (kendi SVG'sindeki tek tek
  // kaya açılarından AYRI olarak) hash'e göre küçük, sabit bir genel eğim
  // -- render'da transform-origin:bottom center ile uygulanıyor (bkz.
  // MapView.tsx) ki taban/zemin teması dönüşten etkilenmesin.
  rotationDeg: number;
};

// `reservedRoots`: dağ kökleri (+6 komşu, dağın büyük taşma payı yüzünden)
// VE kale/NPC karoları (+6 komşu, Castle Scene çevresinde açıklık için).
// `forestRoots`: SADECE kendi hex'i dışlanıyor (komşu dışlaması YOK) --
// bir kaya kümesi bir ağaç kümesiyle aynı karoyu paylaşamaz ama hemen
// yanında durabilir (doğal orman kenarı/kayalık geçişi, bkz. dosya başı
// yorumu).
// FAZ 4A -- göller kaldırıldı, forests.ts ile aynı prensip (bkz. o dosyadaki
// not): `seaDistance` artık denize/ada dışına taşmayı önleyen TEK kontrol.
export function computePlacedRocks(
  tiles: Tile[],
  biomeAnchors: BiomeAnchor[],
  reservedRoots: ReservedRoot[],
  forestRoots: ReservedRoot[],
  seaDistance: Map<string, number>
): PlacedRock[] {
  const occupied = new Set<string>();
  for (const t of tiles) {
    if (t.tileType === "EMPTY") continue;
    occupied.add(`${t.x},${t.y}`);
    for (const [dx, dy] of HEX_DIRECTIONS) occupied.add(`${t.x + dx},${t.y + dy}`);
  }
  for (const r of reservedRoots) {
    occupied.add(`${r.rootX},${r.rootY}`);
    for (const [dx, dy] of HEX_DIRECTIONS) occupied.add(`${r.rootX + dx},${r.rootY + dy}`);
  }
  for (const f of forestRoots) {
    occupied.add(`${f.rootX},${f.rootY}`);
  }

  const candidates = tiles
    .filter((t) => t.tileType === "EMPTY")
    .sort((a, b) => a.x - b.x || a.y - b.y);

  const placed: PlacedRock[] = [];
  for (const t of candidates) {
    const key = `${t.x},${t.y}`;
    if (occupied.has(key)) continue;
    // forests.ts ile aynı taşma düzeltmesi (bkz. islandShore.ts), kayalık
    // sprite'ları biraz daha küçük (scale ~0.85-1.2) olduğu için pay daha dar.
    if ((seaDistance.get(`${t.x},${t.y}`) ?? Infinity) <= 0) continue;

    const intensity = Math.max(
      sampleBiomeIntensity(t.x, t.y, biomeAnchors, "rocky"),
      sampleBiomeIntensity(t.x, t.y, biomeAnchors, "mountainFoot")
    );
    if (intensity <= 0) continue;
    const roll = (hashXY(t.x, t.y, ROCK_SEED) % 10000) / 10000;
    if (roll >= intensity * ROCK_MAX_COVERAGE) continue;

    const defIdx = hashXY(t.x, t.y, ROCK_SEED + 1) % ROCK_CLUSTER_DEFS.length;
    const jitterX = ((hashXY(t.x, t.y, ROCK_SEED + 2) % 100) / 100 - 0.5) * 0.5;
    const jitterY = ((hashXY(t.x, t.y, ROCK_SEED + 3) % 100) / 100 - 0.5) * 0.5;
    const scaleJitter = 0.85 + (hashXY(t.x, t.y, ROCK_SEED + 4) % 100) / 100 * 0.3;
    const rotationDeg = ((hashXY(t.x, t.y, ROCK_SEED + 5) % 100) / 100 - 0.5) * 14; // ±7°

    placed.push({
      key: `${key}:${ROCK_CLUSTER_DEFS[defIdx].id}`,
      def: ROCK_CLUSTER_DEFS[defIdx],
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
