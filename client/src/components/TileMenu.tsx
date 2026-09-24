import type { Tile } from "../api";
import type { ActionType, ScreenPos } from "../game/types";
import { ActionIconScout, ActionIconShield, ActionIconSword, ActionIconUpgrade } from "./icons/ActionIcons";

// Haritada bir kaleye tıklanınca açılan menü: kendi kalem için yüzen
// hilal aksiyon menüsü, diğer kareler için bilgi kartı.
export function TileMenu({
  selectedTile,
  screenPos,
  playerId,
  guildMemberIds,
  onClose,
  onStartAction,
  onUpgrade,
  onRecall,
}: {
  selectedTile: Tile;
  screenPos: ScreenPos;
  playerId: string;
  guildMemberIds: Set<string>;
  onClose: () => void;
  onStartAction: (type: ActionType) => void;
  onUpgrade: (tileId: number) => void;
  onRecall: (reinforcementId: number) => void;
}) {
  const CARD_WIDTH = 300;
  const CARD_MAX_HEIGHT = 440;
  const margin = 12;
  const isMineSel = selectedTile.ownerId === playerId;
  let left: number;
  let top: number;
  if (isMineSel) {
    // Kendi kalem için yüzen hilal aksiyon menüsü -- kullanıcı isteği:
    // kalenin SAĞINDA değil ALTINDA açılsın. .hex-menu-floating'in sabit
    // width'i (260px, bkz. App.css) ile birebir -- yatayda tıklanan noktaya
    // ortalanıyor, dikeyde aşağı doğru açılıyor (chips üstte, hilal menü
    // altta, bkz. JSX sırası).
    const FLOATING_WIDTH = 260;
    const FLOATING_MAX_HEIGHT = 260;
    left = screenPos.x - FLOATING_WIDTH / 2;
    top = screenPos.y + 24;
    left = Math.max(margin, Math.min(left, window.innerWidth - FLOATING_WIDTH - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - FLOATING_MAX_HEIGHT - margin));
  } else {
    left = screenPos.x + 18;
    top = screenPos.y - 20;
    if (left + CARD_WIDTH > window.innerWidth - margin) left = screenPos.x - CARD_WIDTH - 18;
    left = Math.max(margin, Math.min(left, window.innerWidth - CARD_WIDTH - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - CARD_MAX_HEIGHT - margin));
  }
  const isGuildmateSel = !isMineSel && !!selectedTile.ownerId && guildMemberIds.has(selectedTile.ownerId);
  const hasIntelSel = selectedTile.troops !== null && selectedTile.tileType !== "EMPTY";
  // Kendi olmayan kareler için kart: üstte oyuncu adı/seviye "kalkanı"
  // banner'ı, altında bilgi (bkz. .hex-menu-* App.css).
  const ownerLabel =
    selectedTile.tileType === "NPC"
      ? "NPC Kampı"
      : selectedTile.tileType === "EMPTY"
      ? "Boş Kare"
      : selectedTile.ownerUsername ?? "Bilinmiyor";
  const closeMenu = onClose;
  const actionsArc = (
    // Dört eylem kalın, cilalı bir hilal "bar" üzerinde: uçlar (Saldır/
    // Yükselt) yukarıda, ortadakiler (Destek/Gözcü) aşağıda. Bar iki üst
    // üste path (koyu gövde + parlak şerit); butonlar bardan sonra DOM'da
    // geldiği için üstte duruyor ve barın hem üstüne hem altına taşıyor
    // (bkz. App.css .hex-action nth-child top değerleri).
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
      <button className="hex-action hex-action-attack" onClick={() => onStartAction("attack")}>
        <span className="hex-action-shape"><span className="hex-action-icon"><ActionIconSword /></span></span>
        <span className="hex-action-label">Saldır</span>
      </button>
      <button className="hex-action hex-action-reinforce" onClick={() => onStartAction("reinforce")}>
        <span className="hex-action-shape"><span className="hex-action-icon"><ActionIconShield /></span></span>
        <span className="hex-action-label">Destek</span>
      </button>
      <button className="hex-action hex-action-scout" onClick={() => onStartAction("scout")}>
        <span className="hex-action-shape"><span className="hex-action-icon"><ActionIconScout /></span></span>
        <span className="hex-action-label">Gözcü</span>
      </button>
      <button className="hex-action hex-action-upgrade" onClick={() => onUpgrade(selectedTile.id)}>
        <span className="hex-action-shape"><span className="hex-action-icon"><ActionIconUpgrade /></span></span>
        <span className="hex-action-label">Yükselt</span>
      </button>
    </div>
  );
  const myRecallRows = (selectedTile.reinforcements ?? [])
    .filter((r) => r.fromPlayerId === playerId)
    .map((r) => (
      <div key={r.id} className="reinforcement-row">
        <span>{r.troops} asker gönderdin</span>
        <button onClick={() => onRecall(r.id)}>Geri Çağır</button>
      </div>
    ));

  if (isMineSel) {
    // Kendi kalem için kart/pencere YOK -- sadece küçük yuvarlak bilgi
    // hapları ve altında haritanın üzerinde yüzen hilal aksiyon menüsü
    // (bkz. .hex-menu-floating).
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
}
