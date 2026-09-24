import { useState } from "react";
import { updatePlayerFlag, type MyProfile } from "../api";
import { FLAG_COLORS, FLAG_LOGOS, FLAG_SHAPES } from "../game/playerFlags";
import { PlayerFlag } from "./PlayerFlag";

// Flama tasarım ekranı -- GuildModal'daki bayrak seçici kartların aynısı,
// ama 3 ayrı eksen (şekil/renk/logo) için ayrı grid + 🎲 rastgele düğmesi.
// Seçimler SADECE lokal önizleme state'ini değiştirir, "Kaydet"e basılana
// kadar sunucuya yazılmaz (bkz. handleSave).
export function PlayerFlagModal({
  token,
  profile,
  onProfileChange,
  setError,
  setMessage,
  onClose,
}: {
  token: string;
  profile: MyProfile;
  onProfileChange: (p: MyProfile) => void;
  setError: (msg: string | null) => void;
  setMessage: (msg: string | null) => void;
  onClose: () => void;
}) {
  const [shapeId, setShapeId] = useState(profile.flagShape);
  const [colorId, setColorId] = useState(profile.flagColor);
  const [logoId, setLogoId] = useState(profile.flagLogo);
  const [saving, setSaving] = useState(false);

  function handleRandomize() {
    setShapeId(1 + Math.floor(Math.random() * FLAG_SHAPES.length));
    setColorId(1 + Math.floor(Math.random() * FLAG_COLORS.length));
    setLogoId(1 + Math.floor(Math.random() * FLAG_LOGOS.length));
  }

  async function handleSave() {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      await updatePlayerFlag(token, { flagShape: shapeId, flagColor: colorId, flagLogo: logoId });
      onProfileChange({ ...profile, flagShape: shapeId, flagColor: colorId, flagLogo: logoId });
      setMessage("Flaman kaydedildi!");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-screen modal-flag-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🚩 Flamanı Tasarla</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="flag-preview-row">
            <PlayerFlag shapeId={shapeId} colorId={colorId} logoId={logoId} size={70} />
            <button type="button" className="flag-dice-btn" onClick={handleRandomize} title="Rastgele">
              🎲 Rastgele
            </button>
          </div>

          <p className="hint guild-section-heading">Şekil seç</p>
          <div className="flag-picker-grid">
            {FLAG_SHAPES.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`flag-picker-option ${shapeId === s.id ? "selected" : ""}`}
                onClick={() => setShapeId(s.id)}
                title={s.name}
              >
                <PlayerFlag shapeId={s.id} colorId={colorId} logoId={logoId} size={26} />
              </button>
            ))}
          </div>

          <p className="hint guild-section-heading">Renk seç</p>
          <div className="flag-picker-grid">
            {FLAG_COLORS.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`flag-picker-option flag-color-option ${colorId === c.id ? "selected" : ""}`}
                onClick={() => setColorId(c.id)}
                title={c.name}
              >
                <span className="flag-color-swatch" style={{ background: c.hex }} />
              </button>
            ))}
          </div>

          <p className="hint guild-section-heading">Logo seç</p>
          <div className="flag-picker-grid">
            {FLAG_LOGOS.map((l) => (
              <button
                type="button"
                key={l.id}
                className={`flag-picker-option ${logoId === l.id ? "selected" : ""}`}
                onClick={() => setLogoId(l.id)}
                title={l.name}
              >
                <PlayerFlag shapeId={shapeId} colorId={colorId} logoId={l.id} size={26} />
              </button>
            ))}
          </div>

          <button className="confirm-action-btn" disabled={saving} onClick={handleSave}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
  );
}
