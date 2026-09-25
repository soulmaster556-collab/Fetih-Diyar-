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

// ---------------------------------------------------------------------
// Kıyı şeridi -- İKİNCİ deneme (bkz. sohbet geçmişi: ilk deneme dönen
// dikdörtgen segmentlerdi, eğri üzerinde farklı açılarda döndükleri için
// aralarında üçgen boşluklar/dikişler oluşuyordu -- "fasetleme" değil,
// gözle bariz bir testere-dişi hatasıydı, geri alındı).
//
// Bu sefer TEK bir SVG path + TEK bir radyal gradyan -- hiçbir parça/dikiş
// YOK, matematiksel olarak sürekli. Teknik: gölün kendi noktalarını
// (lakePolygonPoints) MARGIN kadar dışarı itilmiş haliyle ikinci, daha
// BÜYÜK bir kapalı eğri çiziyoruz (buildLakePathD ile birebir aynı çizim
// fonksiyonu, closedSmoothPath). Bu büyük şekil merkezden dışa doğru su->
// kum->şeffaf (çim'e karışsın diye) giden bir radialGradient ile dolduruluyor.
// Render sırasında (bkz. MapView.tsx) bu şekil .world-water'ın (gerçek göl
// dolgusu, KÜÇÜK polygon) ALTINA konuyor -- küçük olan üstte kaldığı için
// onu tamamen örtüyor, sadece aradaki halka (MARGIN kadar) görünür kalıyor.
//
// Tek dezavantaj: gradyan TEK bir merkez+yarıçapa göre (dairesel) tanımlı,
// ama göl köşeli/asimetrik (jitter 0.55-1.5x) -- yani geçiş bandının gerçek
// kenarla hizası açıya göre biraz kayar (bazı yönlerde kum biraz erken/geç
// başlar gibi görünebilir). Bu KABUL EDİLEBİLİR bir kusur -- doğal bir
// kumsalın genişliği zaten sabit değildir, ve en önemlisi HİÇBİR YERDE sert
// bir dikiş/boşluk YOK (gradyan matematiksel olarak sürekli), ki asıl
// reddedilen kusur buydu.
export const COAST_BAND_MARGIN_HEX = 2.2;

export function buildCoastRingPathD(lake: LakeAnchor, tileWidth: number): string {
  return closedSmoothPath(lakePolygonPoints(lake, tileWidth, COAST_BAND_MARGIN_HEX));
}

// MapView.tsx'teki <radialGradient>'i userSpaceOnUse ile kuracak konum/
// yarıçap bilgisi -- gradyanın kapsaması gereken EN UZAK nokta jitter'ın
// üst sınırı (1.5x) + margin'e göre (bkz. lakePolygonPoints), aksi halde
// gradyanın kendisi köşelerde şekli tam kaplamayabilir.
export function coastGradientGeometry(lake: LakeAnchor, tileWidth: number) {
  const center = isoCenter(lake.cx, lake.cy, tileWidth);
  const r = (lake.radius * 1.5 + COAST_BAND_MARGIN_HEX) * tileWidth;
  return { cx: center.cx, cy: center.cy, r };
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
