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
// Oyuncu kalesi ve NPC kalesi görselleri -- Eren'in verdiği iki fotoğraf
// (kırmızı sancak = oyuncu, mavi sancak = NPC), beyaz arka planları
// kaldırılıp (alfa şeffaflık) kırpılmış PNG olarak public/buildings altına
// kondu (bkz. sohbetteki görsel işleme adımları).
const CASTLE_ICON = "/buildings/player_castle_new.png";
const NPC_ICON = "/buildings/npc_castle_new.png";
// Yeni kale görsellerinin en-boy oranı (~1.37) -- kutunun dışına taşmasın
// diye kale/NPC boyutu bu orana göre hesaplanıyor (bkz. aşağıdaki
// castleBoxWidth/Height).
const CASTLE_IMAGE_ASPECT = 700 / 512;
const ICON_MIN_WIDTH = 28;
// Üretim/asker etiketi çok küçük karolarda okunaksız kalacağı için sadece
// yeterince yakınlaştırılmışken gösteriliyor.
const LABEL_MIN_WIDTH = 40;

// Zemin artık TEK bir sabit doku (Eren'in verdiği çim karosu fotoğrafı) --
// her karoda aynı görsel kullanılıyor, üstüne serpiştirilmiş hiçbir obje
// (ağaç/taş/kütük) yok; dekor ileride Eren tarafından elle, tek tek
// karolara yerleştirilecek (bkz. sohbet).
const GROUND_TEXTURE = "/terrain/ground.jpg";

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
          {sortedTiles.map((tile) => {
                const showCastle = tile.tileType === "PLAYER" && tileWidth >= ICON_MIN_WIDTH;
                const showNpc = tile.tileType === "NPC" && tileWidth >= ICON_MIN_WIDTH;
                const isMine = tile.ownerId === session.playerId;
                const isGuildmate = !isMine && !!tile.ownerId && guildMemberIds.has(tile.ownerId);
                const { cx, cy } = isoCenter(tile.x, tile.y, tileWidth);
                // Kale/NPC görselleri artık kendi karolarının DIŞINA
                // taşmıyor -- kutu, karonun kendi (tileWidth × tileHeight)
                // sınırlarını asla aşmayacak şekilde (yükseklik sınırlayıcı
                // boyut, CASTLE_IMAGE_ASPECT'e göre genişlik ondan türetiliyor)
                // hesaplanıp karonun ALT ucuna yaslanıyor (Eren'in isteği:
                // "Kaleler bulunduğu karenin dışına çıkmasın").
                const castleBoxHeight = tileHeight * 0.94;
                const castleBoxWidth = castleBoxHeight * CASTLE_IMAGE_ASPECT;
                const npcBoxHeight = tileHeight * 0.84;
                const npcBoxWidth = npcBoxHeight * CASTLE_IMAGE_ASPECT;
                const badgeSize = Math.max(8, castleBoxHeight * 0.32);
                const showInfoLabel = (showCastle || showNpc) && tileWidth >= LABEL_MIN_WIDTH;
                const totalTroops = tile.troops + (tile.reinforcementTroops ?? 0);
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
                    {/* Zemin -- Eren'in verdiği tek sabit çim dokusu, karo
                        baklava şekline clip-path ile kırpılıyor (bkz.
                        .iso-ground) ki komşu karolar arasında beyaz köşe/dikiş
                        görünmesin. Üstüne serpiştirilmiş hiçbir obje yok. */}
                    <img src={GROUND_TEXTURE} alt="" className="iso-ground" draggable={false} />
                    <div className={`iso-diamond ${selectedTile?.id === tile.id ? "selected" : ""}`} />
                    {showCastle && (
                      <>
                        <img
                          src={CASTLE_ICON}
                          alt=""
                          className="iso-castle"
                          style={{
                            width: castleBoxWidth,
                            height: castleBoxHeight,
                            left: (tileWidth - castleBoxWidth) / 2,
                            top: tileHeight - castleBoxHeight,
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
                            top: tileHeight - castleBoxHeight - badgeSize * 0.35,
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
                          width: npcBoxWidth,
                          height: npcBoxHeight,
                          left: (tileWidth - npcBoxWidth) / 2,
                          top: tileHeight - npcBoxHeight,
                        }}
                      />
                    )}
                    {/* Madde: "Saatlik üretimlerin orada toplam asker
                        sayılarıda görünsün" -- kale/NPC'nin üstünde, haritada
                        doğrudan görünen küçük bir üretim/asker etiketi. */}
                    {showInfoLabel && (
                      <div className="tile-info-label" style={{ left: tileWidth / 2 }}>
                        <span>⚔️ {totalTroops}</span>
                        <span>🪙 +{tile.goldPerHour}/sa</span>
                      </div>
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
              <li key={t.id} className="city-card">
                <div className="city-card-top">
                  <img src={CASTLE_ICON} alt="" className="city-icon" />
                  <div className="city-card-title">
                    <div className="city-name">
                      Kale <span className="city-coords">({t.x}, {t.y})</span>
                    </div>
                    <div className="city-meta">Seviye {t.level} · Ada #{t.islandId}</div>
                  </div>
                </div>
                <div className="city-stats-row">
                  <span className="stat-chip stat-troops">⚔️ <strong>{t.troops}</strong></span>
                  <span className="stat-chip stat-gold">🪙 <strong>+{t.goldPerHour}</strong>/sa</span>
                </div>
                <div className="row-actions">
                  <button onClick={() => handleUpgrade(t.id)}>Yükselt</button>
                  <button onClick={() => goToTile(t)}>Haritada Göster</button>
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
              {(selectedTile.reinforcementTroops ?? 0) > 0 && (
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
