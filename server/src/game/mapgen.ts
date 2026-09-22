import { pool, hasMigration, markMigration } from "../db.js";
import { productionForLevel } from "./resources.js";
import type { Settings } from "./settings.js";
import type { TileType } from "../types.js";

// Not: WORLD_SIZE burada ve client/src/App.tsx'te birebir aynı olmalı —
// ikisi de izometrik/harita hesaplarında kullanıyor.
const WORLD_SIZE = 200;

// Adalar artık dünyaya tamamen rastgele saçılmıyor: WORLD_SIZE bir
// GRID_COLS × GRID_ROWS ızgarasına bölünüyor ve her ada kendi hücresinde
// büyüyor. Bu, adaların birbirine olan uzaklığını öngörülebilir ve küçük
// tutar (komşu adalar sadece bitişik olamadıkları için aralarında ince bir
// su şeridi kalır), ayrıca her ada kendi hücresini büyük ölçüde
// doldurduğu için "her ada ekrana sığan bir harita gibi" hissi verir.
// Hücre sayısından daha az ada üretilerek (ISLAND_COUNT < GRID_COLS×GRID_ROWS)
// birkaç hücre boş deniz olarak kalır — uzaktan bakınca aşırı düzenli/ızgara
// gibi görünmesini engelleyen doğal boşluklar.
const GRID_COLS = 6;
const GRID_ROWS = 6;
// Eren'in isteği: "tek ve büyük ada" -- test aşamasında artık birden çok
// küçük ada yerine TEK büyük bir test adası üretiliyor (birkaç kişi aynı
// anda test edecek, sıkışmasınlar diye geniş tutuluyor; harita yine de
// tamamı tek ekranda görünmeyecek kadar büyük -- kaydırma/uzaklaştırma hâlâ
// gerekiyor, ama varsayılan yakınlıkta hiçbir yönde deniz görünmemeli).
// ISLAND_COUNT === 1 olduğunda generateIslandLayout() yukarıdaki
// GRID_COLS×GRID_ROWS hücre sistemini tamamen atlayıp doğrudan
// generateRectangleIsland()'ı çağırıyor (düz kenarlı dikdörtgen, bkz. o
// fonksiyonun üstündeki not). Adayı tekrar birden fazla parçaya bölmek
// istersek burayı eski haline (10) döndürüp bir sonraki migration'ı
// tetiklemek yeterli -- ada üretimi tamamen tersine çevrilebilir.
const ISLAND_COUNT = 1;
const ISLAND_MIN_SIZE = 400;
const ISLAND_MAX_SIZE = 650;
// Bir ada, organik/yuvarlak kenarlar oluşturabilsin diye kendi hücresinin
// dışına bu kadar taşabilir — komşu ada büyümesi zaten bitişikliği
// engellediği için bu taşma iki ada arasındaki boşluğu sıfırlamaz, sadece
// kenarların hücre sınırında keskin bir dikdörtgen gibi kesilmesini önler.
const CELL_OVERFLOW = 5;
const MAX_SEED_ATTEMPTS_PER_ISLAND = 80;
// Tek büyük ada, eski küçük adalardan çok daha fazla büyüme adımı
// gerektiriyor -- 300 durak sınırı bu boyutta erken tetiklenip adayı
// hedeflenenden küçük bırakabilirdi, bu yüzden yükseltildi. (Artık sadece
// ISLAND_COUNT > 1 organik moduna aitse kullanılıyor.)
const MAX_GROWTH_STALLS = 1200;

// Eren: "ada dediğimiz olay dikdörtgene yakın simetrik olsun, bilgisayar
// ekranını (yatay monitör) düşün" -- organik/yuvarlak büyüyen tek-ada
// algoritması tamamen kaldırıldı, yerine düz kenarlı, geniş bir DİKDÖRTGEN
// kara kütlesi geldi (bkz. generateRectangleIsland). 80×52 oranı, hex
// satırlarının ekranda %75 sıkışmasını (bkz. App.tsx isoCenter) hesaba
// katarak yaklaşık 16:9'luk bir monitör görünümü verecek şekilde seçildi.
// Toplam ~4160 karo, önceki organik adayla (3500-5000 hedefi) aynı
// büyüklük sınıfında.
const RECT_ISLAND_WIDTH = 80;
const RECT_ISLAND_HEIGHT = 52;

interface LandTile {
  x: number;
  y: number;
  islandId: number;
  isCoastal: boolean;
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

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function key(x: number, y: number) {
  return `${x},${y}`;
}

// Eren: haritayı altıgene çeviriyoruz -- x,y artık axial hex koordinatı
// (q,r). Kare gridin 8 komşusu yerine bir altıgenin gerçek 6 komşusu var;
// bu sabit yön listesi standart axial komşuluk formülü (bkz.
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
// dikdörtgeni dolduruyor. Axial hex koordinatlarında (bkz. App.tsx isoCenter:
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

  return coords.map(([x, y]) => ({ x, y, islandId, isCoastal: false }));
}

/**
 * Generates an archipelago of large, closely-packed islands: the world is
 * divided into a grid and each island grows as a random blob confined to
 * (roughly) its own grid cell. A new tile is only accepted if none of its
 * neighbors already belong to a *different* island — that's what keeps
 * islands visually and mechanically separate even though they now sit right
 * next to each other with only a thin strip of water between them.
 *
 * Eren: "tek ve büyük ada" isteğinden beri ISLAND_COUNT===1 iken bu organik
 * büyütme hiç çalışmıyor -- bkz. generateRectangleIsland (düz dikdörtgen).
 * Adayı ileride tekrar birden fazla parçaya bölmek istenirse ISLAND_COUNT'u
 * 10'a çıkarmak bu fonksiyonu tekrar devreye sokar.
 */
function generateIslandLayout(): LandTile[] {
  const allTiles: LandTile[] = ISLAND_COUNT === 1 ? generateRectangleIsland() : [];
  const occupied = new Map<string, number>(); // "x,y" -> islandId
  for (const t of allTiles) occupied.set(key(t.x, t.y), t.islandId);

  function canPlace(x: number, y: number, islandId: number, allowed: CellBounds) {
    if (!inBounds(x, y)) return false;
    if (x < allowed.minX || x > allowed.maxX || y < allowed.minY || y > allowed.maxY) return false;
    if (occupied.has(key(x, y))) return false;
    for (const [nx, ny] of neighbors6(x, y)) {
      const owner = occupied.get(key(nx, ny));
      if (owner !== undefined && owner !== islandId) return false;
    }
    return true;
  }

  if (ISLAND_COUNT > 1) {
    const cells: CellBounds[] = shuffled(buildGridCells()).slice(0, ISLAND_COUNT);

    cells.forEach((cell, idx) => {
      const islandId = idx + 1;
      const allowed: CellBounds = {
        minX: Math.max(0, cell.minX - CELL_OVERFLOW),
        maxX: Math.min(WORLD_SIZE - 1, cell.maxX + CELL_OVERFLOW),
        minY: Math.max(0, cell.minY - CELL_OVERFLOW),
        maxY: Math.min(WORLD_SIZE - 1, cell.maxY + CELL_OVERFLOW),
      };

      // Tohum, hücrenin iç %50'lik bölgesinden seçilir — kenara çok yakın
      // başlarsa komşu hücrenin adasıyla erken çarpışıp büyümesi
      // kısıtlanabilir.
      const innerW = Math.max(1, Math.floor((cell.maxX - cell.minX) * 0.5));
      const innerH = Math.max(1, Math.floor((cell.maxY - cell.minY) * 0.5));
      const innerMinX = cell.minX + Math.floor(((cell.maxX - cell.minX) - innerW) / 2);
      const innerMinY = cell.minY + Math.floor(((cell.maxY - cell.minY) - innerH) / 2);

      let seed: [number, number] | null = null;
      for (let t = 0; t < MAX_SEED_ATTEMPTS_PER_ISLAND; t++) {
        const sx = innerMinX + Math.floor(Math.random() * (innerW + 1));
        const sy = innerMinY + Math.floor(Math.random() * (innerH + 1));
        if (canPlace(sx, sy, islandId, allowed)) {
          seed = [sx, sy];
          break;
        }
      }
      if (!seed) return; // bu hücrede yer bulunamadı; ada atlanır

      const targetSize = ISLAND_MIN_SIZE + Math.floor(Math.random() * (ISLAND_MAX_SIZE - ISLAND_MIN_SIZE + 1));
      const islandTiles: [number, number][] = [seed];
      occupied.set(key(seed[0], seed[1]), islandId);

      let stalls = 0;
      while (islandTiles.length < targetSize && stalls < MAX_GROWTH_STALLS) {
        const [bx, by] = pickGrowthOrigin(islandTiles, occupied, islandId);
        const candidates = neighbors6(bx, by).filter(([nx, ny]) => canPlace(nx, ny, islandId, allowed));
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
        allTiles.push({ x, y, islandId, isCoastal: false });
      }
    });
  }

  // Kıyı hesaplama: bir karo, aynı adaya ait OLMAYAN (farklı ada ya da boş
  // deniz) en az bir komşusu varsa kıyı sayılır. Kale/NPC bu karolarda asla
  // yerleşmemeli (Eren'in isteği) -- sadece adanın iç kısmı yerleşime açık.
  for (const tile of allTiles) {
    for (const [nx, ny] of neighbors6(tile.x, tile.y)) {
      if (occupied.get(key(nx, ny)) !== tile.islandId) {
        tile.isCoastal = true;
        break;
      }
    }
  }

  return allTiles;
}

// Eren'in isteği: "sadece haritayı altıgene çevirelim". Kare gridin x,y'si
// ile altıgenin axial q,r'si aynı iki tamsayı kolonunda tutuluyor (bkz.
// db.ts) ama komşuluk/mesafe anlamları tamamen farklı -- eski kare haritada
// üretilmiş adaların hex komşuluğuna göre şekli bozuk/kopuk görünürdü. Bu
// yüzden (Eren'in de kabul ettiği gibi) test haritasını TEK SEFERLİK olarak
// tamamen sıfırlıyoruz: hem karoları hem de hesapları (test kayıtları)
// temizleyip ensureMapGenerated'ın yeni hex-komşuluklu adaları sıfırdan
// üretmesine izin veriyoruz. schema_migrations ile korunduğu için sunucu
// her yeniden başladığında bir daha ÇALIŞMAZ.
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

// Eren'in isteği: "Tek ve büyük ada yapıcaz, sağa sola kaydırabilelim, birkaç
// kişi test yapacağız sıkışmamalıyız" -- ISLAND_COUNT 10'dan 1'e indirildi ve
// tek adanın hedef boyutu büyütüldü (bkz. SINGLE_ISLAND_MIN/MAX_SIZE). Bu da
// koordinatların anlamını değiştirmiyor (hâlâ aynı hex sistemi) ama önceki
// 10-adalı test haritasıyla artık uyuşmuyor, o yüzden hex geçişindeki gibi
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

// Eren: "şu adayı kaldırsak normal bir ekran olsa... bu ada işi can sıktı" +
// "ada dikdörtgene yakın simetrik olsun, yatay monitör gibi düşün" + "NPC'ler
// azalıcak" -- organik/yuvarlak büyüyen tek-ada algoritması tamamen
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

// Eren: "Objelerin etrafında dönen tam 1 tur hex boş olucak... işlemlerden
// sonra sunucuyu sıfırla" -- bu turdaki değişikliklerin (dağ dekoru
// yeniden tasarımı, zoom, ışıltı) hiçbiri harita ÜRETİM formatını
// değiştirmiyor (hâlâ aynı dikdörtgen tek ada, aynı hex sistemi) -- dekor
// zaten tamamen CLIENT tarafında hesaplanıyor. Yine de doğrudan "sıfırla"
// isteği geldiği için, yukarıdaki geçişlerle (hex/tek ada/dikdörtgen)
// AYNI TRUNCATE deseniyle test verisini temizleyip temiz bir haritayla
// yeniden başlıyoruz.
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

export async function ensureMapGenerated(settings: Settings) {
  const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*)::int as count FROM tiles");
  if (Number(rows[0].count) > 0) return;

  const now = Date.now();
  const layout = generateIslandLayout();

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
        // Kıyı karolarında (adanın dış sınırından 1 kare) asla NPC kampı
        // oluşmaz -- sadece adanın iç kısmı NPC'ye açık (Eren'in isteği).
        const isNpc = !tile.isCoastal && Math.random() < settings.npc_spawn_chance;
        const level = isNpc ? 1 + Math.floor(Math.random() * 3) : 1;
        const production = productionForLevel(level, settings);

        values.push(
          `($${p++}, $${p++}, NULL, $${p++}, $${p++}, $${p++}, $${p++}, 0, 0, $${p++}, $${p++}, $${p++})`
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
          tile.isCoastal
        );
      }

      await client.query(
        `INSERT INTO tiles (x, y, owner_id, island_id, tile_type, level, gold_per_hour,
                            troops_per_hour, stored_gold, stored_troops, last_collected_at, is_coastal)
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
// olarak kıyı karolarına düşer.
export async function pickRandomEmptyTile(): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    "SELECT id FROM tiles WHERE tile_type = 'EMPTY' ORDER BY is_coastal ASC, RANDOM() LIMIT 1"
  );
  return rows[0]?.id ?? null;
}

// Zaten canlı olan bir haritaya geriye dönük olarak uygulanan, TEK SEFERLİK
// (schema_migrations ile korunan) geçiş: hiçbir oyuncu verisini silmez,
// sadece henüz kimsenin fethetmediği (owner_id NULL) NPC kamplarını
// düzenler -- kıyıdakileri boşaltır (yeni kural: kıyıda asla NPC olmaz) ve
// iç kısımdakilerin bir kısmını da seyrekleştirir (Eren'in "NPC'ler
// azalsın" isteği). Oyuncuların zaten sahip olduğu hiçbir kareye dokunmaz.
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

// İkinci seyreltme turu: Eren "NPC'ler azalıcak" isteğini tekrarladı --
// applyNpcBorderMigration zaten kıyıdakileri ve iç kısmın yarısını
// boşaltmıştı, bu geçiş kalan (fethedilmemiş) NPC kamplarının bir kısmını
// daha kaldırıp npc_spawn_chance ayarını da (hâlâ eski varsayılandaysa)
// düşürüyor. Aynı şekilde TEK SEFERLİK, oyuncu verisine dokunmuyor.
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

// Üçüncü seyreltme turu: Eren "NPC'leri azalt ciddi oranda azalt" dedi --
// applyNpcDensityReductionMigration (v2) zaten kalan kampların %40'ını
// boşaltmıştı, bu geçiş kalan (fethedilmemiş) NPC kamplarının YARISINI daha
// kaldırıp npc_spawn_chance ayarını da (hâlâ eski varsayılandaysa) 0.01'e
// düşürüyor. Aynı şekilde TEK SEFERLİK, oyuncu verisine dokunmuyor.
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

// Eren: "başlangıç her zaman ilk ana kalede sabit olmalı" -- bu özellik
// eklenmeden önce kayıt olmuş oyuncuların home_tile_id'si NULL'dır. Bu
// geçiş, elden geldiğince (en erken sahip olunan PLAYER karosu) geriye
// dönük olarak doldurur; yeni kayıtlar zaten /register sırasında set
// ediyor (bkz. routes/players.ts). TEK SEFERLİK, idempotent.
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
