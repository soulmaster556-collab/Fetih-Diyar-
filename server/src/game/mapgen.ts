import { pool, hasMigration, markMigration } from "../db.js";
import { productionForLevel } from "./resources.js";
import { generateLakes, isWaterAtWorldPosition } from "./decor.js";
import type { Settings } from "./settings.js";
import type { TileType } from "../types.js";

// Not: WORLD_SIZE burada ve client/src/game/constants.ts'te birebir aynı olmalı —
// ikisi de izometrik/harita hesaplarında kullanıyor.
const WORLD_SIZE = 200;

// Adalar dünyaya rastgele saçılmıyor: WORLD_SIZE bir GRID_COLS × GRID_ROWS
// ızgarasına bölünüyor, her hücreye bir tohum konuyor ve TÜM dünya bu
// tohumlara göre bir VORONOI diyagramına ayrılıyor (bkz. generateIslandLayout
// içindeki voronoiOwner hesabı) -- her karo, hangi tohuma hex-mesafe olarak
// en yakınsa o adanın bölgesi sayılır. Adalar kendi bölgelerini (BORDER_MARGIN
// payı hariç) doldurana kadar büyüdüğü için (hedef boyut sınırı yok) iki
// komşu ada HER YERDE aynı, tutarlı genişlikte bir su şeridiyle ayrılır --
// rastgele/değişken boşluk MATEMATİKSEL OLARAK imkansız (eski "hücre + taşma
// dikdörtgeni" yöntemi bunu garanti edemiyordu, "adalar arasında saçma
// boşluklar var" geri bildirimi buradan geliyordu). BORDER_MARGIN=0 (tam
// sınıra kadar doldur) da denendi ama %90+ kara kapsamıyla neredeyse tek düz
// blok oldu, ayrı ada hissi vermedi -- bkz. generateIslandLayout içindeki
// BORDER_MARGIN yorumu.
// Hücre sayısından daha az ada üretilerek (ISLAND_COUNT < GRID_COLS×GRID_ROWS)
// birkaç hücre boş deniz olarak kalır — uzaktan bakınca aşırı düzenli/ızgara
// gibi görünmesini engelleyen doğal boşluklar.
//
// Kullanıcı isteği ("dünyada baştan sona bitişik bir takımada olsun, adalar
// arası tek değil birkaç geçiş/köprü olabilsin"): ızgara 6×6'dan 7×7'ye (49
// hücre) sıklaştırıldı, ISLAND_COUNT da 10'dan 45'e çıkarıldı -- hücrelerin
// neredeyse tamamı (49'da 45'i) dolu, sadece birkaçı doğal boşluk için boş
// kalıyor. Köprüler de artık her adanın SADECE bir komşusuna değil, ızgarada
// gerçekten bitişik olduğu HER komşusuna kuruluyor (bkz. generateBridges) --
// bu yüzden iki ada kümesi arasında birden fazla geçiş noktası olabiliyor.
const GRID_COLS = 7;
const GRID_ROWS = 7;
// Kullanıcı isteğiyle (çoklu ada + köprü) tek dev adadan çoklu adaya geri
// dönüldü. ISLAND_COUNT === 1 olduğunda generateIslandLayout() yukarıdaki
// GRID_COLS×GRID_ROWS hücre sistemini tamamen atlayıp doğrudan
// generateRectangleIsland()'ı çağırıyordu (düz kenarlı dikdörtgen) -- o kod
// yolu hâlâ duruyor, ISLAND_COUNT'u tekrar 1 yapmak yeterli geri dönüş için.
const ISLAND_COUNT: number = 45;
// Köprüler kısa/dar bir geçiş hissi vermeli -- kullanıcı isteği net: "uzun
// köprü istemiyorum". Gerçek üst sınır her zaman bunun VE canlı
// naval_attack_range ayarının (bkz. generateIslandLayout yorumu) küçüğü,
// yani bu sabit hiçbir zaman aşılmaz, naval_attack_range daha yüksek
// ayarlansa bile.
const MAX_BRIDGE_HEX_LENGTH_HARD_CAP = 8;
// Izgara hücrelerinin 8 yönlü komşuluğu (çapraz dahil) -- pickClusteredCellIndices
// (kümeleme) VE generateBridges (hangi ada çiftlerinin köprüyle bağlanacağı)
// AYNI komşuluk tanımını kullanıyor, aksi halde kümelenmiş ama köprüsüz
// (ya da tam tersi) ada çiftleri ortaya çıkabilir.
const GRID_DIRS_8: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
// Voronoi bölgesini TAMAMEN doldurana kadar büyüyen bir ada, eski sabit
// hedefli (400-650 karo) büyümeden çok daha fazla adım gerektirebiliyor
// (bölge boyutu ~800+ karo olabilir) -- bölge gerçekten dolduğunda art arda
// çok sayıda "yer yok" denemesi normal, bu yüzden durak sınırı yüksek tutulu
// (erken kesilirse ada bölgesini tam doldurmadan durur, sınırda küçük
// boşluklar kalabilir).
const MAX_GROWTH_STALLS = 4000;

// Ada düz kenarlı, geniş bir DİKDÖRTGEN kara kütlesi (bkz.
// generateRectangleIsland) -- yatay monitöre benzesin diye. 80×52 oranı, hex
// satırlarının ekranda %75 sıkışmasını (bkz. client game/hexMath.ts
// isoCenter) hesaba katarak yaklaşık 16:9'luk bir görünüm veriyor. Toplam
// ~4160 karo.
const RECT_ISLAND_WIDTH = 80;
const RECT_ISLAND_HEIGHT = 52;

interface LandTile {
  x: number;
  y: number;
  islandId: number;
  isCoastal: boolean;
  // isCoastal'ın (1 halka) ötesinde 2 halkalık bir güvenlik payı -- NPC
  // yerleşimi SADECE bu true olan karolarda olabilir (bkz. generateIslandLayout
  // sonundaki hesap ve ensureMapGenerated). Kullanıcının kesin isteği ("kumsalda
  // asla kale") tek halkalık isCoastal'a güvenmek yerine burada bilerek daha
  // geniş bir tampon bırakıyor -- ileride kıyıya görsel bir kumsal bandı
  // eklenirse (göldeki gibi) o bandın olası taşmasını da kapsasın diye.
  isNpcSafe: boolean;
  // İki ada arasındaki köprünün parçası mı (bkz. generateBridges). Bridge
  // karoları HER ZAMAN EMPTY -- NPC/kale asla buraya yerleşmez, dar geçiş
  // noktası tıkanmasın diye.
  isBridge: boolean;
}

interface CellBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function buildGridCells(): CellBounds[] {
  const cells: CellBounds[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      cells.push({
        minX: Math.floor((col * WORLD_SIZE) / GRID_COLS),
        maxX: Math.floor(((col + 1) * WORLD_SIZE) / GRID_COLS) - 1,
        minY: Math.floor((row * WORLD_SIZE) / GRID_ROWS),
        maxY: Math.floor(((row + 1) * WORLD_SIZE) / GRID_ROWS) - 1,
      });
    }
  }
  return cells;
}

// Izgara hücreleri eskiden TAMAMEN rastgele seçiliyordu (shuffled(...).slice)
// -- bu, adaların haritanın rastgele köşelerine saçılıp aralarında devasa,
// boş bir deniz şeridi (ve o şeridi geçen anlamsız derecede uzun köprüler,
// bkz. generateBridges) bırakmasına yol açıyordu ("adalar birbirine çok
// uzak" geri bildirimi). Bunun yerine rastgele bir hücreden başlayıp her
// adımda o ana kadar seçilmiş hücrelerden birinin ızgara komşusunu (8 yönlü
// -- çapraz komşuluk da dahil, kümeyi daha sıkı tutar) rastgele ekleyerek
// KÜMELENMİŞ bir seçim yapıyoruz. Sonuç: seçilen hücreler ızgarada bitişik
// bir "leke" oluşturur, dolayısıyla adalar da birbirine yakın büyür ve MST
// köprüleri (bkz. generateBridges) sadece komşu hücreler arası kısa
// mesafeler olur.
function pickClusteredCellIndices(rows: number, cols: number, count: number): number[] {
  const total = rows * cols;
  const take = Math.min(count, total);
  const toIndex = (row: number, col: number) => row * cols + col;

  const startRow = Math.floor(Math.random() * rows);
  const startCol = Math.floor(Math.random() * cols);
  const selected: number[] = [toIndex(startRow, startCol)];
  const selectedSet = new Set<number>(selected);

  while (selected.length < take) {
    const frontier: number[] = [];
    for (const idx of selected) {
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      for (const [dr, dc] of GRID_DIRS_8) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nIdx = toIndex(nr, nc);
        if (selectedSet.has(nIdx)) continue;
        frontier.push(nIdx);
      }
    }

    let next: number;
    if (frontier.length > 0) {
      next = frontier[Math.floor(Math.random() * frontier.length)];
    } else {
      // Izgara komşuluğu tükendi (çok küçük bir ızgarada teorik olarak
      // mümkün) -- kalan herhangi bir hücreyle devam et.
      const remaining: number[] = [];
      for (let i = 0; i < total; i++) if (!selectedSet.has(i)) remaining.push(i);
      if (remaining.length === 0) break;
      next = remaining[Math.floor(Math.random() * remaining.length)];
    }
    selected.push(next);
    selectedSet.add(next);
  }

  return selected;
}

// Voronoi tabanlı büyüme (bkz. generateIslandLayout) adalar arasında artık
// yapısal olarak büyük boşluk bırakmıyor -- bu fonksiyon sadece hex-ızgara
// köşelerinde (3+ Voronoi bölgesinin tam kesiştiği noktalarda) nadiren
// oluşabilecek gerçekten küçük artefaktlar için bir güvenlik ağı. TÜM su
// karolarını bağlı bileşenlerine ayırıp, WATER_POCKET_MAX_SIZE'dan (gerçek
// açık denizden çok daha küçük) olan HER bileşeni karayla dolduruyoruz.
const WATER_POCKET_MAX_SIZE = 300;

function fillSmallWaterPockets(occupied: Map<string, number>): LandTile[] {
  const filled: LandTile[] = [];
  const visited = new Set<string>();

  for (let x = 0; x < WORLD_SIZE; x++) {
    for (let y = 0; y < WORLD_SIZE; y++) {
      const startKey = key(x, y);
      if (occupied.has(startKey) || visited.has(startKey)) continue;

      // Bu su bileşeninin TÜM karolarını BFS ile topla, aynı anda kara
      // komşularını da say (bileşen birden fazla adaya komşuysa çoğunluk
      // kazanır) -- WATER_POCKET_MAX_SIZE'ı aşarsa gerçek açık deniz
      // sayılıp erken durduruluyor, boşuna binlerce karoluk okyanusu
      // taramıyoruz.
      const component: [number, number][] = [[x, y]];
      visited.add(startKey);
      const neighborCounts = new Map<number, number>();
      let head = 0;
      let tooBig = false;
      while (head < component.length) {
        const [px, py] = component[head++];
        for (const [nx, ny] of neighbors6(px, py)) {
          if (!inBounds(nx, ny)) continue;
          const nk = key(nx, ny);
          const owner = occupied.get(nk);
          if (owner !== undefined) {
            neighborCounts.set(owner, (neighborCounts.get(owner) ?? 0) + 1);
            continue;
          }
          if (visited.has(nk)) continue;
          visited.add(nk);
          component.push([nx, ny]);
        }
        if (component.length > WATER_POCKET_MAX_SIZE) {
          tooBig = true;
          break;
        }
      }
      if (tooBig) continue; // gerçek açık deniz -- dokunma

      if (neighborCounts.size === 0) continue; // hiçbir karaya komşu değil (dünyanın boş bir köşesi) -- dokunma

      let bestId = -1;
      let bestCount = -1;
      for (const [id, count] of neighborCounts) {
        if (count > bestCount) {
          bestId = id;
          bestCount = count;
        }
      }

      for (const [px, py] of component) {
        const k = key(px, py);
        occupied.set(k, bestId);
        filled.push({ x: px, y: py, islandId: bestId, isCoastal: false, isNpcSafe: false, isBridge: false });
      }
    }
  }

  return filled;
}

function key(x: number, y: number) {
  return `${x},${y}`;
}

// x,y axial hex koordinatı (q,r). Bir altıgenin 6 komşusu var; bu sabit
// yön listesi standart axial komşuluk formülü (bkz.
// https://www.redblobgames.com/grids/hexagons/ -- "axial direction vectors").
const HEX_DIRECTIONS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

function neighbors6(x: number, y: number): [number, number][] {
  return HEX_DIRECTIONS.map(([dx, dy]) => [x + dx, y + dy]);
}

function inBounds(x: number, y: number) {
  return x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE;
}

function sameIslandNeighborCount(
  occupied: Map<string, number>,
  x: number,
  y: number,
  islandId: number
) {
  let count = 0;
  for (const [nx, ny] of neighbors6(x, y)) {
    if (occupied.get(key(nx, ny)) === islandId) count++;
  }
  return count;
}

// Büyümenin her adımında hangi mevcut karodan devam edileceğini seçer.
// Eskiden tamamen rastgele bir üye karo seçiliyordu -- bu, her açık köşenin
// birçok geçerli komşu yönü olduğu için zamanla dolup düzleşen, sonuçta
// izometrik görünümde neredeyse düzgün bir baklava/dikdörtgene benzeyen
// yuvarlak/dışbükey bir ada siluetine yol açıyordu. Bunun yerine birkaç
// rastgele aday arasından "en az aynı-ada komşusu olanı" (yani ucu/kenarı en
// açık, en 'ince' olanı) seçiyoruz -- bu, dolgun köşeleri doldurmak yerine
// ince çıkıntıların/yarımadaların uzamasını teşvik ediyor, sonuçta koylu-
// körfezli, çok daha organik bir kıyı şeridi oluşuyor.
const FRONTIER_TOURNAMENT_SIZE = 5;

function pickGrowthOrigin(
  tiles: [number, number][],
  occupied: Map<string, number>,
  islandId: number
): [number, number] {
  let best: [number, number] = tiles[Math.floor(Math.random() * tiles.length)];
  let bestCount = sameIslandNeighborCount(occupied, best[0], best[1], islandId);
  for (let t = 1; t < FRONTIER_TOURNAMENT_SIZE; t++) {
    const candidate = tiles[Math.floor(Math.random() * tiles.length)];
    const count = sameIslandNeighborCount(occupied, candidate[0], candidate[1], islandId);
    if (count < bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

// Dünyanın tam ortasında, düz kenarlı bir RECT_ISLAND_WIDTH×RECT_ISLAND_HEIGHT
// dikdörtgeni dolduruyor. Axial hex koordinatlarında (bkz. client game/hexMath.ts isoCenter:
// cx = tileWidth*(x + y/2)) düz bir x aralığını sabit tutup satır (y)
// arttıkça x'i olduğu gibi bırakırsak ekranda PARALELKENAR (her satır bir
// öncekinden sağa kaymış) elde ederiz. Bunun yerine her satırın x
// başlangıcını satır numarasının yarısı kadar SOLA kaydırıyoruz (standart
// "offset -> axial" dönüşümü, bkz. redblobgames.com/grids/hexagons) — böylece
// ekrandaki sol/sağ kenarlar gerçekten dikey kalıyor ve sonuç, yatay bir
// monitör gibi düzgün/simetrik bir dikdörtgene benziyor.
function generateRectangleIsland(): LandTile[] {
  const islandId = 1;
  const occupied = new Map<string, number>();
  const coords: [number, number][] = [];

  const centerX = Math.floor(WORLD_SIZE / 2);
  const centerY = Math.floor(WORLD_SIZE / 2);
  const rowStart = -Math.floor(RECT_ISLAND_HEIGHT / 2);
  const colStart = -Math.floor(RECT_ISLAND_WIDTH / 2);

  for (let r = 0; r < RECT_ISLAND_HEIGHT; r++) {
    const y = centerY + rowStart + r;
    const rowShift = Math.floor((rowStart + r) / 2) - Math.floor(rowStart / 2);
    for (let c = 0; c < RECT_ISLAND_WIDTH; c++) {
      const x = centerX + colStart + c - rowShift;
      if (!inBounds(x, y)) continue;
      occupied.set(key(x, y), islandId);
      coords.push([x, y]);
    }
  }

  return coords.map(([x, y]) => ({ x, y, islandId, isCoastal: false, isNpcSafe: false, isBridge: false }));
}

/**
 * Generates an archipelago of large, closely-packed islands: the world is
 * divided into a grid and each island grows as a random blob confined to
 * (roughly) its own grid cell. A new tile is only accepted if none of its
 * neighbors already belong to a *different* island — that's what keeps
 * islands visually and mechanically separate even though they now sit right
 * next to each other with only a thin strip of water between them.
 *
 * ISLAND_COUNT===1 iken bu organik büyütme hiç çalışmıyor -- bkz.
 * generateRectangleIsland (düz dikdörtgen). Adayı ileride tekrar birden
 * fazla parçaya bölmek istenirse ISLAND_COUNT'u 10'a çıkarmak bu fonksiyonu
 * tekrar devreye sokar.
 */
// maxBridgeHexLength: çağıran taraf (ensureMapGenerated) min(naval_attack_range,
// MAX_BRIDGE_HEX_LENGTH_HARD_CAP) hesaplayıp veriyor -- iki ayrı sınır: (1)
// naval_attack_range'den uzun bir köprü zaten hiçbir zaman saldırıyla
// geçilemiyor (bkz. routes/tiles.ts canReach), (2) kullanıcı isteği ayrıca
// ve net: "uzun köprü istemiyorum" -- bu ikincisi, naval_attack_range admin
// panelinden yüksek bir değere çekilse bile köprülerin kısa/dar kalmasını
// garanti eden sabit bir üst sınır (bkz. MAX_BRIDGE_HEX_LENGTH_HARD_CAP).
function generateIslandLayout(maxBridgeHexLength: number): LandTile[] {
  const allTiles: LandTile[] = ISLAND_COUNT === 1 ? generateRectangleIsland() : [];
  const occupied = new Map<string, number>(); // "x,y" -> islandId
  for (const t of allTiles) occupied.set(key(t.x, t.y), t.islandId);

  // islandId -> ızgaradaki düz hücre indeksi (row*GRID_COLS+col) --
  // generateBridges'in hangi ada çiftlerinin ızgarada komşu olduğunu
  // bulması için kullanılıyor.
  const islandCellIndex = new Map<number, number>();

  if (ISLAND_COUNT > 1) {
    const allCells = buildGridCells();
    const cellIndices = pickClusteredCellIndices(GRID_ROWS, GRID_COLS, ISLAND_COUNT);
    const cells: CellBounds[] = cellIndices.map((i) => allCells[i]);

    // Her ada için TEK bir tohum noktası -- kendi hücresinin içinde rastgele
    // bir yer (artık "uygun mu" diye deneme-yanılma gerekmiyor, bkz. aşağı).
    const seeds = new Map<number, [number, number]>(); // islandId -> [x,y]
    cells.forEach((cell, idx) => {
      const islandId = idx + 1;
      const sx = cell.minX + Math.floor(Math.random() * (cell.maxX - cell.minX + 1));
      const sy = cell.minY + Math.floor(Math.random() * (cell.maxY - cell.minY + 1));
      seeds.set(islandId, [sx, sy]);
      islandCellIndex.set(islandId, cellIndices[idx]);
    });

    // VORONOI BÖLGELERİ: dünyadaki HER karo, hangi tohuma (hex mesafe
    // olarak) en yakınsa o adanın "bölgesi" sayılır -- çok kaynaklı BFS
    // ("wavefront" hepsi aynı anda ilerler) ile tek geçişte hesaplanıyor,
    // her karo tam olarak bir bölgeye ait olduğu için MATEMATİKSEL OLARAK
    // hiçbir "sahipsiz" boşluk kalamaz (eski hücre+taşma dikdörtgenleri
    // birbiriyle örtüşmediğinde/uyuşmadığında rastgele, bazen kocaman
    // boşluklar bırakıyordu -- "adalar arasında saçma boşluklar var" geri
    // bildirimi buradan geliyordu). Adalar kendi bölgelerini (BORDER_MARGIN
    // payı hariç, bkz. aşağısı) doldurana kadar büyüdüğü için her sınırda
    // AYNI, tutarlı genişlikte bir su şeridi oluşuyor -- rastgele büyük/küçük
    // boşluk yok, gerçek puzzle parçası gibi öngörülebilir oturma.
    const voronoiOwner = new Map<string, number>();
    const voronoiQueue: [number, number, number][] = [];
    for (const [islandId, [sx, sy]] of seeds) {
      voronoiOwner.set(key(sx, sy), islandId);
      voronoiQueue.push([sx, sy, islandId]);
    }
    let vHead = 0;
    while (vHead < voronoiQueue.length) {
      const [x, y, islandId] = voronoiQueue[vHead++];
      for (const [nx, ny] of neighbors6(x, y)) {
        if (!inBounds(nx, ny)) continue;
        const nk = key(nx, ny);
        if (voronoiOwner.has(nk)) continue;
        voronoiOwner.set(nk, islandId);
        voronoiQueue.push([nx, ny, islandId]);
      }
    }

    // boundaryDist: her karonun, FARKLI sahipli bir Voronoi karosuna hex
    // mesafesi -- çok kaynaklı BFS (önce sınır karoları, sonra dalga dalga
    // yayılım). Adalar bu mesafe BORDER_MARGIN'i aşana kadar büyüyebiliyor,
    // yani tam Voronoi sınırına kadar DEĞİL, ondan sabit bir miktar geride
    // duruyor -- iki komşu adanın kendi payına düşen geri çekilme toplanınca
    // HER sınırda aynı, tutarlı genişlikte (~2×BORDER_MARGIN+1) bir su şeridi
    // oluşuyor. BORDER_MARGIN=0 (tam sınıra kadar doldur) da denendi ama
    // sonuç %90+ kara kapsamıyla neredeyse tek düz blok oldu -- ayrı adalar
    // hissi vermedi (bkz. script doğrulaması). BORDER_MARGIN=1, görünür ama
    // abartısız bir ayrım bırakıyor (~%81-83 kapsam, köprüler kısa kalıyor).
    const BORDER_MARGIN = 1;
    const boundaryDist = new Map<string, number>();
    const boundaryQueue: [number, number][] = [];
    for (let x = 0; x < WORLD_SIZE; x++) {
      for (let y = 0; y < WORLD_SIZE; y++) {
        const k = key(x, y);
        const owner = voronoiOwner.get(k);
        let isBoundary = false;
        for (const [nx, ny] of neighbors6(x, y)) {
          if (!inBounds(nx, ny)) continue;
          if (voronoiOwner.get(key(nx, ny)) !== owner) {
            isBoundary = true;
            break;
          }
        }
        if (isBoundary) {
          boundaryDist.set(k, 0);
          boundaryQueue.push([x, y]);
        }
      }
    }
    let bHead = 0;
    while (bHead < boundaryQueue.length) {
      const [x, y] = boundaryQueue[bHead++];
      const d = boundaryDist.get(key(x, y))!;
      for (const [nx, ny] of neighbors6(x, y)) {
        if (!inBounds(nx, ny)) continue;
        const nk = key(nx, ny);
        if (boundaryDist.has(nk)) continue;
        boundaryDist.set(nk, d + 1);
        boundaryQueue.push([nx, ny]);
      }
    }

    function canPlace(x: number, y: number, islandId: number) {
      if (!inBounds(x, y)) return false;
      const k = key(x, y);
      if (voronoiOwner.get(k) !== islandId) return false; // kendi Voronoi bölgesi dışı
      if ((boundaryDist.get(k) ?? Infinity) <= BORDER_MARGIN) return false; // sınıra çok yakın -- geri çekil
      if (occupied.has(k)) return false;
      for (const [nx, ny] of neighbors6(x, y)) {
        const owner = occupied.get(key(nx, ny));
        if (owner !== undefined && owner !== islandId) return false; // başka adaya bitişik olamaz
      }
      return true;
    }

    cells.forEach((cell, idx) => {
      const islandId = idx + 1;
      const seed = seeds.get(islandId)!;
      const islandTiles: [number, number][] = [seed];
      occupied.set(key(seed[0], seed[1]), islandId);

      // Hedef boyut YOK -- ada, kendi Voronoi bölgesini (BORDER_MARGIN payı
      // hariç) TAMAMEN dolduruncaya kadar (artık büyüyecek karo kalmayana
      // dek) büyüyor. Sonuç, her sınırda tutarlı genişlikte bir su şeridi
      // (bkz. dosya başı yorumu ve BORDER_MARGIN tanımı).
      let stalls = 0;
      while (stalls < MAX_GROWTH_STALLS) {
        const [bx, by] = pickGrowthOrigin(islandTiles, occupied, islandId);
        const candidates = neighbors6(bx, by).filter(([nx, ny]) => canPlace(nx, ny, islandId));
        if (candidates.length === 0) {
          stalls++;
          continue;
        }
        stalls = 0;
        const [cx, cy] = candidates[Math.floor(Math.random() * candidates.length)];
        occupied.set(key(cx, cy), islandId);
        islandTiles.push([cx, cy]);
      }

      for (const [x, y] of islandTiles) {
        allTiles.push({ x, y, islandId, isCoastal: false, isNpcSafe: false, isBridge: false });
      }
    });
  }

  // Voronoi tabanlı büyüme neredeyse hiç boşluk bırakmıyor, ama hex-ızgara
  // köşelerinde (3+ bölgenin tam kesiştiği noktalarda) nadiren tek karolık
  // artefaktlar kalabiliyor -- bunları da doldur (bkz. fillSmallWaterPockets
  // dosya başı yorumu). Eşik bilerek küçük (300): artık büyük boşluk
  // BEKLENMİYOR, bu sadece gerçek küçük artefaktlar için bir güvenlik ağı.
  for (const t of fillSmallWaterPockets(occupied)) {
    allTiles.push(t);
  }

  // Kıyı hesaplama: bir karo, aynı adaya ait OLMAYAN (farklı ada ya da boş
  // deniz) en az bir komşusu varsa kıyı sayılır. Kale/NPC bu karolarda asla
  // yerleşmemeli -- sadece adanın iç kısmı yerleşime açık.
  for (const tile of allTiles) {
    for (const [nx, ny] of neighbors6(tile.x, tile.y)) {
      if (occupied.get(key(nx, ny)) !== tile.islandId) {
        tile.isCoastal = true;
        break;
      }
    }
  }

  // İkinci halka: isCoastal'ın komşusu olan (ama kendisi kıyı olmayan)
  // karolar da NPC için güvenli SAYILMAZ -- bkz. LandTile.isNpcSafe yorumu.
  // Bunun için önce hangi karoların kıyı olduğunu ayrı bir Set'te tutuyoruz
  // (yukarıdaki döngü tile'ları zaten işaretledi, burada sadece okuyoruz).
  const coastalSet = new Set(allTiles.filter((t) => t.isCoastal).map((t) => key(t.x, t.y)));
  for (const tile of allTiles) {
    if (tile.isCoastal) continue;
    let touchesCoastal = false;
    for (const [nx, ny] of neighbors6(tile.x, tile.y)) {
      if (coastalSet.has(key(nx, ny))) {
        touchesCoastal = true;
        break;
      }
    }
    tile.isNpcSafe = !touchesCoastal;
  }

  // Köprüler: adaları birbirine bağlayan dar kara şeritleri (bkz.
  // generateBridges dosya başı yorumu). Bridge karoları allTiles'a EKLENIYOR
  // (occupied haritasına da) ki isNpcSafe hesabından SONRA eklendikleri için
  // hiçbir ada karosunun isCoastal/isNpcSafe değerini bozmasınlar -- köprü
  // bitişiğindeki ada karoları zaten kıyı/tampon olarak işaretli kalır,
  // bu FAZLADAN güvenli (eksik değil), bilerek dokunulmuyor.
  const bridgeTiles = generateBridges(allTiles, occupied, islandCellIndex, maxBridgeHexLength);
  for (const b of bridgeTiles) {
    occupied.set(key(b.x, b.y), b.islandId);
    allTiles.push(b);
  }

  return allTiles;
}

// ---------------------------------------------------------------------
// Köprüler -- adalar arası dar kara bağlantıları
// ---------------------------------------------------------------------
// Kullanıcı isteği: "adalar birbirine yakın olmalı, aralarında köprü gibi
// geçiş noktaları olmalı VE bu geçiş tek bir köprüyle sınırlı olmak zorunda
// değil, birkaç geçiş de olabilir". Eski sürüm TÜM adalar üzerinde bir
// minimum spanning tree (Prim) kuruyordu -- bu N ada için tam N-1 köprü
// demekti, yani her ada tam olarak BİR komşusuna bağlıydı (ağaç yapısı).
// Yeni yaklaşım: iki ada sadece MST'de eşleştiği için değil, IZGARADA
// GERÇEKTEN KOMŞU (8 yönlü, bkz. GRID_DIRS_8) oldukları için köprüyle
// bağlanıyor -- adalar artık ızgarayı baştan sona doldurduğundan (bkz.
// ISLAND_COUNT/GRID_COLS/GRID_ROWS dosya başı yorumu) bu, çoğu ada için
// BİRDEN FAZLA komşu/köprü demek. Tüm ada çiftlerini (V²) karşılaştırmak
// yerine sadece ızgara-komşusu olan çiftlere bakmak hem çok daha ucuz hem
// zaten tek mantıklı seçenek (uzak bir adaya köprü istemiyoruz). Bir
// hücrenin ada üretimi başarısız olup (bkz. "if (!seed) return") ızgara
// komşuluğunun tüm adaları bağlamadığı nadir durum için, ayrı kalan
// bileşenleri union-find ile bulup en yakın kıyı-kıyı çiftiyle (uzunluk
// sınırı olmadan) birbirine bağlayan bir onarım geçişi var -- bağlılık her
// zaman garanti. Her köprü kenarı için iki kıyı karosu arasına standart
// hex-çizgi algoritmasıyla (redblobgames.com/grids/hexagons, "Line
// Drawing") tek hex genişliğinde düz bir hat çiziliyor.
function axialToCube(q: number, r: number) {
  return { x: q, y: -q - r, z: r };
}

function cubeRound(x: number, y: number, z: number): [number, number, number] {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, ry, rz];
}

function hexDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return (Math.abs(dx) + Math.abs(dy) + Math.abs(dx + dy)) / 2;
}

// İki hex arasındaki (uçlar dahil) tüm hex'leri, aradaki mesafeye göre
// eşit adımlarla küp-uzayda enterpole edip en yakın hex'e yuvarlayarak
// döndürür -- standart, kesintisiz (çapraz atlama yapmayan) bir hex çizgisi.
function hexLine(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  const a = axialToCube(x1, y1);
  const b = axialToCube(x2, y2);
  const n = Math.max(1, hexDistance(x1, y1, x2, y2));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const lx = a.x + (b.x - a.x) * t;
    const ly = a.y + (b.y - a.y) * t;
    const lz = a.z + (b.z - a.z) * t;
    const [rx, , rz] = cubeRound(lx, ly, lz);
    pts.push([rx, rz]); // cube -> axial: q=x, r=z
  }
  return pts;
}

type BridgeEdge = { from: number; to: number; a: [number, number]; b: [number, number]; dist: number };

// İki adanın en yakın kıyı-kıyı karosu çiftini (ve aralarındaki hex
// mesafeyi) brute-force bulur -- generateBridges hem ızgara-komşu çiftler
// için hem de onarım geçişinde çağırıyor.
function nearestCoastalPair(
  coastalByIsland: Map<number, [number, number][]>,
  aId: number,
  bId: number
): { a: [number, number]; b: [number, number]; dist: number } | null {
  const aCoastal = coastalByIsland.get(aId) ?? [];
  const bCoastal = coastalByIsland.get(bId) ?? [];
  let best: { a: [number, number]; b: [number, number]; dist: number } | null = null;
  for (const a of aCoastal) {
    for (const b of bCoastal) {
      const dist = hexDistance(a[0], a[1], b[0], b[1]);
      if (!best || dist < best.dist) best = { a, b, dist };
    }
  }
  return best;
}

function generateBridges(
  allTiles: LandTile[],
  occupied: Map<string, number>,
  islandCellIndex: Map<number, number>,
  maxBridgeHexLength: number
): LandTile[] {
  const islandIds = Array.from(new Set(allTiles.map((t) => t.islandId)));
  if (islandIds.length <= 1) return [];

  const coastalByIsland = new Map<number, [number, number][]>();
  for (const t of allTiles) {
    if (!t.isCoastal) continue;
    const list = coastalByIsland.get(t.islandId) ?? [];
    list.push([t.x, t.y]);
    coastalByIsland.set(t.islandId, list);
  }

  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const edges = new Map<string, BridgeEdge>();

  // 1) Izgarada gerçekten komşu (8 yönlü) her ada çiftine bir köprü --
  // adalar ızgarayı baştan sona doldurduğu için çoğu ada birden fazla
  // komşuya/köprüye sahip oluyor (kullanıcı isteği: "birkaç geçiş olabilir").
  const cellIndexToIslandId = new Map<number, number>();
  for (const [islandId, cellIdx] of islandCellIndex) cellIndexToIslandId.set(cellIdx, islandId);

  for (const [cellIdx, islandId] of cellIndexToIslandId) {
    const row = Math.floor(cellIdx / GRID_COLS);
    const col = cellIdx % GRID_COLS;
    for (const [dr, dc] of GRID_DIRS_8) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
      const neighborIslandId = cellIndexToIslandId.get(nr * GRID_COLS + nc);
      if (neighborIslandId === undefined) continue;
      const k = edgeKey(islandId, neighborIslandId);
      if (edges.has(k)) continue;
      const pair = nearestCoastalPair(coastalByIsland, islandId, neighborIslandId);
      if (!pair || pair.dist > maxBridgeHexLength) continue;
      edges.set(k, { from: islandId, to: neighborIslandId, a: pair.a, b: pair.b, dist: pair.dist });
    }
  }

  // 2) Bağlılık onarımı: yukarıdaki ızgara-komşuluğu bazlı köprüler, aradaki
  // GERÇEK boşluk maxBridgeHexLength'i aştığı için bazı ada çiftlerini
  // BİLEREK atlıyor (kısa köprü isteği). Bu, bazı adaların (özellikle
  // ortadaki gibi her yönden başka adayla çevrili ama hiçbirine yeterince
  // yakın büyümemiş olanların) hiç köprüsü kalmamasına yol açabilir --
  // "ortadaki ada diğerlerinden kopuk" hatası buradan geliyordu. Bağlantısız
  // bir ada, uzun bir köprüden KESİNLİKLE daha kötü olduğu için burada sınır
  // YOK: Union-Find ile bağlı bileşenleri bulup, birden fazla bileşen
  // kaldığı sürece en yakın çifti (mesafe ne olursa olsun) Prim mantığıyla
  // birbirine bağlıyoruz -- CELL_OVERFLOW'un büyütülmesiyle (bkz. dosya başı
  // yorumu) bu geçiş artık pratikte nadiren gerekiyor ve gerektiğinde de
  // çoğunlukla kısa kalıyor, ama garanti olarak sınırsız.
  const parent = new Map<number, number>();
  islandIds.forEach((id) => parent.set(id, id));
  function find(id: number): number {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r);
    return r;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const e of edges.values()) union(e.from, e.to);

  function buildComponents(): Map<number, number[]> {
    const components = new Map<number, number[]>();
    for (const id of islandIds) {
      const root = find(id);
      const list = components.get(root) ?? [];
      list.push(id);
      components.set(root, list);
    }
    return components;
  }

  let components = buildComponents();
  while (components.size > 1) {
    const roots = Array.from(components.keys());
    let best: (BridgeEdge & { ra: number; rb: number }) | null = null;
    for (let i = 0; i < roots.length; i++) {
      for (let j = i + 1; j < roots.length; j++) {
        for (const fromId of components.get(roots[i])!) {
          for (const toId of components.get(roots[j])!) {
            const pair = nearestCoastalPair(coastalByIsland, fromId, toId);
            if (!pair) continue;
            if (!best || pair.dist < best.dist) {
              best = { from: fromId, to: toId, a: pair.a, b: pair.b, dist: pair.dist, ra: roots[i], rb: roots[j] };
            }
          }
        }
      }
    }
    if (!best) break; // olmamalı ama sonsuz döngüye girmeyelim
    const k = edgeKey(best.from, best.to);
    if (!edges.has(k)) edges.set(k, best);
    union(best.from, best.to);
    components = buildComponents();
  }

  const bridgeTiles: LandTile[] = [];
  const bridgeKeys = new Set<string>();
  for (const e of edges.values()) {
    const line = hexLine(e.a[0], e.a[1], e.b[0], e.b[1]);
    for (const [x, y] of line) {
      const k = key(x, y);
      if (occupied.has(k) || bridgeKeys.has(k)) continue; // zaten kara (ada ya da başka bir köprü)
      if (!inBounds(x, y)) continue;
      bridgeKeys.add(k);
      bridgeTiles.push({ x, y, islandId: e.from, isCoastal: false, isNpcSafe: false, isBridge: true });
    }
  }
  return bridgeTiles;
}

// Kare gridden hex'e geçiş: x,y ile axial q,r aynı iki tamsayı kolonunda
// tutuluyor (bkz. db.ts) ama komşuluk/mesafe anlamları tamamen farklı --
// eski kare haritada üretilmiş adaların hex komşuluğuna göre şekli
// bozuk/kopuk görünürdü. Bu yüzden test haritası TEK SEFERLİK olarak
// tamamen sıfırlanıyor: hem karolar hem de hesaplar (test kayıtları)
// temizlenip ensureMapGenerated'ın yeni adaları sıfırdan üretmesine izin
// veriliyor. schema_migrations ile korunduğu için sunucu her yeniden
// başladığında bir daha ÇALIŞMAZ.
export async function applyHexGridConversionMigration() {
  const MIGRATION_NAME = "hex_grid_conversion_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: harita altıgene geçiyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita hex olarak yeniden üretilecek.`);
}

// Tek büyük ada geçişi: ISLAND_COUNT 10'dan 1'e indirildi ve tek adanın
// hedef boyutu büyütüldü (bkz. SINGLE_ISLAND_MIN/MAX_SIZE). Koordinat
// sistemi aynı ama önceki 10-adalı test haritasıyla uyuşmuyor, o yüzden
// tek seferlik bir sıfırlama daha gerekiyor. Adayı ileride tekrar birden
// fazla parçaya bölmek istersek: ISLAND_COUNT'u eski haline getirip yeni bir
// migration adıyla (v3, v4, ...) aynı deseni tekrarlamak yeterli.
export async function applyBigSingleIslandMigration() {
  const MIGRATION_NAME = "big_single_island_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: tek büyük test adasına geçiliyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita tek büyük ada olarak yeniden üretilecek.`);
}

// Dikdörtgen ada geçişi: organik/yuvarlak büyüyen tek-ada algoritması
// kaldırıldı (bkz. generateRectangleIsland), aynı zamanda npc_spawn_chance
// bir kademe daha düşürülüyor. Koordinat sistemi yine değişmedi ama önceki
// organik test haritasıyla uyuşmuyor, o yüzden bir kez daha tam sıfırlama
// gerekiyor.
export async function applyRectSingleIslandMigration() {
  const MIGRATION_NAME = "rect_single_island_v2";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: ada dikdörtgene çevriliyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  // Eski varsayılan (0.08) hâlâ ayarlıysa yeni, daha düşük varsayılana
  // (0.02) taşı -- admin panelinden elle değiştirilmişse dokunma. (Bu
  // migration hiç canlıya çıkmamıştı; 0.04'e taşıyan ilk sürümü hiçbir
  // veritabanında hiç çalışmadığı için doğrudan burada 0.02'ye güncellendi.)
  await pool.query(
    "UPDATE game_settings SET value = 0.02 WHERE key = 'npc_spawn_chance' AND value = 0.08"
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita dikdörtgen tek ada olarak yeniden üretilecek.`);
}

// Elle istenen test verisi sıfırlaması -- bu turdaki değişiklikler (dağ
// dekoru, zoom, ışıltı) harita ÜRETİM formatını değiştirmiyor (dekor
// tamamen CLIENT tarafında), ama yukarıdaki geçişlerle AYNI TRUNCATE
// deseniyle test verisi temizlenip temiz bir haritayla yeniden başlanıyor.
export async function applyDecorRebalanceResetMigration() {
  const MIGRATION_NAME = "decor_rebalance_reset_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: dekor/zoom güncellemesi sonrası test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita yeniden üretilecek.`);
}

// Çoklu ada + köprü geçişi: ISLAND_COUNT tekrar 1'den 10'a çıkarıldı,
// NPC güvenlik tamponu isCoastal'dan isNpcSafe'e (2 halka) genişletildi ve
// adalar arasına köprüler eklendi (bkz. generateBridges). Koordinat sistemi
// aynı ama önceki tek-dev-ada haritasıyla uyuşmuyor, bir kez daha tam
// sıfırlama gerekiyor -- aynı TRUNCATE deseni.
export async function applyMultiIslandBridgeMigration() {
  const MIGRATION_NAME = "multi_island_bridge_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: çoklu ada + köprü sistemine geçiliyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita çoklu ada olarak yeniden üretilecek.`);
}

// Ada ızgara hücre seçimi TAMAMEN rastgeleden KÜMELENMİŞ seçime (bkz.
// pickClusteredCellIndices) çevrildi ve büyüme sırasında kazayla oluşan
// kapalı deniz cepleri artık kara ile dolduruluyor (bkz.
// fillEnclosedSeaPockets) -- kullanıcı geri bildirimi: "adalar birbirine çok
// uzak, aralarında saçma derecede uzun köprüler var" ve "haritada gereksiz
// yuvarlak göletler var". Koordinat sistemi aynı ama önceki haritayla
// uyuşmuyor, bir kez daha tam sıfırlama gerekiyor -- aynı TRUNCATE deseni.
export async function applyClusteredIslandsMigration() {
  const MIGRATION_NAME = "clustered_islands_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: adalar kümelenmiş yerleşime geçiyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita kümelenmiş adalarla yeniden üretilecek.`);
}

// Kullanıcı isteği: "adalar arasında tek geçiş değil, uçtan uca bitişik bir
// takımada, kaydırdıkça hep yeni ada çıksın". Izgara 6×6'dan 7×7'ye (49
// hücre) sıklaştırıldı, ISLAND_COUNT 10'dan 45'e çıkarıldı (hücrelerin
// neredeyse tamamı dolu) ve köprü sistemi MST'den (her ada tam bir
// komşuya bağlı) ızgara-komşuluğu bazlı çoklu köprüye geçti (bkz.
// generateBridges dosya başı yorumu) -- artık bitişik adalar arasında
// birden fazla geçiş noktası olabiliyor. Koordinat sistemi aynı ama önceki
// haritayla uyuşmuyor, bir kez daha tam sıfırlama gerekiyor.
export async function applyDenseArchipelagoMigration() {
  const MIGRATION_NAME = "dense_archipelago_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: yoğun/bitişik takımadaya geçiliyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita yoğun takımada olarak yeniden üretilecek.`);
}

// Köprü uzunluk sınırı (eski sabit MAX_BRIDGE_HEX_LENGTH=30) canlı
// `naval_attack_range` ayarından (varsayılan 15) bağımsızdı -- routes/tiles.ts
// canReach FARKLI adadaki bir saldırıyı bu mesafeden uzaksa köprü olsa da
// reddettiği için, 15'ten uzun her köprü asla kullanılamayan saf bir dekordu
// ("adam bu köprüyü geçmek için bekliyor" sorusu bunu ortaya çıkardı). Bu
// geçiş TEK SEFERLİK olarak haritayı, köprü sınırı artık settings.naval_
// attack_range'e bağlı yeni algoritmayla yeniden üretiyor.
export async function applyBridgeRangeFixMigration() {
  const MIGRATION_NAME = "bridge_range_fix_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: köprü uzunluğu naval_attack_range'e bağlanıyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita menzil-uyumlu köprülerle yeniden üretilecek.`);
}

// Kullanıcı geri bildirimi net: "uzun köprü istemiyorum" -- naval_attack_range
// (15) hâlâ görsel olarak uzun kalabiliyordu. Bu geçiş MAX_BRIDGE_HEX_LENGTH_
// HARD_CAP'i (8) devreye sokup haritayı kısa köprülerle yeniden üretiyor.
export async function applyShortBridgeCapMigration() {
  const MIGRATION_NAME = "short_bridge_cap_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: köprüler kısaltılıyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita kısa köprülerle yeniden üretilecek.`);
}

// Kullanıcı geri bildirimi net: "adalar birbirine UZAK, köprü meselesi değil
// bu". CELL_OVERFLOW 5 -> 12'ye çıkarıldı (bkz. dosya başı yorumu) ki komşu
// hücrelerin adaları GERÇEKTEN birbirine yakın büyüsün -- önceki turda
// köprü uzunluğunu kısaltmak (8) bazı adaları tamamen kopuk bırakmıştı,
// çünkü sorun köprü değil, adaların zaten aralarında bıraktığı boşluktu. Bu
// geçiş haritayı, adalar arası boşluk ortalama ~3 kareye inecek şekilde
// yeniden üretiyor (bkz. bağımsız script doğrulaması: 3 denemede de 0 onarım
// gerekti, yani sadece 8 karolık kısa köprülerle bile 45 ada tek parça).
export async function applyCloserIslandsMigration() {
  const MIGRATION_NAME = "closer_islands_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: adalar yakınlaştırılıyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita yakın adalarla yeniden üretilecek.`);
}

// Kullanıcı ekran görüntüsüyle gösterdi: adalar arasında hâlâ büyük, çirkin
// su boşlukları vardı -- bunlar tam "kapalı" olmadığı (ince bir kanaldan
// asıl denize bağlı olduğu) için eski fillEnclosedSeaPockets'ın
// "ulaşılabilirlik" testini geçip dolmadan kalıyordu. fillSmallWaterPockets
// artık ULAŞILABİLİRLİK değil BOYUT'a bakıyor (bkz. dosya başı yorumu,
// WATER_POCKET_MAX_SIZE=1200) -- gerçek açık denizden çok daha küçük her su
// bileşenini (ister kapalı ister ince bağlantılı) karaya çeviriyor. Bu geçiş
// haritayı bu yeni, çok daha agresif dolgu ile yeniden üretiyor.
export async function applyLargeWaterGapFixMigration() {
  const MIGRATION_NAME = "large_water_gap_fix_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: büyük su boşlukları dolduruluyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita dolgulu haritayla yeniden üretilecek.`);
}

// Boyut tabanlı dolgu (yukarısı) hâlâ yetersizdi: kullanıcı sarı/kırmızı
// işaretli ekran görüntüsüyle gösterdi ki adalar arasındaki büyük körfezler
// ince bir boğazdan asıl açık denize bağlı olduğu için o test onları hâlâ
// atlıyordu. Bu geçiş morfolojik kapama ekliyor (bkz. closeSmallWaterGaps
// dosya başı yorumu, CLOSING_RADIUS=3) -- bu yarıçaptan dar HER su şeridi
// (nereye bağlı olursa olsun) kapanıyor. Not: bu, "iyi" ince kanalların bir
// kısmını da kapatıyor (genişlik olarak "kötü" boğazlardan ayırt edilemez),
// bu yüzden kara kapsamı belirgin şekilde artıyor (~%82-88).
export async function applyMorphologicalClosingMigration() {
  const MIGRATION_NAME = "morphological_closing_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: dar boğazlar kapatılıyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita kapatılmış boğazlarla yeniden üretilecek.`);
}

// Morfolojik kapama, "iyi" ince kanalla "kötü" geniş boşluğu ayırt edemediği
// için haritayı neredeyse tek düz blok yapmıştı ("bu sonuç bu mu" geri
// bildirimi). Kökten değişim: ada büyütme artık rastgele hücre+taşma
// dikdörtgeni yerine VORONOI bölgeleriyle sınırlı (bkz. generateIslandLayout
// dosya başı yorumu) -- her ada kendi bölgesini (BORDER_MARGIN=1 payı hariç)
// tam dolduruyor, bu da HER sınırda aynı, tutarlı (~4 karo) genişlikte bir
// su şeridi garantiliyor -- ne rastgele büyük boşluk (eski yöntem) ne de
// neredeyse hiç su (kapama) riski. Bu geçiş haritayı bu yeni algoritmayla
// yeniden üretiyor.
export async function applyVoronoiIslandsMigration() {
  const MIGRATION_NAME = "voronoi_islands_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  console.log(`[migration] ${MIGRATION_NAME}: adalar Voronoi bölgeleriyle yeniden üretiliyor, test verisi sıfırlanıyor...`);
  await pool.query(
    `TRUNCATE TABLE
       tile_reinforcements, scout_reports, player_reports, battle_log,
       guild_members, guilds, tiles, players
     RESTART IDENTITY CASCADE`
  );
  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı, harita Voronoi tabanlı adalarla yeniden üretilecek.`);
}

export async function ensureMapGenerated(settings: Settings) {
  const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*)::int as count FROM tiles");
  if (Number(rows[0].count) > 0) return;

  const now = Date.now();
  const layout = generateIslandLayout(Math.min(settings.naval_attack_range, MAX_BRIDGE_HEX_LENGTH_HARD_CAP));
  // Göl konumları client'la (riversLakes.ts) BİREBİR aynı, dünya
  // koordinatına göre deterministik üretiliyor (bkz. decor.ts) -- göl
  // altındaki hiçbir karo asla NPC/oyuncu kalesi olamaz (bkz. aşağıdaki
  // isWater kontrolü ve pickRandomEmptyTile).
  const lakes = generateLakes(WORLD_SIZE);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Bulk insert in chunks to keep each query at a reasonable size.
    const CHUNK_SIZE = 200;
    for (let i = 0; i < layout.length; i += CHUNK_SIZE) {
      const chunk = layout.slice(i, i + CHUNK_SIZE);
      const values: string[] = [];
      const params: unknown[] = [];
      let p = 1;

      for (const tile of chunk) {
        const isWater = isWaterAtWorldPosition(tile.x, tile.y, lakes);
        // NPC yerleşimi SADECE isNpcSafe (kıyıdan 2 halka içeride, bkz.
        // LandTile.isNpcSafe yorumu) VE köprü DEĞİL VE göl altında değilse
        // olabilir -- kullanıcının kesin isteği ("kumsalda asla kale")
        // burada üç ayrı garantiyle korunuyor.
        const isNpc =
          tile.isNpcSafe && !tile.isBridge && !isWater && Math.random() < settings.npc_spawn_chance;
        // Kullanıcı isteğiyle 1-3 -> 1-5 aralığına çıkarıldı (bkz.
        // client/src/game/tileImages.ts NPC_LEVEL_TIERS -- görsel eşikler
        // 10/20/30'a çekildiği için 1-5 arası hâlâ hep en düşük tier
        // görselini gösteriyor, sadece asker/üretim gücü değişiyor).
        const level = isNpc ? 1 + Math.floor(Math.random() * 5) : 1;
        const production = productionForLevel(level, settings);

        values.push(
          `($${p++}, $${p++}, NULL, $${p++}, $${p++}, $${p++}, $${p++}, 0, 0, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
        );
        params.push(
          tile.x,
          tile.y,
          tile.islandId,
          isNpc ? "NPC" : "EMPTY",
          level,
          production.gold_per_hour,
          isNpc ? level * 20 : 0, // NPC garrison, static
          now,
          tile.isCoastal,
          isWater,
          tile.isBridge
        );
      }

      await client.query(
        `INSERT INTO tiles (x, y, owner_id, island_id, tile_type, level, gold_per_hour,
                            troops_per_hour, stored_gold, stored_troops, last_collected_at, is_coastal, is_water, is_bridge)
         VALUES ${values.join(", ")}`,
        params
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Yeni oyuncunun başlangıç şehri de bir "kale" olduğu için aynı kıyı
// tamponu kuralına tabi -- ORDER BY is_coastal ASC önce iç karoları dener,
// hiç kalmadıysa (küçük bir adada iç karo tükenmiş olabilir) otomatik
// olarak kıyı karolarına düşer. Göl altındaki karolar (is_water) ise HİÇ
// aday değil -- kıyının aksine burada "yoksa düş" diye bir geri dönüş yok,
// çünkü bir kale asla suyun içinde başlamamalı (bkz. is_water yorumu).
export async function pickRandomEmptyTile(): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM tiles WHERE tile_type = 'EMPTY' AND is_water = false AND is_bridge = false
     ORDER BY is_coastal ASC, RANDOM() LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

// Zaten canlı olan bir haritaya geriye dönük olarak uygulanan, TEK SEFERLİK
// (schema_migrations ile korunan) geçiş: hiçbir oyuncu verisini silmez,
// sadece henüz kimsenin fethetmediği (owner_id NULL) NPC kamplarını
// düzenler -- kıyıdakileri boşaltır (yeni kural: kıyıda asla NPC olmaz) ve
// iç kısımdakilerin bir kısmını da seyrekleştirir. Oyuncuların zaten sahip
// olduğu hiçbir kareye dokunmaz.
export async function applyNpcBorderMigration(settings: Settings) {
  const MIGRATION_NAME = "npc_border_buffer_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  const { rows } = await pool.query<{
    id: number;
    x: number;
    y: number;
    island_id: number;
    tile_type: TileType;
    owner_id: string | null;
  }>("SELECT id, x, y, island_id, tile_type, owner_id FROM tiles");

  if (rows.length === 0) {
    await markMigration(MIGRATION_NAME);
    return;
  }

  console.log(`[migration] ${MIGRATION_NAME}: ${rows.length} karo işlenecek...`);

  const occupied = new Map<string, number>();
  for (const t of rows) occupied.set(key(t.x, t.y), t.island_id);

  function isCoastalRow(t: { x: number; y: number; island_id: number }) {
    for (const [nx, ny] of neighbors6(t.x, t.y)) {
      if (occupied.get(key(nx, ny)) !== t.island_id) return true;
    }
    return false;
  }

  // Önce hepsini BELLEKTE hesaplayıp, veritabanına binlerce ayrı sorgu
  // yerine sadece birkaç TOPLU (bulk, "= ANY($1)") sorgu atıyoruz --
  // aksi halde canlı bir haritada on binlerce satır için tek tek gidip
  // gelen sorgular, Render'ın "portu aç" beklediği süreyi (deploy zaman
  // aşımı) kolayca aşabilir.
  const coastalIds: number[] = [];
  const clearIds: number[] = [];
  for (const t of rows) {
    const coastal = isCoastalRow(t);
    if (coastal) coastalIds.push(t.id);

    if (t.tile_type !== "NPC" || t.owner_id) continue; // sadece fethedilmemiş NPC kampları
    // Kıyıdaki her fethedilmemiş NPC kampı boşaltılır (yeni kural).
    // İç kısımdakilerin de yarısı boşaltılır (yoğunluk azaltma).
    if (coastal || Math.random() < 0.5) clearIds.push(t.id);
  }

  const production = productionForLevel(1, settings);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (coastalIds.length > 0) {
      await client.query("UPDATE tiles SET is_coastal = true WHERE id = ANY($1)", [coastalIds]);
    }
    if (clearIds.length > 0) {
      await client.query(
        `UPDATE tiles
         SET tile_type = 'EMPTY', level = 1, gold_per_hour = $1, troops_per_hour = 0, stored_troops = 0
         WHERE id = ANY($2)`,
        [production.gold_per_hour, clearIds]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await markMigration(MIGRATION_NAME);
  console.log(
    `[migration] ${MIGRATION_NAME}: tamamlandı (${coastalIds.length} kıyı karosu işaretlendi, ${clearIds.length} NPC kampı boşaltıldı).`
  );
}

// İkinci NPC seyreltme turu: applyNpcBorderMigration zaten kıyıdakileri ve
// iç kısmın yarısını boşaltmıştı, bu geçiş kalan (fethedilmemiş) NPC
// kamplarının bir kısmını daha kaldırıp npc_spawn_chance ayarını da (hâlâ
// eski varsayılandaysa) düşürüyor. Aynı şekilde TEK SEFERLİK, oyuncu
// verisine dokunmuyor.
export async function applyNpcDensityReductionMigration(settings: Settings) {
  const MIGRATION_NAME = "npc_density_reduction_v2";
  if (await hasMigration(MIGRATION_NAME)) return;

  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM tiles WHERE tile_type = 'NPC' AND owner_id IS NULL"
  );

  const clearIds = rows.filter(() => Math.random() < 0.4).map((r) => r.id);

  if (clearIds.length > 0) {
    const production = productionForLevel(1, settings);
    await pool.query(
      `UPDATE tiles
       SET tile_type = 'EMPTY', level = 1, gold_per_hour = $1, troops_per_hour = 0, stored_troops = 0
       WHERE id = ANY($2)`,
      [production.gold_per_hour, clearIds]
    );
  }

  // Eski varsayılan (0.15) hâlâ ayarlıysa yeni varsayılana (0.08) taşı --
  // admin panelinden elle değiştirilmişse dokunma.
  await pool.query(
    "UPDATE game_settings SET value = 0.08 WHERE key = 'npc_spawn_chance' AND value = 0.15"
  );

  await markMigration(MIGRATION_NAME);
  console.log(
    `[migration] ${MIGRATION_NAME}: tamamlandı (${rows.length} fethedilmemiş NPC kampından ${clearIds.length} tanesi daha boşaltıldı).`
  );
}

// Üçüncü NPC seyreltme turu: applyNpcDensityReductionMigration (v2) zaten
// kalan kampların %40'ını boşaltmıştı, bu geçiş kalan (fethedilmemiş) NPC
// kamplarının YARISINI daha kaldırıp npc_spawn_chance ayarını da (hâlâ eski
// varsayılandaysa) 0.01'e düşürüyor. Aynı şekilde TEK SEFERLİK, oyuncu
// verisine dokunmuyor.
export async function applyNpcDensityReductionMigrationV3(settings: Settings) {
  const MIGRATION_NAME = "npc_density_reduction_v3";
  if (await hasMigration(MIGRATION_NAME)) return;

  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM tiles WHERE tile_type = 'NPC' AND owner_id IS NULL"
  );

  const clearIds = rows.filter(() => Math.random() < 0.5).map((r) => r.id);

  if (clearIds.length > 0) {
    const production = productionForLevel(1, settings);
    await pool.query(
      `UPDATE tiles
       SET tile_type = 'EMPTY', level = 1, gold_per_hour = $1, troops_per_hour = 0, stored_troops = 0
       WHERE id = ANY($2)`,
      [production.gold_per_hour, clearIds]
    );
  }

  // Eski varsayılan (0.02) hâlâ ayarlıysa yeni varsayılana (0.01) taşı --
  // admin panelinden elle değiştirilmişse dokunma.
  await pool.query(
    "UPDATE game_settings SET value = 0.01 WHERE key = 'npc_spawn_chance' AND value = 0.02"
  );

  await markMigration(MIGRATION_NAME);
  console.log(
    `[migration] ${MIGRATION_NAME}: tamamlandı (${rows.length} fethedilmemiş NPC kampından ${clearIds.length} tanesi daha boşaltıldı).`
  );
}

// Önceki üç seyreltme turu (applyNpcBorderMigration, ...ReductionMigration,
// ...ReductionMigrationV3) NPC yoğunluğunu gereğinden fazla düşürmüştü
// ("haritada sadece birkaç tane var" geri bildirimi). Bu geçiş TERSİNE, kalan
// boş (fethedilmemiş, kıyı olmayan) karelerin bir kısmını NPC kampına
// çevirip npc_spawn_chance ayarını da (hâlâ eski varsayılandaysa) artırıyor.
// TEK SEFERLİK, oyuncuya ait hiçbir kareye dokunmuyor.
export async function applyNpcDensityIncreaseMigrationV4(settings: Settings) {
  const MIGRATION_NAME = "npc_density_increase_v4";
  if (await hasMigration(MIGRATION_NAME)) return;

  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM tiles WHERE tile_type = 'EMPTY' AND is_coastal = false AND owner_id IS NULL"
  );

  // Seviyeye göre gruplanmış id listeleri -- her seviye için TEK bir toplu
  // (ANY($1)) UPDATE atmak, binlerce satır için tek tek sorgu atmaktan çok
  // daha hızlı (bkz. applyNpcBorderMigration'daki aynı gerekçe).
  const idsByLevel = new Map<number, number[]>();
  for (const r of rows) {
    if (Math.random() >= 0.12) continue;
    const level = 1 + Math.floor(Math.random() * 3);
    const list = idsByLevel.get(level) ?? [];
    list.push(r.id);
    idsByLevel.set(level, list);
  }

  let spawnedCount = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [level, ids] of idsByLevel) {
      if (ids.length === 0) continue;
      const production = productionForLevel(level, settings);
      await client.query(
        `UPDATE tiles
         SET tile_type = 'NPC', level = $1, gold_per_hour = $2, troops_per_hour = 0, stored_troops = $3
         WHERE id = ANY($4)`,
        [level, production.gold_per_hour, level * 20, ids]
      );
      spawnedCount += ids.length;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Eski varsayılan (0.01) hâlâ ayarlıysa yeni varsayılana (0.05) taşı --
  // admin panelinden elle değiştirilmişse dokunma.
  await pool.query(
    "UPDATE game_settings SET value = 0.05 WHERE key = 'npc_spawn_chance' AND value = 0.01"
  );

  await markMigration(MIGRATION_NAME);
  console.log(
    `[migration] ${MIGRATION_NAME}: tamamlandı (${rows.length} boş kareden ${spawnedCount} tanesi NPC kampına çevrildi).`
  );
}

// Beşinci NPC seyreltme turu: applyNpcDensityIncreaseMigrationV4 yoğunluğu
// artırmıştı, kullanıcı isteğiyle ("NPC'leri %40 azalt") kalan (fethedilmemiş)
// NPC kamplarının %40'ı tekrar kaldırılıyor ve npc_spawn_chance ayarı da
// (hâlâ eski varsayılandaysa) %40 düşürülüyor. Aynı şekilde TEK SEFERLİK,
// oyuncu verisine dokunmuyor.
export async function applyNpcDensityReductionMigrationV5(settings: Settings) {
  const MIGRATION_NAME = "npc_density_reduction_v5";
  if (await hasMigration(MIGRATION_NAME)) return;

  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM tiles WHERE tile_type = 'NPC' AND owner_id IS NULL"
  );

  const clearIds = rows.filter(() => Math.random() < 0.4).map((r) => r.id);

  if (clearIds.length > 0) {
    const production = productionForLevel(1, settings);
    await pool.query(
      `UPDATE tiles
       SET tile_type = 'EMPTY', level = 1, gold_per_hour = $1, troops_per_hour = 0, stored_troops = 0
       WHERE id = ANY($2)`,
      [production.gold_per_hour, clearIds]
    );
  }

  // Eski varsayılan (0.05) hâlâ ayarlıysa yeni varsayılana (0.03) taşı --
  // admin panelinden elle değiştirilmişse dokunma.
  await pool.query(
    "UPDATE game_settings SET value = 0.03 WHERE key = 'npc_spawn_chance' AND value = 0.05"
  );

  await markMigration(MIGRATION_NAME);
  console.log(
    `[migration] ${MIGRATION_NAME}: tamamlandı (${rows.length} fethedilmemiş NPC kampından ${clearIds.length} tanesi daha boşaltıldı).`
  );
}

// Göller (bkz. decor.ts) `ensureMapGenerated`e kadar mapgen'in hiç bilmediği,
// tamamen client-tarafı bir kavramdı -- bu yüzden zaten canlı olan haritada
// bazı NPC kampları (ve nadiren oyuncu kaleleri) client'ın göl çizdiği bir
// karoya denk gelmiş olabilir ("kaleler göllerin üzerine geliyor" geri
// bildirimi). Bu geçiş TEK SEFERLİK: (1) göl altındaki HER karoyu is_water=
// true olarak işaretler ki bundan sonra hiçbir yeni NPC/oyuncu kalesi oraya
// düşmesin (bkz. ensureMapGenerated/pickRandomEmptyTile), (2) göl altında
// kalan, fethedilmemiş (owner_id NULL) NPC kamplarını EMPTY'e çevirir --
// zaten kimsenin oynamadığı, tamamen tersine çevrilebilir bir değişiklik.
// Bir OYUNCUNUN sahip olduğu kale göl altında çıkarsa (çok nadir, ama
// mümkün) buraya BİLEREK dokunulmuyor -- bir oyuncunun kalesini otomatik
// olarak başka bir karoya taşımak/silmek çok daha riskli bir işlem, sadece
// uyarı olarak loglanıyor (gerekirse admin panelinden elle taşınabilir).
export async function applyLakeLockMigration(settings: Settings) {
  const MIGRATION_NAME = "lake_lock_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  const { rows } = await pool.query<{
    id: number;
    x: number;
    y: number;
    tile_type: TileType;
    owner_id: string | null;
  }>("SELECT id, x, y, tile_type, owner_id FROM tiles");

  if (rows.length === 0) {
    await markMigration(MIGRATION_NAME);
    return;
  }

  const lakes = generateLakes(WORLD_SIZE);
  const waterIds: number[] = [];
  const clearIds: number[] = [];
  let ownedOnWater = 0;
  for (const t of rows) {
    if (!isWaterAtWorldPosition(t.x, t.y, lakes)) continue;
    waterIds.push(t.id);
    if (t.tile_type === "NPC" && !t.owner_id) clearIds.push(t.id);
    else if (t.tile_type === "PLAYER") ownedOnWater++;
  }

  const production = productionForLevel(1, settings);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (waterIds.length > 0) {
      await client.query("UPDATE tiles SET is_water = true WHERE id = ANY($1)", [waterIds]);
    }
    if (clearIds.length > 0) {
      await client.query(
        `UPDATE tiles
         SET tile_type = 'EMPTY', level = 1, gold_per_hour = $1, troops_per_hour = 0, stored_troops = 0
         WHERE id = ANY($2)`,
        [production.gold_per_hour, clearIds]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await markMigration(MIGRATION_NAME);
  console.log(
    `[migration] ${MIGRATION_NAME}: tamamlandı (${waterIds.length} karo göl olarak işaretlendi, ` +
      `${clearIds.length} fethedilmemiş NPC kampı boşaltıldı${
        ownedOnWater > 0 ? `, DİKKAT: ${ownedOnWater} oyuncu kalesi göl altında kaldı (elle taşınmalı)` : ""
      }).`
  );
}

// applyLakeLockMigration (yukarısı) göllerin is_water'ını doğru işaretlemişti
// ama decor.ts'teki isWaterAtWorldPosition o zaman hâlâ düz bir DAİRE
// kullanıyordu (radius*1.35), oysa client'ın ÇİZDİĞİ göl asimetrik/köşeli
// bir çokgen, bazı yönlerde 1.5x'e kadar taşıyor. Daire bu çıkıntıları
// kapsamadığı için o aralıktaki karolar yanlışlıkla "kuru" sayılıp üstlerine
// NPC yerleşmişti -- "kaleler gölün görsel sınırının içinde duruyor" geri
// bildirimi buradan geliyordu. decor.ts artık (bu turda) hem çizimle hem bu
// kontrolle AYNI köşe noktalarını kullanıyor; bu geçiş TEK SEFERLİK olarak
// is_water'ı canlı haritada baştan (artık doğru) formüle göre yeniden
// hesaplıyor ve yeni yakalanan göl-üstü NPC kamplarını applyLakeLockMigration
// ile AYNI kurallarla boşaltıyor (fethedilmemiş NPC -> EMPTY, oyuncu kalesi
// -> dokunulmuyor, sadece loglanıyor).
export async function applyLakePolygonFixMigration(settings: Settings) {
  const MIGRATION_NAME = "lake_polygon_fix_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  const { rows } = await pool.query<{
    id: number;
    x: number;
    y: number;
    tile_type: TileType;
    owner_id: string | null;
    is_water: boolean;
  }>("SELECT id, x, y, tile_type, owner_id, is_water FROM tiles");

  if (rows.length === 0) {
    await markMigration(MIGRATION_NAME);
    return;
  }

  const lakes = generateLakes(WORLD_SIZE);
  const nowWaterIds: number[] = [];
  const nowLandIds: number[] = [];
  const clearIds: number[] = [];
  let ownedOnWater = 0;
  for (const t of rows) {
    const nowWater = isWaterAtWorldPosition(t.x, t.y, lakes);
    if (nowWater === t.is_water) continue;
    if (nowWater) {
      nowWaterIds.push(t.id);
      if (t.tile_type === "NPC" && !t.owner_id) clearIds.push(t.id);
      else if (t.tile_type === "PLAYER") ownedOnWater++;
    } else {
      nowLandIds.push(t.id);
    }
  }

  const production = productionForLevel(1, settings);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (nowWaterIds.length > 0) {
      await client.query("UPDATE tiles SET is_water = true WHERE id = ANY($1)", [nowWaterIds]);
    }
    if (nowLandIds.length > 0) {
      await client.query("UPDATE tiles SET is_water = false WHERE id = ANY($1)", [nowLandIds]);
    }
    if (clearIds.length > 0) {
      await client.query(
        `UPDATE tiles
         SET tile_type = 'EMPTY', level = 1, gold_per_hour = $1, troops_per_hour = 0, stored_troops = 0
         WHERE id = ANY($2)`,
        [production.gold_per_hour, clearIds]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await markMigration(MIGRATION_NAME);
  console.log(
    `[migration] ${MIGRATION_NAME}: tamamlandı (${nowWaterIds.length} karo yeniden göl olarak işaretlendi, ` +
      `${nowLandIds.length} karo yeniden kara olarak işaretlendi, ${clearIds.length} fethedilmemiş NPC kampı ` +
      `boşaltıldı${
        ownedOnWater > 0 ? `, DİKKAT: ${ownedOnWater} oyuncu kalesi göl altında kaldı (elle taşınmalı)` : ""
      }).`
  );
}

// home_tile_id eklenmeden önce kayıt olmuş oyuncuların home_tile_id'si
// NULL'dır. Bu geçiş, elden geldiğince (en erken sahip olunan PLAYER
// karosu) geriye dönük olarak doldurur; yeni kayıtlar zaten /register
// sırasında set ediyor (bkz. routes/players.ts). TEK SEFERLİK, idempotent.
export async function applyHomeTileBackfillMigration() {
  const MIGRATION_NAME = "home_tile_backfill_v1";
  if (await hasMigration(MIGRATION_NAME)) return;

  const result = await pool.query(
    `UPDATE players
     SET home_tile_id = (
       SELECT id FROM tiles
       WHERE owner_id = players.id AND tile_type = 'PLAYER'
       ORDER BY id ASC
       LIMIT 1
     )
     WHERE home_tile_id IS NULL`
  );

  await markMigration(MIGRATION_NAME);
  console.log(`[migration] ${MIGRATION_NAME}: tamamlandı (${result.rowCount ?? 0} oyuncu güncellendi).`);
}
