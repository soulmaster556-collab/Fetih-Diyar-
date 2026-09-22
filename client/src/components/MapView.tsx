import { useMemo } from "react";
import type { ActiveAttack, Tile } from "../api";
import {
  CASTLE_IMAGE_ASPECT,
  ICON_MIN_WIDTH,
  LABEL_MIN_WIDTH,
  SHOW_BUILDINGS,
  WORLD_SIZE,
} from "../game/constants";
import { isoCenter } from "../game/hexMath";
import { bendAttackPath, computePlacedMountains, type MountainScreenBox } from "../game/mountains";
import { castleImageForLevel, grassTextureForTile, npcCastleImageForLevel } from "../game/tileImages";

// Harita artık tüm pencereyi kaplayan tek katman -- menü/panel bunun
// ÜZERİNE yarı saydam "HUD" katmanları olarak biniyor. Kaydırma/zoom/
// sürükleme mantığı App'te (bkz. handleWheel/handleViewportMouseDown), bu
// bileşen sadece çizim yapıyor.
export function MapView({
  viewportRef,
  onScroll,
  onWheel,
  onMouseDown,
  tiles,
  activeAttacks,
  tileWidth,
  tileHeight,
  selectedTileId,
  playerId,
  guildMemberIds,
  clockOffsetMs,
  onTileClick,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  tiles: Tile[];
  activeAttacks: ActiveAttack[];
  tileWidth: number;
  tileHeight: number;
  selectedTileId: number | null;
  playerId: string;
  guildMemberIds: Set<string>;
  clockOffsetMs: number;
  onTileClick: (tile: Tile, clientX: number, clientY: number) => void;
}) {
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
      const { cx, cy } = isoCenter(m.rootX, m.rootY, tileWidth);
      const boxW = tileWidth * m.def.scale;
      const boxH = tileHeight * m.def.scale;
      const box: MountainScreenBox = { key: m.key, centerX: cx, centerY: cy, radius: (boxW + boxH) / 4 };
      return { mountain: m, left: cx - boxW / 2, top: cy - boxH / 2, width: boxW, height: boxH, box };
    });
  }, [placedMountains, tileWidth, tileHeight]);

  return (
  <div
    className="map-viewport"
    ref={viewportRef}
    onScroll={onScroll}
    onWheel={onWheel}
    onMouseDown={onMouseDown}
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
            // Oyuncu kaleleri seviyeye göre (CASTLE_LEVEL_TIERS), NPC
            // kampları kendi seviyesine göre (NPC_LEVEL_TIERS) görsel seçiyor.
            const castleIcon = castleImageForLevel(tile.level);
            const npcIcon = npcCastleImageForLevel(tile.level);
            const { cx, cy } = isoCenter(tile.x, tile.y, tileWidth);
            // Kale kutusu: yükseklik tileHeight*0.82, genişlik en fazla
            // tileWidth*0.94. object-fit:contain her seviye görselinin
            // kendi oranını koruyor (gerçek oranlar ~0.41-1.18). 0.94 tavanı
            // komşu karolarla üst üste binmeyi önlüyor -- kaldırma.
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
            // Boş kareler "ölü alan": ne bilgi kartı açılır ne de (aksiyon
            // modundayken) hedef olarak kabul edilir, tıklama yok sayılır.
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
                  // Her karo (x+y) sırasına göre EXPLICIT z-index taşıyor --
                  // böylece ayrı dağ katmanı aynı numaralandırmayla araya
                  // girip bazı karoların önünde, bazılarının arkasında
                  // görünebiliyor (painter's algorithm). Üst sınır ~1000;
                  // .iso-labels-layer/.attack-lines-layer bilerek çok daha
                  // yüksekte ("her zaman en üstte").
                  zIndex: 10 + tile.x + tile.y,
                }}
                onClick={(e) => {
                  if (isDeadZone) return;
                  onTileClick(tile, e.clientX, e.clientY);
                }}
                title={isDeadZone ? undefined : `(${tile.x}, ${tile.y}) Lv${tile.level} — ada #${tile.islandId}`}
              >
                {/* Zemin -- düz açık yeşil taban rengi (bkz. .iso-ground),
                    üstüne çim topağı dokusu (bkz. grassTextureForTile).
                    Doku PNG'leri zaten altıgen sınırına kırpılmış, burada
                    .iso-ground-grass'taki clip-path ek bir güvenlik. */}
                <div className="iso-ground" />
                <div
                  className="iso-ground-grass"
                  style={{ backgroundImage: `url(${grassTextureForTile(tile.x, tile.y)})` }}
                />
                <div className={`iso-diamond ${selectedTileId === tile.id ? "selected" : ""}`} />
                {/* Sahiplik ayrı bir rozetle değil, seviye etiketinin
                    rengiyle anlaşılıyor -- bkz. aşağıdaki .iso-labels-layer:
                    NPC gri, kendi/klan sarı, düşman oyuncu kırmızı. */}
                {showCastle && (
                  // Oyuncu kaleleri altın, NPC kampları kendi parıltısıyla
                  // (bkz. showNpc dalı).
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
                    className="iso-castle iso-npc-glow"
                    style={{
                      width: npcBoxWidth,
                      height: npcBoxHeight,
                      left: (tileWidth - npcBoxWidth) / 2,
                      top: npcTop,
                    }}
                  />
                )}
                {/* Seviye rozeti BURADA render edilmiyor -- ayrı, tüm
                    karoların üstündeki tek bir katmanda (bkz. aşağıdaki
                    .iso-labels-layer). Sebep: her .iso-tile-group kendi
                    istifleme bağlamını oluşturduğu için, DOM'da sonra gelen
                    komşu karo önceki karonun taşan rozetini örtüyordu. */}
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
          {/* Dağ / dekor katmanı -- bkz. yukarıdaki MOUNTAIN_DEFS/
              computePlacedMountains yorumu. Kale görsellerinin karo
              dışına taşması gibi: her <img> kendi kök hex'inin ekran
              alanına `scale` oranında taşarak konumlanıyor (bkz.
              mountainScreens), z-index'i de frontSortKey'e göre
              yukarıdaki karolarla AYNI numaralandırmada -- böylece dağın
              önünden geçen bir karo dağın üstüne, arkasındaki bir karo
              dağın altına doğru çiziliyor (painter's algorithm, bkz.
              sortedTiles yorumu). pointer-events:none -- tıklama her
              zaman altındaki (zaten "ölü alan" olan EMPTY) karoya
              gidiyor, ayrıca bir tıklama davranışı eklemeye gerek yok. */}
          {mountainScreens.map(({ mountain, left, top, width, height }) => (
            <img
              key={mountain.key}
              src={mountain.def.img}
              alt=""
              className="iso-mountain iso-mountain-glow"
              style={{
                left,
                top,
                width,
                height,
                zIndex: 10 + mountain.frontSortKey,
              }}
            />
          ))}
          {/* Seviye rozetleri -- hiçbir karonun asla üstüne binemeyeceği,
              TEK ve en üstteki ortak bir katmanda (bkz. .iso-labels-layer,
              z-index tüm .iso-tile-group'lardan yüksek). Karo içinde
              çizilince komşu karo rozetin yarısını örtüyordu. */}
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
              // Sahiplik seviye etiketinin rengiyle gösteriliyor: NPC gri,
              // kendi/klan sarı (varsayılan), düşman oyuncu kırmızı.
              const isMine = tile.ownerId === playerId;
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

          {/* Yolda olan (kendi/klanla ilgili) her saldırı için kaynaktan
              hedefe kesikli bir hat + CSS Motion Path (offset-path) ile o hat
              üzerinde ilerleyen bir işaret. Negatif animation-delay (geçen
              süre kadar geride başlatma) sayesinde ayrı bir JS animasyon
              döngüsüne gerek kalmadan, her render'da ordunun O ANKİ gerçek
              konumundan devam ediyor. */}
          <div className="attack-lines-layer">
            <svg className="attack-line-svg">
              {activeAttacks.map((atk) => {
                const from = isoCenter(atk.fromX, atk.fromY, tileWidth);
                const to = isoCenter(atk.targetX, atk.targetY, tileWidth);
                // Araya bir dağ giriyorsa (bkz. bendAttackPath) düz çizgi
                // yerine hafif kavisli bir Bézier path.
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
              // Ham Date.now() yerine sunucuyla senkronize "şu an" (bkz.
              // clockOffsetRef) -- markör GERÇEKTEN süre dolduğunda ulaşsın.
              const estServerNow = Date.now() + clockOffsetMs;
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
  );
}
