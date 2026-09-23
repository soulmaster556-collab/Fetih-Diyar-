import { TILE_WIDTHS } from "./constants";
import { hashXY } from "./mountains";

// ---------------------------------------------------------------------
// FAZ 2 — Castle Scene PROTOTYPE (bkz. components/CastleScene.tsx)
// ---------------------------------------------------------------------
// ÇOK ÖNEMLİ: bu dosya `castleImageForLevel`/`CASTLE_LEVEL_TIERS`'a
// (tileImages.ts) HİÇ dokunmuyor. Kale seviyesi hâlâ "yapının gelişmişliği"
// -- hangi ana kale görselinin kullanılacağını belirliyor. Zoom burada
// SADECE "kameranın yakınlığı"na göre o ana görselin ETRAFINA sahne
// (prop) eklenip eklenmeyeceğini belirliyor. İki sistem kesinlikle
// birbirine bağlı değil -- Level 200 bir kale uzak zoomda hâlâ SADECE
// kendi level_200.png'sini gösterir, ek prop yok.
//
// Kademeli (LOD 0->1->2->3->4, prop'lar teker teker beliren) sistem
// BİLEREK terk edildi -- zoom sırasında etrafta parça parça beliren
// prop'lar "spamlanmış" bir çember gibi görünüyordu. Bunun yerine İKİLİ
// bir durum var: TILE_WIDTHS'in (constants.ts) son 2 kademesine
// (272/320px) kadar sahne TAMAMEN gizli (sadece ana kale görünür),
// oraya ulaşınca TÜM prop'lar TEK SEFERDE birlikte beliriyor.
export function isCastleSceneVisible(tileWidth: number): boolean {
  const idx = TILE_WIDTHS.indexOf(tileWidth);
  if (idx === -1) return false;
  return idx >= TILE_WIDTHS.length - 2;
}

// -----------------------------------------------------------------------
// Prop görselleri -- gerçek fantasy asset'i YOK, SVG placeholder'lar
// (worldRegions.ts'teki TERRAIN_GRAIN_BACKGROUND ile aynı prensip: data
// URI, ekstra dosya gerektirmiyor). GERÇEK ASSET GELDİĞİNDE tek yapılacak
// şey CASTLE_PROP_DEFS'teki `img` alanlarını gerçek PNG/SVG path'leriyle
// değiştirmek -- CastleScene.tsx'in render mantığı hiç değişmez.
// -----------------------------------------------------------------------
function svgDataUri(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const TREE_A = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 56">
  <rect x="17" y="40" width="6" height="14" fill="#6b4a30"/>
  <polygon points="20,0 34,26 6,26" fill="#3f7a3f"/>
  <polygon points="20,14 36,38 4,38" fill="#4f8f4f"/>
</svg>`);
const TREE_B = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 56">
  <rect x="17" y="38" width="6" height="16" fill="#6b4a30"/>
  <circle cx="20" cy="24" r="17" fill="#4a8a4a"/>
  <circle cx="11" cy="30" r="11" fill="#3f7a3f"/>
  <circle cx="29" cy="30" r="11" fill="#3f7a3f"/>
</svg>`);
const ROCK_A = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40">
  <ellipse cx="30" cy="34" rx="26" ry="6" fill="rgba(0,0,0,0.18)"/>
  <path d="M6,30 L14,10 L28,4 L44,8 L54,22 L48,32 L20,34 Z" fill="#9b9788"/>
  <path d="M14,10 L28,4 L34,16 L20,20 Z" fill="#b3af9e"/>
</svg>`);
const ROCK_B = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40">
  <ellipse cx="30" cy="34" rx="22" ry="5" fill="rgba(0,0,0,0.18)"/>
  <path d="M10,28 L20,8 L38,6 L50,20 L44,30 L18,32 Z" fill="#8f8b7c"/>
  <path d="M20,8 L38,6 L32,18 Z" fill="#a6a292"/>
</svg>`);
const PATH_SVG = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 70">
  <path d="M12,70 C10,50 8,30 14,0 L20,0 C22,30 20,50 18,70 Z" fill="#b79a68" opacity="0.85"/>
</svg>`);
const WALL_DETAIL_SVG = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 40">
  <rect x="0" y="16" width="70" height="20" fill="#8d8676"/>
  <rect x="0" y="16" width="70" height="4" fill="#726c5e"/>
  <rect x="0" y="6" width="10" height="12" fill="#8d8676"/>
  <rect x="20" y="6" width="10" height="12" fill="#8d8676"/>
  <rect x="40" y="6" width="10" height="12" fill="#8d8676"/>
  <rect x="60" y="6" width="10" height="12" fill="#8d8676"/>
</svg>`);
const OUTBUILDING_SVG = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 42">
  <rect x="6" y="20" width="32" height="20" fill="#c9a97a"/>
  <polygon points="22,2 42,20 2,20" fill="#8a4f3a"/>
  <rect x="18" y="28" width="8" height="12" fill="#5a3b28"/>
</svg>`);
const DECOR_FLOURISH_SVG = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 40">
  <rect x="8" y="14" width="4" height="26" fill="#6b6255"/>
  <circle cx="10" cy="9" r="7" fill="#ffcf6b" opacity="0.9"/>
  <circle cx="10" cy="9" r="3.4" fill="#fff4d6"/>
</svg>`);

export type PropKind =
  | "tree"
  | "rock"
  | "path"
  | "wallDetail"
  | "outbuilding"
  | "decorFlourish";
// groundShadow ve flag ayrı ele alınıyor -- ilki düz CSS radial-gradient
// (asset gerekmiyor), ikincisi mevcut <GuildFlag> bileşeni (bkz.
// CastleScene.tsx). İkisi de img tabanlı bir "varyant" listesine ihtiyaç
// duymuyor.

// Her PropKind için 1-2 görsel varyant -- hangisinin seçileceği hash'e
// bağlı (SADECE görsel çeşitlilik için, bkz. dosya başı yorumu: "hash
// sadece varyasyon için kullanılabilir", KOMPOZİSYONUN kendisi sabit).
export const CASTLE_PROP_DEFS: Record<PropKind, { img: string; aspect: number }[]> = {
  tree: [
    { img: TREE_A, aspect: 40 / 56 },
    { img: TREE_B, aspect: 40 / 56 },
  ],
  rock: [
    { img: ROCK_A, aspect: 60 / 40 },
    { img: ROCK_B, aspect: 60 / 40 },
  ],
  path: [{ img: PATH_SVG, aspect: 30 / 70 }],
  wallDetail: [{ img: WALL_DETAIL_SVG, aspect: 70 / 40 }],
  outbuilding: [{ img: OUTBUILDING_SVG, aspect: 44 / 42 }],
  decorFlourish: [{ img: DECOR_FLOURISH_SVG, aspect: 20 / 40 }],
};

// -----------------------------------------------------------------------
// Sahne kompozisyonu -- DETERMİNİSTİK slot listesi, HEPSİ birlikte
// beliriyor (bkz. isCastleSceneVisible). Pozisyonlar sabit bir
// kompozisyonun parçası (yol kaleye doğru gelir, ağaçlar/kayalar kendi
// doğal boşluklarında durur). Hash SADECE hangi varyantın (`seed`) ve ne
// kadar küçük bir sapmanın (`jitter`) kullanılacağını belirliyor --
// rastgele saçılma DEĞİL.
//
// "7 hex çember" kuralı: her prop'un merkez-uzaklığı + kendi yarı-boyutu
// ~1 tileWidth'i (komşu hex merkezine olan mesafe) AŞMAYACAK şekilde
// seçildi -- yani tüm sahne, kale merkezli 7 hex'lik (1 merkez + 6
// komşu) kümenin dışına taşmıyor, komşu bir kaleyle çakışma riski yok.
// dx/dy birimi: tileWidth'in katı, (0,0) = karo merkezi (bkz. isoCenter).
// paintOrder: "behind" ana kale görselinden ÖNCE (görsel olarak altında/
// yanında), "front" SONRA (görsel olarak üstünde, ör. bayrak).
// -----------------------------------------------------------------------
export type SceneSlot = {
  id: string;
  kind: PropKind;
  dx: number;
  dy: number;
  width: number; // tileWidth biriminde hedef genişlik
  paintOrder: "behind" | "front";
  seed: number;
  jitter?: number; // tileWidth biriminde, ± bu kadar rastgele sapma (sadece görsel doğallık)
};

export const CASTLE_SCENE_SLOTS: SceneSlot[] = [
  { id: "path", kind: "path", dx: 0, dy: 0.6, width: 0.26, paintOrder: "behind", seed: 1 },
  { id: "wallDetail", kind: "wallDetail", dx: -0.68, dy: -0.2, width: 0.48, paintOrder: "behind", seed: 2 },
  { id: "outbuilding", kind: "outbuilding", dx: 0.66, dy: 0.3, width: 0.32, paintOrder: "behind", seed: 3 },
  { id: "treeLeft", kind: "tree", dx: -0.62, dy: 0.18, width: 0.34, paintOrder: "behind", seed: 11, jitter: 0.03 },
  { id: "treeRight", kind: "tree", dx: 0.64, dy: 0.05, width: 0.32, paintOrder: "behind", seed: 12, jitter: 0.03 },
  { id: "rockNear", kind: "rock", dx: -0.4, dy: 0.5, width: 0.3, paintOrder: "behind", seed: 21, jitter: 0.03 },
  { id: "rockFar", kind: "rock", dx: 0.46, dy: 0.54, width: 0.26, paintOrder: "behind", seed: 22, jitter: 0.03 },
  { id: "decorFlourish", kind: "decorFlourish", dx: -0.28, dy: 0.56, width: 0.13, paintOrder: "behind", seed: 31 },
];

export type PlacedProp = {
  slot: SceneSlot;
  variant: { img: string; aspect: number };
  dx: number;
  dy: number;
};

// tile koordinatına göre deterministik (sayfa her açıldığında AYNI kale
// AYNI kompozisyonu üretir -- bkz. worldRegions.ts/mountains.ts'teki aynı
// prensip). Görünürlük (hepsi ya da hiçbiri) çağıran taraftan
// (CastleScene.tsx) `isCastleSceneVisible` ile kontrol ediliyor, bu
// fonksiyon her zaman TÜM kompozisyonu döndürür.
export function buildCastleScene(tile: { x: number; y: number }): PlacedProp[] {
  return CASTLE_SCENE_SLOTS.map((s) => {
    const variants = CASTLE_PROP_DEFS[s.kind];
    const variantIdx = hashXY(tile.x, tile.y, s.seed) % variants.length;
    const jitter = s.jitter ?? 0;
    const jx = jitter ? ((hashXY(tile.x, tile.y, s.seed + 100) % 100) / 100 - 0.5) * 2 * jitter : 0;
    const jy = jitter ? ((hashXY(tile.x, tile.y, s.seed + 200) % 100) / 100 - 0.5) * 2 * jitter : 0;
    return { slot: s, variant: variants[variantIdx], dx: s.dx + jx, dy: s.dy + jy };
  });
}
