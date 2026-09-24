// Oyuncu flaması: lonca flamasından (guildFlags.ts) BAĞIMSIZ, 3 ayrı eksenli
// bir sistem -- 10 şekil (silüet) × 20 renk × 20 logo. Sunucu sadece bu üç
// küçük integer'ı saklıyor (players.flag_shape/flag_color/flag_logo), görsel
// tamamen client'ta bu tablolardan üretiliyor (bkz. PlayerFlag.tsx).
//
// Şekiller elle yazılmış path yerine küçük yardımcı fonksiyonlarla
// ÜRETİLİYOR (rectShape/swallowtail/singlePoint/rounded/sawtooth) -- 10 ayrı
// jagged path'i elle koordinat koordinat yazmak yerine, ortak bir gövde
// (direk + üst dikdörtgen) üzerine parametrik bir alt-kenar siluet
// bindiriliyor. Tüm şekiller aynı viewBox'ı (0 0 32 64) ve aynı gövde
// kutusunu (x: 5-27, üst y=4, taban y=50) paylaşıyor ki flama boyu/direk
// konumu hangi şekil seçilirse seçilsin tutarlı kalsın.
const VB_LEFT = 5;
const VB_RIGHT = 27;
const VB_TOP = 4;
const VB_BASE = 50;
const VB_MID_X = (VB_LEFT + VB_RIGHT) / 2;

function rectShape(): string {
  return `M${VB_LEFT},${VB_TOP} L${VB_RIGHT},${VB_TOP} L${VB_RIGHT},${VB_BASE} L${VB_LEFT},${VB_BASE} Z`;
}

// notchDepth: taban çizgisinden yukarı doğru iç çentiğin ne kadar derine
// girdiği. tailDrop: iki dış ucun tabanın ne kadar altına sarktığı (0 ise
// çentik var ama sarkan kuyruk yok -- "içe doğru kama" şekli).
function swallowtail(notchDepth: number, tailDrop: number): string {
  const notchY = VB_BASE - notchDepth;
  const tailY = VB_BASE + tailDrop;
  return `M${VB_LEFT},${VB_TOP} L${VB_RIGHT},${VB_TOP} L${VB_RIGHT},${tailY} L${VB_MID_X},${notchY} L${VB_LEFT},${tailY} Z`;
}

// Tek sivri uçlu flama -- pointX ne kadar sola/sağa kayarsa uç o yöne yatık
// görünür.
function singlePoint(pointX: number, pointDrop: number): string {
  const pointY = VB_BASE + pointDrop;
  return `M${VB_LEFT},${VB_TOP} L${VB_RIGHT},${VB_TOP} L${VB_RIGHT},${VB_BASE} L${pointX},${pointY} L${VB_LEFT},${VB_BASE} Z`;
}

function rounded(bulge: number): string {
  const rx = (VB_RIGHT - VB_LEFT) / 2;
  const midY = VB_BASE - 6;
  return `M${VB_LEFT},${VB_TOP} L${VB_RIGHT},${VB_TOP} L${VB_RIGHT},${midY} A${rx},${bulge} 0 0 1 ${VB_LEFT},${midY} Z`;
}

// teeth: diş sayısı, depth: her dişin taban çizgisinin ne kadar altına
// indiği. Sağdan sola zigzag çizip en son sol köşeye (VB_LEFT, VB_BASE)
// kapanıyor.
function sawtooth(teeth: number, depth: number): string {
  const width = VB_RIGHT - VB_LEFT;
  const step = width / (teeth * 2);
  let d = `M${VB_LEFT},${VB_TOP} L${VB_RIGHT},${VB_TOP} L${VB_RIGHT},${VB_BASE} `;
  for (let i = 0; i < teeth * 2 - 1; i++) {
    const x = VB_RIGHT - step * (i + 1);
    const y = i % 2 === 0 ? VB_BASE + depth : VB_BASE;
    d += `L${x},${y} `;
  }
  d += `Z`;
  return d;
}

export const FLAG_SHAPES: { id: number; name: string; path: string }[] = [
  { id: 1, name: "Düz Sancak", path: rectShape() },
  { id: 2, name: "Sığ Kırlangıç", path: swallowtail(10, 4) },
  { id: 3, name: "Derin Kırlangıç", path: swallowtail(22, 10) },
  { id: 4, name: "Sol Yatık Uç", path: singlePoint(9, 10) },
  { id: 5, name: "Sağ Yatık Uç", path: singlePoint(23, 10) },
  { id: 6, name: "Yuvarlak Uç", path: rounded(9) },
  { id: 7, name: "Sığ Testere", path: sawtooth(3, 5) },
  { id: 8, name: "Derin Testere", path: sawtooth(5, 9) },
  { id: 9, name: "Taçlı Kenar", path: sawtooth(4, 6) },
  { id: 10, name: "Kama Çentik", path: swallowtail(14, 0) },
];

// 20 canlı, birbirinden net ayrışan renk. Guild flag'in gradyanının aksine
// düz (solid) renk kullanılıyor ki 20 rengin hepsi tutarlı görünsün (bkz.
// PlayerFlag.tsx'teki ayrı, renkten bağımsız kumaş kıvrımı katmanı).
export const FLAG_COLORS: { id: number; name: string; hex: string }[] = [
  { id: 1, name: "Kızıl", hex: "#e53935" },
  { id: 2, name: "Bordo", hex: "#b71c1c" },
  { id: 3, name: "Turuncu", hex: "#ff7043" },
  { id: 4, name: "Amber", hex: "#ffa000" },
  { id: 5, name: "Altın Sarısı", hex: "#fdd835" },
  { id: 6, name: "Limon Yeşili", hex: "#c0ca33" },
  { id: 7, name: "Zümrüt", hex: "#43a047" },
  { id: 8, name: "Orman Yeşili", hex: "#1b5e20" },
  { id: 9, name: "Teal", hex: "#00897b" },
  { id: 10, name: "Camgöbeği", hex: "#00acc1" },
  { id: 11, name: "Gökyüzü Mavisi", hex: "#039be5" },
  { id: 12, name: "Kraliyet Mavisi", hex: "#1a56db" },
  { id: 13, name: "Çivit", hex: "#3949ab" },
  { id: 14, name: "Mor", hex: "#7b1fa2" },
  { id: 15, name: "Eflatun", hex: "#8e24aa" },
  { id: 16, name: "Macenta", hex: "#d81b60" },
  { id: 17, name: "Gül Pembesi", hex: "#ec407a" },
  { id: 18, name: "Arduvaz Gri", hex: "#607d8b" },
  { id: 19, name: "Kömür", hex: "#37474f" },
  { id: 20, name: "Bronz", hex: "#8d6e63" },
];

// İlk 10'u lonca amblemleriyle (guildFlags.ts) aynı isim/şekil -- kod
// tekrarını önlemek için PlayerFlagLogo bileşeninde aynı path'ler
// kullanılıyor. Kalan 10'u "şimdilik random şekiller" notuna uygun, sade
// yeni placeholder ikonlar.
export const FLAG_LOGOS: { id: number; name: string }[] = [
  { id: 1, name: "Yıldız" },
  { id: 2, name: "Dalga" },
  { id: 3, name: "Ağaç" },
  { id: 4, name: "Elmas" },
  { id: 5, name: "Ay" },
  { id: 6, name: "Kule" },
  { id: 7, name: "Haç" },
  { id: 8, name: "Güneş" },
  { id: 9, name: "Pati" },
  { id: 10, name: "Şerit" },
  { id: 11, name: "Kılıçlar" },
  { id: 12, name: "Kalkan" },
  { id: 13, name: "Yıldırım" },
  { id: 14, name: "Alev" },
  { id: 15, name: "Damla" },
  { id: 16, name: "Çapa" },
  { id: 17, name: "Ok" },
  { id: 18, name: "Taç" },
  { id: 19, name: "Halka" },
  { id: 20, name: "Kurukafa" },
];

export function normalizeFlagShapeId(id: number | null | undefined): number {
  return id && id >= 1 && id <= FLAG_SHAPES.length ? id : 1;
}
export function normalizeFlagColorId(id: number | null | undefined): number {
  return id && id >= 1 && id <= FLAG_COLORS.length ? id : 1;
}
export function normalizeFlagLogoId(id: number | null | undefined): number {
  return id && id >= 1 && id <= FLAG_LOGOS.length ? id : 1;
}
