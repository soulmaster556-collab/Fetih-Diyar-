import { useEffect, useState } from "react";
import { fetchAttackEta } from "../api";
import type { PendingTarget, ScreenPos } from "../game/types";

// Hedef seçildikten sonra açılan asker-sayısı/onay kartı. App bunu
// kaynak+hedef+tür ile `key`leyerek render ediyor -- hedef değişince kart
// sıfırdan açılıyor (asker sayısı 10'a döner, süre yeniden hesaplanır).
export function PendingActionCard({
  pendingTarget,
  screenPos,
  token,
  onCancel,
  onConfirm,
}: {
  pendingTarget: PendingTarget;
  screenPos: ScreenPos | null;
  token: string;
  onCancel: () => void;
  onConfirm: (troops: number) => void;
}) {
  const [troopsInput, setTroopsInput] = useState(10);
  // "Saldırı Emri" onay kartında, göndermeden önce tahmini seyahat süresi.
  const [pendingAttackEtaMs, setPendingAttackEtaMs] = useState<number | null>(null);

  // Onay kartı açılınca (sadece saldırı için, takviye/gözcü anlık)
  // sunucudan tahmini seyahat süresini çekiyoruz.
  useEffect(() => {
    if (pendingTarget.type !== "attack") return;
    let cancelled = false;
    fetchAttackEta(token, pendingTarget.fromTile.id, pendingTarget.targetTile.id)
      .then((r) => {
        if (!cancelled) setPendingAttackEtaMs(r.durationMs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const CARD_WIDTH = 320;
  const margin = 12;
  const pos = screenPos ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
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
        <button className="icon-btn" onClick={onCancel}>✕</button>
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
            onClick={() => onConfirm(troopsInput)}
          >
            {actionMeta.icon} {actionMeta.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
