import type { Tile } from "../api";
import { isoCenter } from "./hexMath";
import { HEX_DIRECTIONS } from "./mountains";

// ---------------------------------------------------------------------
// FAZ 5 — Territory (bölge) katmanı
// ---------------------------------------------------------------------
// Amaç: "20 hex = 20 ayrı renkli altıgen" DEĞİL, "20 hex = tek birleşik
// bölge". Bu dosya SADECE görsel bir katman üretir -- hiçbir gameplay/
// ownership mantığı burada YOK, mevcut `Tile.tileType`/`ownerId` verisini
// okuyup (bkz. api.ts) komşu AYNI sahipli hex'leri tek bir SVG path'inde
// birleştiriyor. Backend'e, `tiles` veri modeline ya da diğer sistemlere
// (mountains/forests/rockyAreas/islandShore/worldRegions) HİÇ dokunmuyor.
//
// Yaklaşım (bkz. computeTerritoryRegions / traceBoundaryLoops):
//   1. Her karo (EMPTY hariç) bir "groupKey"e atanır. NPC kampları HER ZAMAN
//      kendi tile'ına özgü bir key alır (`npc:<x>,<y>`) -- kullanıcı isteği:
//      "NPC'lerin altındaki yuvarlaklar birleşmesin", yani iki NPC bitişik
//      olsa bile asla aynı region'a girmiyor, her biri kendi küçük (tek hex)
//      dairesini çiziyor. Oyuncu karoları `player:<ownerId>` groupKey'i
//      taşıyor AMA gerçek sahiplik hücresi yerine PLAYER_INFLUENCE_OFFSETS
//      ile genişletilmiş bir "etki alanı" diski kullanılıyor (bkz. aşağısı)
//      -- kullanıcı isteği: "oyuncu altındaki yuvarlaklar ... 5 hex boyunca
//      birbirine denk gelirse birleşebilir (o bölgeye hakim gibi)" (sonradan
//      "çok oldu" geri bildirimiyle 3'e düşürüldü, bkz. PLAYER_INFLUENCE_RADIUS).
//      Aynı
//      hücrede birden fazla oyuncunun diski çakışırsa ilk yazan kazanır
//      (bkz. computeTerritoryRegions) -- kesin bir Voronoi değil, ama basit
//      ve deterministik.
//   2. HEX_DIRECTIONS (mountains.ts -- server/mapgen.ts ile birebir aynı 6
//      komşu yön) ile klasik flood-fill: aynı groupKey'e sahip komşu
//      karolar TEK bir "region" (bağlı bileşen) oluşturur.
//   3. Her region için dış (ve varsa iç/delik) sınır, hex köşe noktalarından
//      "boundary edge tracing" ile çıkarılır (bkz. traceBoundaryLoops) --
//      HER hex için ayrı path YOK, tüm region TEK bir kapalı poligon (ya da
//      delikli birden fazla loop) dizisi.
//   4. Bu poligon Chaikin corner-cutting ile yumuşatılır (bkz. chaikinSmooth)
//      -- hex sınırının doğal "kale duvarı" zigzag'ını organik, akıcı bir
//      hatta çevirir (islandShore.ts'teki ada kıyısı da AYNI chaikinSmooth'u
//      kullanıyor, bkz. o dosya -- burada gerçek hex geometrisinden
//      türetildiği için önce zigzag'ı azaltmak, SONRA yumuşak çizgi çekmek
//      gerekiyor).
//
// Performans (madde 18): pahalı olan flood-fill + sınır çıkarma SADECE
// `tiles`/ownership değiştiğinde çalışır (bkz. MapView.tsx useMemo bağımlılığı)
// -- zoom (tileWidth) değişince SADECE nokta koordinatları tileWidth ile
// çarpılır (bkz. buildTerritoryPathD), geometri yeniden hesaplanmaz. Path
// sayısı hex sayısı DEĞİL, bağlı bölge (region) sayısı kadardır -- 100+
// owned hex tek bir oyuncuya aitse tek bir <path> olarak kalır.

export type TerritoryCategory = "mine" | "ally" | "enemy" | "npc";

export type TerritoryPoint = { x: number; y: number };

export type TerritoryRegion = {
  // React key + gerektiğinde debug için -- groupKey + region'daki en küçük
  // koordinat, aynı ownership durumunda kararlı kalır.
  key: string;
  category: TerritoryCategory;
  ownerId: string | null;
  // "Unit" uzayda (tileWidth=1) kapalı poligon(lar) -- dış sınır + varsa
  // delikler. Render'da fill-rule="evenodd" ile birlikte kullanılmalı.
  loops: TerritoryPoint[][];
};

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

// ---------------------------------------------------------------------
// Oyuncu "etki alanı" (influence) diski -- kullanıcı isteği: her oyuncu
// karosu merkezden itibaren 3 hex yarıçaplı bir daire yayıyor (ilk sürümde
// 5'ti -- kullanıcı geri bildirimi: "çok oldu", 3'e düşürüldü), aynı sahibin
// diskleri örtüşürse/bitişikse TEK bölge olarak birleşiyor (bkz. dosya başı
// yorumu). Axial hex mesafesi (dx,dy) -> (|dx|+|dy|+|dx+dy|)/2 (HEX_DIRECTIONS
// ile aynı eksen kuralı, standart axial-distance formülü). Offsets bir kere
// hesaplanıp modül seviyesinde tutuluyor -- radius sabit olduğu için her
// region hesaplamasında yeniden üretmeye gerek yok.
export const PLAYER_INFLUENCE_RADIUS = 3;

function hexOffsetsWithinRadius(radius: number): [number, number][] {
  const offsets: [number, number][] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const dist = (Math.abs(dx) + Math.abs(dy) + Math.abs(dx + dy)) / 2;
      if (dist <= radius) offsets.push([dx, dy]);
    }
  }
  return offsets;
}

const PLAYER_INFLUENCE_OFFSETS = hexOffsetsWithinRadius(PLAYER_INFLUENCE_RADIUS);

// ---------------------------------------------------------------------
// Hex köşe geometrisi
// ---------------------------------------------------------------------
// hexMath.ts'teki isoCenter ile AYNI düzen (sivri-uçlu/pointy-top axial hex,
// bkz. o dosyanın başı) -- köşe açıları -30°'den başlayıp 60°'şer artıyor.
// isoCenter DOĞRUSAL olduğu için (isoCenter(x,y,W) = W * isoCenter(x,y,1))
// köşe konumu da tileWidth ile birebir orantılı: bu yüzden tüm topoloji
// (hangi hex'in hangi köşesi nerede) SADECE tileWidth=1 biriminde bir kere
// hesaplanıyor, gerçek piksele çevirme (buildTerritoryPathD) sadece bir
// çarpma işlemi.
const SQRT3 = Math.sqrt(3);
const CORNER_ANGLES = [-30, 30, 90, 150, 210, 270].map((deg) => (deg * Math.PI) / 180);

function unitHexCorner(x: number, y: number, cornerIndex: number): TerritoryPoint {
  const center = isoCenter(x, y, 1);
  const angle = CORNER_ANGLES[cornerIndex];
  return {
    x: center.cx + Math.cos(angle) / SQRT3,
    y: center.cy + Math.sin(angle) / SQRT3,
  };
}

// HEX_DIRECTIONS'taki her komşu yönün (mountains.ts, server/mapgen.ts ile
// birebir aynı sıra) hangi iki köşe arasındaki kenara denk geldiği --
// kenar (c_i, c_{i+1}) her zaman 60*i derece yöne bakar, bu yüzden
// HEX_DIRECTIONS = [(1,0),(1,-1),(0,-1),(-1,0),(-1,1),(0,1)] (açı sırasıyla
// 0°,-60°,-120°,180°,120°,60°) şu köşe çiftlerine eşleniyor.
const EDGE_CORNERS: [number, number][] = [
  [0, 1], // (1,0)   -> 0°
  [5, 0], // (1,-1)  -> -60°
  [4, 5], // (0,-1)  -> -120°
  [3, 4], // (-1,0)  -> 180°
  [2, 3], // (-1,1)  -> 120°
  [1, 2], // (0,1)   -> 60°
];

function pointKey(p: TerritoryPoint): string {
  // Köşe noktaları farklı hex'lerden gelse de kayan noktalı hesap aynı
  // matematiksel noktayı üretir -- küçük bir yuvarlama payıyla eşleştirme
  // (aksi halde float hatası yüzünden aynı köşe iki ayrı nokta sayılabilir).
  return `${Math.round(p.x * 4096)}:${Math.round(p.y * 4096)}`;
}

// Bir region'ın (aynı groupKey'e sahip, birbirine bağlı hex kümesi) dış
// sınırını (ve varsa deliklerini) çıkarır. Algoritma: her üye hex'in, üye
// OLMAYAN bir komşuya bakan kenarları "sınır kenarı"dır -- bunları uçlarına
// göre zincirleyip kapalı poligon(lar) elde ediyoruz. Bu standart bir
// "grid boundary tracing" tekniği, gerçek pathfinding/görüntü işleme değil.
// export edildi: islandShore.ts da AYNI hex-sınır çıkarma tekniğini
// "sahiplik" değil "adaya ait mi" (bkz. o dosya) için kullanıyor.
export function traceBoundaryLoops(memberSet: Set<string>): TerritoryPoint[][] {
  const edges: { from: TerritoryPoint; to: TerritoryPoint }[] = [];
  for (const key of memberSet) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    for (let k = 0; k < 6; k++) {
      const [dx, dy] = HEX_DIRECTIONS[k];
      if (memberSet.has(tileKey(x + dx, y + dy))) continue;
      const [ca, cb] = EDGE_CORNERS[k];
      edges.push({ from: unitHexCorner(x, y, ca), to: unitHexCorner(x, y, cb) });
    }
  }
  if (edges.length === 0) return [];

  const byStart = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = pointKey(e.from);
    const arr = byStart.get(k);
    if (arr) arr.push(i);
    else byStart.set(k, [i]);
  });

  const used = new Array<boolean>(edges.length).fill(false);
  const loops: TerritoryPoint[][] = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const startKey = pointKey(edges[i].from);
    const loop: TerritoryPoint[] = [];
    let curIdx = i;
    let guard = 0;
    while (guard++ <= edges.length) {
      used[curIdx] = true;
      loop.push(edges[curIdx].from);
      const nextKey = pointKey(edges[curIdx].to);
      if (nextKey === startKey) break;
      const candidates = byStart.get(nextKey);
      const nextIdx = candidates?.find((ci) => !used[ci]);
      if (nextIdx === undefined) break; // pinch/uç durumu -- olabildiğince zarif kes
      curIdx = nextIdx;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// ---------------------------------------------------------------------
// Region hesaplama (flood-fill)
// ---------------------------------------------------------------------
export function computeTerritoryRegions(
  tiles: Tile[],
  playerId: string,
  guildMemberIds: Set<string>
): TerritoryRegion[] {
  type TileMeta = { category: TerritoryCategory; groupKey: string; ownerId: string | null };
  const meta = new Map<string, TileMeta>();

  // NPC: groupKey tile'a özgü (`npc:<x>,<y>`) -- iki NPC bitişik olsa bile
  // asla aynı region'a girmiyor, her biri kendi tek-hex dairesini çiziyor.
  for (const t of tiles) {
    if (t.tileType !== "NPC") continue;
    meta.set(tileKey(t.x, t.y), { category: "npc", groupKey: `npc:${t.x},${t.y}`, ownerId: null });
  }

  // Oyuncu: gerçek sahiplik hücresi yerine PLAYER_INFLUENCE_RADIUS'luk
  // genişletilmiş disk flood-fill'e/boundary tracing'e veriliyor -- aynı
  // sahibin diskleri örtüşüyorsa (gerçek karoları arasında hiç fethedilmemiş
  // alan olmasa bile) traceBoundaryLoops'un standart hex-bitişiklik mantığı
  // onları otomatik olarak TEK bir birleşik bölgeye çeviriyor. İKİ geçiş:
  // önce HER oyuncunun kendi gerçek karoları kesin/çakışmasız yazılıyor
  // (bir kalenin kendi hücresi asla komşu bir rakibin etki diskine
  // "çalınamaz"), SONRA genişletilmiş komşu hücreler sadece boşsa dolduruluyor.
  for (const t of tiles) {
    if (t.tileType !== "PLAYER" || !t.ownerId) continue;
    const isMine = t.ownerId === playerId;
    const isAlly = !isMine && guildMemberIds.has(t.ownerId);
    const category: TerritoryCategory = isMine ? "mine" : isAlly ? "ally" : "enemy";
    meta.set(tileKey(t.x, t.y), { category, groupKey: `player:${t.ownerId}`, ownerId: t.ownerId });
  }
  for (const t of tiles) {
    if (t.tileType !== "PLAYER" || !t.ownerId) continue;
    const isMine = t.ownerId === playerId;
    const isAlly = !isMine && guildMemberIds.has(t.ownerId);
    const category: TerritoryCategory = isMine ? "mine" : isAlly ? "ally" : "enemy";
    for (const [dx, dy] of PLAYER_INFLUENCE_OFFSETS) {
      if (dx === 0 && dy === 0) continue; // kendi hücresi yukarıda zaten kesin yazıldı
      const key = tileKey(t.x + dx, t.y + dy);
      // Başka bir oyuncunun gerçek karosu ya da NPC hücresiyse asla ezilmez;
      // iki farklı oyuncunun boş/fethedilmemiş hücrede çakışan diski ise ilk
      // yazan kazanır (bkz. dosya başı yorumu) -- basit, deterministik,
      // gerçek gameplay'e dokunmuyor (bu katman salt görsel).
      if (!meta.has(key)) meta.set(key, { category, groupKey: `player:${t.ownerId}`, ownerId: t.ownerId });
    }
  }

  const visited = new Set<string>();
  const regions: TerritoryRegion[] = [];

  for (const [key, info] of meta) {
    if (visited.has(key)) continue;
    visited.add(key);
    const stack = [key];
    const members: string[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      members.push(cur);
      const [xs, ys] = cur.split(",");
      const x = Number(xs);
      const y = Number(ys);
      for (const [dx, dy] of HEX_DIRECTIONS) {
        const nKey = tileKey(x + dx, y + dy);
        if (visited.has(nKey)) continue;
        const nInfo = meta.get(nKey);
        if (!nInfo || nInfo.groupKey !== info.groupKey) continue;
        visited.add(nKey);
        stack.push(nKey);
      }
    }
    const loops = traceBoundaryLoops(new Set(members));
    if (loops.length === 0) continue;
    regions.push({
      key: `${info.groupKey}:${members[0]}`,
      category: info.category,
      ownerId: info.ownerId,
      loops,
    });
  }
  return regions;
}

// ---------------------------------------------------------------------
// Sınır yumuşatma + SVG path üretimi
// ---------------------------------------------------------------------
// Chaikin corner-cutting (kapalı eğri): her köşeyi kendi kenarının 1/4 ve
// 3/4 noktalarındaki iki yeni noktayla değiştirir. Hex sınırının doğal
// "merdiven" (crenellation) deseni birkaç turda akıcı bir hatta yaklaşır --
// SVG blur/filter GEREKMİYOR (madde 8/18), sadece nokta listesi güncelleniyor.
// N=2 tur: görünür fark yaratmayı bırakıp gereksiz nokta artışına geçmeden
// önceki nokta.
const CHAIKIN_ITERATIONS = 2;

export function chaikinSmooth(pts: TerritoryPoint[], iterations: number): TerritoryPoint[] {
  let cur = pts;
  for (let iter = 0; iter < iterations; iter++) {
    const next: TerritoryPoint[] = [];
    const n = cur.length;
    for (let i = 0; i < n; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    cur = next;
  }
  return cur;
}

export function closedPathD(pts: TerritoryPoint[]): string {
  if (pts.length < 3) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} `;
  for (let i = 1; i < pts.length; i++) {
    d += `L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} `;
  }
  return `${d}Z`;
}

// region.loops "unit" (tileWidth=1) uzayında -- isoCenter'ın doğrusallığı
// sayesinde gerçek piksele çevirmek sadece x/y'yi tileWidth ile çarpmak
// (bkz. dosya başı yorumu). Zoom değişince SADECE bu fonksiyon yeniden
// çalışır, flood-fill/sınır çıkarma DEĞİL.
export function buildTerritoryPathD(region: TerritoryRegion, tileWidth: number): string {
  return region.loops
    .map((loop) => {
      const smoothed = chaikinSmooth(loop, CHAIKIN_ITERATIONS).map((p) => ({
        x: p.x * tileWidth,
        y: p.y * tileWidth,
      }));
      return closedPathD(smoothed);
    })
    .filter((d) => d.length > 0)
    .join(" ");
}
