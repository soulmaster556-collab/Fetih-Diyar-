import type { Tile } from "../api";
import { HEX_DIRECTIONS, hashXY } from "./mountains";
import { isWaterAtWorldPosition, type WaterFeatures } from "./riversLakes";
import { sampleBiomeIntensity, type BiomeAnchor } from "./worldRegions";

// ---------------------------------------------------------------------
// FAZ 3 — Forest system
// ---------------------------------------------------------------------
// `mountains.ts`'e HİÇ dokunulmadı -- bu dosya sadece onun `hashXY`/
// `HEX_DIRECTIONS`'ını import ediyor ve AYNI genel render mantığını
// (kök hex + ölçekli taşan sprite + painter's algorithm'a `frontSortKey`
// ile katılma, bkz. MapView.tsx) paylaşıyor. Yerleştirme mantığı bilerek
// FARKLI: dağlarda düz `hashXY % DENSITY` yeterliydi (nadir, izole
// objeler), ama orman için bu "hex-grid hissi" verirdi (madde 2). Bunun
// yerine yoğunluk `sampleBiomeIntensity`'den (worldRegions.ts, "forestFloor"
// biyomu) geliyor -- bölge merkezinde yoğun, kenara doğru seyrek, dışında
// hiç. Aynı biyom lekesi zaten zemin renginde görünüyor (FAZ 1), yani orman
// kümeleri görsel olarak "forestFloor" rengiyle boyanmış zeminle DAİMA
// örtüşüyor.
export type ForestClusterDef = { id: string; img: string; scale: number };

// Not: .iso-mountain deseniyle aynı şekilde <img src> olarak kullanılıyor
// (bkz. MapView.tsx forestScreens render'ı) -- CASTLE_PROP_DEFS'teki
// (castleScenes.ts) background-image kullanan `url("...")` sarmalaması
// BURADA YOK, çıplak data URI dönüyor.
function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Tek bir ağaç şekli (üçgen ya da yuvarlak tepe) -- cluster'lar bunu birkaç
// kez farklı x/yükseklik/tip ile bir araya getiriyor (bkz. FOREST_CLUSTER_*).
function treeShape(cx: number, baseY: number, h: number, round: boolean): string {
  const trunkW = h * 0.12;
  const trunkH = h * 0.28;
  const top = baseY - h;
  if (round) {
    const r = h * 0.34;
    return (
      `<rect x="${cx - trunkW / 2}" y="${baseY - trunkH}" width="${trunkW}" height="${trunkH}" fill="#6b4a30"/>` +
      `<circle cx="${cx}" cy="${top + h * 0.42}" r="${r}" fill="#4a8a4a"/>` +
      `<circle cx="${cx - r * 0.6}" cy="${top + h * 0.55}" r="${r * 0.75}" fill="#3f7a3f"/>` +
      `<circle cx="${cx + r * 0.6}" cy="${top + h * 0.55}" r="${r * 0.75}" fill="#3f7a3f"/>`
    );
  }
  const w = h * 0.5;
  return (
    `<rect x="${cx - trunkW / 2}" y="${baseY - trunkH}" width="${trunkW}" height="${trunkH}" fill="#6b4a30"/>` +
    `<polygon points="${cx},${top} ${cx + w / 2},${baseY - trunkH + 2} ${cx - w / 2},${baseY - trunkH + 2}" fill="#3f7a3f"/>` +
    `<polygon points="${cx},${top + h * 0.3} ${cx + w * 0.42},${baseY - trunkH * 0.4} ${cx - w * 0.42},${baseY - trunkH * 0.4}" fill="#4f8f4f"/>`
  );
}

// ---------------------------------------------------------------------
// FAZ 4B — "yatay görünme" kök sebebi VE düzeltmesi
// ---------------------------------------------------------------------
// Kök sebep object-fit:contain'in görseli BOZMASI değildi -- contain kendi
// en-boy oranını asla deforme etmez, sadece kutuya sığdırıp ölçekler. Asıl
// sorun bu SVG'lerin KENDİ İÇERİK siluetiydi: eskiden tüm ağaçlar NEREDEYSE
// AYNI baseY'de (tek bir "zemin çizgisi") ve SADECE x ekseninde yan yana
// diziliyordu (ör. 5 ağaç, baseY 136-146 arası, x 40-190 arası) -- yani
// çizilen içeriğin gerçek sınır kutusu ~220×12 gibi son derece YATAY/yassı
// bir dikdörtgendi (bkz. eski FOREST_CLUSTER_01: genişlik yüksekliğin
// neredeyse 2 katıydı). object-fit:contain bunu portre-oranlı karo
// kutusuna sığdırırken KÜÇÜLTÜP kutunun en altına yasladı (object-position:
// bottom center) -- her ağacın kendi gövde/tepe oranı bozulmasa da, KÜME
// bir bütün olarak "yere yatırılmış yassı bir şerit" gibi okunuyordu.
//
// Düzeltme: ağaçlar artık TEK bir yatay sırada değil, hem x HEM baseY
// ekseninde kademelendirilmiş (bazıları öne/aşağı, bazıları arkaya/yukarı)
// -- mountains.ts'teki tekil dağ sprite'larının zaten doğal olarak portre
// siluetli olmasına benzer şekilde, artık KÜMENİN kendisinin çizilen içerik
// sınır kutusu da dar/dikey bir dikdörtgene yaklaşıyor (viewBox'lar da bu
// içerik oranına göre seçildi). Ayrı bir CSS rotate/transform hilesi YOK --
// sorun kompozisyonun kendisindeydi, düzeltme de kompozisyonda.
//
// 4 varyant, 3-7 ağaç arası (madde 5 -- tekrar fark edilmesin). Gerçek
// asset geldiğinde SADECE bu dört sabitin `img` değeri değişecek.
const FOREST_CLUSTER_01 = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 185">` +
    treeShape(42, 180, 72, false) +
    treeShape(70, 165, 95, true) +
    treeShape(105, 182, 62, false) +
    treeShape(60, 148, 80, true) +
    treeShape(112, 155, 68, false) +
    `</svg>`
);
const FOREST_CLUSTER_02 = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 135 175">` +
    treeShape(35, 170, 80, true) +
    treeShape(72, 155, 58, false) +
    treeShape(95, 172, 95, true) +
    treeShape(58, 142, 66, false) +
    `</svg>`
);
const FOREST_CLUSTER_03 = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 165 195">` +
    treeShape(30, 190, 58, false) +
    treeShape(58, 172, 82, true) +
    treeShape(88, 192, 66, false) +
    treeShape(115, 176, 90, true) +
    treeShape(140, 188, 60, false) +
    treeShape(68, 148, 85, true) +
    treeShape(105, 142, 52, false) +
    `</svg>`
);
const FOREST_CLUSTER_04 = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 115 170">` +
    treeShape(35, 165, 70, false) +
    treeShape(75, 148, 95, true) +
    treeShape(60, 168, 55, false) +
    `</svg>`
);

export const FOREST_CLUSTER_DEFS: ForestClusterDef[] = [
  { id: "forest-cluster-01", img: FOREST_CLUSTER_01, scale: 1.35 },
  { id: "forest-cluster-02", img: FOREST_CLUSTER_02, scale: 1.25 },
  { id: "forest-cluster-03", img: FOREST_CLUSTER_03, scale: 1.5 },
  { id: "forest-cluster-04", img: FOREST_CLUSTER_04, scale: 1.1 },
];

const FOREST_SEED = 401;
// Bölge merkezinde (intensity=1) bile boş hex'lerin EN FAZLA bu oranı
// cluster alıyor -- geri kalanı doğal açıklık (madde 4). Ayrı bir
// "clearing algoritması" YOK, açıklıklar bu olasılıksal seyrelmeden
// kendiliğinden çıkıyor. Kullanıcı isteğiyle ("dekorları azalt") eski
// 0.62'den düşürüldü.
const FOREST_MAX_COVERAGE = 0.4;

export type PlacedForest = {
  key: string;
  def: ForestClusterDef;
  rootX: number;
  rootY: number;
  frontSortKey: number;
  // Kök hex merkezine göre küçük ofset + ölçek sapması (tileWidth biriminde/
  // çarpan) -- SADECE hex-grid hissini kırmak için (madde 2), kompozisyonu
  // değiştirmiyor.
  jitterX: number;
  jitterY: number;
  scaleJitter: number;
};

export type ReservedRoot = { rootX: number; rootY: number };

// `reserved`: dağların (bkz. mountains.ts computePlacedMountains) kapladığı
// kökler -- bir orman kümesi asla bir dağın üstüne/hemen yanına binmesin
// diye kendisi VE 6 komşusu dışlanıyor. Kale/NPC karoları da aynı şekilde
// (+6 komşusu) dışlanıyor ki Castle Scene'in etrafında doğal bir açıklık
// kalsın (bkz. dosya başı yorumu madde 10) -- bu salt görsel bir kural,
// gameplay'e bağlı değil. Orman kümeleri KENDİ ARALARINDA komşu dışlaması
// YAPMIYOR (bilerek): sık, kesintisiz bir orman kütlesi hissi için bitişik
// köklerin de cluster alabilmesi gerekiyor.
// FAZ 4A -- `water`: aynı hex'te nehir/göl varsa (bkz.
// riversLakes.ts isWaterAtWorldPosition) o hex tamamen aday listesinden
// çıkarılıyor -- "ağaçlar suyun içine rastgele spawn olmamalı" (dosya başı
// FAZ 4A madde 6). Su, `tiles`'tan bağımsız dünya-koordinat geometrisi
// olduğu için bu kontrol windowing'i bozmuyor (her aday hex için tek bir
// ucuz mesafe hesabı).
export function computePlacedForests(
  tiles: Tile[],
  biomeAnchors: BiomeAnchor[],
  reserved: ReservedRoot[],
  water: WaterFeatures
): PlacedForest[] {
  const occupied = new Set<string>();
  for (const t of tiles) {
    if (t.tileType === "EMPTY") continue;
    occupied.add(`${t.x},${t.y}`);
    for (const [dx, dy] of HEX_DIRECTIONS) occupied.add(`${t.x + dx},${t.y + dy}`);
  }
  for (const r of reserved) {
    occupied.add(`${r.rootX},${r.rootY}`);
    for (const [dx, dy] of HEX_DIRECTIONS) occupied.add(`${r.rootX + dx},${r.rootY + dy}`);
  }

  const candidates = tiles
    .filter((t) => t.tileType === "EMPTY")
    .sort((a, b) => a.x - b.x || a.y - b.y);

  const placed: PlacedForest[] = [];
  for (const t of candidates) {
    const key = `${t.x},${t.y}`;
    if (occupied.has(key)) continue;
    // Orman sprite'ı kök hex'in DIŞINA (scale ~1.1-1.5 + jitter) taşabildiği
    // için 1 hex birimi ekstra pay -- "ağaçlar göle taşıyor" düzeltmesi
    // (bkz. riversLakes.ts isWaterAtWorldPosition yorumu).
    if (isWaterAtWorldPosition(t.x, t.y, water, 1)) continue;

    const intensity = sampleBiomeIntensity(t.x, t.y, biomeAnchors, "forestFloor");
    if (intensity <= 0) continue;
    const roll = (hashXY(t.x, t.y, FOREST_SEED) % 10000) / 10000;
    if (roll >= intensity * FOREST_MAX_COVERAGE) continue;

    const defIdx = hashXY(t.x, t.y, FOREST_SEED + 1) % FOREST_CLUSTER_DEFS.length;
    const jitterX = ((hashXY(t.x, t.y, FOREST_SEED + 2) % 100) / 100 - 0.5) * 0.5;
    const jitterY = ((hashXY(t.x, t.y, FOREST_SEED + 3) % 100) / 100 - 0.5) * 0.5;
    const scaleJitter = 0.85 + (hashXY(t.x, t.y, FOREST_SEED + 4) % 100) / 100 * 0.3;

    placed.push({
      key: `${key}:${FOREST_CLUSTER_DEFS[defIdx].id}`,
      def: FOREST_CLUSTER_DEFS[defIdx],
      rootX: t.x,
      rootY: t.y,
      frontSortKey: t.x + t.y,
      jitterX,
      jitterY,
      scaleJitter,
    });
  }
  return placed;
}
