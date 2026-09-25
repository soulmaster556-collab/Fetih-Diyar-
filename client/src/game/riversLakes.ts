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

// Gölün asimetrik/düzensiz kıyı noktalarını üretir -- hem SVG çizimi
// (buildLakePathD) hem de "burada su var mı" testi (isWaterAtWorldPosition)
// AYNI bu noktaları kullanıyor, böylece görünen şekil ile oyun mantığının
// su saydığı alan ASLA birbirinden sapamaz (eskiden ikisi ayrı ayrı --
// çizim bu noktalarla, kontrol ise düz bir daireyle -- hesaplanıyordu; bu
// da gölün köşeli/asimetrik çıkıntılarının bazı yönlerde daire sınırının
// dışına taşmasına, dolayısıyla "kaleler gölün içinde duruyor" hatasına yol
// açıyordu, bkz. sohbet geçmişi). `marginHexUnits`: forests/rockyAreas/
// crystals'ın kendi sprite taşma payı için her köşe noktasını merkezden
// dışarı doğru bu kadar hex-birimi ittiriyor (eski `extraMarginHexUnits`
// ile aynı amaç, artık daireye değil bu poligona uygulanıyor).
function lakePolygonPoints(
  lake: LakeAnchor,
  tileWidth: number,
  marginHexUnits = 0
): { x: number; y: number }[] {
  const center = isoCenter(lake.cx, lake.cy, tileWidth);
  const r = lake.radius * tileWidth;
  const margin = marginHexUnits * tileWidth;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < lake.pointCount; i++) {
    const angle = (i / lake.pointCount) * Math.PI * 2;
    // 0.55-1.5 arası -- eski (0.7-1.25) dardan belirgin şekilde genişletildi
    // ki göl daireye değil, gerçekten asimetrik/düzensiz bir yamaya benzesin.
    const jitter = 0.55 + (hashXY(lake.seed, i, 4001) % 100) / 100 * 0.95;
    const rr = r * jitter + margin;
    pts.push({ x: center.cx + Math.cos(angle) * rr, y: center.cy + Math.sin(angle) * rr });
  }
  return pts;
}

// Ray-casting point-in-polygon -- standart, kapalı çokgen için (bkz.
// https://en.wikipedia.org/wiki/Point_in_polygon). closedSmoothPath'in
// çizdiği yumuşatılmış eğri, bu ham noktaların birleştirdiği düz çokgene
// çok yakın seyrediyor (Bézier eğrileri ardışık nokta ORTALARINDAN geçiyor,
// dışına taşmıyor), o yüzden ham noktalarla test etmek hem yeterince
// doğru hem de kapalı-form bir eğri kesişim hesabından çok daha basit/hızlı.
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

export function buildLakePathD(lake: LakeAnchor, tileWidth: number): string {
  return closedSmoothPath(lakePolygonPoints(lake, tileWidth));
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

// ---------------------------------------------------------------------
// Kıyı şeridi (çim -> kum -> su geçiş dokusu, bkz. public/terrain/coastline-1.webp)
// ---------------------------------------------------------------------
// Gölün kıyı çizgisi boyunca döndürülmüş küçük doku parçaları dizmek için
// closedSmoothPath'in çizdiği AYNI kapalı Bézier eğrisi üzerinde örnekleme
// yapıyor -- path'in kendi 'd' string'ini ayrıştırmak yerine, closedSmoothPath
// ile TAMAMEN aynı quadratic Bézier segmentlerini (kontrol noktaları:
// midpoint(prev,cur) -> cur -> midpoint(cur,next)) burada yeniden hesaplayıp
// her segmenti stepsPerVertex parçaya bölüyoruz -- böylece örnek noktalar
// ekranda görünen eğrinin TAM üstünde duruyor, ayrı bir yaklaşık eğri değil.
function quadraticBezierPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

export type CoastSegment = {
  key: string;
  x: number; // ekran piksel konumu (segment merkezi)
  y: number;
  angleDeg: number; // CSS rotate() değeri -- dokunun "çim" ucu dışa (kara tarafına) baksın diye
  length: number; // kıyı boyunca (döşemenin genişliği)
};

// Her göl için kıyı boyunca eşit aralıklı örnekler üretir. `stepsPerVertex`
// köşe başına kaç segment demek (fazlası daha pürüzsüz ama daha çok DOM
// elemanı). Dokunun kıyıya dik derinliği (çim-kum-su'nun tamamı) segment
// başına değil ÇAĞIRAN tarafta (MapView.tsx) sabit bir div height olarak
// veriliyor -- burada sadece kıyı boyunca konum/açı/uzunluk üretiliyor.
// Segment uzunluğu komşularla örtüşsün diye (bkz. OVERLAP_FACTOR) örnekler
// arası mesafeden biraz büyük tutuluyor.
const OVERLAP_FACTOR = 1.5;

export function computeCoastSegments(
  lakes: LakeAnchor[],
  tileWidth: number,
  stepsPerVertex = 4
): CoastSegment[] {
  const segments: CoastSegment[] = [];
  lakes.forEach((lake, lakeIdx) => {
    const pts = lakePolygonPoints(lake, tileWidth);
    const n = pts.length;
    if (n < 3) return;
    const center = isoCenter(lake.cx, lake.cy, tileWidth);

    // Bézier eğrisi üzerindeki tüm örnek noktaları önce toplanıyor (açı ve
    // segment uzunluğu, ardışık örnekler arasındaki mesafeden hesaplanacağı
    // için hepsine ihtiyaç var).
    const curvePts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      const m0 = midpoint(prev, cur);
      const m1 = midpoint(cur, next);
      for (let s = 0; s < stepsPerVertex; s++) {
        curvePts.push(quadraticBezierPoint(m0, cur, m1, s / stepsPerVertex));
      }
    }

    const cn = curvePts.length;
    for (let i = 0; i < cn; i++) {
      const p = curvePts[i];
      const nextP = curvePts[(i + 1) % cn];
      const prevP = curvePts[(i - 1 + cn) % cn];
      // Teğet yönü: bir önceki/sonraki örnekten (merkezi fark) -- eğrinin
      // yerel akış yönü, segmentin "kıyı boyunca" eksenini verir.
      const tangentAngle = Math.atan2(nextP.y - prevP.y, nextP.x - prevP.x);
      // Dışa (kara) yön: merkezden örneğe giden vektör -- dokunun "çim" ucu
      // (üst kenarı) bu yöne baksın istiyoruz. Teğeti +90/-90 çevirip
      // hangisinin merkezden uzaklaştığına (dışa baktığına) bakıyoruz.
      const outward = { x: p.x - center.cx, y: p.y - center.cy };
      const perp = { x: -Math.sin(tangentAngle), y: Math.cos(tangentAngle) };
      const sign = perp.x * outward.x + perp.y * outward.y >= 0 ? 1 : -1;
      const outwardAngle = tangentAngle + (sign > 0 ? Math.PI / 2 : -Math.PI / 2);
      // CSS rotate(): 0deg'de div'in "üstü" (-Y yönü, dokunun çim ucu) ekranda
      // yukarı bakar (-90deg konumunda) -- bu yüzden istenen dışa açıya
      // ulaşmak için +90 ekleniyor (bkz. dosya başı yorumundaki türetme).
      const angleDeg = (outwardAngle * 180) / Math.PI + 90;
      const length = Math.hypot(nextP.x - p.x, nextP.y - p.y) * OVERLAP_FACTOR;

      segments.push({
        key: `${lakeIdx}:${i}`,
        x: p.x,
        y: p.y,
        angleDeg,
        length: Math.max(length, 1),
      });
    }
  });
  return segments;
}

export type WaterFeatures = { lakes: LakeAnchor[] };

// forests.ts/rockyAreas.ts/crystals.ts (ve MapView.tsx'teki dağ
// render-filtresi) bu TEK fonksiyonla "burada su var mı" soruyor, mapgen.ts
// (sunucu) da NPC/kale yerleşimini aynı mantıkla dışlıyor (bkz. decor.ts --
// elle senkron tutulan port). Kontrol SADECE kök hex noktasına bakıyor
// (sprite'lar jitter+scale ile kök hex'in biraz dışına taşabiliyor), gerçek
// gölün noktalarına göre (artık düz bir daireye göre DEĞİL, yukarıdaki
// lakePolygonPoints/pointInPolygon) test ediliyor. worldRegions.ts'teki
// sampleBiomeIntensity ile aynı prensip: isoCenter(_,_,1) referans
// birimiyle, tileWidth'ten (zoom) TAMAMEN bağımsız, saf koordinat
// karşılaştırması.
//
// `extraMarginHexUnits` -- orman/kayalık/dağ sprite'ları KÖK hex'in ÇOK
// ötesine taşabiliyor (bkz. forests.ts FOREST_CLUSTER_DEFS scale ~1.1-1.5
// + jitter, mountains.ts scale 2.2). Kök hex "kuru" olsa bile sprite'ın
// kendisi komşu bir göle bindirebiliyordu. Çağıran taraf (forests/rockyAreas/
// crystals/MapView dağ filtresi) kendi sprite'ının en kötü taşma payına göre
// ekstra bir hex-birimi payı geçiyor -- lakePolygonPoints bu payı her köşe
// noktasını merkezden dışarı iterek uyguluyor, bu yüzden göllerin sık
// kümelendiği ("spam") bölgelerde de doğal olarak işliyor: örtüşen göllerin
// payları da örtüşüp tek, daha geniş bir dışlama alanı oluşturuyor.
export function isWaterAtWorldPosition(
  x: number,
  y: number,
  water: WaterFeatures,
  extraMarginHexUnits = 0
): boolean {
  const p = isoCenter(x, y, 1);
  for (const lake of water.lakes) {
    const pts = lakePolygonPoints(lake, 1, extraMarginHexUnits);
    if (pointInPolygon(p.cx, p.cy, pts)) return true;
  }
  return false;
}
