import { useRef } from "react";
import type { Guild, MyProfile, PlayerSummary, Session } from "../api";
import { GuildFlag } from "./GuildFlag";
import { PlayerFlag } from "./PlayerFlag";

// Oyuncu bilgileri -- üst menüdeki küçük avatar/isim yerine artık büyük,
// tek bir "profil" penceresi (referans görsellerdeki "Oyuncu bilgileri"
// ekranına karşılık geliyor). Danışman/sezon/şehir-görünümü gibi bizde
// olmayan sistemler yerine SADECE gerçekten var olan veriler gösteriliyor:
// avatar, takma ad, flama, toplam altın/asker (+üretim), şehir sayısı, lonca.
export function ProfileModal({
  session,
  profile,
  summary,
  totalTroops,
  myTilesCount,
  guild,
  onAvatarFile,
  onOpenFlagEditor,
  onClose,
}: {
  session: Session;
  profile: MyProfile | null;
  summary: PlayerSummary | null;
  totalTroops: number;
  myTilesCount: number;
  guild: Guild | null;
  onAvatarFile: (file: File) => void;
  onOpenFlagEditor: () => void;
  onClose: () => void;
}) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const displayName = profile?.nickname ?? session.username;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-screen modal-profile" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🐾 Oyuncu Bilgileri</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="profile-modal-top">
            <div className="profile-modal-avatar-col">
              <button
                type="button"
                className="profile-modal-avatar-btn"
                onClick={() => avatarInputRef.current?.click()}
                title="Profil fotoğrafını değiştir"
              >
                {profile?.avatarData ? (
                  <img src={profile.avatarData} alt="" className="profile-modal-avatar-img" />
                ) : (
                  <span className="profile-modal-avatar-fallback">{displayName.slice(0, 2).toUpperCase()}</span>
                )}
                <span className="profile-modal-avatar-edit-badge">📷</span>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="profile-avatar-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onAvatarFile(file);
                }}
              />
              <div className="profile-modal-name">{displayName}</div>
              {profile?.nickname && <div className="profile-modal-username">@{session.username}</div>}
              {profile && (
                <button type="button" className="profile-modal-flag-btn" onClick={onOpenFlagEditor}>
                  <PlayerFlag shapeId={profile.flagShape} colorId={profile.flagColor} logoId={profile.flagLogo} size={22} />
                  Flamanı Düzenle
                </button>
              )}
            </div>

            <div className="profile-modal-stat-grid">
              <div className="profile-modal-stat">
                <span className="profile-modal-stat-label">🪙 Altın</span>
                <span className="profile-modal-stat-value">{summary ? Math.floor(summary.gold) : "—"}</span>
                {summary && <span className="profile-modal-stat-sub">+{summary.goldPerHour}/sa</span>}
              </div>
              <div className="profile-modal-stat">
                <span className="profile-modal-stat-label">⚔️ Asker</span>
                <span className="profile-modal-stat-value">{totalTroops}</span>
                {summary && <span className="profile-modal-stat-sub">+{summary.troopsPerHour}/sa</span>}
              </div>
              <div className="profile-modal-stat">
                <span className="profile-modal-stat-label">🏰 Şehir</span>
                <span className="profile-modal-stat-value">{myTilesCount}</span>
              </div>
              <div className="profile-modal-stat">
                <span className="profile-modal-stat-label">🛡️ Lonca</span>
                {guild ? (
                  <span className="profile-modal-stat-value profile-modal-guild-value">
                    <GuildFlag flagId={guild.flagId} size={18} /> {guild.name}
                  </span>
                ) : (
                  <span className="profile-modal-stat-value profile-modal-stat-empty">Yok</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
