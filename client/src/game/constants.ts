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
// Kullanıcı isteğiyle ("zoom'u x2 daha uzaklaştır, adaları daha net açık
// görmek istiyorum") uzaklaşma ucuna iki yeni kademe (34, 24) eklendi --
// eski en uzak kademe (48) artık ne varsayılan ne de dizinin sonu, sadece bir
// ara basamak. Varsayılan da eski varsayılandan (109) yaklaşık 2 kat daha
// uzağa (48) çekildi ki haritayı açar açmaz adaların genel şekli tek ekranda
// görünsün; isteyen kullanıcı yine de 2 kademe daha (34, 24) yakınlaşmadan
// önce uzaklaşabilir.
export const TILE_WIDTHS = [24, 34, 48, 63, 83, 109, 144, 189];
export const DEFAULT_TILE_WIDTH_INDEX = 2;

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
