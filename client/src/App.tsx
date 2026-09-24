import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  attackTile,
  fetchActiveAttacks,
  fetchGeneralChat,
  fetchGuildChat,
  fetchMap,
  fetchMyGuild,
  fetchMyGuildInvites,
  fetchMyProfile,
  fetchMyReports,
  fetchMyTiles,
  fetchPlayerSummary,
  markReportsRead,
  recallReinforcement,
  reinforceTile,
  scoutTile,
  sendGeneralChat,
  sendGuildChat,
  upgradeTile,
  uploadAvatar,
  type ActiveAttack,
  type ChatMessage,
  type Guild,
  type MyProfile,
  type PlayerSummary,
  type ReceivedGuildInvite,
  type Report,
  type Session,
  type Tile,
} from "./api";
import {
  DEFAULT_TILE_WIDTH_INDEX,
  SESSION_KEY,
  TILE_WIDTHS,
  VIEWPORT_MARGIN,
  WORLD_SIZE,
} from "./game/constants";
import { isoCenter, screenToWorld } from "./game/hexMath";
import type { ActionMode, ActionType, PendingTarget } from "./game/types";
import { loadSession, resizeImageToDataUrl } from "./game/utils";
import { ChatPanel } from "./components/ChatPanel";
import { GuildModal } from "./components/GuildModal";
import { KingdomPanel } from "./components/KingdomPanel";
import { LeaderboardModal } from "./components/LeaderboardModal";
import { LoginScreen } from "./components/LoginScreen";
import { MapView } from "./components/MapView";
import { NicknameModal } from "./components/NicknameModal";
import { PendingActionCard } from "./components/PendingActionCard";
import { PlayerFlagModal } from "./components/PlayerFlagModal";
import { ReportsModal } from "./components/ReportsModal";
import { TileMenu } from "./components/TileMenu";
import { TopBar } from "./components/TopBar";

// Not: GUILD_FLAG_DEFS/GuildFlag artık components/GuildFlag.tsx'te, harita
// çizimi components/MapView.tsx'te, saf hesaplamalar game/ klasöründe.

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession());
  // `tiles`: sadece o an ekranda görünen bölgenin karoları (+ pay). Dünya
  // binlerce karo olabileceği için tamamını her seferinde çekmiyoruz.
  const [tiles, setTiles] = useState<Tile[]>([]);
  // `myTiles`: oyuncunun SAHİP OLDUĞU tüm şehirler, görünen bölgeden
  // bağımsız — "Krallığım" listesi haritada nerede olursan ol tam olmalı.
  const [myTiles, setMyTiles] = useState<Tile[]>([]);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  // Kale menüsünden bir aksiyon seçilip hedef beklenirken dolu (bkz.
  // game/types.ts ActionMode/PendingTarget açıklaması).
  const [actionMode, setActionMode] = useState<ActionMode | null>(null);
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(null);
  // Madde 1: tek yerde toplam altın/asker üretimi + ortak altın havuzu.
  const [summary, setSummary] = useState<PlayerSummary | null>(null);
  // Lonca (klan) sistemi.
  const [guild, setGuild] = useState<Guild | null>(null);
  const [showGuildPanel, setShowGuildPanel] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sağdaki/soldaki sabit barlar kaldırıldığı için "Seçili Kare" bilgi
  // kartı artık tıklanan noktanın yakınında yüzen bir kutu -- konumu
  // tıklama anındaki ekran koordinatlarında tutuluyor.
  const [selectedScreenPos, setSelectedScreenPos] = useState<{ x: number; y: number } | null>(null);
  // "Krallığım" listesi: üst menüdeki butonla açılıp kapanan yüzen liste
  // (arama/sıralama/sayfalama bkz. components/KingdomPanel.tsx).
  const [showKingdomList, setShowKingdomList] = useState(false);
  // Liderlik Panosu (en çok asker / en çok kale).
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  // Mesaj/rapor kutusu: saldırı sonuçları, gözcü raporları, gözetlenme
  // bildirimleri.
  const [showReports, setShowReports] = useState(false);
  // Flama tasarım ekranı (bkz. components/PlayerFlagModal.tsx).
  const [showFlagEditor, setShowFlagEditor] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const unreadReportCount = useMemo(() => reports.filter((r) => r.readAt === null).length, [reports]);
  // Sohbet -- Genel Chat / Lonca Chat (bkz. components/ChatPanel.tsx,
  // server routes/chat.ts). Panel her zaman ekranda (kapanabilir bir modal
  // değil), bu yüzden mesajlar arka planda sürekli poll ediliyor -- tıpkı
  // raporlar/aktif saldırılar gibi.
  const [generalChat, setGeneralChat] = useState<ChatMessage[]>([]);
  const [guildChat, setGuildChat] = useState<ChatMessage[]>([]);
  // Yolda olan (kendi/klanla ilgili) saldırılar -- haritada animasyonlu hat
  // olarak çiziliyor (bkz. MapView .attack-lines-layer).
  const [activeAttacks, setActiveAttacks] = useState<ActiveAttack[]>([]);
  const prevAttackIdsRef = useRef<Set<number>>(new Set());
  // İstemci saati sunucununkinden farklı olabilir (bkz. server tiles.ts
  // serverNow), bu yüzden gerçek "şu an" = Date.now() + bu fark. Her
  // /attacks/active cevabında ve saldırı gönderiminde tazeleniyor.
  const clockOffsetRef = useRef(0);
  // Bana (henüz bir loncada olmasam bile) gelmiş, cevaplanmamış davetler.
  const [receivedInvites, setReceivedInvites] = useState<ReceivedGuildInvite[]>([]);
  // Üst menüdeki profil widget'ı (avatar).
  const [profile, setProfile] = useState<MyProfile | null>(null);
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

  const refreshGeneralChat = (token: string) => {
    fetchGeneralChat(token).then(setGeneralChat).catch(() => {});
  };

  const refreshGuildChat = (token: string) => {
    fetchGuildChat(token).then((r) => setGuildChat(r.messages)).catch(() => {});
  };

  // Yolda olan saldırılar -- liste küçülürse (bir saldırı sonuçlanmışsa)
  // haritayı/kaleleri/altını/raporları hemen tazeliyoruz ki sonucu görmek
  // için 3-10 saniyelik normal polling aralığını beklemeye gerek kalmasın.
  const refreshActiveAttacks = (token: string) => {
    fetchActiveAttacks(token)
      .then(({ serverNow, attacks: list }) => {
        clockOffsetRef.current = serverNow - Date.now();
        const prevIds = prevAttackIdsRef.current;
        const nextIds = new Set(list.map((a) => a.id));
        const someResolved = Array.from(prevIds).some((id) => !nextIds.has(id));
        prevAttackIdsRef.current = nextIds;
        setActiveAttacks(list);
        if (someResolved) {
          refresh();
          refreshMyTiles(token);
          refreshSummary(token);
          refreshReports(token);
        }
      })
      .catch(() => {});
  };

  const refreshReceivedInvites = (token: string) => {
    fetchMyGuildInvites(token).then(setReceivedInvites).catch(() => {});
  };

  const refreshProfile = (token: string) => {
    fetchMyProfile(token).then(setProfile).catch(() => {});
  };

  // NicknameModal onaylanınca hem profili hem (localStorage'a yazılan)
  // session'ı güncelliyoruz ki `profile.nickname` artık dolu olduğu için
  // modal render koşulu false'a düşüp modal kendiliğinden kapansın (bkz. o
  // dosyadaki not -- "onaylanınca otomatik kapanıcak").
  function handleNicknameConfirmed(nickname: string) {
    setProfile((p) => (p ? { ...p, nickname } : p));
    setSession((s) => {
      if (!s) return s;
      const next = { ...s, nickname };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      return next;
    });
  }

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

  // Sohbet -- kullanıcı sekmeyi hiç açmasa da (panel her zaman görünür ama
  // yeni mesaj bildirimini kaçırmamak için) 4 saniyede bir her iki kanal da
  // çekiliyor. Lonca kanalı loncası olmayan oyuncu için sunucudan zaten boş
  // dönüyor (bkz. server routes/chat.ts) -- burada ayrıca dallanmaya gerek yok.
  useEffect(() => {
    if (!session) return;
    refreshGeneralChat(session.token);
    refreshGuildChat(session.token);
    const interval = setInterval(() => {
      refreshGeneralChat(session.token);
      refreshGuildChat(session.token);
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // Sunucudaki saldırı/takviye çözüm turu (bkz. index.ts) 2 saniyede bir
  // çalıştığı için aynı sıklıkla çekiliyor -- bu, siparişler zamanında
  // çözülmezse (sunucu az önce yeniden başladıysa vb.) diye bir güvenlik
  // ağı; asıl hız aşağıdaki "en yakın varış" zamanlayıcısında (bkz. sonraki
  // effect).
  useEffect(() => {
    if (!session) return;
    prevAttackIdsRef.current = new Set();
    refreshActiveAttacks(session.token);
    const interval = setInterval(() => refreshActiveAttacks(session.token), 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // Marker'ın CSS animasyonu tam arrivesAt'te bitiyor ama sonucun/takviyenin
  // gerçekten uygulanması eskiden 2 saniyelik genel poll'u beklerdi --
  // oyuncuya "ikon vardı ama bir şey olmadı" hissi veriyordu (bkz. sunucu
  // tarafında aynı sorunun asıl çözümü: game/orderScheduler.ts). Burada da
  // en yakın arrivesAt'e göre TEK SEFERLİK bir zamanlayıcı kurup tam o anda
  // (küçük bir güvenlik payıyla) yeniden çekiyoruz -- 2sn'lik interval'i
  // beklemeden.
  useEffect(() => {
    if (!session || activeAttacks.length === 0) return;
    const estServerNow = Date.now() + clockOffsetRef.current;
    const soonestArrival = Math.min(...activeAttacks.map((a) => a.arrivesAt));
    const delay = Math.max(50, soonestArrival - estServerNow + 150);
    const timeout = window.setTimeout(() => refreshActiveAttacks(session.token), delay);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, activeAttacks]);

  useEffect(() => {
    if (!session) return;
    refreshReceivedInvites(session.token);
    const interval = setInterval(() => refreshReceivedInvites(session.token), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  useEffect(() => {
    if (!session) return;
    refreshProfile(session.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // Esc açık olan HER şeyi kapatır: hedef seçme modu, asker kartı, kale
  // menüsü ve tüm yüzen paneller. Capture fazında dinleniyor ki odak bir
  // input içindeyken ya da bir alt eleman olayı durdursa bile Esc kaçmasın.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      setPendingTarget(null);
      setActionMode(null);
      setSelectedTile(null);
      setSelectedScreenPos(null);
      setShowKingdomList(false);
      setShowGuildPanel(false);
      setShowLeaderboard(false);
      setShowReports(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);


  // Girişte kamera her zaman ana kalede başlar: server'ın login/register
  // cevabındaki sabit home koordinatları (session.homeX/homeY) kullanılıyor
  // -- myTiles[0]'ın sırası garanti değil (server ORDER BY vermiyor). Çok
  // eski hesaplarda home null gelebilir, o durumda myTiles[0]'a düşülüyor.
  useEffect(() => {
    if (hasCenteredRef.current || !session) return;
    if (typeof session.homeX === "number" && typeof session.homeY === "number") {
      hasCenteredRef.current = true;
      scrollToWorld(session.homeX, session.homeY, false);
      refresh();
      return;
    }
    if (myTiles.length === 0) return;
    hasCenteredRef.current = true;
    scrollToWorld(myTiles[0].x, myTiles[0].y, false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, myTiles]);

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


  // Klan arkadaşlarımın oyuncu kimlikleri -- takviye hedefinin geçerli olup
  // olmadığını (kendi kalem ya da klan arkadaşımın kalesi) anlamak için.
  const guildMemberIds = useMemo(() => new Set((guild?.members ?? []).map((m) => m.playerId)), [guild]);

  // Üst menüdeki toplam asker -- tüm kalelerin ev garnizonlarının toplamı
  // (klan takviyeleri hariç, onlar "benim" askerim sayılmıyor).
  const totalTroops = useMemo(
    () => myTiles.reduce((sum, t) => sum + (t.troops ?? 0), 0),
    [myTiles]
  );

  function handleLoggedIn(s: Session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    hasCenteredRef.current = false;
    setError(null);
    setSession(s);
    refreshMyTiles(s.token);
    refreshSummary(s.token);
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
    setActiveAttacks([]);
    prevAttackIdsRef.current = new Set();
    setReceivedInvites([]);
    setProfile(null);
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

  // Kendi kalemize tıklayınca açılan menüden "Saldır", "Destek Gönder" ya
  // da "Gözcü Gönder" seçilince: bilgi kartını kapatıp "hedef seç" moduna
  // geçiyoruz.
  // Aynı anda yalnızca TEK bir yüzen panel (kale menüsü, Krallığım, Lonca,
  // Liderlik, Raporlar) açık olmalı -- yeni panel açılmadan önce bu çağrılıp
  // diğer hepsi kapatılıyor.
  function closeFloatingPanels() {
    setSelectedTile(null);
    setSelectedScreenPos(null);
    setShowKingdomList(false);
    setShowGuildPanel(false);
    setShowLeaderboard(false);
    setShowReports(false);
    setShowFlagEditor(false);
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
    // Gözcü için asker-sayısı kartı açılmaz, doğrudan sabit 1 asker gider.
    if (type === "scout") {
      runScout(fromTile, tile);
      return;
    }
    setError(null);
    setPendingTarget({ type, fromTile, targetTile: tile });
    setSelectedScreenPos({ x: screenX, y: screenY });
  }

  // Gözcüyü asker-sayısı modalına hiç girmeden, sabit 1 asker ile doğrudan
  // gönderir (bkz. handleTargetPick). handleConfirmAction'daki "scout" dalı
  // artık çalışma zamanında hiç tetiklenmiyor ama TS tip güvenliği için
  // (actionMeta, pendingTarget.type: ActionType ile indeksleniyor) yerinde
  // bırakıldı.
  async function runScout(fromTile: Tile, targetTile: Tile) {
    if (!session) return;
    if ((fromTile.troops ?? 0) < 1) {
      setError("Gözcü göndermek için en az 1 askerin olmalı.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const result = await scoutTile(session.token, targetTile.id, fromTile.id, 1);
      setMessage(
        `Gözcü raporu geldi: Lv${result.level} — ⚔️ ${Math.floor(result.troops)} asker, 🪙 +${result.goldPerHour}/sa`
      );
      refresh();
      refreshMyTiles(session.token);
      refreshSummary(session.token);
      refreshReports(session.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionMode(null);
      setPendingTarget(null);
      setSelectedScreenPos(null);
    }
  }

  async function handleConfirmAction(troops: number) {
    if (!session || !pendingTarget) return;
    setError(null);
    setMessage(null);
    const { type, fromTile, targetTile } = pendingTarget;
    try {
      if (type === "attack") {
        // Saldırı anında sonuçlanmıyor: ordu yola çıkıyor (bkz. api.ts
        // AttackOrder), sonuç hat animasyonu + rapor kutusuyla (bkz.
        // refreshActiveAttacks) varış anında geliyor.
        const order = await attackTile(session.token, targetTile.id, fromTile.id, troops);
        clockOffsetRef.current = order.serverNow - Date.now();
        const etaSec = Math.max(1, Math.round((order.arrivesAt - order.departedAt) / 1000));
        setMessage(`Ordu yola çıktı! ${etaSec} sn sonra hedefe ulaşacak.`);
        refreshActiveAttacks(session.token);
      } else if (type === "scout") {
        const result = await scoutTile(session.token, targetTile.id, fromTile.id, troops);
        setMessage(
          `Gözcü raporu geldi: Lv${result.level} — ⚔️ ${Math.floor(result.troops)} asker, 🪙 +${result.goldPerHour}/sa`
        );
      } else {
        // Takviye de artık anında değil, saldırı gibi bir "yolda" siparişi
        // (bkz. api.ts reinforceTile/AttackOrder, server game/reinforcements.ts).
        const order = await reinforceTile(session.token, targetTile.id, fromTile.id, troops);
        clockOffsetRef.current = order.serverNow - Date.now();
        const etaSec = Math.max(1, Math.round((order.arrivesAt - order.departedAt) / 1000));
        setMessage(`Takviye yola çıktı! ${etaSec} sn sonra hedefe ulaşacak.`);
        refreshActiveAttacks(session.token);
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
    if (!next || !session) return;
    refreshReceivedInvites(session.token);
  }

  function openLeaderboard() {
    const next = !showLeaderboard;
    closeFloatingPanels();
    setShowLeaderboard(next);
  }

  function openFlagEditor() {
    const next = !showFlagEditor;
    closeFloatingPanels();
    setShowFlagEditor(next);
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

  // Haritada (ölü alan olmayan) bir karoya tıklanınca: hedef seçme
  // modundaysak hedef olarak değerlendir, değilse bilgi kartını/menüyü aç.
  function handleTileClick(tile: Tile, clientX: number, clientY: number) {
    if (actionMode) {
      handleTargetPick(tile, clientX, clientY);
      return;
    }
    closeFloatingPanels();
    setSelectedTile(tile);
    setMessage(null);
    setError(null);
    setSelectedScreenPos({ x: clientX, y: clientY });
  }

  function handleSendGeneralChat(text: string) {
    if (!session) return;
    // İyimser (optimistic) ekleme yok -- 4sn'lik poll zaten çok kısa, sunucu
    // cevabı kendi mesajını normal akışla getirir (diğer poll'larla aynı
    // basitlik ilkesi).
    sendGeneralChat(session.token, text).then((m) => setGeneralChat((prev) => [...prev, m])).catch(() => {});
  }

  function handleSendGuildChat(text: string) {
    if (!session) return;
    sendGuildChat(session.token, text).then((m) => setGuildChat((prev) => [...prev, m])).catch(() => {});
  }

  async function handleAvatarFile(file: File) {
    if (!session) return;
    setError(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 160);
      await uploadAvatar(session.token, dataUrl);
      setProfile((p) => (p ? { ...p, avatarData: dataUrl } : p));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!session) {
    return <LoginScreen onLoggedIn={handleLoggedIn} />;
  }

  return (
    <div className="game-layout">
      <MapView
        viewportRef={viewportRef}
        onScroll={handleViewportScroll}
        onWheel={handleWheel}
        onMouseDown={handleViewportMouseDown}
        tiles={tiles}
        activeAttacks={activeAttacks}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        selectedTileId={selectedTile?.id ?? null}
        playerId={session.playerId}
        guildMemberIds={guildMemberIds}
        clockOffsetMs={clockOffsetRef.current}
        onTileClick={handleTileClick}
      />

      <TopBar
        session={session}
        profile={profile}
        summary={summary}
        totalTroops={totalTroops}
        myTilesCount={myTiles.length}
        guild={guild}
        receivedInvitesCount={receivedInvites.length}
        unreadReportCount={unreadReportCount}
        showKingdomList={showKingdomList}
        showGuildPanel={showGuildPanel}
        showLeaderboard={showLeaderboard}
        showReports={showReports}
        onAvatarFile={handleAvatarFile}
        onGoHome={() => myTiles[0] && goToTile(myTiles[0])}
        onToggleKingdom={() => {
          const next = !showKingdomList;
          closeFloatingPanels();
          setShowKingdomList(next);
        }}
        onToggleGuild={openGuildPanel}
        onToggleLeaderboard={openLeaderboard}
        onToggleReports={openReports}
        onOpenFlagEditor={openFlagEditor}
        onLogout={handleLogout}
      />

      {profile && !profile.nickname && (
        <NicknameModal token={session.token} onConfirmed={handleNicknameConfirmed} />
      )}

      <ChatPanel
        generalMessages={generalChat}
        guildMessages={guildChat}
        hasGuild={!!guild}
        playerId={session.playerId}
        onSendGeneral={handleSendGeneralChat}
        onSendGuild={handleSendGuildChat}
      />

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

      {/* Liderlik/Raporlar/Lonca: koyu arka plan üzerinde ortalanan tam boy
          modal ekranlar. */}
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {showReports && <ReportsModal reports={reports} onClose={() => setShowReports(false)} />}

      {showFlagEditor && profile && (
        <PlayerFlagModal
          token={session.token}
          profile={profile}
          onProfileChange={setProfile}
          setError={setError}
          setMessage={setMessage}
          onClose={() => setShowFlagEditor(false)}
        />
      )}

      {showGuildPanel && (
        <GuildModal
          token={session.token}
          guild={guild}
          receivedInvites={receivedInvites}
          onGuildChange={setGuild}
          onInvitesRefresh={() => refreshReceivedInvites(session.token)}
          setError={setError}
          setMessage={setMessage}
          onClose={() => setShowGuildPanel(false)}
        />
      )}

      {showKingdomList && (
        <KingdomPanel
          myTiles={myTiles}
          onClose={() => setShowKingdomList(false)}
          onUpgrade={handleUpgrade}
          onGoTo={goToTile}
        />
      )}

      {selectedTile && selectedScreenPos && (
        <TileMenu
          selectedTile={selectedTile}
          screenPos={selectedScreenPos}
          playerId={session.playerId}
          guildMemberIds={guildMemberIds}
          onClose={() => { setSelectedTile(null); setSelectedScreenPos(null); }}
          onStartAction={(type) => startAction(type, selectedTile)}
          onUpgrade={handleUpgrade}
          onRecall={handleRecall}
        />
      )}

      {pendingTarget && (
        <PendingActionCard
          key={`${pendingTarget.type}-${pendingTarget.fromTile.id}-${pendingTarget.targetTile.id}`}
          pendingTarget={pendingTarget}
          screenPos={selectedScreenPos}
          token={session.token}
          onCancel={cancelAction}
          onConfirm={handleConfirmAction}
        />
      )}
    </div>
  );
}
