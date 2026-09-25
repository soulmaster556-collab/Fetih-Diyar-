import { useMemo } from "react";
import type { ActiveAttack, Tile } from "../api";
import {
  CASTLE_IMAGE_ASPECT,
  ICON_MIN_WIDTH,
  LABEL_MIN_WIDTH,
  SHOW_BUILDINGS,
  WORLD_SIZE,
} from "../game/constants";
import { computePlacedCrystals } from "../game/crystals";
import { computePlacedForests } from "../game/forests";
import { isoCenter } from "../game/hexMath";
import { bendAttackPath, computePlacedMountains, type MountainScreenBox } from "../game/mountains";
import { computePlacedRocks } from "../game/rockyAreas";
import {
  buildCoastRingPathD,
  buildLakePathD,
  coastGradientGeometry,
  generateLakes,
  isWaterAtWorldPosition,
} from "../game/riversLakes";
import { castleImageForLevel, npcCastleImageForLevel } from "../game/tileImages";
import { buildTerritoryPathD, computeTerritoryRegions } from "../game/territory";
import { buildBiomeBackground, generateBiomeAnchors, TERRAIN_GRAIN_BACKGROUND } from "../game/worldRegions";
import { PlayerFlag } from "./PlayerFlag";

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

  // FAZ 1 -- Sürekli dünya zemini (bkz. worldRegions.ts). Anchor listesi
  // WORLD_SIZE'a göre sabit -- yüklü `tiles` penceresinden TAMAMEN bağımsız,
  // bu yüzden harita hızlı kaydırılırken zemin asla "sonradan belirmiyor"
  // (eski hex-başına .iso-ground sisteminin aksine). Sadece zoom (tileWidth)
  // değişince piksel konumları yeniden hesaplanıyor.
  const biomeAnchors = useMemo(() => generateBiomeAnchors(WORLD_SIZE), []);
  const terrainBackground = useMemo(
    () => buildBiomeBackground(biomeAnchors, tileWidth),
    [biomeAnchors, tileWidth]
  );

  // Göller. AYNI prensip: WORLD_SIZE'a göre bir kez üretilir, `tiles`'tan
  // bağımsız (bkz. riversLakes.ts dosya başı yorumu). z-index sırası:
  // .world-terrain (0) -> .world-water (1) -> .iso-tile-group'lar (10+).
  // Territory (FAZ 5) ileride bu ikisinin arasına (z~2) girecek. Nehir
  // sistemi kullanıcı isteğiyle kaldırıldı -- sadece göl var.
  const waterFeatures = useMemo(() => ({ lakes: generateLakes(WORLD_SIZE) }), []);
  const lakePathsD = useMemo(
    () => waterFeatures.lakes.map((l) => ({ key: `lake-${l.seed}`, d: buildLakePathD(l, tileWidth) })),
    [waterFeatures, tileWidth]
  );
  // Kıyı şeridi -- TEK bir path + TEK bir radyal gradyan, parça/dikiş YOK
  // (bkz. riversLakes.ts buildCoastRingPathD dosya başı yorumu -- ilk
  // deneme döndürülmüş dikdörtgen parçalardı, eğride dikiş oluşturuyordu,
  // geri alındı).
  const coastRings = useMemo(
    () =>
      waterFeatures.lakes.map((l) => ({
        key: `coast-${l.seed}`,
        gradientId: `coast-gradient-${l.seed}`,
        maskId: `coast-mask-${l.seed}`,
        d: buildCoastRingPathD(l, tileWidth),
        geo: coastGradientGeometry(l, tileWidth),
      })),
    [waterFeatures, tileWidth]
  );

  // FAZ 5 -- Territory (bkz. game/territory.ts dosya başı yorumu). Pahalı
  // kısım (flood-fill + sınır çıkarma) SADECE `tiles`/sahiplik değiştiğinde
  // yeniden çalışır -- zoom (tileWidth) değişince ayrı bir useMemo (aşağıda)
  // sadece koordinatları ölçekliyor, topoloji baştan hesaplanmıyor (madde 18).
  const territoryRegions = useMemo(
    () => computeTerritoryRegions(tiles, playerId, guildMemberIds),
    [tiles, playerId, guildMemberIds]
  );
  const territoryPathsD = useMemo(
    () =>
      territoryRegions.map((r) => ({ key: r.key, category: r.category, d: buildTerritoryPathD(r, tileWidth) })),
    [territoryRegions, tileWidth]
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

  // FAZ 4A madde 6 -- "dağların suyla kötü çakışmaması", ama
  // `computePlacedMountains`'ın KENDİSİNE (mountains.ts) dokunmadan: dağ
  // YERLEŞİMİ hiç değişmedi, sadece burada -- render'a hangi dağların
  // ÇİZİLECEĞİNE karar veren MapView katmanında -- kökü suya denk gelen
  // dağlar listeden çıkarılıyor. Attack-line bükülmesi de (aşağıda) AYNI
  // filtrelenmiş listeyi kullanıyor ki görünmeyen bir dağın etrafında
  // saldırı hattı bükülmesin.
  // Dağ sprite'ı (scale 2.2) diğer dekorlardan daha büyük taştığı için pay
  // da daha geniş -- "ağaçlar/dekorlar göle taşıyor" düzeltmesi (bkz.
  // riversLakes.ts isWaterAtWorldPosition yorumu, forests.ts/rockyAreas.ts
  // ile aynı prensip).
  const visibleMountainScreens = useMemo(
    () =>
      mountainScreens.filter(
        (m) => !isWaterAtWorldPosition(m.mountain.rootX, m.mountain.rootY, waterFeatures, 1.25)
      ),
    [mountainScreens, waterFeatures]
  );

  // FAZ 3 -- Forest + Rocky Areas. `mountains.ts` HİÇ değişmedi; bu iki
  // sistem sadece onunla aynı painter's-algorithm havuzuna (10+x+y,
  // aşağıdaki render'da mountainScreens ile yan yana) katılıyor. Sıra
  // önemli: dağlar önce yerleşiyor (değişmedi), ormanlar dağ köklerini
  // (+6 komşu) dışlayarak yerleşiyor, kayalıklar hem dağları hem de
  // (sadece kendi hex'i, komşu dışlaması olmadan) orman köklerini
  // dışlayarak yerleşiyor -- bkz. forests.ts/rockyAreas.ts dosya başı
  // yorumları. world-terrain'e (biomeAnchors'ın KENDİSİ değişmiyor, sadece
  // okunuyor) hiç dokunulmuyor.
  const placedForests = useMemo(
    () => computePlacedForests(tiles, biomeAnchors, placedMountains, waterFeatures),
    [tiles, biomeAnchors, placedMountains, waterFeatures]
  );
  const placedRocks = useMemo(
    () => computePlacedRocks(tiles, biomeAnchors, placedMountains, placedForests, waterFeatures),
    [tiles, biomeAnchors, placedMountains, placedForests, waterFeatures]
  );

  const forestScreens = useMemo(() => {
    return placedForests.map((f) => {
      const { cx, cy } = isoCenter(f.rootX, f.rootY, tileWidth);
      const scale = f.def.scale * f.scaleJitter;
      const boxW = tileWidth * scale;
      const boxH = tileHeight * scale;
      const left = cx + f.jitterX * tileWidth - boxW / 2;
      const top = cy + f.jitterY * tileWidth - boxH / 2;
      return { forest: f, left, top, width: boxW, height: boxH };
    });
  }, [placedForests, tileWidth, tileHeight]);

  const rockScreens = useMemo(() => {
    return placedRocks.map((r) => {
      const { cx, cy } = isoCenter(r.rootX, r.rootY, tileWidth);
      const scale = r.def.scale * r.scaleJitter;
      const boxW = tileWidth * scale;
      const boxH = tileHeight * scale;
      const left = cx + r.jitterX * tileWidth - boxW / 2;
      const top = cy + r.jitterY * tileWidth - boxH / 2;
      return { rock: r, left, top, width: boxW, height: boxH };
    });
  }, [placedRocks, tileWidth, tileHeight]);

  // Kristal dekor kümeleri (bkz. game/crystals.ts dosya başı yorumu) --
  // dağ kökleri (+6 komşu) VE orman/kayalık kökleri (sadece kendi hex'i)
  // dışlanarak yerleşiyor, aynı forests/rockyAreas'ın birbirini dışlama
  // mantığı. Su kontrolü kendi içinde (computePlacedCrystals).
  const placedCrystals = useMemo(
    () => computePlacedCrystals(tiles, placedMountains, [...placedForests, ...placedRocks], waterFeatures),
    [tiles, placedMountains, placedForests, placedRocks, waterFeatures]
  );

  // "Havada duruyor" düzeltmesi: kutuyu (mountains/forests/rocks gibi) cy
  // etrafında ortalamak yerine, kalenin (castleTop hesabı, aşağısı) oturduğu
  // AYNI zemin çizgisine (cy + 0.35*tileHeight) ALT kenardan sabitliyoruz.
  // Eskiden top = cy - boxH/2 idi -- boxH scale'e göre değiştiği için
  // (0.34-0.68 arası) düşük scale'li varyantlar (blue-2/3, gold-2, purple-2)
  // zeminin çok yukarısında kalıyordu, kullanıcı geri bildirimi ("kristaller
  // havada duruyor") buradan geliyordu. Artık scale ne olursa olsun ALT
  // kenar hep aynı noktada, sadece kutunun boyu değişiyor.
  const CRYSTAL_GROUND_OFFSET = 0.35;
  const crystalScreens = useMemo(() => {
    return placedCrystals.map((c) => {
      const { cx, cy } = isoCenter(c.rootX, c.rootY, tileWidth);
      const scale = c.def.scale * c.scaleJitter;
      const boxW = tileWidth * scale;
      const boxH = tileHeight * scale;
      const left = cx + c.jitterX * tileWidth - boxW / 2;
      const groundY = cy + c.jitterY * tileWidth + CRYSTAL_GROUND_OFFSET * tileHeight;
      const top = groundY - boxH;
      return { crystal: c, left, top, width: boxW, height: boxH };
    });
  }, [placedCrystals, tileWidth, tileHeight]);

  // Render sırası (yukarıdan aşağıya = arkadan öne, FAZ 5 madde 2/17):
  // world-terrain(z0) -> world-water(z1) -> world-territory(z2) ->
  // iso-tile-group'lar + mountains/forests/rocky/castle-scenes (z 10+,
  // painter's algorithm havuzu) -> iso-labels-layer(z500) ->
  // attack-lines-layer(en üst). Bu sırayı değiştirmeden koru.
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
      {/* FAZ 1 -- tek parça dünya zemini. Hex başına DEĞİL, .iso-map'in
          TAMAMI için tek katman (bkz. worldRegions.ts) -- .iso-tile-group'lar
          zaten z-index 10+ ile bunun üstünde duruyor, painter's algorithm'a
          hiç katılmıyor (sabit z-index 0). İki alt-katman: biyom lekeleri
          (geniş, yumuşak geçişli renk varyasyonu) + üstünde ince bir doku/
          gren katmanı (yakın zoomda çıplak düz renk hissi vermesin diye). */}
      <div className="world-terrain">
        <div
          className="world-terrain-grass"
          style={{ backgroundSize: `${tileWidth * 6}px ${tileWidth * 6}px` }}
        />
        <div
          className="world-terrain-biome"
          style={{ backgroundImage: terrainBackground }}
        />
        <div
          className="world-terrain-grain"
          style={{
            backgroundImage: TERRAIN_GRAIN_BACKGROUND,
            backgroundSize: `${tileWidth * 1.5}px ${tileWidth * 1.5}px`,
          }}
        />
      </div>
      {/* Göl katmanı. .world-terrain'in HEMEN üstünde, tüm
          .iso-tile-group'ların (z-index 10+) altında -- sabit z-index 1,
          painter's algorithm'a hiç katılmıyor (tıpkı terrain gibi düz/
          zemine-yapışık bir katman, "boylu" bir obje değil). Tek bir SVG,
          içinde birkaç <path> -- dünya boyutundan bağımsız, düşük DOM
          maliyetli (bkz. riversLakes.ts dosya başı yorumu). Nehir sistemi
          kullanıcı isteğiyle kaldırıldı. */}
      {/* Kıyı şeridi -- .world-terrain'in üstünde ama .world-water'ın (aşağısı,
          gerçek göl dolgusu) ALTINDA, sabit z-index 1 (bu DOM sırası yeterli --
          eşit z'de sonraki kardeş üstte boyanır, bkz. App.css notu). Su->kum->
          şeffaf radyal gradyanla dolu TEK path -- göl dolgusu bunun büyük
          kısmını örtüyor, sadece MARGIN kadarlık halka dışarıda kalıyor (bkz.
          riversLakes.ts buildCoastRingPathD dosya başı yorumu). */}
      <svg className="world-coastline">
        <defs>
          {coastRings.map((r) => (
            <radialGradient
              key={r.gradientId}
              id={r.gradientId}
              gradientUnits="userSpaceOnUse"
              cx={r.geo.cx}
              cy={r.geo.cy}
              r={r.geo.r}
            >
              {/* Su -> ıslak kum (koyu, dalganın hemen üstü) -> kuru kum ->
                  şeffaf (çime karışsın diye) -- kullanıcı isteğiyle eski
                  4-durak/düz-plato geçiş daha kademeli/doğal hale getirildi. */}
              <stop offset="0%" stopColor="#3f8fbf" stopOpacity="0.9" />
              <stop offset="30%" stopColor="#3f8fbf" stopOpacity="0.85" />
              <stop offset="42%" stopColor="#b9a276" stopOpacity="0.85" />
              <stop offset="58%" stopColor="#e8d6ab" stopOpacity="0.85" />
              <stop offset="85%" stopColor="#e8d6ab" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#e8d6ab" stopOpacity="0" />
            </radialGradient>
          ))}
          {/* Kum dokusu -- .world-terrain-grain ile AYNI teknik (feTurbulence,
              gerçek asset yok), ama kum daha ince taneli hissetsin diye
              yüksek baseFrequency. patternUnits userSpaceOnUse + tileWidth'e
              bağlı boyut ki zoom değişince tane boyutu da orantılı kalsın. */}
          <pattern
            id="sand-grain-pattern"
            patternUnits="userSpaceOnUse"
            width={tileWidth * 0.35}
            height={tileWidth * 0.35}
          >
            <filter id="sand-grain-filter">
              <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" stitchTiles="stitch" />
              <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#sand-grain-filter)" />
          </pattern>
          {/* Kum dokusunun (aşağısı) sadece gradyanın GÖRÜNÜR olduğu yerde
              (su/çim'e karıştığı kenarlarda değil) belirmesi için -- mask
              içindeki path AYNI gradyanla dolduruluyor, o yüzden tane de
              rengin soluma eğrisini birebir takip ediyor. */}
          {/* style={{colorInterpolation:'sRGB'}} ÖNEMLİ -- SVG mask'lar
              varsayılan olarak linearRGB uzayında luminance hesaplıyor, bu da
              orta tonları (buradaki gradyan renkleri gibi) olması gerekenden
              çok daha karanlık/görünmez gösteriyor (bkz. dosya başı yorumu --
              maskesiz test edilince tane net görünüyordu, mask eklenince
              neredeyse kayboluyordu, sebebi buydu). */}
          {coastRings.map((r) => (
            <mask key={r.maskId} id={r.maskId} style={{ colorInterpolation: "sRGB" }}>
              <path d={r.d} fill={`url(#${r.gradientId})`} />
            </mask>
          ))}
        </defs>
        {coastRings.map((r) => (
          <path key={r.key} d={r.d} fill={`url(#${r.gradientId})`} />
        ))}
        {coastRings.map((r) => (
          <path
            key={`${r.key}-grain`}
            d={r.d}
            fill="url(#sand-grain-pattern)"
            mask={`url(#${r.maskId})`}
            className="world-coastline-grain"
          />
        ))}
      </svg>
      <svg className="world-water">
        {lakePathsD.map((l) => (
          <path key={l.key} d={l.d} className="lake-shape" />
        ))}
      </svg>
      {/* FAZ 5 -- Territory katmanı. .world-water'ın HEMEN üstünde, TÜM
          .iso-tile-group'ların (z 10+) altında -- sabit z-index 2, terrain/su
          gibi zemine yapışık bir katman, painter's algorithm'a katılmıyor.
          Her <path> tek bir bağlı bölgeyi (region) temsil ediyor -- hex
          başına DEĞİL (bkz. game/territory.ts dosya başı yorumu). fillRule
          evenodd, region içinde delik (ör. fethedilmemiş bir NPC karosu)
          varsa doğru boşluğu bırakması için. */}
      <svg className="world-territory">
        {territoryPathsD.map((r) => (
          <path
            key={r.key}
            d={r.d}
            fillRule="evenodd"
            className={`territory-path territory-path-${r.category}`}
          />
        ))}
      </svg>
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
            // Kale kutusu: kullanıcı isteğiyle NPC kampıyla AYNI boyuta
            // geri döndürüldü (önceki 1.18/1.32 büyütme kaldırıldı).
            // object-fit:contain her seviye görselinin kendi oranını koruyor
            // (gerçek oranlar ~0.41-1.18).
            const castleBoxHeight = tileHeight * 0.7;
            const castleBoxWidth = castleBoxHeight * CASTLE_IMAGE_ASPECT;
            const npcBoxHeight = tileHeight * 0.7;
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
                {/* Zemin artık burada değil -- tek parça .world-terrain
                    katmanı (bkz. yukarısı) tüm haritayı kaplıyor. Bu div
                    sadece seçili karo vurgusu için var, varsayılanda
                    şeffaf (bkz. .iso-diamond). */}
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
          {visibleMountainScreens.map(({ mountain, left, top, width, height }) => (
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
                transform: `rotate(${mountain.rotationDeg}deg)${mountain.flipX ? " scaleX(-1)" : ""}`,
                transformOrigin: "bottom center",
              }}
            />
          ))}
          {/* FAZ 3 -- orman kümeleri. Dağlarla AYNI z-index numaralandırması
              (10+frontSortKey) -- ayrı bir katman değil, aynı painter's
              algorithm havuzuna karışıyor (bkz. yukarıdaki placedForests
              yorumu), böylece önünden geçen bir karo kümenin üstünde,
              arkasındaki bir karo altında doğru şekilde görünüyor. */}
          {forestScreens.map(({ forest, left, top, width, height }) => (
            <img
              key={forest.key}
              src={forest.def.img}
              alt=""
              className="forest-cluster"
              style={{
                left,
                top,
                width,
                height,
                zIndex: 10 + forest.frontSortKey,
              }}
            />
          ))}
          {/* FAZ 3 -- kayalık kümeler. Aynı prensip, ayrı katman. FAZ 4B --
              her kayaya (kendi SVG'sindeki tekil taş açılarından AYRI
              olarak) hash'e göre sabit, küçük bir genel eğim uygulanıyor
              (bkz. rockyAreas.ts `rotationDeg` yorumu) -- transform-origin
              "bottom center" ile taban/zemin teması dönüşten etkilenmiyor. */}
          {rockScreens.map(({ rock, left, top, width, height }) => (
            <img
              key={rock.key}
              src={rock.def.img}
              alt=""
              className="rock-cluster"
              style={{
                left,
                top,
                width,
                height,
                zIndex: 10 + rock.frontSortKey,
                transform: `rotate(${rock.rotationDeg}deg)`,
                transformOrigin: "bottom center",
              }}
            />
          ))}
          {/* Kristal dekor kümeleri (bkz. game/crystals.ts). Aynı painter's
              algorithm havuzu (10+frontSortKey). Zeminle bütünleşmesi için
              görselin ALTINA ayrı bir gölge elipsi konuyor (castle-scene-shadow
              ile aynı teknik, bkz. App.css) -- gerçek raster görsel kendi
              gölgesini taşımıyor, SVG dekorların (rockShape içindeki <ellipse>)
              aksine. rotationDeg dağ/kayalıkla aynı "hep aynı açı" tekrarını
              kırmak için, transform-origin bottom center ile taban bozulmasın
              diye. */}
          {crystalScreens.map(({ crystal, left, top, width, height }) => (
            <div
              key={crystal.key}
              className="crystal-cluster-wrap"
              style={{
                left,
                top,
                width,
                height,
                zIndex: 10 + crystal.frontSortKey,
              }}
            >
              <div
                className="crystal-cluster-shadow"
                style={{ width: width * 0.6, height: height * 0.14 }}
              />
              <img
                src={crystal.def.img}
                alt=""
                className={`crystal-cluster crystal-glow-${crystal.def.color}`}
                style={{
                  transform: `rotate(${crystal.rotationDeg}deg)`,
                  transformOrigin: "bottom center",
                }}
              />
            </div>
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

          {/* Oyuncu flamaları + merkez kale efekti -- level-badge'lerle AYNI
              sebepten (komşu karonun taşan görseli örtmesin diye) ayrı, her
              zaman en üstteki tek bir katmanda. Flama GERÇEK sahiplik
              verisinden (tile.ownerFlagShape/Color/Logo) geliyor ve TÜM
              oyuncu kalelerinde görünüyor. */}
          <div className="iso-flags-layer">
            {sortedTiles.map((tile) => {
              const showFlag =
                SHOW_BUILDINGS && tile.tileType === "PLAYER" && !!tile.ownerId && tileWidth >= ICON_MIN_WIDTH;
              if (!showFlag && !tile.isCapital) return null;
              const { cx, cy } = isoCenter(tile.x, tile.y, tileWidth);
              return (
                <div
                  key={tile.id}
                  className="iso-flag-anchor"
                  style={{
                    left: cx - tileWidth / 2,
                    top: cy - tileHeight / 2,
                    width: tileWidth,
                    height: tileHeight,
                  }}
                >
                  {tile.isCapital && (
                    <div
                      className="capital-castle-aura"
                      style={{
                        left: tileWidth / 2 - (tileWidth * 1.3) / 2,
                        top: tileHeight / 2 + tileWidth * 0.14 - (tileWidth * 0.5) / 2,
                        width: tileWidth * 1.3,
                        height: tileWidth * 0.5,
                      }}
                    />
                  )}
                  {showFlag && (
                    <div
                      className="iso-flag-badge"
                      style={{
                        left: tileWidth / 2 + tileWidth * 0.04 - (tileWidth * 0.34) / 2,
                        top: tileHeight / 2 - tileWidth * 0.66,
                      }}
                    >
                      <PlayerFlag
                        shapeId={tile.ownerFlagShape ?? 1}
                        colorId={tile.ownerFlagColor ?? 1}
                        logoId={tile.ownerFlagLogo ?? 1}
                        size={tileWidth * 0.34}
                      />
                    </div>
                  )}
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
                  visibleMountainScreens.map((m) => m.box),
                  tileWidth
                );
                return (
                  <path
                    key={atk.id}
                    d={d}
                    fill="none"
                    className={`attack-line-path ${atk.isMine ? "attack-line-mine" : "attack-line-enemy"} attack-line-${atk.orderType}`}
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
                visibleMountainScreens.map((m) => m.box),
                tileWidth
              );
              // Ham Date.now() yerine sunucuyla senkronize "şu an" (bkz.
              // clockOffsetRef) -- markör GERÇEKTEN süre dolduğunda ulaşsın.
              const estServerNow = Date.now() + clockOffsetMs;
              const totalMs = Math.max(1, atk.arrivesAt - atk.departedAt);
              const elapsedMs = Math.min(totalMs, Math.max(0, estServerNow - atk.departedAt));
              const etaSec = Math.max(0, Math.round((atk.arrivesAt - estServerNow) / 1000));
              const actionLabel = atk.orderType === "reinforce" ? "Takviye" : "Saldırı";
              return (
                <div
                  key={atk.id}
                  className={`attack-line-marker attack-line-marker-${atk.orderType} ${
                    atk.isMine ? "attack-line-marker-mine" : "attack-line-marker-enemy"
                  }`}
                  style={
                    {
                      offsetPath: `path('${d}')`,
                      animationDuration: `${totalMs}ms`,
                      animationDelay: `-${elapsedMs}ms`,
                    } as React.CSSProperties
                  }
                  title={`${atk.attackerUsername} (${actionLabel}): (${atk.fromX}, ${atk.fromY}) → (${atk.targetX}, ${atk.targetY}) · ${etaSec} sn`}
                >
                  <PlayerFlag
                    shapeId={atk.attackerFlagShape}
                    colorId={atk.attackerFlagColor}
                    logoId={atk.attackerFlagLogo}
                    size={11}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
  );
}
