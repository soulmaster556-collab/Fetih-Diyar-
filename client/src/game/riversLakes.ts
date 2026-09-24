import { isoCenter } from "./hexMath";
import { hashXY } from "./mountains";

// ---------------------------------------------------------------------
// Lakes (world water)
// ---------------------------------------------------------------------
// worldRegions.ts'teki biyom anchor sistemiyle AYNI mimari prensip: tamamen
// dünya koordinatına göre, `tiles` (yüklü pencere) verisinden TAMAMEN
// bağımsız, deterministik (Math.random() YOK, hashXY -- mountains.ts'teki
// aynı hash, bkz. o dosya). Göl geometrisi WORLD_SIZE'a göre TEK SEFER
// üretilir; zoom sadece piksel konumunu yeniden ölçekler (buildLakePathD
// tileWidth alıyor), hangi karoların o an yüklü olduğu bu geometriyi hiç
// etkilemez -- tıpkı .world-terrain gibi.
//
// Nehir sistemi kullanıcı isteğiyle tamamen kaldırıldı -- şerit/nehir
// şekli artık YOK, sadece asimetrik, farklı büyüklüklerde göller var.

export type LakeAnchor = {
  cx: number; // hex/dünya koordinatı (isoCenter uzayı)
  cy: number;
  radius: number; // hex birimi, ortalama yarıçap -- göller arası BÜYÜK farkla değişir
  pointCount: number; // 7-12 arası -- daha az nokta köşeli, daha çok nokta daha pürüzsüz/karmaşık bir asimetri verir
  seed: number;
};

// Anchor'lar WORLD_SIZE/2 (dünyanın ortası, bkz. server/mapgen.ts'in adayı
// da tam ortada üretmesi) etrafında yoğunlaşan bir ağırlıkla, kaba bir
// ızgara + hash üzerinden üretiliyor -- worldRegions.ts'teki
// generateBiomeAnchors ile aynı desen (Math.random() değil, deterministik).
// Kenarlara doğru olasılık düşüyor ki su, oyuncuların gerçekten gezdiği
// bölgeyle ilgisiz, boş okyanus köşelerinde rastgele belirmesin.
const LAKE_SEED = 811;
const LAKE_GRID_STEP = 16;

export function generateLakes(worldSize: number): LakeAnchor[] {
  const center = worldSize / 2;
  const lakes: LakeAnchor[] = [];
  for (let gy = 0; gy < worldSize; gy += LAKE_GRID_STEP) {
    for (let gx = 0; gx < worldSize; gx += LAKE_GRID_STEP) {
      // Eliptik ağırlık -- x yönünde daha toleranslı, y yönünde daha sıkı
      // (kaba yarı-genişlik/yarı-yükseklik oranı). Sunucunun (mapgen.ts)
      // ürettiği tek ada dünyanın tam ortasında ama enine (genişlik >
      // yükseklik) bir dikdörtgen; dairesel bir ağırlık göllerin çoğunu
      // adanın kuzey/güneyindeki boş denize düşürüyordu. Kesin sunucu
      // sabitlerine (RECT_ISLAND_WIDTH/HEIGHT) bağlanmadan -- client/server
      // ayrımı bozulmasın diye -- kaba/yaklaşık bir oran kullanılıyor.
      const dx = (gx - center) / 46;
      const dy = (gy - center) / 30;
      const distFromCenter = Math.hypot(dx, dy); // ~0 merkezde, ~1 ada kenarında
      const threshold = 230 * Math.max(0, 1 - distFromCenter * 0.6); // 1000 üzerinden
      const roll = hashXY(gx, gy, LAKE_SEED) % 1000;
      if (roll > threshold) continue;
      const jitterX = (hashXY(gx, gy, LAKE_SEED + 1) % 100) / 100 - 0.5;
      const jitterY = (hashXY(gx, gy, LAKE_SEED + 2) % 100) / 100 - 0.5;
      const cx = Math.min(worldSize - 1, Math.max(0, gx + jitterX * LAKE_GRID_STEP));
      const cy = Math.min(worldSize - 1, Math.max(0, gy + jitterY * LAKE_GRID_STEP));
      // 2 (küçük gölet) - 7.5 (orta/büyük göl) hex birimi arası -- "farklı
      // büyüklüklerde göller" için geniş ama adanın yoğun NPC bölgesini
      // toptan yutacak kadar devasa değil (ilk denemede radius~13 bir göl
      // koca bir kale kümesini suya gömmüştü).
      const sizeRoll = (hashXY(gx, gy, LAKE_SEED + 3) % 1000) / 1000;
      const radius = 2 + sizeRoll * sizeRoll * 5.5; // kare alma: küçükler daha sık, büyükler nadir
      const pointCount = 7 + (hashXY(gx, gy, LAKE_SEED + 5) % 6); // 7-12
      lakes.push({ cx, cy, radius, pointCount, seed: gx * 1000 + gy });
    }
  }
  return lakes;
}

// Bir gölün kapalı, organik ("tek hex'e sıkışmayan, düzensiz kıyılı",
// ASİMETRİK) şeklini SVG path'ine çeviriyor. Teknik: merkez etrafında N
// nokta (her biri hash'e göre yarıçapı BELİRGİN ölçüde sapan -- simetrik
// bir daire değil), sonra ardışık noktaların ORTA noktalarından geçen
// quadratic Bézier'lerle (klasik "Catmull-Rom benzeri" yumuşatma) kapalı,
// köşesiz bir kıyı çizgisi -- düz bir çokgen DEĞİL. Jitter'lar BİLEREK
// ekran-piksel uzayında (isoCenter'dan SONRA), hex-koordinat uzayında
// değil -- aksi halde hex ızgarasının eğikliği (isoCenter'daki x+y/2
// çarpanı) göl şeklini paralelkenar gibi çarpıtırdı (bkz. worldRegions.ts'
// teki biyom lekelerinin AYNI sebeple piksel uzayında dairesel
// radial-gradient kullanması).
export function buildLakePathD(lake: LakeAnchor, tileWidth: number): string {
  const center = isoCenter(lake.cx, lake.cy, tileWidth);
  const r = lake.radius * tileWidth;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < lake.pointCount; i++) {
    const angle = (i / lake.pointCount) * Math.PI * 2;
    // 0.55-1.5 arası -- eski (0.7-1.25) dardan belirgin şekilde genişletildi
    // ki göl daireye değil, gerçekten asimetrik/düzensiz bir yamaya benzesin.
    const jitter = 0.55 + (hashXY(lake.seed, i, 4001) % 100) / 100 * 0.95;
    const rr = r * jitter;
    pts.push({ x: center.cx + Math.cos(angle) * rr, y: center.cy + Math.sin(angle) * rr });
  }
  return closedSmoothPath(pts);
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function closedSmoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  const start = midpoint(pts[n - 1], pts[0]);
  let d = `M ${start.x} ${start.y} `;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const m = midpoint(cur, next);
    d += `Q ${cur.x} ${cur.y} ${m.x} ${m.y} `;
  }
  return d + "Z";
}

export type WaterFeatures = { lakes: LakeAnchor[] };

// forests.ts/rockyAreas.ts (ve MapView.tsx'teki dağ render-filtresi) bu TEK
// fonksiyonla "burada su var mı" soruyor. Kontrol SADECE kök hex noktasına
// bakıyor (forest/rock/mountain cluster'ların kendi sprite'ı jitter+scale ile
// kök hex'in biraz dışına taşabiliyor) -- bu yüzden pay bilerek cömert
// tutuldu (yarıçapın %35 fazlası) ki kıyıya yakın kök hex'ler zaten elensin,
// sprite kıyıyı nadiren kesişsin. worldRegions.ts'teki sampleBiomeIntensity
// ile aynı prensip: isoCenter(_,_,1) referans birimiyle, tileWidth'ten
// (zoom) TAMAMEN bağımsız, saf koordinat karşılaştırması.
//
// `extraMarginHexUnits` -- "ağaçlar hâlâ göle taşıyor" düzeltmesi: %35'lik
// pay tek başına yetmiyordu çünkü orman/kayalık/dağ sprite'ları KÖK hex'in
// ÇOK ötesine taşabiliyor (bkz. forests.ts FOREST_CLUSTER_DEFS scale ~1.1-1.5
// + jitter, mountains.ts scale 2.2). Kök hex "kuru" olsa bile sprite'ın
// kendisi komşu bir göle bindirebiliyordu. Çağıran taraf (forests/rockyAreas/
// MapView dağ filtresi) kendi sprite'ının en kötü taşma payına göre ekstra
// bir hex-birimi payı geçiyor -- bu, göllerin sık kümelendiği ("spam")
// bölgelerde de doğal olarak işliyor: örtüşen göllerin payları da örtüşüp
// tek, daha geniş bir dışlama alanı oluşturuyor, ayrı bir "yoğun bölge"
// tespiti gerekmiyor.
export function isWaterAtWorldPosition(
  x: number,
  y: number,
  water: WaterFeatures,
  extraMarginHexUnits = 0
): boolean {
  const p = isoCenter(x, y, 1);
  for (const lake of water.lakes) {
    const c = isoCenter(lake.cx, lake.cy, 1);
    const dist = Math.hypot(p.cx - c.cx, p.cy - c.cy);
    if (dist < lake.radius * 1.35 + extraMarginHexUnits) return true;
  }
  return false;
}
