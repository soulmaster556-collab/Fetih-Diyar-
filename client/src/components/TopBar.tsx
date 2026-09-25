import type { Guild, MyProfile, PlayerSummary, Session } from "../api";
import { GuildFlag } from "./GuildFlag";

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
  onOpenProfile,
  onGoHome,
  onToggleKingdom,
  onToggleGuild,
  onToggleLeaderboard,
  onToggleReports,
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
  onOpenProfile: () => void;
  onGoHome: () => void;
  onToggleKingdom: () => void;
  onToggleGuild: () => void;
  onToggleLeaderboard: () => void;
  onToggleReports: () => void;
  onLogout: () => void;
}) {
  // Profilde gösterilen isim artık takma ad (diğer oyunculara görünen
  // kimlik) -- `session.username` sadece login kimlik bilgisi, profil henüz
  // yüklenmediği/nickname hiç seçilmediği çok kısa bir ara durumda ona
  // düşülüyor (bkz. api.ts Session/MyProfile yorumları).
  const displayName = profile?.nickname ?? session.username;

  return (
    <header className="topbar">
      <div className="profile-column">
        <div className="profile-widget">
          {/* Avatar artık dosya seçiciyi değil, büyük "Oyuncu Bilgileri"
              penceresini açıyor (bkz. ProfileModal.tsx -- fotoğraf
              değiştirme oraya taşındı). İsim TIKLANMIYOR -- avatar zaten
              aynı işi yapıyor, ikinci bir tıklanabilir alan gereksizdi. */}
          <button type="button" className="profile-avatar-btn" onClick={onOpenProfile} title="Oyuncu bilgileri">
            {profile?.avatarData ? (
              <img src={profile.avatarData} alt="" className="profile-avatar-img" />
            ) : (
              <span className="profile-avatar-fallback">{displayName.slice(0, 2).toUpperCase()}</span>
            )}
          </button>
          <span className="profile-widget-name">{displayName}</span>
        </div>
        {summary && (
          <div className="summary-bar">
            {/* Altın/asker artık avatarın ALTINDA, referanstaki elmas/altın
                istifi gibi dikey sıralı, dolu (şeffaf değil) çerçeveli iki
                ayrı rozet (bkz. client/public/ui/frames/frame-bar-long-alt.png).
                İleride başka bir kaynak eklenirse aynı sütuna alt alta
                eklenecek şekilde tasarlandı. */}
            <span className="summary-item summary-item-gold">
              <span className="summary-item-value">🪙 {Math.floor(summary.gold)}</span>
              <span className="summary-item-rate">+{summary.goldPerHour}/sa</span>
            </span>
            <span className="summary-item summary-item-troops">
              <span className="summary-item-value">⚔️ {totalTroops}</span>
              <span className="summary-item-rate">+{summary.troopsPerHour}/sa</span>
            </span>
          </div>
        )}
      </div>
      <div className="player-info">
        <button
          className="hud-icon-btn"
          disabled={myTilesCount === 0}
          onClick={onGoHome}
          title="Ana kalene git"
        >
          <span className="hud-icon-glyph">🧭</span>
        </button>
        <button
          className={`hud-icon-btn ${showKingdomList ? "active" : ""}`}
          onClick={onToggleKingdom}
          title={`Krallığım (${myTilesCount})`}
        >
          <span className="hud-icon-glyph">🏰</span>
          {myTilesCount > 0 && <span className="hud-icon-badge hud-icon-badge-neutral">{myTilesCount}</span>}
        </button>
        <button
          className={`hud-icon-btn ${showGuildPanel ? "active" : ""}`}
          onClick={onToggleGuild}
          title={guild ? guild.name : "Lonca"}
        >
          <span className="hud-icon-glyph">
            {guild ? <GuildFlag flagId={guild.flagId} size={22} /> : "🛡️"}
          </span>
          {receivedInvitesCount > 0 && <span className="hud-icon-badge">{receivedInvitesCount}</span>}
        </button>
        <button
          className={`hud-icon-btn ${showLeaderboard ? "active" : ""}`}
          onClick={onToggleLeaderboard}
          title="Liderlik Panosu"
        >
          <span className="hud-icon-glyph">🏆</span>
        </button>
        <button
          className={`hud-icon-btn ${showReports ? "active" : ""}`}
          onClick={onToggleReports}
          title="Mesaj &amp; Raporlar"
        >
          <span className="hud-icon-glyph">📨</span>
          {unreadReportCount > 0 && <span className="hud-icon-badge">{unreadReportCount}</span>}
        </button>
        <button className="hud-icon-btn hud-icon-btn-logout" onClick={onLogout} title="Çıkış">
          <span className="hud-icon-glyph">🚪</span>
        </button>
      </div>
    </header>
  );
}
