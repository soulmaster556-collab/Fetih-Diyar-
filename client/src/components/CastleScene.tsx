import { useMemo } from "react";
import { buildCastleScene, type PlacedProp } from "../game/castleScenes";

// FAZ 2 prototip -- bkz. game/castleScenes.ts dosya başı yorumu. Bu
// bileşen SADECE MapView.tsx'in seçtiği TEK bir prototip kalede kullanılır
// (bkz. MapView.tsx `prototypeCastleId`); diğer tüm kaleler hâlâ eski
// `<img src={castleIcon}>` tek-görsel sistemiyle çiziliyor -- oraya hiç
// dokunulmadı.
//
// Konum sistemi: tüm prop'lar `.iso-tile-group`'un (tileWidth × tileHeight)
// kendi içinde, karo merkezine göre (dx,dy * tileWidth) ofsetle
// konumlanıyor -- ana kale görseliyle AYNI koordinat uzayı. Bu yüzden
// parent'ın z-index'i (10+x+y, bkz. MapView.tsx) ve overflow:visible'ı
// (bkz. App.css .iso-tile-group) hiçbir ek kod gerekmeden painter's
// algorithm'a doğru şekilde uyuyor -- CastleScene kendi z-index'ini asla
// tanımlamıyor.
//
// `sceneVisible` İKİLİ -- kademeli LOD YOK (bkz. castleScenes.ts dosya
// başı yorumu): false iken SADECE ana kale görseli var, true olunca TÜM
// prop'lar birlikte, tek seferde beliriyor.
export function CastleScene({
  tile,
  sceneVisible,
  tileWidth,
  tileHeight,
  castleIcon,
  castleBoxWidth,
  castleBoxHeight,
  castleLeft,
  castleTop,
}: {
  tile: { x: number; y: number };
  sceneVisible: boolean;
  tileWidth: number;
  tileHeight: number;
  castleIcon: string;
  castleBoxWidth: number;
  castleBoxHeight: number;
  castleLeft: number;
  castleTop: number;
}) {
  const props = useMemo(() => buildCastleScene(tile), [tile.x, tile.y]);
  const behind = sceneVisible ? props.filter((p) => p.slot.paintOrder === "behind") : [];
  const front = sceneVisible ? props.filter((p) => p.slot.paintOrder === "front") : [];

  const centerX = tileWidth / 2;
  const centerY = tileHeight / 2;

  return (
    <>
      {sceneVisible && (
        <div
          className="castle-scene-shadow"
          style={{
            left: centerX - (tileWidth * 1.3) / 2,
            top: centerY + tileWidth * 0.14 - (tileWidth * 0.46) / 2,
            width: tileWidth * 1.3,
            height: tileWidth * 0.46,
          }}
        />
      )}
      {behind.map((p) => (
        <CastleSceneProp key={p.slot.id} prop={p} tileWidth={tileWidth} centerX={centerX} centerY={centerY} />
      ))}
      <img
        src={castleIcon}
        alt=""
        className="iso-castle iso-castle-glow"
        style={{
          width: castleBoxWidth,
          height: castleBoxHeight,
          left: castleLeft,
          top: castleTop,
        }}
      />
      {front.map((p) => (
        <CastleSceneProp key={p.slot.id} prop={p} tileWidth={tileWidth} centerX={centerX} centerY={centerY} />
      ))}
    </>
  );
}

function CastleSceneProp({
  prop,
  tileWidth,
  centerX,
  centerY,
}: {
  prop: PlacedProp;
  tileWidth: number;
  centerX: number;
  centerY: number;
}) {
  const width = prop.slot.width * tileWidth;
  const height = width / prop.variant.aspect;
  return (
    <div
      className="castle-scene-prop"
      style={{
        left: centerX + prop.dx * tileWidth - width / 2,
        top: centerY + prop.dy * tileWidth - height / 2,
        width,
        height,
        backgroundImage: prop.variant.img,
      }}
    />
  );
}
