import { useRef } from "react";
import type { Guild, MyProfile, PlayerSummary, Session } from "../api";
import { GuildFlag } from "./GuildFlag";
import { PlayerFlag } from "./PlayerFlag";

export function TopBar({
  session,
  profile,
  summary,
  totalTroops,
  myTilesCount,
  guild,
  receivedInvitesCount,
  unreadReportCount,
  showKingdomList,
  showGuildPanel,
  showLeaderboard,
  showReports,
  onAvatarFile,
  onGoHome,
  onToggleKingdom,
  onToggleGuild,
  onToggleLeaderboard,
  onToggleReports,
  onOpenFlagEditor,
  onLogout,
}: {
  session: Session;
  profile: MyProfile | null;
  summary: PlayerSummary | null;
  totalTroops: number;
  myTilesCount: number;
  guild: Guild | null;
  receivedInvitesCount: number;
  unreadReportCount: number;
  showKingdomList: boolean;
  showGuildPanel: boolean;
  showLeaderboard: boolean;
  showReports: boolean;
  onAvatarFile: (file: File) => void;
  onGoHome: () => void;
  onToggleKingdom: () => void;
  onToggleGuild: () => void;
  onToggleLeaderboard: () => void;
  onToggleReports: () => void;
  onOpenFlagEditor: () => void;
  onLogout: () => void;
}) {
  // Üst menüdeki yuvarlak profil widget'ı (avatar yükleme).
  const avatarInputRef = useRef<HTMLInputElement>(null);
  // Profilde gösterilen isim artık takma ad (diğer oyunculara görünen
  // kimlik) -- `session.username` sadece login kimlik bilgisi, profil henüz
  // yüklenmediği/nickname hiç seçilmediği çok kısa bir ara durumda ona
  // düşülüyor (bkz. api.ts Session/MyProfile yorumları).
  const displayName = profile?.nickname ?? session.username;

  return (
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
            <span className="profile-avatar-fallback">{displayName.slice(0, 2).toUpperCase()}</span>
          )}
          <span className="profile-avatar-edit-badge">📷</span>
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
        <span className="profile-widget-name">{displayName}</span>
        {profile && (
          <button type="button" className="profile-flag-btn" onClick={onOpenFlagEditor} title="Flamanı tasarla">
            <PlayerFlag shapeId={profile.flagShape} colorId={profile.flagColor} logoId={profile.flagLogo} size={20} />
          </button>
        )}
      </div>
      {summary && (
        <div className="summary-bar">
          <span className="summary-item summary-item-gold">
            🪙 {Math.floor(summary.gold)} <small>(+{summary.goldPerHour}/sa)</small>
          </span>
          {/* Toplam asker, altınla aynı "toplam (+üretim/sa)" biçiminde. */}
          <span className="summary-item summary-item-troops">
            ⚔️ {totalTroops} <small>(+{summary.troopsPerHour}/sa)</small>
          </span>
        </div>
      )}
      <div className="player-info">
        <button
          className="kingdom-toggle"
          disabled={myTilesCount === 0}
          onClick={onGoHome}
          title="Ana kalene git"
        >
          🧭 Krallığıma Git
        </button>
        <button
          className={`kingdom-toggle ${showKingdomList ? "active" : ""}`}
          onClick={onToggleKingdom}
        >
          🏰 Krallığım ({myTilesCount})
        </button>
        <button
          className={`kingdom-toggle kingdom-toggle-guild ${showGuildPanel ? "active" : ""}`}
          onClick={onToggleGuild}
        >
          {guild ? <GuildFlag flagId={guild.flagId} size={20} /> : "🛡️"} {guild ? guild.name : "Lonca"}
          {receivedInvitesCount > 0 ? ` (${receivedInvitesCount})` : ""}
        </button>
        <button
          className={`kingdom-toggle ${showLeaderboard ? "active" : ""}`}
          onClick={onToggleLeaderboard}
        >
          🏆 Liderlik
        </button>
        <button
          className={`kingdom-toggle ${showReports ? "active" : ""}`}
          onClick={onToggleReports}
        >
          📨 Raporlar{unreadReportCount > 0 ? ` (${unreadReportCount})` : ""}
        </button>
        <button onClick={onLogout}>Çıkış</button>
      </div>
    </header>
  );
}
