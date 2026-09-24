// Client'taki client/src/game/riversLakes.ts (+ mountains.ts'teki hashXY ve
// hexMath.ts'teki isoCenter) ile BİREBİR aynı göl geometrisinin sunucu
// portu. İki proje ayrı npm paketi olduğu için (bkz. CLAUDE.md, paylaşılan
// kod/workspace yok) bu elle senkron tutulan bir kopya -- tıpkı WORLD_SIZE
// gibi. Sadece "bu (x,y) karosu göl mü" sorusuna cevap vermek için gereken
// minimum alt küme port edildi (dağ/orman/kayalık dekoru zaten sadece
// tile_type === 'EMPTY' karolara yerleşir ve zaten dolu bir karoya asla
// binmez, o yüzden onlara sunucu tarafında karşılık gerekmiyor -- SADECE
// göller `tiles` verisinden tamamen bağımsız, dünya koordinatına göre
// üretildiği için kale/NPC yerleşimiyle çakışabiliyordu).
//
// Amaç: mapgen.ts artık yeni bir NPC/oyuncu kalesini, client'ın "burada göl
// var" diye çizeceği bir karoya YERLEŞTİRMİYOR (bkz. ensureMapGenerated,
// pickRandomEmptyTile, applyLakeLockMigration).
export function hashXY(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

// hexMath.ts'teki isoCenter ile aynı, sadece tileWidth=1 referans birimiyle
// (gerçek piksel değil, client'taki isWaterAtWorldPosition'ın kullandığı
// AYNI oranlı/skewed koordinat uzayı -- bkz. o dosyadaki not).
function isoCenter(x: number, y: number) {
  const tileHeight = 2 / Math.sqrt(3);
  return { cx: x + y / 2, cy: tileHeight * 0.75 * y };
}

type LakeAnchor = { cx: number; cy: number; radius: number };

const LAKE_SEED = 811;
const LAKE_GRID_STEP = 16;

// riversLakes.ts'teki generateLakes ile birebir aynı (pointCount/seed hariç
// -- bunlar sadece SVG kıyı şeklini çizmek için kullanılıyor, "burada göl
// var mı" testine dahil değiller, bkz. isWaterAtWorldPosition).
export function generateLakes(worldSize: number): LakeAnchor[] {
  const center = worldSize / 2;
  const lakes: LakeAnchor[] = [];
  for (let gy = 0; gy < worldSize; gy += LAKE_GRID_STEP) {
    for (let gx = 0; gx < worldSize; gx += LAKE_GRID_STEP) {
      const dx = (gx - center) / 46;
      const dy = (gy - center) / 30;
      const distFromCenter = Math.hypot(dx, dy);
      const threshold = 230 * Math.max(0, 1 - distFromCenter * 0.6);
      const roll = hashXY(gx, gy, LAKE_SEED) % 1000;
      if (roll > threshold) continue;
      const jitterX = (hashXY(gx, gy, LAKE_SEED + 1) % 100) / 100 - 0.5;
      const jitterY = (hashXY(gx, gy, LAKE_SEED + 2) % 100) / 100 - 0.5;
      const cx = Math.min(worldSize - 1, Math.max(0, gx + jitterX * LAKE_GRID_STEP));
      const cy = Math.min(worldSize - 1, Math.max(0, gy + jitterY * LAKE_GRID_STEP));
      const sizeRoll = (hashXY(gx, gy, LAKE_SEED + 3) % 1000) / 1000;
      const radius = 2 + sizeRoll * sizeRoll * 5.5;
      lakes.push({ cx, cy, radius });
    }
  }
  return lakes;
}

// riversLakes.ts'teki isWaterAtWorldPosition ile birebir aynı eşik (%35
// pay) -- kıyıya yakın kök hex'lerin de elenmesi için bilerek cömert.
export function isWaterAtWorldPosition(x: number, y: number, lakes: LakeAnchor[]): boolean {
  const p = isoCenter(x, y);
  for (const lake of lakes) {
    const c = isoCenter(lake.cx, lake.cy);
    const dist = Math.hypot(p.cx - c.cx, p.cy - c.cy);
    if (dist < lake.radius * 1.35) return true;
  }
  return false;
}
