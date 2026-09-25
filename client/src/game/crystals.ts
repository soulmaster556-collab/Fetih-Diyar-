import type { Tile } from "../api";
import { hashXY, islandDecorFactor } from "./mountains";
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
//      DÜZELTME: bu ilk ayar 9 görsel arasında tutarsızdı (0.34-0.60 arası,
//      neredeyse 2 kat fark) -- kullanıcı geri bildirimi ("bazıları büyük
//      bazıları küçük, hepsini en büyük olanı baz alarak düzenle"). Artık
//      hepsi eski en büyük değere (0.60, crystal-blue-1) EŞİT -- object-fit
//      contain zaten kutunun genişliğiyle sınırlandığı için (9 görselin
//      en/boy oranı da kutununkinden geniş, bkz. crystal PNG'leri) aynı
//      `scale` = aynı render GENİŞLİĞİ, sadece görselin kendi en/boy oranına
//      göre yüksekliği ~%25 içinde değişiyor -- artık hepsi gözle görülür
//      şekilde aynı boyutta.
//   3) YOĞUNLUK -- ilk sürümde kale/NPC karolarının 6 komşusu da
//      (mountains.ts GİBİ değil, forests.ts gibi) dışlanıyordu -- yoğun bir
//      NPC haritasında bu, aday havuzunu neredeyse tamamen siliyordu
//      (kullanıcı geri bildirimi: "haritada kristalleri hiç göremiyorum").
//      Artık mountains.ts ile AYNI, daha hafif kural: sadece kale/NPC'nin
//      KENDİ hex'i dışlanıyor. Kullanıcı isteğiyle ("kristalleri biraz daha
//      çoğalt") CRYSTAL_DENSITY ayrıca düşürüldü (bkz. aşağısı).
// 3 renk (purple/gold/blue) × 3 varyant = 9 sabit görsel; hangisinin
// seçileceği (mountains.ts'teki gibi) deterministik hash'e göre.
export type CrystalColor = "purple" | "gold" | "blue";

export type CrystalDef = {
  id: string;
  img: string;
  color: CrystalColor;
  // Görsel, kendi hex'inin kaç katı bir kutuya sığdırılıp ortalanacak.
  // Kullanıcı isteğiyle ("en büyük olanı baz al") 9 görselin TAMAMI eski en
  // büyük değere (0.60) eşitlendi -- artık aralarında boyut farkı yok.
  scale: number;
};

const CRYSTAL_UNIFORM_SCALE = 0.6;

export const CRYSTAL_DEFS: CrystalDef[] = [
  { id: "crystal-purple-1", img: "/decor/crystals/crystal-purple-1.png", color: "purple", scale: CRYSTAL_UNIFORM_SCALE },
  { id: "crystal-purple-2", img: "/decor/crystals/crystal-purple-2.png", color: "purple", scale: CRYSTAL_UNIFORM_SCALE },
  { id: "crystal-purple-3", img: "/decor/crystals/crystal-purple-3.png", color: "purple", scale: CRYSTAL_UNIFORM_SCALE },
  { id: "crystal-gold-1", img: "/decor/crystals/crystal-gold-1.png", color: "gold", scale: CRYSTAL_UNIFORM_SCALE },
  { id: "crystal-gold-2", img: "/decor/crystals/crystal-gold-2.png", color: "gold", scale: CRYSTAL_UNIFORM_SCALE },
  { id: "crystal-gold-3", img: "/decor/crystals/crystal-gold-3.png", color: "gold", scale: CRYSTAL_UNIFORM_SCALE },
  { id: "crystal-blue-1", img: "/decor/crystals/crystal-blue-1.png", color: "blue", scale: CRYSTAL_UNIFORM_SCALE },
  { id: "crystal-blue-2", img: "/decor/crystals/crystal-blue-2.png", color: "blue", scale: CRYSTAL_UNIFORM_SCALE },
  { id: "crystal-blue-3", img: "/decor/crystals/crystal-blue-3.png", color: "blue", scale: CRYSTAL_UNIFORM_SCALE },
];

const CRYSTAL_SEED = 911;
// Kullanıcı isteğiyle ("kristalleri biraz daha çoğalt") eski 130'dan
// düşürüldü -- density modulo'nun BÖLENİ olduğu için küçülmesi = aday
// havuzunun daha büyük bir yüzdesinin seçilmesi = daha sık kristal.
export const CRYSTAL_DENSITY = 90;

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

// `reservedRoots`: orman/kayalık kökleri -- SADECE kendi hex'i dışlanıyor
// (rockyAreas.ts'teki forestRoots kuralıyla aynı), bir kristal bir ağaç/kaya
// kümesinin hemen yanında durabilir ama aynı karoyu paylaşamaz. (Eskiden
// ayrıca dağ köklerini +6 komşusuyla dışlayan bir `bigReservedRoots` de
// vardı -- dağ dekoru kaldırıldığı için o parametre de kaldırıldı.)
export function computePlacedCrystals(
  tiles: Tile[],
  reservedRoots: ReservedRoot[],
  seaDistance: Map<string, number>
): PlacedCrystal[] {
  const occupied = new Set<string>();
  for (const t of tiles) {
    if (t.tileType !== "EMPTY") occupied.add(`${t.x},${t.y}`);
  }
  for (const r of reservedRoots) {
    occupied.add(`${r.rootX},${r.rootY}`);
  }

  const candidates = tiles.filter((t) => {
    if (t.tileType !== "EMPTY") return false;
    // Ada bazlı yoğunluk (bkz. mountains.ts islandDecorFactor) -- bazı
    // adalar diğerlerinden belirgin şekilde daha kristal-zengin.
    const density = Math.max(30, Math.round(CRYSTAL_DENSITY / islandDecorFactor(t.islandId, 301)));
    return hashXY(t.x, t.y, CRYSTAL_SEED) % density === 0;
  });
  candidates.sort((a, b) => a.x - b.x || a.y - b.y);

  const placed: PlacedCrystal[] = [];
  for (const t of candidates) {
    const key = `${t.x},${t.y}`;
    if (occupied.has(key)) continue;
    // Kristal sprite'ı kök hex'in biraz dışına taşabildiği için (scale
    // ~0.42-0.68 + jitter) küçük bir pay -- forests.ts/rockyAreas.ts'teki
    // taşma düzeltmesiyle aynı prensip (bkz. islandShore.ts), ama kristal
    // küçük olduğu için pay da daha düşük.
    if ((seaDistance.get(`${t.x},${t.y}`) ?? Infinity) <= 0) continue;

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
