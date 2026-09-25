export const SESSION_KEY = "fetih-diyari-session";
// Not: WORLD_SIZE burada ve server/src/game/mapgen.ts'te birebir aynı olmalı.
export const WORLD_SIZE = 200;
// Görünen bölgenin kenarlarına eklenen pay (karo cinsinden) — küçük
// kaydırmalarda hemen yeniden istek atmamak için.
export const VIEWPORT_MARGIN = 6;
// Karo genişliği seviyeleri (zoom kademeleri, px). Altıgen yüksekliği =
// genişlik × 2/√3 (bkz. hexMath.ts). Kullanıcı geri bildirimi: eski 6 kademe
// ([72,104,144,200,272,320]) uzaklaşırken "az" (72'de tıkanıp kalıyor, sadece
// 2 kademe uzaklaşma payı var), yakınlaşırken "fazla" (200->272->320 arası
// oranlar %36/%18 -- tutarsız, üstteki sıçrama göze batıyor) hissettiriyordu.
// Dizi ~×1.31 sabit oranla (geometrik dizi) 8 kademeye çıkarılmıştı; kullanıcı
// isteğiyle en yakın 2 kademe (248/320) tekrar kaldırıldı -- en yakın zoom
// artık 189px.
export const TILE_WIDTHS = [48, 63, 83, 109, 144, 189];
// Varsayılan başlangıç zoom'u kullanıcı isteğiyle bir kademe geri çekildi
// (144 -> 109, index 4 -> 3) -- standart oyun mesafesi artık biraz daha
// uzaktan, haritadan daha fazlası tek ekranda görünüyor.
export const DEFAULT_TILE_WIDTH_INDEX = 3;

// Kale görsellerinin en-boy oranı (~1.37) -- kutunun dışına taşmasın diye
// NPC kale boyutu bu orana göre hesaplanıyor (bkz. components/MapView.tsx npcBoxWidth).
// object-fit:contain her görselin kendi gerçek oranını koruduğu için NPC'nin
// 3 seviye görselinin birbirinden farklı oranları olması sorun değil -- bu
// sadece dıştaki kutunun oranı.
export const CASTLE_IMAGE_ASPECT = 700 / 512;
export const ICON_MIN_WIDTH = 28;

// Üretim/asker etiketi çok küçük karolarda okunaksız kalacağı için sadece
// yeterince yakınlaştırılmışken gösteriliyor.
export const LABEL_MIN_WIDTH = 40;

// Zemin artık hex başına değil, tek parça bir dünya katmanı (bkz.
// game/worldRegions.ts, App.css .world-terrain).

// Kale/NPC görselleri hex karoların üzerinde gösteriliyor mu.
export const SHOW_BUILDINGS = true;
