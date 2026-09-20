import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  attackTile,
  fetchMap,
  fetchMyTiles,
  fetchPlayerSummary,
  login,
  register,
  reinforceTile,
  upgradeTile,
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
// Oyuncu kalesi ve NPC kampı görselleri (tek dosya olduğu için tarayıcı
// her ikisini de bir kez indirir, tüm ilgili karolarda paylaşılır).
const CASTLE_ICON = "/buildings/player_castle.png";
const NPC_ICON = "/buildings/npc_camp.png";
const ICON_MIN_WIDTH = 28;

// Boş karolar için zemin dokusu + dekor görselleri. Hangi karonun hangi
// dokuyu/dekoru aldığı (x,y) koordinatından deterministik olarak
// hesaplanıyor (bkz. tileVariantHash) -- böylece harita her 3sn'de bir
// yeniden çekilse bile karolar "titremiyor" / rastgele değişmiyor.
const GRASS_VARIANTS = ["/terrain/grass_1.png", "/terrain/grass_2.png", "/terrain/grass_3.png"];
// Çim varyantı artık TEK karo yerine GRASS_BLOCK_SIZE×GRASS_BLOCK_SIZE'lık
// bloklar halinde seçiliyor -- her karo bağımsız rastgele seçildiğinde harita
// "kare kare" belli olan bir dama tahtası gibi görünüyordu; komşu karoların
// aynı dokuyu paylaşması daha sakin/organik bölgeler oluşturuyor.
const GRASS_BLOCK_SIZE = 4;
// Çim fotoğrafının üzerine uygulanan yarı saydam yeşil "yıkama" -- 3 farklı
// dokunun kendi parlaklık/ton farkları birleşince karo sınırları belirgin
// çiziliyordu, bu katman hepsini ortak bir tona çekip dikişleri yumuşatıyor.
const GRASS_WASH_COLOR = "rgba(120, 178, 76, 0.5)";
const TREE_DECOR = "/terrain/decor_trees.png";
// Tek tük (kümeye dahil olmayan) serpiştirilmiş dekorlar -- taş/kütük/kazıntı
// artık daha seyrek (önceden %35'lik tek bir havuzun parçasıydı).
const SCATTERED_DECOR_VARIANTS = ["/terrain/decor_ruins.png", "/terrain/decor_rocks.png", "/terrain/decor_stump.png"];
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

function grassVariantFor(tile: Tile) {
  const bx = Math.floor(tile.x / GRASS_BLOCK_SIZE);
  const by = Math.floor(tile.y / GRASS_BLOCK_SIZE);
  const idx = Math.floor(tileVariantHash(bx, by) * GRASS_VARIANTS.length);
  return GRASS_VARIANTS[Math.min(idx, GRASS_VARIANTS.length - 1)];
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

function tileColor(tile: Tile, myId: string | undefined) {
  if (tile.tileType === "NPC") return "#8d6e63";
  if (tile.tileType === "EMPTY") return "#8bc34a";
  if (tile.ownerId === myId) return "#4caf50";
  return "#e53935";
}

function distance(a: Tile, b: Tile) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  const [attackFromId, setAttackFromId] = useState<number | null>(null);
  const [troopsToSend, setTroopsToSend] = useState(10);
  const [reinforceFromId, setReinforceFromId] = useState<number | null>(null);
  const [troopsToReinforce, setTroopsToReinforce] = useState(10);
  // Madde 1: tek yerde toplam altın/asker üretimi + ortak altın havuzu.
  const [summary, setSummary] = useState<PlayerSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  function currentViewportCenterWorld() {
    const el = viewportRef.current;
    if (!el) return null;
    return screenToWorld(
      el.scrollLeft + el.clientWidth / 2,
      el.scrollTop + el.clientHeight / 2,
      tileWidth
    );
  }

  function zoomTo(nextIndex: number) {
    recenterOnZoomRef.current = currentViewportCenterWorld();
    setTileWidthIndex(nextIndex);
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

  // Every owned tile is a *candidate* attack origin — same-island targets
  // still need direct adjacency, but a different island only needs to be
  // within naval range, which the client doesn't know exactly. The server
  // is the source of truth; this list is sorted by distance so the most
  // plausible origins show up first.
  const attackCandidates = useMemo(() => {
    if (!selectedTile) return [];
    return myTiles
      .map((t) => ({ tile: t, dist: distance(t, selectedTile), sameIsland: t.islandId === selectedTile.islandId }))
      .sort((a, b) => a.dist - b.dist);
  }, [selectedTile, myTiles]);

  // Madde 3: kendi kalelerin arasında asker takviyesi — anında, mesafe
  // sınırı yok, bu yüzden basitçe seçili kale hariç tüm şehirlerim.
  const reinforceCandidates = useMemo(() => {
    if (!selectedTile) return [];
    return myTiles.filter((t) => t.id !== selectedTile.id);
  }, [selectedTile, myTiles]);

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

  async function handleAttack() {
    if (!session || !selectedTile || attackFromId === null) return;
    setError(null);
    setMessage(null);
    try {
      const result = await attackTile(session.token, selectedTile.id, attackFromId, troopsToSend);
      setMessage(
        result.result === "ATTACKER_WINS"
          ? `Zafer! Kare ele geçirildi. (Güç: ${Math.round(result.attackerPower)} vs ${Math.round(result.defenderPower)})`
          : `Saldırı püskürtüldü. (Güç: ${Math.round(result.attackerPower)} vs ${Math.round(result.defenderPower)})`
      );
      refresh();
      refreshMyTiles(session.token);
      refreshSummary(session.token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleReinforce() {
    if (!session || !selectedTile || reinforceFromId === null) return;
    setError(null);
    setMessage(null);
    try {
      await reinforceTile(session.token, selectedTile.id, reinforceFromId, troopsToReinforce);
      setMessage("Takviye gönderildi!");
      refresh();
      refreshMyTiles(session.token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function goToTile(tile: Tile) {
    setSelectedTile(tile);
    setAttackFromId(null);
    setReinforceFromId(null);
    setMessage(null);
    setError(null);
    scrollToWorld(tile.x, tile.y, true);
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
      <div className="map-viewport" ref={viewportRef} onScroll={handleViewportScroll}>
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
                const { cx, cy } = isoCenter(tile.x, tile.y, tileWidth);
                // Kale/NPC kampı tek karonun içine sığıyor. Kuleler çok uzun/baskın
                // durduğu için boyut ve yukarı taşma payı küçültüldü -- NPC kampı
                // haritada çok daha sık göründüğü için biraz daha küçük tutuluyor.
                const castleSize = tileWidth * 0.8;
                const npcSize = tileWidth * 0.72;
                const isEmpty = tile.tileType === "EMPTY";
                const grassImg = isEmpty ? grassVariantFor(tile) : null;
                const decorImg = isEmpty && tileWidth >= DECOR_MIN_WIDTH ? decorVariantFor(tile) : null;
                const decorSize = tileWidth * 0.85;
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
                    onClick={() => {
                      setSelectedTile(tile);
                      setAttackFromId(null);
                      setReinforceFromId(null);
                      setMessage(null);
                      setError(null);
                    }}
                    title={`(${tile.x}, ${tile.y}) Lv${tile.level} — ada #${tile.islandId}`}
                  >
                    <div
                      className={`iso-diamond ${selectedTile?.id === tile.id ? "selected" : ""}`}
                      style={{
                        backgroundColor: showCastle
                          ? (isMine ? "#4caf50" : "#e53935")
                          : tileColor(tile, session.playerId),
                        // Yarı saydam yeşil "yıkama" katmanı, çim fotoğrafının üzerine
                        // biner -- 3 farklı dokunun ton/parlaklık farkını yumuşatıp
                        // karo sınırlarının "kare kare" belli olmasını azaltır.
                        backgroundImage: grassImg ? `linear-gradient(${GRASS_WASH_COLOR}, ${GRASS_WASH_COLOR}), url(${grassImg})` : undefined,
                        backgroundSize: grassImg ? "100% 100%, 100% 100%" : undefined,
                        backgroundPosition: grassImg ? "center" : undefined,
                      }}
                    />
                    {decorImg && (
                      <img
                        src={decorImg}
                        alt=""
                        className="iso-decor"
                        style={{
                          width: decorSize,
                          height: decorSize,
                          left: (tileWidth - decorSize) / 2,
                          top: (tileHeight - decorSize) / 2 - tileHeight * 0.18,
                        }}
                      />
                    )}
                    {showCastle && (
                      <img
                        src={CASTLE_ICON}
                        alt=""
                        className="iso-castle"
                        style={{
                          width: castleSize,
                          height: castleSize,
                          left: (tileWidth - castleSize) / 2,
                          top: (tileHeight - castleSize) / 2 - tileHeight * 0.1,
                        }}
                      />
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
                          top: (tileHeight - npcSize) / 2 - tileHeight * 0.1,
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

      <div className="map-toolbar">
        <button onClick={() => zoomTo(Math.max(0, tileWidthIndex - 1))} disabled={tileWidthIndex === 0}>
          − Uzaklaş
        </button>
        <button
          onClick={() => zoomTo(Math.min(TILE_WIDTHS.length - 1, tileWidthIndex + 1))}
          disabled={tileWidthIndex === TILE_WIDTHS.length - 1}
        >
          + Yakınlaş
        </button>
        {myTiles[0] && <button onClick={() => goToTile(myTiles[0])}>Krallığıma git</button>}
      </div>

      <div className="legend">
        <span><i style={{ background: "#4caf50" }} /> Senin şehrin</span>
        <span><i style={{ background: "#e53935" }} /> Düşman</span>
        <span><i style={{ background: "#8d6e63" }} /> NPC kampı</span>
        <span><i style={{ background: "#8bc34a" }} /> Boş kare</span>
      </div>

        <aside className="side-panel">
          <section>
            <h2>Krallığım</h2>
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
          </section>

          <section>
            <h2>Seçili Kare</h2>
            {!selectedTile && <p className="hint">Haritadan bir kare seç.</p>}
            {selectedTile && (
              <div>
                <p>
                  ({selectedTile.x}, {selectedTile.y}) — {selectedTile.tileType} — Lv
                  {selectedTile.level} — ada #{selectedTile.islandId}
                </p>
                <p>⚔️ {selectedTile.troops} asker &nbsp; 🪙 +{selectedTile.goldPerHour}/sa</p>

                {selectedTile.tileType === "EMPTY" && (
                  <p className="hint">
                    Boş kareye saldırılamaz. Haritada ilerlemek için NPC kamplarını veya
                    düşman şehirlerini fethetmelisin.
                  </p>
                )}

                {selectedTile.tileType !== "EMPTY" && selectedTile.ownerId !== session.playerId && (
                  <div className="attack-form">
                    {attackCandidates.length === 0 ? (
                      <p className="hint">Önce bir şehrin olmalı.</p>
                    ) : (
                      <>
                        <label>
                          Nereden saldırılsın:
                          <select
                            value={attackFromId ?? ""}
                            onChange={(e) => setAttackFromId(Number(e.target.value))}
                          >
                            <option value="" disabled>
                              Şehir seç
                            </option>
                            {attackCandidates.map(({ tile: t, dist, sameIsland }) => (
                              <option key={t.id} value={t.id}>
                                ({t.x},{t.y}) — {t.troops} asker — {sameIsland ? "aynı ada" : `${Math.round(dist)} mesafe (deniz aşımı)`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Gönderilecek asker:
                          <input
                            type="number"
                            min={1}
                            value={troopsToSend}
                            onChange={(e) => setTroopsToSend(Number(e.target.value))}
                          />
                        </label>
                        <button disabled={attackFromId === null} onClick={handleAttack}>
                          Saldır
                        </button>
                      </>
                    )}
                  </div>
                )}

                {selectedTile.ownerId === session.playerId && (
                  <div className="attack-form">
                    {reinforceCandidates.length === 0 ? (
                      <p className="hint">Takviye göndermek için başka bir şehrin olmalı.</p>
                    ) : (
                      <>
                        <label>
                          Nereden takviye gönderilsin:
                          <select
                            value={reinforceFromId ?? ""}
                            onChange={(e) => setReinforceFromId(Number(e.target.value))}
                          >
                            <option value="" disabled>
                              Şehir seç
                            </option>
                            {reinforceCandidates.map((t) => (
                              <option key={t.id} value={t.id}>
                                ({t.x},{t.y}) — {t.troops} asker
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Gönderilecek asker:
                          <input
                            type="number"
                            min={1}
                            value={troopsToReinforce}
                            onChange={(e) => setTroopsToReinforce(Number(e.target.value))}
                          />
                        </label>
                        <button disabled={reinforceFromId === null} onClick={handleReinforce}>
                          Takviye Gönder
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
    </div>
  );
}
