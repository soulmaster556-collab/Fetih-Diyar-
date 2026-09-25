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

type LakeAnchor = { cx: number; cy: number; radius: number; pointCount: number; seed: number };

const LAKE_SEED = 811;
const LAKE_GRID_STEP = 16;

// riversLakes.ts'teki generateLakes ile birebir aynı -- pointCount/seed de
// dahil, çünkü artık isWaterAtWorldPosition de (aşağısı) tıpkı client gibi
// gölün gerçek köşe noktalarına göre test ediyor (eskiden sadece SVG çizimi
// için gerekiyordu, kontrol düz bir daireydi -- bkz. aşağıdaki not).
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
      const pointCount = 7 + (hashXY(gx, gy, LAKE_SEED + 5) % 6);
      lakes.push({ cx, cy, radius, pointCount, seed: gx * 1000 + gy });
    }
  }
  return lakes;
}

// riversLakes.ts'teki lakePolygonPoints/pointInPolygon ile birebir aynı --
// eskiden burada düz bir daire (radius*1.35) kullanılıyordu, ama client'taki
// GÖRSEL göl şekli (buildLakePathD) asimetrik/köşeli bir çokgen, bazı
// yönlerde 1.5x'e kadar taşıyor. Daire çemberi bu çıkıntıları kapsamadığı
// için o aralıkta kalan karolar "kuru" sayılıp üstlerine NPC/kale
// yerleşiyordu -- görselde kalenin gölün içinde durduğu hata buradan
// geliyordu (bkz. sohbet geçmişi). Artık İKİSİ DE (çizim ve bu kontrol)
// AYNI köşe noktalarını kullanıyor, sapma yapısal olarak imkansız.
function lakePolygonPoints(lake: LakeAnchor): { x: number; y: number }[] {
  const center = isoCenter(lake.cx, lake.cy);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < lake.pointCount; i++) {
    const angle = (i / lake.pointCount) * Math.PI * 2;
    const jitter = 0.55 + (hashXY(lake.seed, i, 4001) % 100) / 100 * 0.95;
    const rr = lake.radius * jitter;
    pts.push({ x: center.cx + Math.cos(angle) * rr, y: center.cy + Math.sin(angle) * rr });
  }
  return pts;
}

function pointInPolygon(x: number, y: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isWaterAtWorldPosition(x: number, y: number, lakes: LakeAnchor[]): boolean {
  const p = isoCenter(x, y);
  for (const lake of lakes) {
    if (pointInPolygon(p.cx, p.cy, lakePolygonPoints(lake))) return true;
  }
  return false;
}
