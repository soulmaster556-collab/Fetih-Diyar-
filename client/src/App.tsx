import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  attackTile,
  createGuild,
  fetchMap,
  fetchMyGuild,
  fetchMyTiles,
  fetchPlayerSummary,
  joinGuild,
  leaveGuild,
  listGuilds,
  login,
  recallReinforcement,
  register,
  reinforceTile,
  upgradeTile,
  type Guild,
  type GuildListEntry,
  type PlayerSummary,
  type Session,
  type Tile,
} from "./api";

const SESSION_KEY = "fetih-diyari-session";
// Not: WORLD_SIZE burada ve server/src/game/mapgen.ts'te birebir aynı olmalı.
const WORLD_SIZE = 200;
// Görünen bölgenin kenarlarına eklenen pay (karo cinsinden) — küçük
// kaydırmalarda hemen yeniden istek atmamak için.
const VIEWPORT_MARGIN = 6;
// Karo genişliği (izometrik baklava şeklinin genişliği, px). Yükseklik hep
// genişliğin yarısı — klasik 2:1 izometrik oran (Travian/Forge of Empires
// tarzı haritalarda kullanılan oran).
const TILE_WIDTHS = [16, 22, 32, 46, 64];
const DEFAULT_TILE_WIDTH_INDEX = 2;
// Oyuncu kalesi ve NPC kampı görselleri -- artık AI fotoğraf değil, kodda
// elle çizilmiş düz renkli (flat) SVG'ler: hem tema açık/canlı çizgi film
// stiline dönsün diye, hem de eskisi gibi "fazla dikine giden kule" hissi
// olmasın diye bilerek geniş/basık oranlarda çizildi (bkz. viewBox'ları).
const CASTLE_ICON = "/buildings/player_castle.svg";
const NPC_ICON = "/buildings/npc_camp.svg";
const ICON_MIN_WIDTH = 28;

// Boş karolar artık fotoğraf dokusu değil, düz (flat) canlı yeşil renk
// kullanıyor -- hem yeni "çizgi film" temasına uyuyor hem de üç farklı
// fotoğrafın kendi ton farkından kaynaklanan "kare kare" dikiş sorununu
// baştan ortadan kaldırıyor. Hangi karonun hangi tonu aldığı (x,y)'den
// deterministik olarak hesaplanıyor (bkz. tileVariantHash).
const GRASS_COLOR_VARIANTS = ["#8bc34a", "#97cf57", "#7fb943"];
// Çim tonu artık TEK karo yerine GRASS_BLOCK_SIZE×GRASS_BLOCK_SIZE'lık
// bloklar halinde seçiliyor -- her karo bağımsız rastgele seçildiğinde harita
// "kare kare" belli olan bir dama tahtası gibi görünüyordu; komşu karoların
// aynı tonu paylaşması daha sakin/organik bölgeler oluşturuyor.
const GRASS_BLOCK_SIZE = 4;
const TREE_DECOR = "/terrain/decor_trees.svg";
// Tek tük (kümeye dahil olmayan) serpiştirilmiş dekorlar -- taş/kütük/kazıntı
// artık daha seyrek (önceden %35'lik tek bir havuzun parçasıydı).
const SCATTERED_DECOR_VARIANTS = ["/terrain/decor_ruins.svg", "/terrain/decor_rocks.svg", "/terrain/decor_stump.svg"];
const DECOR_MIN_WIDTH = 28;
const SCATTERED_DECOR_CHANCE = 0.14;
// Kümeye dahil olmayan tekil (yalnız) ağaç ihtimali -- orman kümelerinden
// bağımsız, seyrek bir "tek ağaç" hissi için. Artık ağaçların çoğu kümeler
// üzerinden geliyor, bu yüzden düşük tutuluyor.
const LONE_TREE_CHANCE = 0.04;

// Ağaç kümeleri: harita (x,y) uzayı FOREST_BLOCK_SIZE×FOREST_BLOCK_SIZE'lık
// bloklara bölünür, her blok bağımsız ve deterministik olarak "bu blokta
// nadir bir orman kümesi var mı" diye zar atar -- varsa 3-4 (sık) veya 6-7
// (nadir) bitişik kareden oluşan organik bir küme büyütülür (mapgen.ts'teki
// ada büyütme mantığına benzer, sadece küçük ölçekte ve tamamen client-side).
const FOREST_BLOCK_SIZE = 8;
const FOREST_CLUSTER_CHANCE = 0.12;

// (x,y) tam sayı çiftinden [0,1) aralığında deterministik bir sayı üretir
// (basit bir integer hash -- Math.random YOK, aynı karo hep aynı sonucu verir).
function tileVariantHash(x: number, y: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

function grassColorFor(tile: Tile) {
  const bx = Math.floor(tile.x / GRASS_BLOCK_SIZE);
  const by = Math.floor(tile.y / GRASS_BLOCK_SIZE);
  const idx = Math.floor(tileVariantHash(bx, by) * GRASS_COLOR_VARIANTS.length);
  return GRASS_COLOR_VARIANTS[Math.min(idx, GRASS_COLOR_VARIANTS.length - 1)];
}

// Verilen (bx,by) bloğu için (varsa) orman kümesinin üye karolarını
// hesaplar. Büyüme, bloğun kendi sınırları içine sıkıştırılır ki bir
// karonun üyeliği her zaman KENDİ bloğundan (bx,by) hesaplanarak
// bulunabilsin (komşu bloklara taşıp da oradan görünmez kalmasın).
function forestClusterMembers(bx: number, by: number): Set<string> {
  const spawnRoll = tileVariantHash(bx * 92821 + 17, by * 63841 + 29);
  if (spawnRoll >= FOREST_CLUSTER_CHANCE) return new Set();

  const sizeRoll = tileVariantHash(bx * 15485 + 3, by * 25733 + 11);
  const extra = Math.floor(tileVariantHash(bx * 5051 + 41, by * 7919 + 59) * 2); // 0 ya da 1
  const size = sizeRoll >= 0.65 ? 6 + extra : 3 + extra; // %65 küçük (3-4), %35 nadir büyük (6-7)

  const blockMinX = bx * FOREST_BLOCK_SIZE;
  const blockMinY = by * FOREST_BLOCK_SIZE;
  const originX = blockMinX + Math.floor(tileVariantHash(bx * 104729 + 5, by * 101 + 7) * FOREST_BLOCK_SIZE);
  const originY = blockMinY + Math.floor(tileVariantHash(bx * 211 + 13, by * 104723 + 19) * FOREST_BLOCK_SIZE);

  const members = new Set<string>([`${originX},${originY}`]);
  const frontier: [number, number][] = [[originX, originY]];
  const dirs: [number, number][] = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];

  let step = 0;
  while (members.size < size && step < size * 8) {
    step++;
    const frontierIdx = Math.floor(tileVariantHash(originX + step * 733, originY + step * 977) * frontier.length);
    const [px, py] = frontier[frontierIdx];
    const dirIdx = Math.floor(tileVariantHash(originX * 31 + step * 17, originY * 31 + step * 23) * dirs.length);
    const [dx, dy] = dirs[dirIdx];
    const nx = px + dx;
    const ny = py + dy;
    // Kümeyi kendi bloğunun sınırları içinde tut (bkz. yukarıdaki not).
    if (nx < blockMinX || nx >= blockMinX + FOREST_BLOCK_SIZE) continue;
    if (ny < blockMinY || ny >= blockMinY + FOREST_BLOCK_SIZE) continue;
    const k = `${nx},${ny}`;
    if (!members.has(k)) {
      members.add(k);
      frontier.push([nx, ny]);
    }
  }
  return members;
}

function isInForestCluster(x: number, y: number): boolean {
  const bx = Math.floor(x / FOREST_BLOCK_SIZE);
  const by = Math.floor(y / FOREST_BLOCK_SIZE);
  const members = forestClusterMembers(bx, by);
  return members.size > 0 && members.has(`${x},${y}`);
}

function decorVariantFor(tile: Tile): string | null {
  // 1) Orman kümesinin parçası mı? (en yüksek öncelik)
  if (isInForestCluster(tile.x, tile.y)) return TREE_DECOR;

  // 2) Seyrek serpiştirilmiş dekor (taş/kütük/kazıntı) -- farklı hash
  // "tuzları" kullanılarak diğer kararlardan bağımsız tutuluyor.
  const scatteredRoll = tileVariantHash(tile.x + 9973, tile.y + 9973);
  if (scatteredRoll < SCATTERED_DECOR_CHANCE) {
    const idx = Math.floor(tileVariantHash(tile.x - 9973, tile.y - 9973) * SCATTERED_DECOR_VARIANTS.length);
    return SCATTERED_DECOR_VARIANTS[Math.min(idx, SCATTERED_DECOR_VARIANTS.length - 1)];
  }

  // 3) Kümeye dahil olmayan tekil/yalnız ağaç.
  const loneTreeRoll = tileVariantHash(tile.x + 42017, tile.y + 42017);
  if (loneTreeRoll < LONE_TREE_CHANCE) return TREE_DECOR;

  return null;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

// Grid koordinatını (x,y) izometrik ekran merkezine çevirir. Standart 2:1
// izometrik projeksiyon: sağa gitmek ekranda sağ-aşağı, aşağı gitmek
// ekranda sol-aşağı hareket ettirir — bu da o klasik "baklava" ızgarayı
// oluşturur. offsetX, en soldaki karonun negatif koordinata düşmesini önler.
function isoCenter(x: number, y: number, tileWidth: number) {
  const tileHeight = tileWidth / 2;
  const offsetX = ((WORLD_SIZE - 1) * tileWidth) / 2;
  return {
    cx: offsetX + (x - y) * (tileWidth / 2),
    cy: (x + y) * (tileHeight / 2),
  };
}

// isoCenter'ın tersi: ekrandaki bir (screenX, screenY) noktasının hangi
// dünya koordinatına düştüğünü bulur. Dört köşeyi bu şekilde çözüp min/max
// alarak, görünen dikdörtgen alanın kapsadığı (x,y) aralığını (bir dörtgen
// değil, baklava şeklinde olsa da) yaklaşık olarak buluyoruz — sunucudan
// sadece bu aralığı istemek için yeterli.
function screenToWorld(sx: number, sy: number, tileWidth: number) {
  const tileHeight = tileWidth / 2;
  const offsetX = ((WORLD_SIZE - 1) * tileWidth) / 2;
  const a = (sx - offsetX) / (tileWidth / 2); // x - y
  const b = sy / (tileHeight / 2); // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession());
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  // `tiles`: sadece o an ekranda görünen bölgenin karoları (+ pay). Dünya
  // binlerce karo olabileceği için tamamını her seferinde çekmiyoruz.
  const [tiles, setTiles] = useState<Tile[]>([]);
  // `myTiles`: oyuncunun SAHİP OLDUĞU tüm şehirler, görünen bölgeden
  // bağımsız — "Krallığım" listesi haritada nerede olursan ol tam olmalı.
  const [myTiles, setMyTiles] = useState<Tile[]>([]);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  // Yeni akış: önce KENDİ kalene tıklarsın -> küçük bir menü (Saldır /
  // Destek Gönder) açılır -> sonra haritada HEDEFİ seçersin -> asker sayısı
  // sorulur. `actionMode` "hedef seçme" adımındayken aktif; geçerli bir
  // hedefe tıklanınca `pendingTarget` dolar ve asker sayısı modalı açılır.
  const [actionMode, setActionMode] = useState<{ type: "attack" | "reinforce"; fromTile: Tile } | null>(null);
  const [pendingTarget, setPendingTarget] = useState<{
    type: "attack" | "reinforce";
    fromTile: Tile;
    targetTile: Tile;
  } | null>(null);
  const [troopsInput, setTroopsInput] = useState(10);
  // Madde 1: tek yerde toplam altın/asker üretimi + ortak altın havuzu.
  const [summary, setSummary] = useState<PlayerSummary | null>(null);
  // Lonca (klan) sistemi.
  const [guild, setGuild] = useState<Guild | null>(null);
  const [showGuildPanel, setShowGuildPanel] = useState(false);
  const [availableGuilds, setAvailableGuilds] = useState<GuildListEntry[]>([]);
  const [guildNameInput, setGuildNameInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sağdaki/soldaki sabit barlar kaldırıldığı için "Seçili Kare" bilgi
  // kartı artık tıklanan noktanın yakınında yüzen bir kutu -- konumu
  // tıklama anındaki ekran koordinatlarında tutuluyor.
  const [selectedScreenPos, setSelectedScreenPos] = useState<{ x: number; y: number } | null>(null);
  // "Krallığım" şehir listesi artık kalıcı bir panel değil, üst menüdeki
  // butona basınca açılan/kapanan yüzen bir açılır liste.
  const [showKingdomList, setShowKingdomList] = useState(false);
  const [tileWidthIndex, setTileWidthIndex] = useState(DEFAULT_TILE_WIDTH_INDEX);
  const tileWidth = TILE_WIDTHS[tileWidthIndex];
  const tileHeight = tileWidth / 2;
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollDebounceRef = useRef<number | undefined>(undefined);
  const hasCenteredRef = useRef(false);
  // Zoom seviyesi (tileWidth) değişince karo boyutu değiştiği için
  // scrollLeft/scrollTop'un işaret ettiği dünya noktası da kayar — bu ref,
  // zoom tuşuna basılır basılmaz "ekranın ortasındaki dünya noktasını"
  // saklar, yeni tileWidth uygulandıktan sonra oraya yeniden kaydırırız.
  const recenterOnZoomRef = useRef<{ x: number; y: number } | null>(null);

  // Fare tekerleği artık haritayı kaydırmak yerine yakınlaştırıp
  // uzaklaştırıyor -- imlecin altındaki dünya noktası zoom sonrasında da
  // aynı yerde kalsın diye (ekranın ortası değil) o noktayı hesaplayıp
  // recenterOnZoomRef'e yazıyoruz; tileWidth değişince aşağıdaki effect
  // oraya yeniden kaydırıyor.
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = viewportRef.current;
    if (!el) return;
    const direction = e.deltaY < 0 ? 1 : -1;
    const nextIndex = Math.min(TILE_WIDTHS.length - 1, Math.max(0, tileWidthIndex + direction));
    if (nextIndex === tileWidthIndex) return;
    const rect = el.getBoundingClientRect();
    const sx = e.clientX - rect.left + el.scrollLeft;
    const sy = e.clientY - rect.top + el.scrollTop;
    recenterOnZoomRef.current = screenToWorld(sx, sy, tileWidth);
    setTileWidthIndex(nextIndex);
  }

  // Sol tıkla basılı tutup sürükleyerek haritayı kaydırma (artık native
  // scrollbar/kaydırma çubuğu yok -- .map-viewport overflow:hidden).
  // Sürükleme mesafesi küçükse (basit bir tıklama ise) karo seçimi normal
  // şekilde çalışmaya devam etsin diye, gerçek bir sürükleme olduysa
  // ardından gelen "click" olayını bir kereliğine yutuyoruz.
  function handleViewportMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const el = viewportRef.current;
    if (!el) return;
    const drag = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      moved: false,
    };

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
      el!.scrollLeft = drag.scrollLeft - dx;
      el!.scrollTop = drag.scrollTop - dy;
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (drag.moved) {
        const swallowClick = (ev: MouseEvent) => ev.stopPropagation();
        el!.addEventListener("click", swallowClick, { capture: true, once: true });
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function currentBoundingBox() {
    const el = viewportRef.current;
    if (!el) return null;
    const corners = [
      [el.scrollLeft, el.scrollTop],
      [el.scrollLeft + el.clientWidth, el.scrollTop],
      [el.scrollLeft, el.scrollTop + el.clientHeight],
      [el.scrollLeft + el.clientWidth, el.scrollTop + el.clientHeight],
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [sx, sy] of corners) {
      const { x, y } = screenToWorld(sx, sy, tileWidth);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return {
      minX: Math.max(0, Math.floor(minX) - VIEWPORT_MARGIN),
      maxX: Math.min(WORLD_SIZE - 1, Math.ceil(maxX) + VIEWPORT_MARGIN),
      minY: Math.max(0, Math.floor(minY) - VIEWPORT_MARGIN),
      maxY: Math.min(WORLD_SIZE - 1, Math.ceil(maxY) + VIEWPORT_MARGIN),
    };
  }

  const refresh = () => {
    const bbox = currentBoundingBox();
    fetchMap(bbox ?? undefined)
      .then(setTiles)
      .catch((e) => setError(e.message));
  };

  const refreshMyTiles = (token: string) => {
    fetchMyTiles(token).then(setMyTiles).catch(() => {});
  };

  const refreshSummary = (token: string) => {
    fetchPlayerSummary(token).then(setSummary).catch(() => {});
  };

  const refreshGuild = (token: string) => {
    fetchMyGuild(token).then(setGuild).catch(() => {});
  };

  function scrollToWorld(x: number, y: number, smooth: boolean) {
    const el = viewportRef.current;
    if (!el) return;
    const { cx, cy } = isoCenter(x, y, tileWidth);
    el.scrollTo({
      left: cx - el.clientWidth / 2,
      top: cy - el.clientHeight / 2,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function handleViewportScroll() {
    window.clearTimeout(scrollDebounceRef.current);
    scrollDebounceRef.current = window.setTimeout(refresh, 250);
  }

  useEffect(() => {
    if (!session) return;
    refreshMyTiles(session.token);
    const interval = setInterval(() => refreshMyTiles(session.token), 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  useEffect(() => {
    if (!session) return;
    refreshSummary(session.token);
    const interval = setInterval(() => refreshSummary(session.token), 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  useEffect(() => {
    if (!session) return;
    refreshGuild(session.token);
    const interval = setInterval(() => refreshGuild(session.token), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // Hedef seçme modu ya da asker-sayısı modalı açıkken Esc ile iptal.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setPendingTarget(null);
      setActionMode(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // İlk açılışta oyuncunun ilk şehri gelince oraya kaydır (aksi halde 200x80
  // dünyanın rastgele bir köşesinde, muhtemelen boş denizde kalırız).
  useEffect(() => {
    if (hasCenteredRef.current || myTiles.length === 0) return;
    hasCenteredRef.current = true;
    scrollToWorld(myTiles[0].x, myTiles[0].y, false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTiles]);

  // Zoom değişince bir karonun ekrandaki piksel karşılığı değiştiği için
  // önce (varsa) ekranın ortasındaki dünya noktasını yeni ölçeğe göre
  // yeniden ortala, sonra görünen bölgeyi çek.
  useEffect(() => {
    if (!session) return;
    if (recenterOnZoomRef.current) {
      scrollToWorld(recenterOnZoomRef.current.x, recenterOnZoomRef.current.y, false);
      recenterOnZoomRef.current = null;
    }
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileWidth, session?.token]);

  // Seçili kare hâlâ görünen bölgedeyse (ya da benim şehrimse) en güncel
  // sayılarla senkron kalsın; ekrandan çıktıysa son bilinen haliyle kalır.
  useEffect(() => {
    if (!selectedTile) return;
    const fresh =
      tiles.find((t) => t.id === selectedTile.id) ??
      myTiles.find((t) => t.id === selectedTile.id);
    if (fresh && fresh !== selectedTile) setSelectedTile(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, myTiles]);

  // İzometrik görünümde alttaki karolar üsttekilerin önüne çizilmeli
  // (aksi halde şehir ikonları arkadaki karoların altında kalır gibi
  // görünür). DOM sırası = çizim sırası olduğu için basitçe x+y'ye göre
  // artan sıralamak yeterli.
  const sortedTiles = useMemo(
    () => [...tiles].sort((a, b) => a.x + a.y - (b.x + b.y)),
    [tiles]
  );

  // Zemin artık HER karonun kendi ayrı arka plan rengini çizdiği bir "kare
  // kare" ızgara değil -- aynı GRASS_BLOCK_SIZE bloğuna (ve dolayısıyla aynı
  // yeşil tona) düşen komşu karolar TEK bir SVG <path> içinde birleştirilip
  // tek seferde dolduruluyor. Aynı path üzerindeki bitişik baklavaların
  // arasında stroke/kenar çizgisi olmadığı için görsel olarak "tek parça bir
  // ada yaması" gibi görünüyor, ayrı karolar dizisi gibi değil. Karo türüne
  // (NPC/oyuncu/boş) bakılmaksızın HER karo bu zemine dahil -- sahiplik artık
  // zeminin renginden değil, binanın altındaki küçük rozetten anlaşılıyor
  // (bkz. aşağıdaki "ownership-badge").
  const terrainGroups = useMemo(() => {
    const groups = new Map<string, { color: string; parts: string[] }>();
    const half = tileWidth / 2;
    const halfH = tileHeight / 2;
    // Bitişik karo path'leri arasında olası kıl payı boşluk/dikiş kalmasın
    // diye köşeleri çok hafif dışa taşırıyoruz.
    const pad = 0.75;
    for (const tile of tiles) {
      const bx = Math.floor(tile.x / GRASS_BLOCK_SIZE);
      const by = Math.floor(tile.y / GRASS_BLOCK_SIZE);
      const groupKey = `${bx}:${by}`;
      const color = grassColorFor(tile);
      const { cx, cy } = isoCenter(tile.x, tile.y, tileWidth);
      const d = `M ${cx} ${cy - halfH - pad} L ${cx + half + pad} ${cy} L ${cx} ${cy + halfH + pad} L ${cx - half - pad} ${cy} Z `;
      let group = groups.get(groupKey);
      if (!group) {
        group = { color, parts: [] };
        groups.set(groupKey, group);
      }
      group.parts.push(d);
    }
    return Array.from(groups.entries()).map(([groupKey, group]) => ({
      key: groupKey,
      color: group.color,
      d: group.parts.join(""),
    }));
  }, [tiles, tileWidth, tileHeight]);

  // Klan arkadaşlarımın oyuncu kimlikleri -- takviye hedefinin geçerli olup
  // olmadığını (kendi kalem ya da klan arkadaşımın kalesi) anlamak için.
  const guildMemberIds = useMemo(() => new Set((guild?.members ?? []).map((m) => m.playerId)), [guild]);

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const action = authMode === "login" ? login : register;
      const s = await action(usernameInput.trim(), passwordInput);
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      hasCenteredRef.current = false;
      setSession(s);
      refreshMyTiles(s.token);
      refreshSummary(s.token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setTiles([]);
    setMyTiles([]);
    setSelectedTile(null);
    setSummary(null);
    setGuild(null);
    setActionMode(null);
    setPendingTarget(null);
    hasCenteredRef.current = false;
  }

  async function handleUpgrade(tileId: number) {
    if (!session) return;
    setError(null);
    setMessage(null);
    try {
      await upgradeTile(session.token, tileId);
      setMessage("Şehir yükseltildi!");
      refresh();
      refreshMyTiles(session.token);
      refreshSummary(session.token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Kendi kalemize tıklayınca açılan küçük menüden "Saldır" ya da "Destek
  // Gönder" seçilince: bilgi kartını kapatıp "hedef seç" moduna geçiyoruz.
  function startAction(type: "attack" | "reinforce", fromTile: Tile) {
    setActionMode({ type, fromTile });
    setPendingTarget(null);
    setSelectedTile(null);
    setSelectedScreenPos(null);
    setMessage(null);
    setError(null);
  }

  function cancelAction() {
    setActionMode(null);
    setPendingTarget(null);
    setError(null);
  }

  // Hedef seçme modundayken haritada bir karoya tıklanınca çağrılır --
  // hedef geçerliyse asker-sayısı modalını açar, değilse hatayı gösterip
  // modda kalır (kullanıcı başka bir kareye tıklayıp tekrar deneyebilir).
  function handleTargetPick(tile: Tile, screenX: number, screenY: number) {
    if (!actionMode || !session) return;
    const { type, fromTile } = actionMode;
    if (tile.id === fromTile.id) {
      setError(type === "attack" ? "Kendi kalene saldıramazsın." : "Aynı kaleye takviye gönderilemez.");
      return;
    }
    if (type === "attack") {
      if (tile.tileType === "EMPTY") {
        setError("Boş kareye saldırılamaz. Sadece NPC kampına veya bir oyuncunun kalesine saldırabilirsin.");
        return;
      }
      if (tile.ownerId === session.playerId) {
        setError("Kendi karene saldıramazsın.");
        return;
      }
    } else {
      const isSelf = tile.ownerId === session.playerId;
      const isGuildmate = !isSelf && !!tile.ownerId && guildMemberIds.has(tile.ownerId);
      if (!isSelf && !isGuildmate) {
        setError("Sadece kendi kalene veya klan arkadaşının kalesine takviye gönderebilirsin.");
        return;
      }
    }
    setError(null);
    setTroopsInput(10);
    setPendingTarget({ type, fromTile, targetTile: tile });
    setSelectedScreenPos({ x: screenX, y: screenY });
  }

  async function handleConfirmAction() {
    if (!session || !pendingTarget) return;
    setError(null);
    setMessage(null);
    const { type, fromTile, targetTile } = pendingTarget;
    try {
      if (type === "attack") {
        const result = await attackTile(session.token, targetTile.id, fromTile.id, troopsInput);
        setMessage(
          result.result === "ATTACKER_WINS"
            ? `Zafer! Kare ele geçirildi. (Güç: ${Math.round(result.attackerPower)} vs ${Math.round(result.defenderPower)})`
            : `Saldırı püskürtüldü. (Güç: ${Math.round(result.attackerPower)} vs ${Math.round(result.defenderPower)})`
        );
      } else {
        await reinforceTile(session.token, targetTile.id, fromTile.id, troopsInput);
        setMessage("Takviye gönderildi!");
      }
      refresh();
      refreshMyTiles(session.token);
      refreshSummary(session.token);
      setPendingTarget(null);
      setActionMode(null);
      setSelectedScreenPos(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRecall(reinforcementId: number) {
    if (!session) return;
    setError(null);
    setMessage(null);
    try {
      await recallReinforcement(session.token, reinforcementId);
      setMessage("Askerler geri çağrıldı.");
      refresh();
      refreshMyTiles(session.token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openGuildPanel() {
    setShowGuildPanel((v) => !v);
    if (!guild) listGuilds().then(setAvailableGuilds).catch(() => {});
  }

  async function handleCreateGuild(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !guildNameInput.trim()) return;
    setError(null);
    try {
      const g = await createGuild(session.token, guildNameInput.trim());
      setGuild(g);
      setGuildNameInput("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleJoinGuild(guildId: number) {
    if (!session) return;
    setError(null);
    try {
      const g = await joinGuild(session.token, guildId);
      setGuild(g);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleLeaveGuild() {
    if (!session) return;
    setError(null);
    try {
      await leaveGuild(session.token);
      setGuild(null);
      listGuilds().then(setAvailableGuilds).catch(() => {});
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function goToTile(tile: Tile) {
    setSelectedTile(tile);
    setActionMode(null);
    setPendingTarget(null);
    setMessage(null);
    setError(null);
    scrollToWorld(tile.x, tile.y, true);
    setShowKingdomList(false);
    const el = viewportRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setSelectedScreenPos({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  }

  if (!session) {
    return (
      <div className="login-screen">
        <h1>Fetih Diyarı</h1>
        <p className="subtitle">Million Lords tarzı, timer'sız fetih prototipi</p>
        <div className="auth-tabs">
          <button
            className={authMode === "login" ? "active" : ""}
            onClick={() => { setAuthMode("login"); setError(null); }}
            type="button"
          >
            Giriş Yap
          </button>
          <button
            className={authMode === "register" ? "active" : ""}
            onClick={() => { setAuthMode("register"); setError(null); }}
            type="button"
          >
            Kayıt Ol
          </button>
        </div>
        <form onSubmit={handleAuthSubmit} className="login-form">
          <input
            placeholder="Kullanıcı adı"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            minLength={3}
            maxLength={20}
            required
          />
          <input
            type="password"
            placeholder="Şifre (en az 6 karakter)"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            minLength={6}
            required
          />
          <button type="submit">{authMode === "login" ? "Giriş Yap" : "Krallığını Kur"}</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="game-layout">
      {/* Harita artık tüm pencereyi kaplayan tek katman -- menü/panel bunun
          ÜZERİNE yarı saydam "HUD" katmanları olarak biniyor (ayrı kutular
          halinde değil, tek bütün bir oyun ekranı hissi için). */}
      <div
        className="map-viewport"
        ref={viewportRef}
        onScroll={handleViewportScroll}
        onWheel={handleWheel}
        onMouseDown={handleViewportMouseDown}
      >
        <div
          className="iso-map"
          style={{
            width: WORLD_SIZE * tileWidth,
            height: WORLD_SIZE * tileHeight + tileHeight,
          }}
        >
          {/* Tüm adaların zemini -- artık her karo kendi arka planını çizen
              ayrı bir dikdörtgen değil, aynı renk bloğuna düşen komşu
              karoların TEK bir SVG path'te birleştiği "tek parça yama"lar.
              Bkz. terrainGroups memo'su: aradaki dikişler tamamen kayboluyor. */}
          <svg
            className="terrain-layer"
            width={WORLD_SIZE * tileWidth}
            height={WORLD_SIZE * tileHeight + tileHeight}
          >
            {terrainGroups.map((g) => (
              <path key={g.key} d={g.d} fill={g.color} />
            ))}
          </svg>
          {sortedTiles.map((tile) => {
                const showCastle = tile.tileType === "PLAYER" && tileWidth >= ICON_MIN_WIDTH;
                const showNpc = tile.tileType === "NPC" && tileWidth >= ICON_MIN_WIDTH;
                const isMine = tile.ownerId === session.playerId;
                const isGuildmate = !isMine && !!tile.ownerId && guildMemberIds.has(tile.ownerId);
                const { cx, cy } = isoCenter(tile.x, tile.y, tileWidth);
                // Yeni SVG kale/NPC çizimleri bilerek geniş/basık oranlı (dikine
                // gitmesinler diye) -- object-fit:contain + object-position:bottom
                // ile kutunun tabanına yaslanıyor, bu yüzden kutu boyutu eskisi
                // kadar büyük olmasa da okunaklı kalıyor.
                const castleSize = tileWidth * 0.92;
                const npcSize = tileWidth * 0.86;
                const badgeSize = Math.max(8, castleSize * 0.24);
                const isEmpty = tile.tileType === "EMPTY";
                const decorImg = isEmpty && tileWidth >= DECOR_MIN_WIDTH ? decorVariantFor(tile) : null;
                const decorSize = tileWidth * 0.8;
                // NPC/dekor ikonlarına karo bazlı hafif döndürme+ölçek farkı --
                // aynı ikon yüzlerce karoda birebir aynı dursa "fotokopi
                // çekilmiş" gibi tekdüze/kare kare bir tekrar hissi veriyordu.
                const npcRotation = (tileVariantHash(tile.x * 31 + 7, tile.y * 37 + 11) - 0.5) * 20;
                const npcScale = 0.92 + tileVariantHash(tile.x * 41 + 13, tile.y * 43 + 17) * 0.18;
                const decorRotation = (tileVariantHash(tile.x * 53 + 19, tile.y * 59 + 23) - 0.5) * 26;
                const decorScale = 0.88 + tileVariantHash(tile.x * 61 + 29, tile.y * 67 + 31) * 0.3;
                return (
                  <div
                    key={tile.id}
                    data-tile-id={tile.id}
                    className="iso-tile-group"
                    style={{
                      left: cx - tileWidth / 2,
                      top: cy - tileHeight / 2,
                      width: tileWidth,
                      height: tileHeight,
                    }}
                    onClick={(e) => {
                      if (actionMode) {
                        handleTargetPick(tile, e.clientX, e.clientY);
                        return;
                      }
                      setSelectedTile(tile);
                      setMessage(null);
                      setError(null);
                      setSelectedScreenPos({ x: e.clientX, y: e.clientY });
                    }}
                    title={`(${tile.x}, ${tile.y}) Lv${tile.level} — ada #${tile.islandId}`}
                  >
                    <div className={`iso-diamond ${selectedTile?.id === tile.id ? "selected" : ""}`} />
                    {decorImg && (
                      <img
                        src={decorImg}
                        alt=""
                        className="iso-decor"
                        style={{
                          width: decorSize,
                          height: decorSize,
                          left: (tileWidth - decorSize) / 2,
                          top: (tileHeight - decorSize) / 2 - tileHeight * 0.05,
                          transform: `rotate(${decorRotation}deg) scale(${decorScale})`,
                        }}
                      />
                    )}
                    {showCastle && (
                      <>
                        <img
                          src={CASTLE_ICON}
                          alt=""
                          className="iso-castle"
                          style={{
                            width: castleSize,
                            height: castleSize,
                            left: (tileWidth - castleSize) / 2,
                            top: (tileHeight - castleSize) / 2 - tileHeight * 0.05,
                          }}
                        />
                        {/* Sahiplik artık zeminin renginden değil, kalenin
                            yanındaki bu küçük rozetten anlaşılıyor (yeşil =
                            benim, mavi = klan arkadaşım, kırmızı = düşman)
                            -- zemin her yerde aynı sürekli çim olduğu için
                            "kare kare" satranç tahtası etkisi tamamen
                            ortadan kalkıyor. */}
                        <div
                          className="ownership-badge"
                          style={{
                            background: isMine ? "#4caf50" : isGuildmate ? "#2196f3" : "#e53935",
                            width: badgeSize,
                            height: badgeSize,
                            left: (tileWidth - castleSize) / 2 + castleSize - badgeSize * 0.7,
                            top: (tileHeight - castleSize) / 2 - tileHeight * 0.05 - badgeSize * 0.35,
                          }}
                        />
                      </>
                    )}
                    {showNpc && (
                      <img
                        src={NPC_ICON}
                        alt=""
                        className="iso-castle"
                        style={{
                          width: npcSize,
                          height: npcSize,
                          left: (tileWidth - npcSize) / 2,
                          top: (tileHeight - npcSize) / 2 - tileHeight * 0.05,
                          transform: `rotate(${npcRotation}deg) scale(${npcScale})`,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

      <header className="topbar">
        <h1>Fetih Diyarı</h1>
        {summary && (
          <div className="summary-bar">
            <span className="summary-item">🪙 {Math.floor(summary.gold)} <small>(+{summary.goldPerHour}/sa)</small></span>
            <span className="summary-item">⚔️ +{summary.troopsPerHour}/sa</span>
          </div>
        )}
        <div className="player-info">
          <button
            className="kingdom-toggle"
            disabled={myTiles.length === 0}
            onClick={() => myTiles[0] && goToTile(myTiles[0])}
            title="Ana kalene git"
          >
            🧭 Krallığıma Git
          </button>
          <button
            className={`kingdom-toggle ${showKingdomList ? "active" : ""}`}
            onClick={() => setShowKingdomList((v) => !v)}
          >
            🏰 Krallığım ({myTiles.length})
          </button>
          <button
            className={`kingdom-toggle ${showGuildPanel ? "active" : ""}`}
            onClick={openGuildPanel}
          >
            🛡️ {guild ? guild.name : "Lonca"}
          </button>
          <span>{session.username}</span>
          <button onClick={handleLogout}>Çıkış</button>
        </div>
      </header>

      {(message || error) && (
        <div className="hud-banners">
          {message && <div className="banner success">{message}</div>}
          {error && <div className="banner error">{error}</div>}
        </div>
      )}

      {actionMode && !pendingTarget && (
        <div className="action-hint">
          <span>
            {actionMode.type === "attack"
              ? "Saldırmak istediğin kaleyi haritada seç"
              : "Takviye göndermek istediğin kaleyi (kendi ya da klan arkadaşının) haritada seç"}
          </span>
          <button className="icon-btn" onClick={cancelAction}>✕ İptal</button>
        </div>
      )}

      {showGuildPanel && (
        <div className="kingdom-dropdown">
          <div className="tile-card-header">
            <h2>Lonca</h2>
            <button className="icon-btn" onClick={() => setShowGuildPanel(false)}>✕</button>
          </div>
          {guild ? (
            <div>
              <p>
                <strong>{guild.name}</strong> — {guild.memberCount} üye
              </p>
              <ul className="city-list">
                {guild.members.map((m) => (
                  <li key={m.playerId}>
                    <div className="city-row">
                      <div>{m.username}{m.playerId === guild.leaderId ? " 👑" : ""}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <button onClick={handleLeaveGuild}>Loncadan Ayrıl</button>
            </div>
          ) : (
            <div>
              <form onSubmit={handleCreateGuild} className="login-form">
                <input
                  placeholder="Yeni lonca adı"
                  value={guildNameInput}
                  onChange={(e) => setGuildNameInput(e.target.value)}
                  minLength={3}
                  maxLength={24}
                />
                <button type="submit">Lonca Kur</button>
              </form>
              <p className="hint">Ya da mevcut bir loncaya katıl:</p>
              {availableGuilds.length === 0 && <p className="hint">Henüz hiç lonca yok.</p>}
              <ul className="city-list">
                {availableGuilds.map((g) => (
                  <li key={g.id}>
                    <div className="city-row">
                      <div>
                        <div>{g.name}</div>
                        <div className="stats">👑 {g.leaderUsername} &nbsp; 👥 {g.memberCount}</div>
                      </div>
                    </div>
                    <div className="row-actions">
                      <button onClick={() => handleJoinGuild(g.id)}>Katıl</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {showKingdomList && (
        <div className="kingdom-dropdown">
          <div className="tile-card-header">
            <h2>Krallığım</h2>
            <button className="icon-btn" onClick={() => setShowKingdomList(false)}>✕</button>
          </div>
          {myTiles.length === 0 && <p className="hint">Henüz bir şehrin yok.</p>}
          <ul className="city-list">
            {myTiles.map((t) => (
              <li key={t.id}>
                <div className="city-row">
                  <img src={CASTLE_ICON} alt="" className="city-icon" />
                  <div>
                    <div>
                      ({t.x},{t.y}) — Lv{t.level} — ada #{t.islandId}
                    </div>
                    <div className="stats">
                      ⚔️ {t.troops} asker &nbsp; 🪙 +{t.goldPerHour}/sa
                    </div>
                  </div>
                </div>
                <div className="row-actions">
                  <button onClick={() => handleUpgrade(t.id)}>Yükselt</button>
                  <button onClick={() => goToTile(t)}>Haritada göster</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedTile && selectedScreenPos && (() => {
        const CARD_WIDTH = 300;
        const CARD_MAX_HEIGHT = 440;
        const margin = 12;
        let left = selectedScreenPos.x + 18;
        let top = selectedScreenPos.y - 20;
        if (left + CARD_WIDTH > window.innerWidth - margin) left = selectedScreenPos.x - CARD_WIDTH - 18;
        left = Math.max(margin, Math.min(left, window.innerWidth - CARD_WIDTH - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - CARD_MAX_HEIGHT - margin));
        return (
          <div className="tile-card" style={{ left, top, maxHeight: CARD_MAX_HEIGHT }}>
            <div className="tile-card-header">
              <h2>Seçili Kare</h2>
              <button
                className="icon-btn"
                onClick={() => { setSelectedTile(null); setSelectedScreenPos(null); }}
              >
                ✕
              </button>
            </div>
            <div>
              <p>
                ({selectedTile.x}, {selectedTile.y}) — {selectedTile.tileType} — Lv
                {selectedTile.level} — ada #{selectedTile.islandId}
              </p>
              <p>⚔️ {selectedTile.troops} asker &nbsp; 🪙 +{selectedTile.goldPerHour}/sa</p>
              {selectedTile.reinforcementTroops > 0 && (
                <p>🛡️ +{selectedTile.reinforcementTroops} takviye (klan)</p>
              )}
              {!selectedTile.ownerId
                ? null
                : selectedTile.ownerId === session.playerId
                ? null
                : guildMemberIds.has(selectedTile.ownerId) && <p className="hint">Bu bir klan arkadaşının kalesi.</p>}

              {selectedTile.tileType === "EMPTY" && (
                <p className="hint">
                  Boş kareye saldırılamaz. Haritada ilerlemek için NPC kamplarını veya
                  düşman şehirlerini fethetmelisin.
                </p>
              )}

              {selectedTile.tileType !== "EMPTY" && selectedTile.ownerId !== session.playerId && (
                <p className="hint">
                  Saldırmak için önce kendi kalene tıkla, açılan menüden "Saldır"ı seç, sonra bu kareyi hedef göster.
                </p>
              )}

              {selectedTile.ownerId === session.playerId && (
                <div className="castle-actions">
                  <button onClick={() => startAction("attack", selectedTile)}>⚔️ Saldır</button>
                  <button onClick={() => startAction("reinforce", selectedTile)}>🛡️ Destek Gönder</button>
                  <button onClick={() => handleUpgrade(selectedTile.id)}>⬆️ Yükselt</button>
                </div>
              )}

              {selectedTile.reinforcements
                .filter((r) => r.fromPlayerId === session.playerId)
                .map((r) => (
                  <div key={r.id} className="reinforcement-row">
                    <span>{r.troops} asker gönderdin</span>
                    <button onClick={() => handleRecall(r.id)}>Geri Çağır</button>
                  </div>
                ))}
            </div>
          </div>
        );
      })()}

      {pendingTarget && (() => {
        const CARD_WIDTH = 300;
        const margin = 12;
        const pos = selectedScreenPos ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        let left = pos.x + 18;
        let top = pos.y - 20;
        if (left + CARD_WIDTH > window.innerWidth - margin) left = pos.x - CARD_WIDTH - 18;
        left = Math.max(margin, Math.min(left, window.innerWidth - CARD_WIDTH - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - 260 - margin));
        const maxTroops =
          pendingTarget.type === "attack" ? pendingTarget.fromTile.troops : pendingTarget.fromTile.troops;
        return (
          <div className="tile-card" style={{ left, top }}>
            <div className="tile-card-header">
              <h2>{pendingTarget.type === "attack" ? "Saldır" : "Destek Gönder"}</h2>
              <button className="icon-btn" onClick={cancelAction}>✕</button>
            </div>
            <div>
              <p>
                ({pendingTarget.fromTile.x},{pendingTarget.fromTile.y}) → ({pendingTarget.targetTile.x},{pendingTarget.targetTile.y})
              </p>
              <p className="hint">Elindeki asker: {maxTroops}</p>
              <div className="attack-form">
                <label>
                  Gönderilecek asker:
                  <input
                    type="number"
                    min={1}
                    max={maxTroops}
                    value={troopsInput}
                    onChange={(e) => setTroopsInput(Number(e.target.value))}
                    autoFocus
                  />
                </label>
                <button disabled={troopsInput <= 0 || troopsInput > maxTroops} onClick={handleConfirmAction}>
                  {pendingTarget.type === "attack" ? "Saldır" : "Gönder"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
