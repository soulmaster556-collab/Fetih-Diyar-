import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  attackTile,
  createGuild,
  fetchLeaderboard,
  fetchMap,
  fetchMyGuild,
  fetchMyReports,
  fetchMyTiles,
  fetchPlayerSummary,
  joinGuild,
  leaveGuild,
  listGuilds,
  login,
  markReportsRead,
  recallReinforcement,
  register,
  reinforceTile,
  scoutTile,
  upgradeTile,
  type Guild,
  type GuildListEntry,
  type LeaderboardResponse,
  type PlayerSummary,
  type Report,
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
// Eren'in isteği: "Uzak zoomdan eksiltip yakın zoom ekle" -- en uzak seviye
// (16px, haritanın neredeyse tamamen ayrıntısız göründüğü seviye) kaldırıldı,
// buna karşılık üst uca iki yeni yakın seviye (88, 120) eklendi.
const TILE_WIDTHS = [22, 32, 46, 64, 88, 120];
// Varsayılan hâlâ 46px (önceki turdaki "daha yakın plan" kararı korunuyor) --
// bu istek sadece kullanılabilir zoom ARALIĞINI kaydırıyor, varsayılanı değil.
const DEFAULT_TILE_WIDTH_INDEX = 2;
// Eren'in isteği: "kaleler leveline göre şekil değiştirsin" -- oyuncuya ait
// (kendi/klan/düşman fark etmez, hepsi "gerçek oyuncu kalesi") karolar artık
// TEK bir sabit görsel yerine, kalenin seviyesine göre 6 farklı görselden
// birini kullanıyor (bkz. castleImageForLevel). Sahiplik artık görselin
// kendisinden değil, kalenin yanındaki renkli rozetten anlaşılıyor (bkz.
// ownership-badge) -- bu yüzden eski "mavi sancak/kırmızı sancak" iki-görsel
// sistemi kaldırıldı, sadece NPC hâlâ ayrı bir görsel kullanıyor (bkz.
// NPC_CASTLE_ICON).
const CASTLE_LEVEL_TIERS: [number, string][] = [
  [200, "/buildings/castle_levels/level_200.png"],
  [100, "/buildings/castle_levels/level_100.png"],
  [50, "/buildings/castle_levels/level_50.png"],
  [25, "/buildings/castle_levels/level_25.png"],
  [10, "/buildings/castle_levels/level_10.png"],
  [1, "/buildings/castle_levels/level_1.png"],
];
function castleImageForLevel(level: number): string {
  for (const [threshold, src] of CASTLE_LEVEL_TIERS) {
    if (level >= threshold) return src;
  }
  return CASTLE_LEVEL_TIERS[CASTLE_LEVEL_TIERS.length - 1][1];
}
// Eren'in gönderdiği gerçek NPC kalesi görseli (koyu lacivert/altın,
// gözcü kulesi ortada) -- geçici oyuncu-kalesi placeholder'ı kaldırıldı.
const NPC_CASTLE_ICON = "/buildings/npc_castle.png";
// Kale görsellerinin en-boy oranı (~1.37) -- kutunun dışına taşmasın diye
// kale/NPC boyutu bu orana göre hesaplanıyor (bkz. aşağıdaki
// castleBoxWidth/Height). object-fit:contain her görselin kendi gerçek
// oranını koruduğu için 6 seviye görselinin birbirinden farklı oranları
// olması sorun değil -- bu sadece dıştaki kutunun oranı.
const CASTLE_IMAGE_ASPECT = 700 / 512;
const ICON_MIN_WIDTH = 28;
// Üretim/asker etiketi çok küçük karolarda okunaksız kalacağı için sadece
// yeterince yakınlaştırılmışken gösteriliyor.
const LABEL_MIN_WIDTH = 40;

// Eren: "zemini iptal et tek renk açık yeşil zemin koy, altıgenleri görmek
// istemiyorum -- dümdüz tek renk açık yeşil" -- doku/fotoğraf tabanlı zemin
// tamamen kaldırıldı (küçük ton farkları komşu karo sınırlarında görünüp bal
// peteği deseni gibi duruyordu), yerine .iso-ground CSS'inde düz TEK renk
// background-color geldi (bkz. App.css). Üstüne serpiştirilmiş hiçbir obje
// yok.

// Kale/NPC görselleri hex karoların üzerinde gösteriliyor mu -- Eren'in asıl
// amacı eklenen kale görsellerini sergilemek olduğu için bu hep açık.
const SHOW_BUILDINGS = true;

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

// Grid koordinatını (artık axial hex koordinatı: x=q, y=r) ekran merkezine
// çevirir. Sivri-uçlu (pointy-top) altıgen döşeme kullanıyoruz: aynı satırda
// (r sabit) yan yana karolar tam "tileWidth" kadar kayar; bir alt satıra
// (r+1) geçmek hem yarım karo sağa hem de karo yüksekliğinin 3/4'ü kadar
// aşağı kaydırır -- bu standart axial-to-pixel dönüşümü, klasik altıgen
// petek görünümünü verir. x,y her zaman >= 0 olduğu için (WORLD_SIZE içinde)
// eski baklava sisteminin aksine negatif koordinatı önlemek için ayrı bir
// offsetX'e gerek yok.
function isoCenter(x: number, y: number, tileWidth: number) {
  const tileHeight = tileWidth * (2 / Math.sqrt(3));
  return {
    cx: tileWidth * (x + y / 2),
    cy: tileHeight * 0.75 * y,
  };
}

// isoCenter'ın tam tersi (doğrusal bir dönüşüm olduğu için yaklaşık değil,
// birebir ters çözüm): ekrandaki bir (screenX, screenY) noktasının hangi
// axial (q,r) hücresine denk geldiğini bulur. Dört köşeyi bu şekilde çözüp
// min/max alarak, görünen alanın kapsadığı aralığı buluyoruz — sunucudan
// sadece bu aralığı istemek için yeterli.
function screenToWorld(sx: number, sy: number, tileWidth: number) {
  const tileHeight = tileWidth * (2 / Math.sqrt(3));
  const y = sy / (tileHeight * 0.75);
  const x = sx / tileWidth - y / 2;
  return { x, y };
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
  // Destek Gönder / Gözcü Gönder) açılır -> sonra haritada HEDEFİ seçersin
  // -> asker sayısı sorulur. `actionMode` "hedef seçme" adımındayken aktif;
  // geçerli bir hedefe tıklanınca `pendingTarget` dolar ve asker sayısı
  // modalı açılır.
  type ActionType = "attack" | "reinforce" | "scout";
  const [actionMode, setActionMode] = useState<{ type: ActionType; fromTile: Tile } | null>(null);
  const [pendingTarget, setPendingTarget] = useState<{
    type: ActionType;
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
  // butona basınca açılan/kapanan yüzen bir açılır liste. Eren: "belkide
  // oyuncu 100'lerce kale sahibi olucak" -- bu yüzden liste artık arama,
  // sıralama ve sayfalama (hepsini birden render etmemek için) destekliyor.
  const [showKingdomList, setShowKingdomList] = useState(false);
  const [kingdomSearch, setKingdomSearch] = useState("");
  const [kingdomSort, setKingdomSort] = useState<"level" | "troops" | "gold" | "coords">("level");
  const [kingdomVisibleCount, setKingdomVisibleCount] = useState(25);
  // Liderlik Panosu (Eren: "Sıralama olucak en çok askere sahip olan - En
  // çok kaleye sahip olan").
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  // Mesaj/rapor bölümü (Eren: "Mesaj ve rapor bölümü olucak") -- saldırı
  // sonuçları, gözcü raporları, gözetlendiğine dair bildirimler. Tür
  // filtresi, yüzlerce olay birikince taramayı kolaylaştırıyor.
  const [showReports, setShowReports] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportFilter, setReportFilter] = useState<"all" | "attack" | "scout">("all");
  const unreadReportCount = useMemo(() => reports.filter((r) => r.readAt === null).length, [reports]);
  const [tileWidthIndex, setTileWidthIndex] = useState(DEFAULT_TILE_WIDTH_INDEX);
  const tileWidth = TILE_WIDTHS[tileWidthIndex];
  // Sivri-uçlu altıgende yükseklik = genişlik × 2/√3 (bkz. isoCenter).
  const tileHeight = tileWidth * (2 / Math.sqrt(3));
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
    // Token her zaman gönderiliyor ki sunucu gözcü/klan görünürlüğünü
    // (bkz. Tile arayüzündeki not) doğru uygulayabilsin.
    fetchMap(bbox ?? undefined, session?.token)
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

  const refreshReports = (token: string) => {
    fetchMyReports(token).then(setReports).catch(() => {});
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

  // Mesaj/rapor kutusu -- okunmamış sayısı üst menüdeki rozette her zaman
  // güncel kalsın diye periyodik olarak (panel kapalıyken de) çekiliyor.
  useEffect(() => {
    if (!session) return;
    refreshReports(session.token);
    const interval = setInterval(() => refreshReports(session.token), 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // Hedef seçme modu ya da asker-sayısı modalı açıkken Esc ile iptal.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setPendingTarget(null);
      setActionMode(null);
      setShowLeaderboard(false);
      setShowReports(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Arama/sıralama değişince "Krallığım" sayfalamasını başa sar -- aksi
  // halde yeni bir filtrede eski (belki artık anlamsız) sayfa konumunda kalır.
  useEffect(() => {
    setKingdomVisibleCount(25);
  }, [kingdomSearch, kingdomSort]);

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

  // Klan arkadaşlarımın oyuncu kimlikleri -- takviye hedefinin geçerli olup
  // olmadığını (kendi kalem ya da klan arkadaşımın kalesi) anlamak için.
  const guildMemberIds = useMemo(() => new Set((guild?.members ?? []).map((m) => m.playerId)), [guild]);

  // Üst menüdeki toplam asker sayısı (Eren: "üstteki asker üretim sayısı
  // bölümüne toplam asker sayısınıda ekle") -- krallıktaki tüm kalelerin ev
  // garnizonlarının toplamı (klan takviyeleri hariç, onlar "benim" askerim
  // sayılmıyor).
  const totalTroops = useMemo(
    () => myTiles.reduce((sum, t) => sum + (t.troops ?? 0), 0),
    [myTiles]
  );

  // "Krallığım" listesi: arama + sıralama uygulanmış hâli (Eren: "belkide
  // oyuncu 100'lerce kale sahibi olucak" -- tam liste yerine filtrelenip
  // sıralanmış, sonra sayfa sayfa gösterilen bir liste).
  const filteredSortedMyTiles = useMemo(() => {
    const q = kingdomSearch.trim().toLowerCase();
    let list = myTiles;
    if (q) {
      list = list.filter((t) => {
        const haystack = `(${t.x}, ${t.y}) ada #${t.islandId} lv${t.level} seviye ${t.level}`.toLowerCase();
        return haystack.includes(q);
      });
    }
    const sorted = [...list];
    switch (kingdomSort) {
      case "level":
        sorted.sort((a, b) => b.level - a.level);
        break;
      case "troops":
        sorted.sort((a, b) => (b.troops ?? 0) - (a.troops ?? 0));
        break;
      case "gold":
        sorted.sort((a, b) => (b.goldPerHour ?? 0) - (a.goldPerHour ?? 0));
        break;
      case "coords":
        sorted.sort((a, b) => a.x - b.x || a.y - b.y);
        break;
    }
    return sorted;
  }, [myTiles, kingdomSearch, kingdomSort]);

  // Raporlar listesi: tür filtresi uygulanmış hâli.
  const filteredReports = useMemo(() => {
    if (reportFilter === "all") return reports;
    if (reportFilter === "attack") {
      return reports.filter((r) => r.type === "attack_won" || r.type === "attack_lost" || r.type === "defended_win" || r.type === "defended_loss");
    }
    return reports.filter((r) => r.type === "scout_sent" || r.type === "scouted_by");
  }, [reports, reportFilter]);

  // Göreli zaman metni ("3 dk önce" gibi) -- yüzlerce olay biriktiğinde tam
  // tarih/saatten daha hızlı taranabiliyor.
  function timeAgo(ts: number) {
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return "az önce";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} dk önce`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} sa önce`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay} gün önce`;
  }

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

  // Kendi kalemize tıklayınca açılan küçük menüden "Saldır", "Destek
  // Gönder" ya da "Gözcü Gönder" seçilince: bilgi kartını kapatıp "hedef
  // seç" moduna geçiyoruz.
  // Eren: "Bir yeri tıkladığım zaman bir pencere açılıyor farklı bir yeri
  // tıklayınca eski pencere de ekranda kalıyor, otomatik kapansın" -- aynı
  // anda yalnızca TEK bir yüzen panel (kale menüsü, Krallığım, Lonca,
  // Liderlik, Raporlar) açık olmalı. Yeni bir panel açılmadan önce bu
  // çağrılıp diğer hepsi kapatılıyor.
  function closeFloatingPanels() {
    setSelectedTile(null);
    setSelectedScreenPos(null);
    setShowKingdomList(false);
    setShowGuildPanel(false);
    setShowLeaderboard(false);
    setShowReports(false);
  }

  function startAction(type: ActionType, fromTile: Tile) {
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
      setError(
        type === "attack"
          ? "Kendi kalene saldıramazsın."
          : type === "scout"
          ? "Kendi kalene gözcü göndermene gerek yok."
          : "Aynı kaleye takviye gönderilemez."
      );
      return;
    }
    if (type === "attack" || type === "scout") {
      if (tile.tileType === "EMPTY") {
        setError(
          type === "attack"
            ? "Boş kareye saldırılamaz. Sadece NPC kampına veya bir oyuncunun kalesine saldırabilirsin."
            : "Boş kareye gözcü gönderilemez. Sadece NPC kampına veya bir oyuncunun kalesine gözcü gönderebilirsin."
        );
        return;
      }
      if (tile.ownerId === session.playerId) {
        setError(type === "attack" ? "Kendi karene saldıramazsın." : "Kendi karene gözcü göndermene gerek yok.");
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
      } else if (type === "scout") {
        const result = await scoutTile(session.token, targetTile.id, fromTile.id, troopsInput);
        setMessage(
          `Gözcü raporu geldi: Lv${result.level} — ⚔️ ${Math.floor(result.troops)} asker, 🪙 +${result.goldPerHour}/sa`
        );
      } else {
        await reinforceTile(session.token, targetTile.id, fromTile.id, troopsInput);
        setMessage("Takviye gönderildi!");
      }
      refresh();
      refreshMyTiles(session.token);
      refreshSummary(session.token);
      if (session) refreshReports(session.token);
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
    const next = !showGuildPanel;
    closeFloatingPanels();
    setShowGuildPanel(next);
    if (next && !guild) listGuilds().then(setAvailableGuilds).catch(() => {});
  }

  function openLeaderboard() {
    const next = !showLeaderboard;
    closeFloatingPanels();
    setShowLeaderboard(next);
    if (next) fetchLeaderboard().then(setLeaderboard).catch(() => {});
  }

  // Raporlar panelini açınca hem en güncel listeyi çekiyoruz hem de hepsini
  // okunmuş işaretliyoruz -- rozet sayısı böylece panel kapanınca sıfırlanır.
  function openReports() {
    const next = !showReports;
    closeFloatingPanels();
    setShowReports(next);
    if (!next || !session) return;
    fetchMyReports(session.token).then(setReports).catch(() => {});
    if (unreadReportCount > 0) {
      markReportsRead(session.token)
        .then(() => refreshReports(session.token))
        .catch(() => {});
    }
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
    closeFloatingPanels();
    setSelectedTile(tile);
    setActionMode(null);
    setPendingTarget(null);
    setMessage(null);
    setError(null);
    scrollToWorld(tile.x, tile.y, true);
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
            // Axial hex düzeninde en sağdaki karo cx = tileWidth*1.5*(WORLD_SIZE-1)
            // konumunda oturuyor (bkz. isoCenter) -- kapsayıcı buna göre
            // boyutlandırılıyor, eski kare/baklava formülü artık geçerli değil.
            width: tileWidth * (1.5 * (WORLD_SIZE - 1) + 1),
            height: tileHeight * 0.75 * (WORLD_SIZE - 1) + tileHeight,
          }}
        >
          {sortedTiles.map((tile) => {
                const showCastle =
                  SHOW_BUILDINGS && tile.tileType === "PLAYER" && tileWidth >= ICON_MIN_WIDTH;
                const showNpc =
                  SHOW_BUILDINGS && tile.tileType === "NPC" && tileWidth >= ICON_MIN_WIDTH;
                const isMine = tile.ownerId === session.playerId;
                const isGuildmate = !isMine && !!tile.ownerId && guildMemberIds.has(tile.ownerId);
                // Eren'in isteği: gerçek oyuncu kaleleri artık sahipliğe göre
                // değil SEVİYEYE göre görsel değiştiriyor (bkz.
                // CASTLE_LEVEL_TIERS) -- sahiplik yanındaki renkli rozetten
                // anlaşılıyor. NPC kampları hâlâ ayrı, Eren'in gönderdiği
                // gerçek NPC kale görselini kullanıyor (bkz. NPC_CASTLE_ICON).
                const castleIcon = castleImageForLevel(tile.level);
                const { cx, cy } = isoCenter(tile.x, tile.y, tileWidth);
                // Kale/NPC görselleri kendi karolarının DIŞINA taşmasın diye
                // kutu yüksekliği, CASTLE_IMAGE_ASPECT (~1.37, enine geniş)
                // hesaba katılarak genişlik tileWidth'i AŞMAYACAK şekilde
                // sınırlandırıldı (eski 0.94 oranı genişlikte ~%48 taşmaya
                // sebep oluyordu -- komşu karolardaki kaleler üst üste
                // biniyormuş gibi görünüyordu, bkz. Eren'in "üst üste
                // binmeler var" uyarısı). Eren'in isteği: "kaleleri karenin
                // içine ortala" -- dikey olarak karonun tam ortasında.
                const castleBoxHeight = tileHeight * 0.6;
                const castleBoxWidth = castleBoxHeight * CASTLE_IMAGE_ASPECT;
                const npcBoxHeight = tileHeight * 0.54;
                const npcBoxWidth = npcBoxHeight * CASTLE_IMAGE_ASPECT;
                const castleTop = (tileHeight - castleBoxHeight) / 2;
                const npcTop = (tileHeight - npcBoxHeight) / 2;
                const badgeSize = Math.max(8, castleBoxHeight * 0.32);
                // Gözcü/casusluk sistemi: asker/altın bilgisi sadece kendi/
                // klan kalelerinde ya da daha önce gözcülenmiş düşman/NPC
                // kalelerinde gösterilir (tile.troops null ise hiç bilgi yok).
                const hasIntel = tile.troops !== null;
                const showInfoLabel = (showCastle || showNpc) && tileWidth >= LABEL_MIN_WIDTH && hasIntel;
                const totalTroops = (tile.troops ?? 0) + (tile.reinforcementTroops ?? 0);
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
                      closeFloatingPanels();
                      setSelectedTile(tile);
                      setMessage(null);
                      setError(null);
                      setSelectedScreenPos({ x: e.clientX, y: e.clientY });
                    }}
                    title={`(${tile.x}, ${tile.y}) Lv${tile.level} — ada #${tile.islandId}`}
                  >
                    {/* Zemin -- Eren'in isteği üzerine artık doku/fotoğraf
                        değil, dümdüz TEK renk açık yeşil (bkz. .iso-ground'un
                        background-color'ı App.css'te) -- altıgen sınırları
                        görünmesin diye komşu karolar arasında hiçbir ton farkı
                        yok. Üstüne serpiştirilmiş hiçbir obje de yok. */}
                    <div className="iso-ground" />
                    <div className={`iso-diamond ${selectedTile?.id === tile.id ? "selected" : ""}`} />
                    {showCastle && (
                      <>
                        <img
                          src={castleIcon}
                          alt=""
                          className="iso-castle"
                          style={{
                            width: castleBoxWidth,
                            height: castleBoxHeight,
                            left: (tileWidth - castleBoxWidth) / 2,
                            top: castleTop,
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
                            left: (tileWidth - castleBoxWidth) / 2 + castleBoxWidth - badgeSize * 0.7,
                            top: castleTop - badgeSize * 0.35,
                          }}
                        />
                      </>
                    )}
                    {showNpc && (
                      <img
                        src={NPC_CASTLE_ICON}
                        alt=""
                        className="iso-castle"
                        style={{
                          width: npcBoxWidth,
                          height: npcBoxHeight,
                          left: (tileWidth - npcBoxWidth) / 2,
                          top: npcTop,
                        }}
                      />
                    )}
                    {/* Seviye rozeti artık BURADA render edilmiyor -- ayrı,
                        tüm karoların üstünde tek bir katmana taşındı (bkz.
                        aşağıdaki .iso-labels-layer). Sebep: her
                        .iso-tile-group kendi z-index'i (1) yüzünden kendi
                        "istifleme bağlamını" oluşturuyor -- bu da komşu bir
                        karo DOM'da SONRA geldiğinde, önceki karonun karo
                        dışına taşan (yukarı yüzen) rozetinin üstünü örtmesine
                        sebep oluyordu (Eren'in ekran görüntüsündeki "Lv4"
                        yazılarının yarısının kesilmesi tam olarak buydu). */}
                    {/* Madde: "Saatlik üretimlerin orada toplam asker
                        sayılarıda görünsün" -- ama artık sadece gözcülenmiş
                        (ya da kendi/klan) kalelerde, ve donmuş/son bilinen
                        bilgi olarak (bkz. Tile.scoutedAt). */}
                    {showInfoLabel && (
                      <div className="tile-info-label" style={{ left: tileWidth / 2 }}>
                        <span>⚔️ {totalTroops}</span>
                        <span>🪙 +{tile.goldPerHour ?? 0}/sa</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Seviye rozetleri -- Eren'in ekran görüntüsünde "Lv4"
                  yazılarının yarısı kesik görünüyordu. Sebep: yukarıdaki her
                  .iso-tile-group kendi z-index'i (1) yüzünden kendi
                  istifleme bağlamını oluşturuyor, bu da komşu bir karo
                  DOM'da SONRA geldiğinde onun zemininin, önceki karonun karo
                  dışına taşan (yukarı yüzen) rozetinin üstünü örtmesine
                  sebep oluyordu. Çözüm: tüm rozetleri, hiçbir karonun asla
                  üstüne binemeyeceği, TEK ve en üstteki ortak bir katmanda
                  toplamak (bkz. .iso-labels-layer, z-index tüm
                  .iso-tile-group'lardan yüksek). */}
              <div className="iso-labels-layer">
                {sortedTiles.map((tile) => {
                  const showCastle =
                    SHOW_BUILDINGS && tile.tileType === "PLAYER" && tileWidth >= ICON_MIN_WIDTH;
                  const showNpc =
                    SHOW_BUILDINGS && tile.tileType === "NPC" && tileWidth >= ICON_MIN_WIDTH;
                  const showLevelBadge = (showCastle || showNpc) && tileWidth >= LABEL_MIN_WIDTH;
                  if (!showLevelBadge) return null;
                  const { cx, cy } = isoCenter(tile.x, tile.y, tileWidth);
                  const isNpcTile = tile.tileType === "NPC";
                  return (
                    <div
                      key={tile.id}
                      className="iso-label-anchor"
                      style={{
                        left: cx - tileWidth / 2,
                        top: cy - tileHeight / 2,
                        width: tileWidth,
                        height: tileHeight,
                      }}
                    >
                      <div
                        className={`level-badge ${isNpcTile ? "level-badge-npc" : ""}`}
                        style={{ left: tileWidth / 2 }}
                      >
                        Lv{tile.level}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

      <header className="topbar">
        <h1>Fetih Diyarı</h1>
        {summary && (
          <div className="summary-bar">
            <span className="summary-item summary-item-gold">
              🪙 {Math.floor(summary.gold)} <small>(+{summary.goldPerHour}/sa)</small>
            </span>
            {/* Eren: "Toplam asker ve yanındaki saatlik üretimi birleştir
                altın yeri gibi olsun" -- artık tek rozette, altınla aynı
                "toplam (+üretim/sa)" biçiminde. */}
            <span className="summary-item summary-item-troops">
              ⚔️ {totalTroops} <small>(+{summary.troopsPerHour}/sa)</small>
            </span>
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
            onClick={() => {
              const next = !showKingdomList;
              closeFloatingPanels();
              setShowKingdomList(next);
            }}
          >
            🏰 Krallığım ({myTiles.length})
          </button>
          <button
            className={`kingdom-toggle ${showGuildPanel ? "active" : ""}`}
            onClick={openGuildPanel}
          >
            🛡️ {guild ? guild.name : "Lonca"}
          </button>
          <button
            className={`kingdom-toggle ${showLeaderboard ? "active" : ""}`}
            onClick={openLeaderboard}
          >
            🏆 Liderlik
          </button>
          <button
            className={`kingdom-toggle ${showReports ? "active" : ""}`}
            onClick={openReports}
          >
            📨 Raporlar{unreadReportCount > 0 ? ` (${unreadReportCount})` : ""}
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
              : actionMode.type === "scout"
              ? "Gözcü göndermek istediğin kaleyi haritada seç"
              : "Takviye göndermek istediğin kaleyi (kendi ya da klan arkadaşının) haritada seç"}
          </span>
          <button className="icon-btn" onClick={cancelAction}>✕ İptal</button>
        </div>
      )}

      {/* Eren: "Liderlik panosu öne ayrı ekran olarak çıksın" / "Mesajlar
          raporlar bölümü de öne ayrı ekran olarak açılsın... profesyonel
          bir şekilde tasarla" -- bu iki panel artık haritanın üstüne
          bağlı küçük bir açılır kutu değil, koyu bir arka plan üzerinde
          ortalanan, kendi başına bir "ekran" gibi tam boy modal. */}
      {showLeaderboard && (
        <div className="modal-overlay" onClick={() => setShowLeaderboard(false)}>
          <div className="modal-screen modal-leaderboard" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🏆 Liderlik Panosu</h2>
              <button className="icon-btn" onClick={() => setShowLeaderboard(false)}>✕</button>
            </div>
            <div className="modal-body">
              {!leaderboard ? (
                <p className="hint">Yükleniyor…</p>
              ) : (
                <div className="leaderboard-sections">
                  <div className="leaderboard-column">
                    <h3 className="leaderboard-heading">⚔️ En Çok Askere Sahip</h3>
                    {leaderboard.topTroops.length === 0 && <p className="hint">Henüz veri yok.</p>}
                    <ol className="leaderboard-list">
                      {leaderboard.topTroops.map((e, i) => (
                        <li key={`troops-${e.username}-${i}`} className={`leaderboard-row ${i < 3 ? `leaderboard-top leaderboard-top-${i + 1}` : ""}`}>
                          <span className="leaderboard-rank">#{i + 1}</span>
                          <span className="leaderboard-name">{e.username}</span>
                          <span className="leaderboard-value">{e.value}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="leaderboard-column">
                    <h3 className="leaderboard-heading">🏰 En Çok Kaleye Sahip</h3>
                    {leaderboard.topCastles.length === 0 && <p className="hint">Henüz veri yok.</p>}
                    <ol className="leaderboard-list">
                      {leaderboard.topCastles.map((e, i) => (
                        <li key={`castles-${e.username}-${i}`} className={`leaderboard-row ${i < 3 ? `leaderboard-top leaderboard-top-${i + 1}` : ""}`}>
                          <span className="leaderboard-rank">#{i + 1}</span>
                          <span className="leaderboard-name">{e.username}</span>
                          <span className="leaderboard-value">{e.value}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showReports && (
        <div className="modal-overlay" onClick={() => setShowReports(false)}>
          <div className="modal-screen modal-reports" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📨 Mesaj &amp; Raporlar</h2>
              <button className="icon-btn" onClick={() => setShowReports(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="filter-chip-row">
                <button className={`filter-chip ${reportFilter === "all" ? "active" : ""}`} onClick={() => setReportFilter("all")}>
                  Tümü
                </button>
                <button className={`filter-chip ${reportFilter === "attack" ? "active" : ""}`} onClick={() => setReportFilter("attack")}>
                  ⚔️ Savaş
                </button>
                <button className={`filter-chip ${reportFilter === "scout" ? "active" : ""}`} onClick={() => setReportFilter("scout")}>
                  🔭 Gözcü
                </button>
              </div>
              {filteredReports.length === 0 && <p className="hint">Bu filtrede henüz bir mesaj yok.</p>}
              <ul className="report-list">
                {filteredReports.map((r) => (
                  <li key={r.id} className={`report-row report-${r.type}`}>
                    <div className="report-row-header">
                      <span className="report-title">{r.title}</span>
                      <span className="report-time">{timeAgo(r.createdAt)}</span>
                    </div>
                    <p className="report-body">{r.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
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
        <div className="kingdom-dropdown kingdom-dropdown-wide">
          <div className="tile-card-header">
            <h2>Krallığım ({myTiles.length})</h2>
            <button className="icon-btn" onClick={() => setShowKingdomList(false)}>✕</button>
          </div>
          {myTiles.length === 0 ? (
            <p className="hint">Henüz bir şehrin yok.</p>
          ) : (
            <>
              {/* Eren: "belkide oyuncu 100'lerce kale sahibi olucak" -- arama
                  ve sıralama, liste büyüdükçe belirli bir kaleyi bulmayı
                  hızlandırıyor. */}
              <div className="kingdom-toolbar">
                <input
                  className="kingdom-search"
                  placeholder="Ara: koordinat, ada veya seviye…"
                  value={kingdomSearch}
                  onChange={(e) => setKingdomSearch(e.target.value)}
                />
                <select
                  className="kingdom-sort"
                  value={kingdomSort}
                  onChange={(e) => setKingdomSort(e.target.value as typeof kingdomSort)}
                >
                  <option value="level">Seviyeye göre</option>
                  <option value="troops">Askere göre</option>
                  <option value="gold">Altına göre</option>
                  <option value="coords">Konuma göre</option>
                </select>
              </div>

              {filteredSortedMyTiles.length === 0 ? (
                <p className="hint">Aramayla eşleşen kale yok.</p>
              ) : (
                <>
                  <div className="kingdom-table-head">
                    <span>Kale</span>
                    <span>Lv</span>
                    <span>⚔️</span>
                    <span>🪙/sa</span>
                    <span></span>
                  </div>
                  <ul className="kingdom-table">
                    {filteredSortedMyTiles.slice(0, kingdomVisibleCount).map((t) => (
                      <li key={t.id} className="kingdom-table-row">
                        <span className="kingdom-table-coords">
                          ({t.x}, {t.y}) <small>Ada #{t.islandId}</small>
                        </span>
                        <span className="kingdom-table-level">Lv{t.level}</span>
                        <span className="kingdom-table-troops">{t.troops}</span>
                        <span className="kingdom-table-gold">+{t.goldPerHour}</span>
                        <span className="kingdom-table-actions">
                          <button className="icon-btn" onClick={() => handleUpgrade(t.id)} title="Yükselt">⬆️</button>
                          <button className="icon-btn" onClick={() => goToTile(t)} title="Haritada göster">🗺️</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {filteredSortedMyTiles.length > kingdomVisibleCount && (
                    <button
                      className="kingdom-load-more"
                      onClick={() => setKingdomVisibleCount((v) => v + 25)}
                    >
                      Daha Fazla Göster ({filteredSortedMyTiles.length - kingdomVisibleCount} kale kaldı)
                    </button>
                  )}
                </>
              )}
            </>
          )}
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
        const isMineSel = selectedTile.ownerId === session.playerId;
        const isGuildmateSel = !isMineSel && !!selectedTile.ownerId && guildMemberIds.has(selectedTile.ownerId);
        const hasIntelSel = selectedTile.troops !== null && selectedTile.tileType !== "EMPTY";
        // Eren'in isteği: kaleye tıklayınca açılan bu kart artık gönderdiği
        // referans görsele benzer şekilde -- üstte oyuncu adı/seviye
        // "kalkanı"/lonca rozetinden oluşan bir banner, altında altıgen
        // aksiyon butonları -- tasarlandı (bkz. .hex-menu-* App.css). Veri/
        // mantık aynı kaldı, sadece görünüm değişti.
        const ownerLabel =
          selectedTile.tileType === "NPC"
            ? "NPC Kampı"
            : selectedTile.tileType === "EMPTY"
            ? "Boş Kare"
            : selectedTile.ownerUsername ?? "Bilinmiyor";
        return (
          <div className="tile-card hex-menu" style={{ left, top, maxHeight: CARD_MAX_HEIGHT }}>
            <button
              className="hex-menu-close"
              onClick={() => { setSelectedTile(null); setSelectedScreenPos(null); }}
            >
              ✕
            </button>
            <div className="hex-menu-banner">
              <div className="hex-menu-level-shield">
                <span>{selectedTile.level}</span>
              </div>
              <div className="hex-menu-owner-block">
                <div className="hex-menu-owner-name">{ownerLabel}</div>
                <div className="hex-menu-owner-sub">
                  ({selectedTile.x}, {selectedTile.y}) · Ada #{selectedTile.islandId}
                  {isMineSel && <span className="hex-menu-pill hex-menu-pill-own">Benim</span>}
                  {isGuildmateSel && <span className="hex-menu-pill hex-menu-pill-guild">Klan</span>}
                </div>
              </div>
            </div>
            <div className="hex-menu-body">
              {hasIntelSel ? (
                <>
                  <div className="tile-stats-row">
                    <span className="stat-chip stat-troops">⚔️ <strong>{selectedTile.troops}</strong></span>
                    <span className="stat-chip stat-gold">🪙 <strong>+{selectedTile.goldPerHour}</strong>/sa</span>
                  </div>
                  {(selectedTile.reinforcementTroops ?? 0) > 0 && (
                    <p className="hint">🛡️ +{selectedTile.reinforcementTroops} takviye (klan)</p>
                  )}
                  {!isMineSel && !isGuildmateSel && selectedTile.scoutedAt !== null && (
                    <p className="hint scout-hint">
                      🔍 Gözcü raporu: {new Date(selectedTile.scoutedAt).toLocaleString("tr-TR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" "}(bu bilgi donmuş — güncellemek için tekrar gözcü gönder)
                    </p>
                  )}
                </>
              ) : (
                selectedTile.tileType !== "EMPTY" && (
                  <p className="hint scout-hint">
                    🔍 Bu kale hakkında istihbaratın yok. Asker sayısını görmek için önce gözcü gönder.
                  </p>
                )
              )}

              {selectedTile.tileType === "EMPTY" && (
                <p className="hint">
                  Boş kareye saldırılamaz. Haritada ilerlemek için NPC kamplarını veya
                  düşman şehirlerini fethetmelisin.
                </p>
              )}

              {selectedTile.tileType !== "EMPTY" && !isMineSel && (
                <p className="hint">
                  Saldırmak veya gözcü göndermek için önce kendi kalene tıkla, açılan menüden seç, sonra bu kareyi hedef göster.
                </p>
              )}

              {isMineSel && (
                <div className="hex-actions">
                  <button className="hex-action hex-action-attack" onClick={() => startAction("attack", selectedTile)}>
                    <span className="hex-action-shape"><span className="hex-action-icon">⚔️</span></span>
                    <span className="hex-action-label">Saldır</span>
                  </button>
                  <button className="hex-action hex-action-reinforce" onClick={() => startAction("reinforce", selectedTile)}>
                    <span className="hex-action-shape"><span className="hex-action-icon">🛡️</span></span>
                    <span className="hex-action-label">Destek</span>
                  </button>
                  <button className="hex-action hex-action-scout" onClick={() => startAction("scout", selectedTile)}>
                    <span className="hex-action-shape"><span className="hex-action-icon">🔭</span></span>
                    <span className="hex-action-label">Gözcü</span>
                  </button>
                  <button className="hex-action hex-action-upgrade" onClick={() => handleUpgrade(selectedTile.id)}>
                    <span className="hex-action-shape"><span className="hex-action-icon">⬆️</span></span>
                    <span className="hex-action-label">Yükselt</span>
                  </button>
                </div>
              )}

              {(selectedTile.reinforcements ?? [])
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
        const CARD_WIDTH = 320;
        const margin = 12;
        const pos = selectedScreenPos ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        let left = pos.x + 18;
        let top = pos.y - 20;
        if (left + CARD_WIDTH > window.innerWidth - margin) left = pos.x - CARD_WIDTH - 18;
        left = Math.max(margin, Math.min(left, window.innerWidth - CARD_WIDTH - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - 320 - margin));
        const maxTroops = pendingTarget.fromTile.troops ?? 0;
        const actionMeta = {
          attack: { title: "Saldırı Emri", icon: "⚔️", confirmLabel: "Saldır", cls: "confirm-attack" },
          reinforce: { title: "Destek Gönder", icon: "🛡️", confirmLabel: "Gönder", cls: "confirm-reinforce" },
          scout: { title: "Gözcü Gönder", icon: "🔭", confirmLabel: "Gönder", cls: "confirm-scout" },
        }[pendingTarget.type];
        const targetLabel =
          pendingTarget.targetTile.tileType === "NPC" ? "NPC Kampı" : "Oyuncu Kalesi";
        return (
          <div className="tile-card pending-action-card" style={{ left, top }}>
            <div className="tile-card-header">
              <h2>{actionMeta.icon} {actionMeta.title}</h2>
              <button className="icon-btn" onClick={cancelAction}>✕</button>
            </div>
            <div>
              <div className="pending-route">
                <div className="pending-route-side">
                  <span className="pending-route-label">Kalen</span>
                  <span className="pending-route-coords">({pendingTarget.fromTile.x}, {pendingTarget.fromTile.y})</span>
                  <span className="pending-route-sub">Lv{pendingTarget.fromTile.level}</span>
                </div>
                <span className="pending-route-arrow">→</span>
                <div className="pending-route-side">
                  <span className="pending-route-label">Hedef</span>
                  <span className="pending-route-coords">({pendingTarget.targetTile.x}, {pendingTarget.targetTile.y})</span>
                  <span className="pending-route-sub">{targetLabel} · Lv{pendingTarget.targetTile.level}</span>
                </div>
              </div>

              <p className="hint">Elindeki asker: <strong>{maxTroops}</strong></p>

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
                <div className="troop-quick-btns">
                  {[0.25, 0.5, 1].map((frac) => (
                    <button
                      key={frac}
                      type="button"
                      className="troop-quick-btn"
                      onClick={() => setTroopsInput(Math.max(1, Math.floor(maxTroops * frac)))}
                    >
                      {frac === 1 ? "Tümü" : `%${frac * 100}`}
                    </button>
                  ))}
                </div>
                <button
                  className={`confirm-action-btn ${actionMeta.cls}`}
                  disabled={troopsInput <= 0 || troopsInput > maxTroops}
                  onClick={handleConfirmAction}
                >
                  {actionMeta.icon} {actionMeta.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
