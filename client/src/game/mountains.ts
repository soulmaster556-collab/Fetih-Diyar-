// ---------------------------------------------------------------------
// Dekor sistemleri için paylaşılan yardımcılar
// ---------------------------------------------------------------------
// Dağ dekoru (2 sabit görsel, range-a/range-b) kullanıcı isteğiyle haritadan
// tamamen kaldırıldı (bkz. public/decor/mountains -- silindi). Bu dosya adı
// hâlâ "mountains.ts" ama artık kendisi bir dekor türü ÜRETMİYOR -- sadece
// forests.ts/rockyAreas.ts/crystals.ts/worldRegions.ts'in ortak kullandığı
// deterministik hash ve hex-komşuluk yardımcılarını barındırıyor. Ayrı bir
// dosyaya taşımak (rename) bu dört dosyadaki import satırlarını gereksiz
// yere değiştirirdi, o yüzden içerik burada kaldı.
export function hashXY(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

// server/src/game/mapgen.ts'teki HEX_DIRECTIONS ile birebir aynı 6 axial
// komşu yön -- bir hex'in "1 tur"unu (6 komşusunu) bulmak için kullanılıyor.
export const HEX_DIRECTIONS: [number, number][] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

// ---------------------------------------------------------------------
// Ada bazlı dekor profili
// ---------------------------------------------------------------------
// Kullanıcı isteği: "dekorları haritaya değil ada ada dağıt" -- forests/
// rockyAreas/crystals'taki yoğunluk/varyasyon hesapları sadece (x,y) dünya
// koordinatına bakıyordu, hangi adaya ait olduğu HİÇ önemli değildi -- bu
// yüzden bitişik iki ada, fiziksel olarak ayrı olsalar bile istatistiksel
// olarak AYNI dekor karakterine sahipti (aynı yoğunluk, aynı "kaç tanesi
// orman/kaya" oranı). Bu fonksiyon, HER dekor türü (forest/rock/crystal,
// `decorKind` ile ayrılıyor) için HER adaya (islandId) kendi tohumundan
// türeyen FARKLI bir yoğunluk çarpanı (0.5-1.6 arası) veriyor -- sonuç:
// bazı adalar diğerlerinden belirgin şekilde daha ormanlık/kayalık/kristalli
// oluyor, aynı ada tüm dekor türlerinde aynı "zengin/fakir" olmak zorunda
// değil (her decorKind kendi bağımsız rulosunu alıyor). Tamamen deterministik
// (Math.random() değil).
const ISLAND_DECOR_PROFILE_SEED = 5501;

export function islandDecorFactor(islandId: number, decorKind: number): number {
  const roll = hashXY(islandId, decorKind, ISLAND_DECOR_PROFILE_SEED) % 1000;
  return 0.5 + (roll / 1000) * 1.1; // 0.5 .. 1.6
}
