import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  acceptGuildInvite,
  attackTile,
  createGuild,
  declineGuildInvite,
  fetchActiveAttacks,
  fetchAttackEta,
  fetchLeaderboard,
  fetchMap,
  fetchMyGuild,
  fetchMyGuildInvites,
  fetchMyProfile,
  fetchMyReports,
  fetchMyTiles,
  fetchPlayerSummary,
  inviteToGuild,
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
  uploadAvatar,
  type ActiveAttack,
  type Guild,
  type GuildListEntry,
  type LeaderboardResponse,
  type MyProfile,
  type PlayerSummary,
  type ReceivedGuildInvite,
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
// Eren: "hexleri biraz daha büyütelim", "zoom da zaten fazla uzağa gidiyor
// şuan onu düzeltelim çok uzağa gitmesine gerek yok", "başlangıç daha da
// yakın plan başlamalı" -- üç isteği birden karşılamak için tüm ölçek yukarı
// kaydırıldı: en uzak seviye (eski 22px, aşırı küçük/uzak) tamamen kaldırıldı,
// yeni minimum (36) eski varsayılana (46) yakın kalıp aşırı uzaklaşmayı
// engelliyor, ve varsayılan (72) eskisinden %56 daha büyük başlıyor ("daha
// yakın plan"). Üst uca da bir sonraki adım (160) eklendi, yakınlaştırma
// tavanı da birlikte yükselsin diye.
const TILE_WIDTHS = [36, 52, 72, 100, 136, 160];
// Varsayılan artık 72px (index 2) -- eski varsayılan (46) yerine, "daha yakın
// plan" isteği için bir kademe büyütüldü.
const DEFAULT_TILE_WIDTH_INDEX = 2;
// Eren'in isteği: "kaleler leveline göre şekil değiştirsin" -- oyuncuya ait
// (kendi/klan/düşman fark etmez, hepsi "gerçek oyuncu kalesi") karolar artık
// TEK bir sabit görsel yerine, kalenin seviyesine göre 6 farklı görselden
// birini kullanıyor (bkz. castleImageForLevel). Sahiplik artık görselin
// kendisinden değil, kalenin yanındaki renkli rozetten anlaşılıyor (bkz.
// ownership-badge) -- bu yüzden eski "mavi sancak/kırmızı sancak" iki-görsel
// sistemi kaldırıldı, sadece NPC hâlâ ayrı bir görsel kullanıyor (bkz.
// NPC_LEVEL_TIERS).
// Eren (2. tur): yeşil/yosunlu-kristal temalı yeni 6 seviyelik kale seti
// gönderdi ("Npc ve Oyuncu kaleleri olucaklar") -- eski lacivert/turkuaz seti
// bu dosyaların YERİNE (aynı dosya adlarıyla) kondu, kod tarafında değişiklik
// gerekmedi.
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
// Eren (2. tur): NPC kampları için de lav/şeytani temalı yeni bir set
// gönderdi -- eskiden NPC tek bir sabit görsel kullanıyordu (npc_castle.png),
// artık oyuncu kalesiyle aynı mantıkla NPC'nin KENDİ seviyesine (bkz.
// mapgen.ts: NPC'ler hep 1-3 arası doğuyor) göre 3 farklı görselden biri
// seçiliyor -- en küçük/orta/en gösterişli üç kule NPC'nin 1/2/3 seviyesine
// atandı, kalan üç görsel ileride NPC seviye aralığı büyürse diye ayrı
// tutuldu (henüz projeye eklenmedi).
const NPC_LEVEL_TIERS: [number, string][] = [
  [3, "/buildings/npc_castle_levels/npc_level_3.png"],
  [2, "/buildings/npc_castle_levels/npc_level_2.png"],
  [1, "/buildings/npc_castle_levels/npc_level_1.png"],
];
function npcCastleImageForLevel(level: number): string {
  for (const [threshold, src] of NPC_LEVEL_TIERS) {
    if (level >= threshold) return src;
  }
  return NPC_LEVEL_TIERS[NPC_LEVEL_TIERS.length - 1][1];
}
// Kale görsellerinin en-boy oranı (~1.37) -- kutunun dışına taşmasın diye
// NPC kale boyutu bu orana göre hesaplanıyor (bkz. aşağıdaki npcBoxWidth).
// object-fit:contain her görselin kendi gerçek oranını koruduğu için NPC'nin
// 3 seviye görselinin birbirinden farklı oranları olması sorun değil -- bu
// sadece dıştaki kutunun oranı.
const CASTLE_IMAGE_ASPECT = 700 / 512;
const ICON_MIN_WIDTH = 28;

// Eren: "kenarları kel çim dokularını (13/14/15) oyuna random döşenecek
// şekilde ayarla, böylece birbirini tekrar etmez desenler" -- zemin artık
// tekrar doku kullanıyor (bkz. .iso-ground-grass), ama üç görselden hangisi
// her karoda göründüğü GERÇEK rastgelelik yerine axial hex koordinatına göre
// (x - y) mod 3 ile seçiliyor. Sebep: düz Math.random() render'da her
// yeniden çizimde titreyebilir VE komşu iki karo şansla aynı görseli
// alabilir (aynı görsel yan yana gelince "desen tekrarı" göze çok batar).
// (x - y) mod 3, altıgen komşuluk sisteminde (6 komşu, bkz. isoCenter) HER
// zaman komşudan farklı bir değer üretir -- yani üç dokudan hiçbiri asla
// bitişik iki karoda yan yana tekrarlamaz, ama harita genelinde üçü de
// dağınık/organik görünür (her doku de kendi içinde farklı seed ile
// rastgele serpiştirilmiş çim topaklarından oluşuyor).
const GRASS_TEXTURES = [
  "/terrain/grass-tuft-a.png",
  "/terrain/grass-tuft-b.png",
  "/terrain/grass-tuft-c.png",
];
function grassTextureForTile(x: number, y: number): string {
  const idx = (((x - y) % 3) + 3) % 3;
  return GRASS_TEXTURES[idx];
}

// ---------------------------------------------------------------------
// Dağ / çoklu-hex dekor sistemi
// ---------------------------------------------------------------------
// Eren: "dağ olayı ... çoklu hexliye yükleme" -- 5 benzersiz dağ görseli
// gönderdi (3 kanyon/yarık tarzı, 2 sıradağ tarzı). Kale görselinin karo
// dışına taşması gibi ama ÇOK daha büyük: her dağ TEK bir hex'e değil,
// kök karoya bitişik birden fazla hex'e birden yayılan bir sprite.
// "yönleri asimetrik yerleşebilir" notu üzerine her dağın ayak izi
// BİLEREK simetrik olmayan bir hex kümesi -- server/src/game/mapgen.ts
// HEX_DIRECTIONS'daki ([[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]) 6 gerçek
// komşu yönden seçilmiş bir alt küme, düzgün "çiçek" şekli değil.
//
// Yerleştirme sunucuya/DB'ye HİÇ dokunmadan tamamen CLIENT tarafında,
// koordinata göre DETERMİNİSTİK yapılıyor (bkz. hashXY -- grassTextureForTile
// ile aynı prensip: Math.random() değil, sayfa her açıldığında AYNI
// karolarda aynı dağ çıksın). Bu yaklaşımın bilinçli tercih sebebi: harita
// zaten CANLI ve üretilmiş -- mapgen.ts'e (sunucu, sadece YENİ üretilecek
// haritaları etkiler) dokunmak burada hiçbir şey değiştirmezdi. Bir dağ,
// ayak izindeki TÜM karolar o an "EMPTY" (boş) DEĞİLSE hiç yerleştirilmiyor
// -- yani var olan bir NPC kampının veya oyuncu kalesinin üzerine asla
// binmiyor, bu da NPC'lerin dağ karolarına "spawn olması" sorununu ayrıca
// bir koda gerek kalmadan otomatik olarak engelliyor (bkz.
// computePlacedMountains).
type MountainDef = {
  id: string;
  img: string;
  // Kök karoya göre komşu offsetleri (HEX_DIRECTIONS'ın bir alt kümesi).
  footprint: [number, number][];
  scale: number; // kapladığı kutuyu bu kadar büyüt (hafif taşma/zenginlik için)
};

const MOUNTAIN_DEFS: MountainDef[] = [
  { id: "range-a", img: "/decor/mountains/range-a.png", footprint: [[0, 0], [1, 0], [0, 1], [1, -1]], scale: 1.1 },
  { id: "range-b", img: "/decor/mountains/range-b.png", footprint: [[0, 0], [-1, 0], [-1, 1], [0, 1], [1, 0]], scale: 1.1 },
];

// Basit, hızlı, deterministik tam sayı hash'i (Math.random() DEĞİL -- aynı
// (x,y,seed) her zaman aynı sonucu vermeli, bkz. yukarıdaki not).
function hashXY(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

// Yaklaşık her 60 boş karodan biri bir dağ ADAYI olarak seçiliyor -- ayak
// izi tamamen boş çıkmayan adaylar elendiği için gerçek yoğunluk bundan
// belirgin şekilde daha seyrek.
const MOUNTAIN_DENSITY = 60;

type PlacedMountain = {
  key: string;
  def: MountainDef;
  rootX: number;
  rootY: number;
  frontSortKey: number; // painter's algorithm sıralaması için (bkz. sortedTiles)
};

function computePlacedMountains(tiles: Tile[]): PlacedMountain[] {
  const byKey = new Map<string, Tile>();
  for (const t of tiles) byKey.set(`${t.x},${t.y}`, t);

  const candidates = tiles.filter(
    (t) => t.tileType === "EMPTY" && hashXY(t.x, t.y, 1) % MOUNTAIN_DENSITY === 0
  );
  // Çakışan adaylar arasındaki önceliğin her zaman aynı (deterministik)
  // sırada çözülmesi için koordinataya göre sırala.
  candidates.sort((a, b) => a.x - b.x || a.y - b.y);

  const claimed = new Set<string>();
  const placed: PlacedMountain[] = [];
  for (const t of candidates) {
    const defIndex = hashXY(t.x, t.y, 2) % MOUNTAIN_DEFS.length;
    const def = MOUNTAIN_DEFS[defIndex];
    const footprintKeys = def.footprint.map(([dx, dy]) => `${t.x + dx},${t.y + dy}`);
    const allEmpty = footprintKeys.every((k) => {
      const ft = byKey.get(k);
      return !!ft && ft.tileType === "EMPTY" && !claimed.has(k);
    });
    if (!allEmpty) continue;
    for (const k of footprintKeys) claimed.add(k);
    const frontSortKey = Math.max(...def.footprint.map(([dx, dy]) => t.x + dx + (t.y + dy)));
    placed.push({ key: `${t.x},${t.y}:${def.id}`, def, rootX: t.x, rootY: t.y, frontSortKey });
  }
  return placed;
}

// Bir saldırı hattının (from -> to) bir dağın kapladığı EKRAN dairesine
// (merkez+yarıçap) çok yaklaşıp yaklaşmadığını kontrol edip, öyleyse dağı
// atlayacak şekilde bükülmüş bir SVG path (quadratic Bézier) üretir. Eren'in
// isteği ("Basit görsel eğri ... çizgi rota olayı dağın içinden geçmesin
// yeter") gereği bu GERÇEK pathfinding DEĞİL -- sadece en çok engel olan TEK
// dağa göre basit bir kavis.
type MountainScreenBox = {
  key: string;
  centerX: number;
  centerY: number;
  radius: number;
};

function bendAttackPath(
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

// Eren (2. tur): "saldır destek gözcü gibi ikonlarda... daha profesyonel
// farklı bir tasarım yap" -- emoji yerine, aksiyon menüsünün cilalı/3D
// altıgen rozetlerinin üzerine oturan sade, beyaz siluetli vektör ikonlar.
// Renk zaten rozetten (hex-action-shape gradyanı) geliyor, ikon sadece net
// bir silüet olsun diye düz beyaz.
function ActionIconSword() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <g transform="rotate(45 12 12)">
        <rect x="10.6" y="1.2" width="2.8" height="12.4" rx="1.2" fill="#fff" />
        <rect x="6.8" y="13.4" width="10.4" height="2.6" rx="1.1" fill="#fff" />
        <rect x="10.8" y="15.6" width="2.4" height="5.2" rx="1" fill="#fff" opacity="0.92" />
        <circle cx="12" cy="21.4" r="1.7" fill="#fff" />
      </g>
    </svg>
  );
}
function ActionIconShield() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M12 2.2L19.5 5.1V10.4C19.5 15.6 16.5 19.5 12 21.6C7.5 19.5 4.5 15.6 4.5 10.4V5.1L12 2.2Z"
        fill="#fff"
      />
      <path d="M12 4.6V19.1" stroke="rgba(0,0,0,0.22)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function ActionIconScout() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <g transform="rotate(-38 12 12)">
        <path d="M8.5 4.2 L18 6.4 L18.6 9.4 L8 10.8 Z" fill="#fff" />
        <rect x="4.6" y="9.6" width="4.4" height="4.4" rx="1" fill="#fff" />
        <circle cx="18.3" cy="7.9" r="1" fill="rgba(0,0,0,0.25)" />
      </g>
    </svg>
  );
}
function ActionIconUpgrade() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M12 3.2L19.6 11.6H15.4V20.4H8.6V11.6H4.4L12 3.2Z" fill="#fff" />
    </svg>
  );
}

// Eren: "oyuna aynı şekilde aynı stilde ama farklı görselleri olan 10 adet
// lonca bayrağı ekle" -- TEK bir bayrak şablonu (direk + kırlangıç kuyruklu
// flama), her biri farklı renk gradyanı + farklı sade amblemle ayrışıyor.
// Sunucu sadece 1-10 arası flagId saklıyor (bkz. guilds.ts), görselin
// kendisi tamamen client'ta üretiliyor.
export const GUILD_FLAG_DEFS: { id: number; name: string; colors: [string, string]; emblem: string }[] = [
  { id: 1, name: "Kızıl Şahin", colors: ["#e5484d", "#8a1f22"], emblem: "star" },
  { id: 2, name: "Derin Deniz", colors: ["#2f8fd6", "#12466e"], emblem: "wave" },
  { id: 3, name: "Orman Yemini", colors: ["#3fae5c", "#1c5c30"], emblem: "tree" },
  { id: 4, name: "Altın Taç", colors: ["#f0b429", "#a5720f"], emblem: "diamond" },
  { id: 5, name: "Gece Ayı", colors: ["#6b5ecb", "#332a72"], emblem: "moon" },
  { id: 6, name: "Demir Kule", colors: ["#7c8b96", "#3d474e"], emblem: "tower" },
  { id: 7, name: "Kutsal Yemin", colors: ["#e8e2d0", "#a89f7e"], emblem: "cross" },
  { id: 8, name: "Kum Fırtınası", colors: ["#d99a4e", "#8a5a20"], emblem: "sun" },
  { id: 9, name: "Kurt Sürüsü", colors: ["#5a6b7a", "#232f38"], emblem: "paw" },
  { id: 10, name: "Kan Kardeşliği", colors: ["#c23a5e", "#661f34"], emblem: "stripe" },
];

function GuildFlagEmblem({ emblem }: { emblem: string }) {
  const fill = "rgba(255,255,255,0.92)";
  switch (emblem) {
    case "star":
      return (
        <path
          d="M0,-3.2 L0.9,-1 L3.2,-1 L1.3,0.4 L2,2.8 L0,1.4 L-2,2.8 L-1.3,0.4 L-3.2,-1 L-0.9,-1 Z"
          fill={fill}
        />
      );
    case "wave":
      return (
        <g fill="none" stroke={fill} strokeWidth="1" strokeLinecap="round">
          <path d="M-3.4,-1.2 Q-1.7,-2.6 0,-1.2 T3.4,-1.2" />
          <path d="M-3.4,1.6 Q-1.7,0.2 0,1.6 T3.4,1.6" />
        </g>
      );
    case "tree":
      return (
        <g fill={fill}>
          <path d="M0,-3.4 L2.6,1.2 H1 L2.2,3 H-2.2 L-1,1.2 H-2.6 Z" />
        </g>
      );
    case "diamond":
      return <rect x="-2.2" y="-2.2" width="4.4" height="4.4" transform="rotate(45)" fill={fill} />;
    case "moon":
      return <path d="M0.6,-3.2 A3.2,3.2 0 1 0 0.6,3.2 A2.3,2.3 0 1 1 0.6,-3.2 Z" fill={fill} />;
    case "tower":
      return (
        <g fill={fill}>
          <path d="M-2,-1 L0,-3.4 L2,-1 Z" />
          <rect x="-1.6" y="-1" width="3.2" height="4.4" />
          <rect x="-0.5" y="0.6" width="1" height="1.2" fill="rgba(0,0,0,0.32)" />
        </g>
      );
    case "cross":
      return (
        <g fill={fill}>
          <rect x="-0.7" y="-3" width="1.4" height="6" />
          <rect x="-2.6" y="-0.7" width="5.2" height="1.4" />
        </g>
      );
    case "sun":
      return (
        <g stroke={fill} strokeWidth="0.9" strokeLinecap="round">
          <circle cx="0" cy="0" r="1.6" fill={fill} stroke="none" />
          <line x1="0" y1="-2" x2="0" y2="-3.5" />
          <line x1="0" y1="2" x2="0" y2="3.5" />
          <line x1="-2" y1="0" x2="-3.5" y2="0" />
          <line x1="2" y1="0" x2="3.5" y2="0" />
          <line x1="-1.4" y1="-1.4" x2="-2.5" y2="-2.5" />
          <line x1="1.4" y1="1.4" x2="2.5" y2="2.5" />
          <line x1="-1.4" y1="1.4" x2="-2.5" y2="2.5" />
          <line x1="1.4" y1="-1.4" x2="2.5" y2="-2.5" />
        </g>
      );
    case "paw":
      return (
        <g fill={fill}>
          <ellipse cx="0" cy="1" rx="1.8" ry="1.4" />
          <circle cx="-1.6" cy="-1.4" r="0.85" />
          <circle cx="0" cy="-2.1" r="0.85" />
          <circle cx="1.6" cy="-1.4" r="0.85" />
        </g>
      );
    case "stripe":
    default:
      return <rect x="-4.6" y="-0.8" width="9.2" height="1.6" transform="rotate(-18)" fill={fill} opacity="0.8" />;
  }
}

function GuildFlag({ flagId, size = 28, title }: { flagId: number; size?: number; title?: string }) {
  const def = GUILD_FLAG_DEFS.find((f) => f.id === flagId) ?? GUILD_FLAG_DEFS[0];
  const gradId = `guildFlagGrad${def.id}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="guild-flag-svg">
      {title ? <title>{def.name}</title> : null}
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={def.colors[0]} />
          <stop offset="100%" stopColor={def.colors[1]} />
        </linearGradient>
      </defs>
      <rect x="3" y="1.6" width="1.6" height="20.8" rx="0.6" fill="#caa23a" />
      <path
        d="M4.6 3 H19.5 L15.8 8 L19.5 13 H4.6 Z"
        fill={`url(#${gradId})`}
        stroke="rgba(0,0,0,0.25)"
        strokeWidth="0.4"
      />
      <g transform="translate(10.9 8)">
        <GuildFlagEmblem emblem={def.emblem} />
      </g>
    </svg>
  );
}

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

// Eren: "içerisine görsel yüklenebilecek şekilde tasarım yap" (profil
// fotoğrafı) -- yüklenen görsel her boyutta olabilir, sunucuya devasa bir
// dosya göndermemek (ve avatar_data sütununu şişirmemek) için burada,
// göndermeden ÖNCE tarayıcıda küçük bir kareye (cover-crop) küçültülüp
// JPEG'e sıkıştırılıyor -- sonuç genelde birkaç KB, sunucudaki ~300kb
// güvenlik sınırının (bkz. server players.ts MAX_AVATAR_DATA_URL_LENGTH)
// çok altında kalıyor.
function resizeImageToDataUrl(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Görsel okunamadı."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Görsel yüklenemedi."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Bu tarayıcı görsel işlemeyi desteklemiyor."));
          return;
        }
        // Kısa kenar referans alınıp ortadan kare kırpılıyor (cover), sonra
        // hedef boyuta gerdiriliyor -- yükleyen kişinin fotoğrafı hangi
        // oranda olursa olsun yuvarlak profil çerçevesine düzgün oturuyor.
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
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
  // Eren: "10 adet lonca bayrağı ekle ... lonca kurulumunda olsun
  // seçilebilmeli" -- yeni lonca formunda seçilen bayrak, varsayılan 1.
  const [guildFlagInput, setGuildFlagInput] = useState(1);
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
  // Eren: "saldırdığın kaleden saldırdığın kaleye gidildiğini belli eden bir
  // saldırı hattı olsun ... hareketli olsun" -- yolda olan (kendi/klan
  // ilgili) tüm saldırılar, haritada animasyonlu bir hat/işaret olarak
  // gösteriliyor (bkz. aşağıdaki .attack-lines-layer render'ı).
  const [activeAttacks, setActiveAttacks] = useState<ActiveAttack[]>([]);
  const prevAttackIdsRef = useRef<Set<number>>(new Set());
  // Eren: "51sn diyor fakat ... hedefe çok hızlı ulaşıyor" -- istemcinin
  // saati sunucununkinden farklı olabileceği için (bkz. server tiles.ts
  // serverNow yorumu), gerçek "şu an"ı Date.now() + bu farkla hesaplıyoruz.
  // Her /attacks/active cevabında ve saldırı gönderiminde tazeleniyor.
  const clockOffsetRef = useRef(0);
  // "Saldırı Emri" onay kartında, göndermeden önce tahmini seyahat süresi.
  const [pendingAttackEtaMs, setPendingAttackEtaMs] = useState<number | null>(null);
  // Eren: "Lonca bölümünü geliştir oyuncu davet falan olsun" -- bana
  // (henüz bir loncada olmasam bile) gelmiş, cevaplanmamış davetler.
  const [receivedInvites, setReceivedInvites] = useState<ReceivedGuildInvite[]>([]);
  const [guildInviteUsername, setGuildInviteUsername] = useState("");
  // Eren: "Sol üst tarafda ... içerisine görsel yüklenebilecek şekilde
  // tasarım yap ... yuvarlak oyuncu profil" -- üst menüdeki profil widget'ı.
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
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

  // Eren: "Oyunda artık saldırılar zamanlamalı olsun ... hareketli olsun" --
  // sunucudaki çözüm turu (bkz. index.ts) 2 saniyede bir çalıştığı için aynı
  // sıklıkla çekmek, bir saldırı ulaşır ulaşmaz haritanın/hattın güncel
  // kalmasını sağlıyor.
  useEffect(() => {
    if (!session) return;
    prevAttackIdsRef.current = new Set();
    refreshActiveAttacks(session.token);
    const interval = setInterval(() => refreshActiveAttacks(session.token), 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

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

  // Eren: "Oyuna girişdeki başlangıç her zaman ilk ana kalede sabit olmalı
  // (her giriş için)" -- myTiles[0]'ın sırası garanti değildi (server
  // ORDER BY vermiyordu), bu yüzden artık server'ın login/register
  // cevabıyla birlikte gönderdiği sabit home koordinatlarını (session.homeX/
  // homeY) kullanıyoruz; bunlar hemen mevcut olduğu için myTiles'ın
  // yüklenmesini beklemeye gerek yok. Çok eski hesaplarda (backfill'den önce
  // hiç kale sahibi olunmamışsa) home koordinatları null gelebilir -- o
  // durumda eski davranışa (myTiles[0]) düşülüyor.
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

  // İzometrik görünümde alttaki karolar üsttekilerin önüne çizilmeli
  // (aksi halde şehir ikonları arkadaki karoların altında kalır gibi
  // görünür). DOM sırası = çizim sırası olduğu için basitçe x+y'ye göre
  // artan sıralamak yeterli.
  const sortedTiles = useMemo(
    () => [...tiles].sort((a, b) => a.x + a.y - (b.x + b.y)),
    [tiles]
  );

  // Dağ yerleşimi -- sadece o an yüklü (viewport'taki) karolara göre
  // hesaplanıyor, bkz. computePlacedMountains yorumu.
  const placedMountains = useMemo(() => computePlacedMountains(tiles), [tiles]);

  // Her dağın kapladığı EKRAN dikdörtgenini/dairesini hesaplar -- hem dağ
  // görselinin render boyutu/konumu hem de saldırı hattının bükülme kontrolü
  // (bkz. bendAttackPath) AYNI bu veriyi kullanıyor, tek yerden hesaplanıp
  // tutarlılık garanti ediliyor.
  const mountainScreens = useMemo(() => {
    return placedMountains.map((m) => {
      const centers = m.def.footprint.map(([dx, dy]) => isoCenter(m.rootX + dx, m.rootY + dy, tileWidth));
      const minCx = Math.min(...centers.map((c) => c.cx)) - tileWidth / 2;
      const maxCx = Math.max(...centers.map((c) => c.cx)) + tileWidth / 2;
      const minCy = Math.min(...centers.map((c) => c.cy)) - tileHeight / 2;
      const maxCy = Math.max(...centers.map((c) => c.cy)) + tileHeight / 2;
      const boxW = (maxCx - minCx) * m.def.scale;
      const boxH = (maxCy - minCy) * m.def.scale;
      const centerX = (minCx + maxCx) / 2;
      const centerY = (minCy + maxCy) / 2;
      const box: MountainScreenBox = { key: m.key, centerX, centerY, radius: (boxW + boxH) / 4 };
      return { mountain: m, left: centerX - boxW / 2, top: centerY - boxH / 2, width: boxW, height: boxH, box };
    });
  }, [placedMountains, tileWidth, tileHeight]);

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

  // Eren: "Saldırı Emri sayfasında süre görünmeli ki oyuncu ne kadar sürede
  // gideceğini bilmeli." -- onay kartı açılınca (sadece saldırı için,
  // takviye/gözcü anlık) sunucudan tahmini süreyi çekiyoruz.
  useEffect(() => {
    setPendingAttackEtaMs(null);
    if (!session || !pendingTarget || pendingTarget.type !== "attack") return;
    let cancelled = false;
    fetchAttackEta(session.token, pendingTarget.fromTile.id, pendingTarget.targetTile.id)
      .then((r) => {
        if (!cancelled) setPendingAttackEtaMs(r.durationMs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTarget?.fromTile.id, pendingTarget?.targetTile.id, pendingTarget?.type]);

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
    // Eren: "Gözcü gönderirken rakam seçmeye gerek yok sabit 1 direk
    // göndersin." -- gözcü için asker-sayısı modalı hiç açılmadan, doğrudan
    // 1 asker ile gönderiliyor.
    if (type === "scout") {
      runScout(fromTile, tile);
      return;
    }
    setError(null);
    setTroopsInput(10);
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

  async function handleConfirmAction() {
    if (!session || !pendingTarget) return;
    setError(null);
    setMessage(null);
    const { type, fromTile, targetTile } = pendingTarget;
    try {
      if (type === "attack") {
        // Eren: "Oyunda artık saldırılar zamanlamalı olsun. Direk tıkla
        // saldır değil" -- saldırı artık anında sonuçlanmıyor, ordu yola
        // çıkıyor (bkz. api.ts AttackOrder) ve sonuç yolda-hat animasyonu +
        // rapor kutusuyla (bkz. .attack-lines-layer, refreshActiveAttacks)
        // birkaç saniye sonra geliyor.
        const order = await attackTile(session.token, targetTile.id, fromTile.id, troopsInput);
        clockOffsetRef.current = order.serverNow - Date.now();
        const etaSec = Math.max(1, Math.round((order.arrivesAt - order.departedAt) / 1000));
        setMessage(`Ordu yola çıktı! ${etaSec} sn sonra hedefe ulaşacak.`);
        refreshActiveAttacks(session.token);
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
    if (!next || !session) return;
    if (!guild) listGuilds().then(setAvailableGuilds).catch(() => {});
    refreshReceivedInvites(session.token);
  }

  async function handleInvitePlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !guildInviteUsername.trim()) return;
    setError(null);
    setMessage(null);
    const invited = guildInviteUsername.trim();
    try {
      const g = await inviteToGuild(session.token, invited);
      setGuild(g);
      setGuildInviteUsername("");
      setMessage(`${invited} loncaya davet edildi.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAcceptInvite(inviteId: number) {
    if (!session) return;
    setError(null);
    setMessage(null);
    try {
      const g = await acceptGuildInvite(session.token, inviteId);
      setGuild(g);
      setMessage(`${g.name} loncasına katıldın!`);
      refreshReceivedInvites(session.token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeclineInvite(inviteId: number) {
    if (!session) return;
    setError(null);
    try {
      await declineGuildInvite(session.token, inviteId);
      refreshReceivedInvites(session.token);
    } catch (err) {
      setError((err as Error).message);
    }
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
      const g = await createGuild(session.token, guildNameInput.trim(), guildFlagInput);
      setGuild(g);
      setGuildNameInput("");
      setGuildFlagInput(1);
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
        <h1 className="sr-only">Valerion</h1>
        <div className="login-card">
          <p className="subtitle">Timer'sız fetih dünyasına hoş geldin</p>
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
                // Eren'in isteği: gerçek oyuncu kaleleri artık sahipliğe göre
                // değil SEVİYEYE göre görsel değiştiriyor (bkz.
                // CASTLE_LEVEL_TIERS) -- sahiplik yanındaki renkli rozetten
                // anlaşılıyor. NPC kampları da artık KENDİ seviyesine göre 3
                // görselden birini kullanıyor (bkz. NPC_LEVEL_TIERS).
                const castleIcon = castleImageForLevel(tile.level);
                const npcIcon = npcCastleImageForLevel(tile.level);
                const { cx, cy } = isoCenter(tile.x, tile.y, tileWidth);
                // Eren: "Oyuncu kalelerini büyüt altıgenin içinde çok küçük
                // kalıyorlar." -- ölçüm yapıp gerçek sebebi bulduk: eski kod
                // kutuyu CASTLE_IMAGE_ASPECT'e (700/512 ≈ 1.37, ENİNE geniş)
                // göre boyutlandırıyordu, ama CASTLE_LEVEL_TIERS'taki 6 gerçek
                // seviye görseli aslında dar/uzun (gerçek en-boy oranları
                // ~0.41 ile ~1.02 arası, hiçbiri 1.37'ye yaklaşmıyor). Kutu
                // her zaman görselden daha "yassı" olduğu için object-fit:
                // contain kutunun sadece YÜKSEKLİĞİNİ dolduruyordu -- yani
                // kutuyu büyütmenin tek yolu buydu, ama eski kod güvenlik payı
                // için yüksekliği 0.62'de tutuyordu. Artık kaleye ÖZEL
                // CASTLE_IMAGE_ASPECT'e güvenmek yerine kutuyu ferah tutuyoruz
                // (yükseklik 0.62->0.82, genişlik en fazla tileWidth'in
                // %94'ü) ve object-fit:contain her seviyenin kendi gerçek
                // oranını koruyarak sığdırıyor -- en geniş gerçek görsel bile
                // (~1.02 oran) bu tavanın altında kalıyor, yani komşu
                // karolarla üst üste binme riski yok (bkz. Eren'in eski "üst
                // üste binmeler var" uyarısı -- o hataya geri dönülmedi).
                // Eren (2. tur, yeni yeşil/kristal set): yeni level_10 görseli
                // öncekilerden daha "yassı" (~1.18 oran) -- kutu oranı
                // (1.05'ten 1.2'ye) hafifçe artırıldı ki object-fit:contain bu
                // görseli de tam yüksekliğine sığdırabilsin, tileWidth*0.94
                // tavanı üst üste binmeye karşı güvenlik payını zaten koruyor.
                const castleBoxHeight = tileHeight * 0.82;
                const castleBoxWidth = Math.min(castleBoxHeight * 1.2, tileWidth * 0.94);
                const npcBoxHeight = tileHeight * 0.58;
                const npcBoxWidth = npcBoxHeight * CASTLE_IMAGE_ASPECT;
                const castleTop = (tileHeight - castleBoxHeight) / 2;
                const npcTop = (tileHeight - npcBoxHeight) / 2;
                // Gözcü/casusluk sistemi: asker/altın bilgisi sadece kendi/
                // klan kalelerinde ya da daha önce gözcülenmiş düşman/NPC
                // kalelerinde gösterilir (tile.troops null ise hiç bilgi yok).
                const hasIntel = tile.troops !== null;
                const showInfoLabel = (showCastle || showNpc) && tileWidth >= LABEL_MIN_WIDTH && hasIntel;
                const totalTroops = (tile.troops ?? 0) + (tile.reinforcementTroops ?? 0);
                // Eren: "Boş veya dekorlara tıklayınca tepki olmasın ve
                // açılan pencerede açılmasın oralar ölü alanlar." -- boş
                // kareler artık tamamen "ölü alan": ne bilgi kartı açılır ne
                // de (aksiyon modundayken) geçerli bir hedef olarak kabul
                // edilir, tıklama tamamen yok sayılır.
                const isDeadZone = tile.tileType === "EMPTY";
                return (
                  <div
                    key={tile.id}
                    data-tile-id={tile.id}
                    className={`iso-tile-group ${isDeadZone ? "iso-tile-dead" : ""}`}
                    style={{
                      left: cx - tileWidth / 2,
                      top: cy - tileHeight / 2,
                      width: tileWidth,
                      height: tileHeight,
                      // Eren'in dağ isteği için: her karo artık kendi (x+y)
                      // sırasına göre EXPLICIT bir z-index taşıyor (eskiden
                      // hepsi düz z-index:1'di, sıralama sadece DOM sırasına
                      // dayanıyordu). Böylece aşağıdaki ayrı dağ katmanı,
                      // kendi frontSortKey'ine göre AYNI numaralandırmayla
                      // araya girip bazı karoların ÖNÜNDE bazılarının
                      // ARKASINDA görünebiliyor (painter's algorithm iki
                      // katman arasında da geçerli oluyor). Üst sınır ~1000
                      // (bkz. App.css .iso-labels-layer/.attack-lines-layer
                      // -- onlar bilerek çok daha yüksek bir z-index'te,
                      // "her zaman en üstte" garantisi bozulmasın diye).
                      zIndex: 10 + tile.x + tile.y,
                    }}
                    onClick={(e) => {
                      if (isDeadZone) return;
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
                    title={isDeadZone ? undefined : `(${tile.x}, ${tile.y}) Lv${tile.level} — ada #${tile.islandId}`}
                  >
                    {/* Zemin -- düz açık yeşil taban rengi (bkz. .iso-ground)
                        korunuyor, ÜSTÜNE Eren'in "kenarlar kel kalmış"
                        isteğiyle son haline getirdiği çim topağı dokusu
                        (bkz. GRASS_TEXTURES/grassTextureForTile) biniyor.
                        Doku PNG'leri zaten kendi altıgen sınırına kırpılmış
                        üretildi ve komşu-karo dikiş testinden geçti, burada
                        .iso-ground-grass'taki clip-path ek bir güvenlik. */}
                    <div className="iso-ground" />
                    <div
                      className="iso-ground-grass"
                      style={{ backgroundImage: `url(${grassTextureForTile(tile.x, tile.y)})` }}
                    />
                    <div className={`iso-diamond ${selectedTile?.id === tile.id ? "selected" : ""}`} />
                    {/* Sahiplik artık kalenin yanındaki ayrı bir rozetle değil
                        (Eren: "oyuncunun kalelerinin yanındaki yeşil
                        yuvarlağı kaldır"), doğrudan seviye etiketinin
                        rengiyle anlaşılıyor -- bkz. aşağıdaki
                        .iso-labels-layer: NPC gri, kendi/klan sarı, düşman
                        oyuncu kırmızı. */}
                    {showCastle && (
                      // Eren: "Sadece oyuncu kalelerine ışıltı ekle" -- glow
                      // sadece burada (showCastle/PLAYER dalı), NPC kampları
                      // (showNpc dalı, aşağıda) hiç dokunulmadı.
                      <img
                        src={castleIcon}
                        alt=""
                        className="iso-castle iso-castle-glow"
                        style={{
                          width: castleBoxWidth,
                          height: castleBoxHeight,
                          left: (tileWidth - castleBoxWidth) / 2,
                          top: castleTop,
                        }}
                      />
                    )}
                    {showNpc && (
                      <img
                        src={npcIcon}
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
              {/* Dağ / çoklu-hex dekor katmanı -- bkz. yukarıdaki
                  MOUNTAIN_DEFS/computePlacedMountains yorumu. Kale
                  görsellerinin karo dışına taşması gibi ama çok daha büyük:
                  her <img> kendi kapladığı TÜM hex'lerin ekran alanına
                  sığacak şekilde konumlanıyor (bkz. mountainScreens),
                  z-index'i de frontSortKey'e göre yukarıdaki karolarla AYNI
                  numaralandırmada -- böylece dağın önünden geçen bir karo
                  dağın üstüne, arkasındaki bir karo dağın altına doğru
                  çiziliyor (painter's algorithm, bkz. sortedTiles yorumu).
                  pointer-events:none -- tıklama her zaman altındaki (zaten
                  "ölü alan" olan EMPTY) karoya gidiyor, ayrıca bir tıklama
                  davranışı eklemeye gerek yok. */}
              {mountainScreens.map(({ mountain, left, top, width, height }) => (
                <img
                  key={mountain.key}
                  src={mountain.def.img}
                  alt=""
                  className="iso-mountain"
                  style={{
                    left,
                    top,
                    width,
                    height,
                    zIndex: 10 + mountain.frontSortKey,
                  }}
                />
              ))}
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
                  // Eren: "oyuncunun kalelerinin yanındaki yeşil yuvarlağı
                  // kaldır ... oyuncu kendisi sarı ve sadece düşman oyuncuyu
                  // da kırmızı yap" -- sahiplik ayrı bir rozetle değil, bu
                  // seviye etiketinin rengiyle gösteriliyor: NPC gri
                  // (mevcut), kendi/klan sarı (varsayılan), düşman oyuncu
                  // kırmızı (yeni).
                  const isMine = tile.ownerId === session.playerId;
                  const isGuildmate = !isMine && !!tile.ownerId && guildMemberIds.has(tile.ownerId);
                  const isEnemyPlayer = !isNpcTile && !isMine && !isGuildmate;
                  const badgeClass = isNpcTile
                    ? "level-badge-npc"
                    : isEnemyPlayer
                    ? "level-badge-enemy"
                    : "";
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
                      <div className={`level-badge ${badgeClass}`} style={{ left: tileWidth / 2 }}>
                        Lv{tile.level}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Eren: "saldırdığın kaleden saldırdığın kaleye gidildiğini
                  belli eden bir saldırı hattı olsun ... yolda giden bir şey
                  hareketli olsun" -- yolda olan (kendi/klanla ilgili) her
                  saldırı için kaynaktan hedefe kesikli bir hat + CSS Motion
                  Path (offset-path) ile o hat üzerinde gerçek zamanlı
                  ilerleyen bir işaret. Negatif animation-delay (geçen süre
                  kadar geride başlatma) sayesinde ayrı bir JS animasyon
                  döngüsüne (requestAnimationFrame) hiç gerek kalmadan --
                  sayfa her yeniden render olduğunda ordunun O ANKİ gerçek
                  konumundan devam ediyor. */}
              <div className="attack-lines-layer">
                <svg className="attack-line-svg">
                  {activeAttacks.map((atk) => {
                    const from = isoCenter(atk.fromX, atk.fromY, tileWidth);
                    const to = isoCenter(atk.targetX, atk.targetY, tileWidth);
                    // Eren: "çizgi rota olayı dağın içinden geçmesin yeter,
                    // basit görsel eğri" -- düz çizgi yerine, araya bir dağ
                    // giriyorsa (bkz. bendAttackPath) hafif kavisli bir
                    // Bézier path. Gerçek pathfinding DEĞİL, bilerek basit.
                    const d = bendAttackPath(
                      from.cx,
                      from.cy,
                      to.cx,
                      to.cy,
                      mountainScreens.map((m) => m.box),
                      tileWidth
                    );
                    return (
                      <path
                        key={atk.id}
                        d={d}
                        fill="none"
                        className={`attack-line-path ${atk.isMine ? "attack-line-mine" : "attack-line-enemy"}`}
                      />
                    );
                  })}
                </svg>
                {activeAttacks.map((atk) => {
                  const from = isoCenter(atk.fromX, atk.fromY, tileWidth);
                  const to = isoCenter(atk.targetX, atk.targetY, tileWidth);
                  // Marker'ın izlediği yol da SVG'deki ile birebir aynı
                  // (bkz. yukarıdaki d hesaplaması) -- yoksa asker ikonu
                  // çizgiden bağımsız, dağın içinden düz gidiyormuş gibi
                  // görünürdü.
                  const d = bendAttackPath(
                    from.cx,
                    from.cy,
                    to.cx,
                    to.cy,
                    mountainScreens.map((m) => m.box),
                    tileWidth
                  );
                  // Eren: "51sn diyor fakat ... hedefe çok hızlı ulaşıyor" --
                  // ham Date.now() yerine sunucuyla senkronize edilmiş "şu an"
                  // (bkz. clockOffsetRef) kullanılıyor ki markör GERÇEKTEN
                  // süresi dolduğunda hedefe ulaşsın.
                  const estServerNow = Date.now() + clockOffsetRef.current;
                  const totalMs = Math.max(1, atk.arrivesAt - atk.departedAt);
                  const elapsedMs = Math.min(totalMs, Math.max(0, estServerNow - atk.departedAt));
                  const etaSec = Math.max(0, Math.round((atk.arrivesAt - estServerNow) / 1000));
                  return (
                    <div
                      key={atk.id}
                      className={`attack-line-marker ${atk.isMine ? "attack-line-marker-mine" : "attack-line-marker-enemy"}`}
                      style={
                        {
                          offsetPath: `path('${d}')`,
                          animationDuration: `${totalMs}ms`,
                          animationDelay: `-${elapsedMs}ms`,
                        } as React.CSSProperties
                      }
                      title={`${atk.attackerUsername}: (${atk.fromX}, ${atk.fromY}) → (${atk.targetX}, ${atk.targetY}) · ${etaSec} sn`}
                    >
                      ⚔️
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

      <header className="topbar">
        <div className="profile-widget">
          <button
            type="button"
            className="profile-avatar-btn"
            onClick={() => avatarInputRef.current?.click()}
            title="Profil fotoğrafını değiştir"
          >
            {profile?.avatarData ? (
              <img src={profile.avatarData} alt="" className="profile-avatar-img" />
            ) : (
              <span className="profile-avatar-fallback">{session.username.slice(0, 2).toUpperCase()}</span>
            )}
            <span className="profile-avatar-edit-badge">📷</span>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="profile-avatar-input"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file || !session) return;
              setError(null);
              try {
                const dataUrl = await resizeImageToDataUrl(file, 160);
                await uploadAvatar(session.token, dataUrl);
                setProfile((p) => (p ? { ...p, avatarData: dataUrl } : p));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
          <span className="profile-widget-name">{session.username}</span>
        </div>
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
            className={`kingdom-toggle kingdom-toggle-guild ${showGuildPanel ? "active" : ""}`}
            onClick={openGuildPanel}
          >
            {guild ? <GuildFlag flagId={guild.flagId} size={20} /> : "🛡️"} {guild ? guild.name : "Lonca"}
            {receivedInvites.length > 0 ? ` (${receivedInvites.length})` : ""}
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

      {/* Eren: "Lonca bölümü açıldığı zaman oda ortada açılsın (liderlik
          panosu gibi)" -- köşeye tutunan küçük ".kingdom-dropdown" yerine,
          Liderlik/Raporlar panolarıyla birebir aynı ortalanmış tam-ekran
          modal deseni (.modal-overlay/.modal-screen/.modal-header/
          .modal-body, bkz. yukarıdaki showLeaderboard/showReports). */}
      {showGuildPanel && (
        <div className="modal-overlay" onClick={() => setShowGuildPanel(false)}>
          <div className="modal-screen modal-guild" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🛡️ Lonca</h2>
              <button className="icon-btn" onClick={() => setShowGuildPanel(false)}>✕</button>
            </div>
            <div className="modal-body">
          {guild ? (
            <div>
              <p className="guild-header-row">
                <GuildFlag flagId={guild.flagId} size={36} />
                <span><strong>{guild.name}</strong> — {guild.memberCount} üye</span>
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

              {/* Eren: "Lonca bölümünü geliştir oyuncu davet falan olsun." */}
              <p className="hint guild-section-heading">Oyuncu davet et</p>
              <form onSubmit={handleInvitePlayer} className="guild-invite-form">
                <input
                  placeholder="Kullanıcı adı"
                  value={guildInviteUsername}
                  onChange={(e) => setGuildInviteUsername(e.target.value)}
                  minLength={3}
                  maxLength={20}
                />
                <button type="submit">Davet Et</button>
              </form>

              {guild.pendingInvites.length > 0 && (
                <>
                  <p className="hint guild-section-heading">Bekleyen davetler</p>
                  <ul className="city-list">
                    {guild.pendingInvites.map((inv) => (
                      <li key={inv.id}>
                        <div className="city-row">
                          <div>
                            <div>{inv.invitedUsername}</div>
                            <div className="stats">{inv.invitedByUsername} davet etti</div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <button onClick={handleLeaveGuild}>Loncadan Ayrıl</button>
            </div>
          ) : (
            <div>
              {receivedInvites.length > 0 && (
                <>
                  <p className="hint guild-section-heading">Sana gelen davetler</p>
                  <ul className="city-list">
                    {receivedInvites.map((inv) => (
                      <li key={inv.id}>
                        <div className="city-row">
                          <div>
                            <div>{inv.guildName}</div>
                            <div className="stats">{inv.invitedByUsername} davet etti</div>
                          </div>
                        </div>
                        <div className="row-actions">
                          <button onClick={() => handleAcceptInvite(inv.id)}>Kabul Et</button>
                          <button className="icon-btn" onClick={() => handleDeclineInvite(inv.id)}>Reddet</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <form onSubmit={handleCreateGuild} className="login-form">
                <input
                  placeholder="Yeni lonca adı"
                  value={guildNameInput}
                  onChange={(e) => setGuildNameInput(e.target.value)}
                  minLength={3}
                  maxLength={24}
                />
                {/* Eren: "10 adet lonca bayrağı ekle ... lonca kurulumunda
                    olsun seçilebilmeli" -- 10 bayrağın hepsi küçük seçilebilir
                    kartlar olarak listeleniyor, seçili olan altın çerçeveyle
                    vurgulanıyor. */}
                <p className="hint guild-section-heading">Lonca bayrağı seç</p>
                <div className="guild-flag-picker">
                  {GUILD_FLAG_DEFS.map((f) => (
                    <button
                      type="button"
                      key={f.id}
                      className={`guild-flag-option ${guildFlagInput === f.id ? "selected" : ""}`}
                      onClick={() => setGuildFlagInput(f.id)}
                      title={f.name}
                    >
                      <GuildFlag flagId={f.id} size={30} />
                    </button>
                  ))}
                </div>
                <button type="submit">Lonca Kur</button>
              </form>
              <p className="hint">Ya da mevcut bir loncaya katıl:</p>
              {availableGuilds.length === 0 && <p className="hint">Henüz hiç lonca yok.</p>}
              <ul className="city-list">
                {availableGuilds.map((g) => (
                  <li key={g.id}>
                    <div className="city-row">
                      <GuildFlag flagId={g.flagId} size={26} />
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
          </div>
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
        const closeMenu = () => { setSelectedTile(null); setSelectedScreenPos(null); };
        const actionsArc = (
          // Eren: "Kale üzerine gelince açılan menüyü kalenin altından
          // kalenin sağına ve soluna uzuyacak şekilde yarım ay olarak yap.
          // Ve yarım ayın çizgisinin üzerinede saldır, destek, gözcü,
          // yükselt ekle." -- dört eylem bir hilal eğrisi üzerinde: uçlar
          // (Saldır/Yükselt) yukarıda, ortadakiler (Destek/Gözcü) aşağıda.
          // Eren (2. tur): "Sana altına yarım ay yap ve mini menüleri
          // üzerine yerleştir dedim ama sen hala kare penceredesin ...
          // Screenshot_19'deki menü tasarımını istiyorum ve ikonlarda 3D
          // boyutlu olucak." -- bu blok artık ayrı bir kart/pencere İÇİNDE
          // değil, doğrudan haritanın üzerinde şeffaf biçimde yüzüyor (bkz.
          // isMineSel dalı aşağıda ve .hex-menu-floating / .hex-action-shape
          // App.css'teki glossy 3D güncellemesi).
          // Eren (3. tur): "Bu 4 ikonu birbirine bağlayan kalın bir bar
          // ekle. Fakat ikonlar bardan dışarı taşıcak şekilde olmalı hem
          // aşağıdan hem yukarıdan sanki barın üzerine sonradan
          // yerleştirilmiş gibi durmalılar." -- eski ince kesik-çizgili
          // "hilal" yerine, iki üst üste path ile (koyu metal gövde + üstte
          // ince parlak highlight şeridi) kalın, cilalı bir "kemer/bar"
          // çizildi. Butonlar (.hex-action) zaten bardan sonra DOM'da
          // geldiği için üstte duruyor; boyutları barın kalınlığından
          // büyük tutulup dikey ortası bar çizgisine denk gelecek şekilde
          // konumlandı (bkz. App.css .hex-action nth-child top değerleri)
          // -- yani her ikon barın hem üstüne hem altına taşıyor.
          <div className="hex-actions">
            <svg className="hex-actions-arc" viewBox="0 0 260 118" preserveAspectRatio="none">
              <defs>
                <linearGradient id="hexActionsBarGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6b7280" />
                  <stop offset="45%" stopColor="#3f4652" />
                  <stop offset="100%" stopColor="#20242c" />
                </linearGradient>
              </defs>
              <path className="hex-actions-bar-body" d="M 16 24 Q 130 84 244 24" />
              <path className="hex-actions-bar-shine" d="M 18 20 Q 130 78 242 20" />
            </svg>
            <button className="hex-action hex-action-attack" onClick={() => startAction("attack", selectedTile)}>
              <span className="hex-action-shape"><span className="hex-action-icon"><ActionIconSword /></span></span>
              <span className="hex-action-label">Saldır</span>
            </button>
            <button className="hex-action hex-action-reinforce" onClick={() => startAction("reinforce", selectedTile)}>
              <span className="hex-action-shape"><span className="hex-action-icon"><ActionIconShield /></span></span>
              <span className="hex-action-label">Destek</span>
            </button>
            <button className="hex-action hex-action-scout" onClick={() => startAction("scout", selectedTile)}>
              <span className="hex-action-shape"><span className="hex-action-icon"><ActionIconScout /></span></span>
              <span className="hex-action-label">Gözcü</span>
            </button>
            <button className="hex-action hex-action-upgrade" onClick={() => handleUpgrade(selectedTile.id)}>
              <span className="hex-action-shape"><span className="hex-action-icon"><ActionIconUpgrade /></span></span>
              <span className="hex-action-label">Yükselt</span>
            </button>
          </div>
        );
        const myRecallRows = (selectedTile.reinforcements ?? [])
          .filter((r) => r.fromPlayerId === session.playerId)
          .map((r) => (
            <div key={r.id} className="reinforcement-row">
              <span>{r.troops} asker gönderdin</span>
              <button onClick={() => handleRecall(r.id)}>Geri Çağır</button>
            </div>
          ));

        if (isMineSel) {
          // Eren: kendi kalem için artık kare/dikdörtgen bir pencere/kart
          // YOK -- sadece küçük, yuvarlak "mini" bilgi hapları (seviye,
          // asker, altın, takviye, kapat) ve altında doğrudan haritanın
          // üzerinde yüzen hilal aksiyon menüsü var (bkz. .hex-menu-floating).
          return (
            <div className="hex-menu-floating" style={{ left, top }}>
              <div className="hex-floating-chips">
                <span className="hex-chip hex-chip-level">🏰 {selectedTile.level}</span>
                {hasIntelSel && (
                  <span className="hex-chip hex-chip-troops">⚔️ {selectedTile.troops}</span>
                )}
                {hasIntelSel && (
                  <span className="hex-chip hex-chip-gold">🪙 +{selectedTile.goldPerHour}</span>
                )}
                {(selectedTile.reinforcementTroops ?? 0) > 0 && (
                  <span className="hex-chip hex-chip-reinforce">🛡️ +{selectedTile.reinforcementTroops}</span>
                )}
                <button className="hex-chip hex-chip-close" onClick={closeMenu}>✕</button>
              </div>
              {actionsArc}
              {myRecallRows.length > 0 && (
                <div className="hex-floating-recalls">{myRecallRows}</div>
              )}
            </div>
          );
        }

        return (
          <div className="tile-card hex-menu" style={{ left, top, maxHeight: CARD_MAX_HEIGHT }}>
            <button className="hex-menu-close" onClick={closeMenu}>
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
                  {!isGuildmateSel && selectedTile.scoutedAt !== null && (
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

              {selectedTile.tileType !== "EMPTY" && (
                <p className="hint">
                  Saldırmak veya gözcü göndermek için önce kendi kalene tıkla, açılan menüden seç, sonra bu kareyi hedef göster.
                </p>
              )}

              {myRecallRows}
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
              {pendingTarget.type === "attack" && (
                <p className="hint pending-eta">
                  🕒 Tahmini seyahat süresi:{" "}
                  <strong>
                    {pendingAttackEtaMs === null
                      ? "hesaplanıyor…"
                      : `${Math.round(pendingAttackEtaMs / 1000)} sn`}
                  </strong>
                </p>
              )}

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
