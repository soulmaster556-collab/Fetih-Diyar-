import type { Tile } from "../api";

// ---------------------------------------------------------------------
// Dağ / dekor sistemi
// ---------------------------------------------------------------------
// Her dağ TEK bir mantıksal hex'e ait; görseli o hex'ten `scale` oranında
// taşarak çiziliyor. Kural: bir objenin (kale/NPC/dağ) 6 komşu hex'i HER
// ZAMAN boş kalır (bkz. `occupied` kontrolü) -- böylece taşma asla başka
// bir objeyle çakışmaz. Eskiden dağlar birden fazla hex'e yayılıyordu ve
// hem üst üste binme hem de komşu çimle görünür "dikiş" oluşuyordu.
//
// Yerleştirme sunucuya/DB'ye HİÇ dokunmadan tamamen CLIENT tarafında,
// koordinata göre DETERMİNİSTİK yapılıyor (bkz. hashXY -- worldRegions.ts'teki
// biyom anchor üretimi de aynı hash'i kullanıyor: Math.random() değil,
// sayfa her açıldığında AYNI karolarda aynı dağ çıksın).
export type MountainDef = {
  id: string;
  img: string;
  scale: number; // görsel, kendi hex'inin kaç katı bir kutuya sığdırılıp ortalanacak (kale ikonlarındaki taşma payı gibi)
};

// Kullanıcı isteğiyle ("dağları %75 büyüt") eski 2.2 -> 3.85.
export const MOUNTAIN_DEFS: MountainDef[] = [
  { id: "range-a", img: "/decor/mountains/range-a.png", scale: 3.85 },
  { id: "range-b", img: "/decor/mountains/range-b.png", scale: 3.85 },
];

// Basit, hızlı, deterministik tam sayı hash'i (Math.random() DEĞİL -- aynı
// (x,y,seed) her zaman aynı sonucu vermeli, bkz. yukarıdaki not).
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

// Dekor yoğunluğu (büyüdükçe seyrekleşir) -- dağlar harita genelinde
// seyrek/nadir kalsın diye yüksek tutuluyor. Kullanıcı isteğiyle ("dekorları
// azalt") eski 240'tan daha da seyrekleştirildi.
export const MOUNTAIN_DENSITY = 320;

export type PlacedMountain = {
  key: string;
  def: MountainDef;
  rootX: number;
  rootY: number;
  frontSortKey: number; // painter's algorithm sıralaması için (bkz. sortedTiles)
  // rockyAreas.ts'teki `rotationDeg` ile aynı prensip: sadece 2 sabit görsel
  // (range-a/range-b) olduğu için rotasyon/ayna YOKSA harita genelinde her
  // dağ birebir aynı açıda, "hep yatay bir sırt" gibi tekrar ediyor --
  // deterministik hash'e göre küçük bir dönüş + %50 ihtimalle yatay ayna
  // (flipX) bu tekrarı kırıyor. transform-origin "bottom center" ile
  // uygulanıyor (bkz. MapView.tsx) ki taban hizası bozulmasın.
  rotationDeg: number;
  flipX: boolean;
};

export function computePlacedMountains(tiles: Tile[]): PlacedMountain[] {
  // Bir hex "işgal edilmiş" sayılır ki komşusuna YENİ bir dekor kökü
  // yerleştirilemesin -- ya gerçek bir kale/NPC karosudur ya da daha önce
  // bu döngüde bir dağın kökü olarak seçilmiştir. Kale-kale bitişikliği
  // BİLEREK burada kısıtlanmıyor (oyuncular komşu kareyi fethederek
  // genişler, bu normal oynanış) -- kural sadece dekorun kendisine ve
  // dekorun kalelere/başka dekora olan mesafesine uygulanıyor.
  const occupied = new Set<string>();
  for (const t of tiles) {
    if (t.tileType !== "EMPTY") occupied.add(`${t.x},${t.y}`);
  }

  const candidates = tiles.filter(
    (t) => t.tileType === "EMPTY" && hashXY(t.x, t.y, 1) % MOUNTAIN_DENSITY === 0
  );
  // Çakışan adaylar arasındaki önceliğin her zaman aynı (deterministik)
  // sırada çözülmesi için koordinataya göre sırala.
  candidates.sort((a, b) => a.x - b.x || a.y - b.y);

  const placed: PlacedMountain[] = [];
  for (const t of candidates) {
    const key = `${t.x},${t.y}`;
    if (occupied.has(key)) continue;
    const touchesOccupied = HEX_DIRECTIONS.some(([dx, dy]) => occupied.has(`${t.x + dx},${t.y + dy}`));
    if (touchesOccupied) continue;

    const defIndex = hashXY(t.x, t.y, 2) % MOUNTAIN_DEFS.length;
    const def = MOUNTAIN_DEFS[defIndex];
    occupied.add(key);
    // ±12° -- rocky kümelerdeki ±7°'den biraz daha geniş (dağ görseli daha
    // büyük/dikkat çekici olduğu için varyasyon da daha belirgin olmalı),
    // ama ışık/gölgenin baskın yönünü bozacak kadar (90°) DEĞİL.
    const rotationDeg = ((hashXY(t.x, t.y, 3) % 100) / 100 - 0.5) * 24;
    const flipX = hashXY(t.x, t.y, 4) % 2 === 0;
    placed.push({
      key: `${key}:${def.id}`,
      def,
      rootX: t.x,
      rootY: t.y,
      frontSortKey: t.x + t.y,
      rotationDeg,
      flipX,
    });
  }
  return placed;
}

// Bir saldırı hattının (from -> to) bir dağın kapladığı EKRAN dairesine
// (merkez+yarıçap) çok yaklaşıp yaklaşmadığını kontrol edip, öyleyse dağı
// atlayacak şekilde bükülmüş bir SVG path (quadratic Bézier) üretir. Bu
// bilerek GERÇEK pathfinding DEĞİL -- sadece en çok engel olan TEK dağa
// göre basit bir kavis.
export type MountainScreenBox = {
  key: string;
  centerX: number;
  centerY: number;
  radius: number;
};

export function bendAttackPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  mountains: MountainScreenBox[],
  tileWidth: number
): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1) return `M ${fromX} ${fromY} L ${toX} ${toY}`;

  let best: { t: number; dist: number; box: MountainScreenBox } | null = null;
  for (const box of mountains) {
    const t = Math.max(0, Math.min(1, ((box.centerX - fromX) * dx + (box.centerY - fromY) * dy) / lenSq));
    if (t < 0.06 || t > 0.94) continue; // kaynağa/hedefe çok yakınsa bükme (uçlar zaten karonun üzerinde)
    const closestX = fromX + t * dx;
    const closestY = fromY + t * dy;
    const dist = Math.hypot(box.centerX - closestX, box.centerY - closestY);
    if (dist < box.radius && (!best || dist < best.dist)) {
      best = { t, dist, box };
    }
  }
  if (!best) return `M ${fromX} ${fromY} L ${toX} ${toY}`;

  const len = Math.sqrt(lenSq);
  const perpX = -dy / len;
  const perpY = dx / len;
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const toBoxX = best.box.centerX - (fromX + best.t * dx);
  const toBoxY = best.box.centerY - (fromY + best.t * dy);
  // Dağın hangi tarafta olduğunun TERSİNE bük.
  const side = perpX * toBoxX + perpY * toBoxY >= 0 ? -1 : 1;
  const clearance = best.box.radius - best.dist + tileWidth * 0.9;
  // Quadratic Bézier'in orta noktadaki sapması, kontrol noktasının kiriş
  // ortasına göre sapmasının YARISI kadardır -- istenen boşluğu (clearance)
  // elde etmek için kontrol noktasını 2 katı kadar itiyoruz.
  const cpx = midX + perpX * side * clearance * 2;
  const cpy = midY + perpY * side * clearance * 2;
  return `M ${fromX} ${fromY} Q ${cpx} ${cpy} ${toX} ${toY}`;
}
