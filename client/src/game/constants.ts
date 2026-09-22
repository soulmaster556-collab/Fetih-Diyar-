export const SESSION_KEY = "fetih-diyari-session";
// Not: WORLD_SIZE burada ve server/src/game/mapgen.ts'te birebir aynı olmalı.
export const WORLD_SIZE = 200;
// Görünen bölgenin kenarlarına eklenen pay (karo cinsinden) — küçük
// kaydırmalarda hemen yeniden istek atmamak için.
export const VIEWPORT_MARGIN = 6;
// Karo genişliği seviyeleri (zoom kademeleri, px). Altıgen yüksekliği =
// genişlik × 2/√3 (bkz. hexMath.ts). En uzak kademe bilerek sınırlı (çok
// uzağa zoom istenmiyor), varsayılan yakın planda başlıyor.
export const TILE_WIDTHS = [72, 104, 144, 200, 272, 320];
// Varsayılan artık 72px (index 2) -- eski varsayılan (46) yerine, "daha yakın
// plan" isteği için bir kademe büyütüldü.
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

// Zemin düz tek renk açık yeşil (bkz. App.css .iso-ground) -- doku/fotoğraf
// tabanlı zemin, komşu karo sınırlarında bal peteği deseni gibi görünüyordu.

// Kale/NPC görselleri hex karoların üzerinde gösteriliyor mu.
export const SHOW_BUILDINGS = true;
