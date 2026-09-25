import { useEffect, useState } from "react";
import { fetchLeaderboard, type LeaderboardEntry, type LeaderboardResponse } from "../api";

const CROWNS = ["👑", "🥈", "🥉"];

// Oyuncunun gerçek profil fotoğrafı varsa onu göster, yoksa baş harflerine
// düş (bkz. TopBar/ProfilModal'daki aynı desen). Kalkanın deliği kare
// değil, foto object-fit:cover ile kutuyu dolduruyor -- çerçeve (::after)
// zaten üstüne binip taşan köşeleri gizliyor.
function LeaderboardAvatar({ entry }: { entry: LeaderboardEntry }) {
  return (
    <span className="leaderboard-podium-avatar">
      {entry.avatarData ? (
        <img src={entry.avatarData} alt="" className="leaderboard-podium-avatar-img" />
      ) : (
        entry.username.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

// İlk 3 sıra: referanstaki gibi (2.-1.-3. sırayla, 1. ortada ve büyük)
// taç + madalyon-avatarlı bir "podyum".
function LeaderboardPodium({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) return null;
  const order = [1, 0, 2].filter((i) => entries[i] !== undefined);
  return (
    <div className="leaderboard-podium">
      {order.map((i) => {
        const e = entries[i];
        const rank = i + 1;
        return (
          <div key={e.username} className={`leaderboard-podium-card leaderboard-podium-${rank}`}>
            <span className="leaderboard-podium-crown">{CROWNS[i]}</span>
            <LeaderboardAvatar entry={e} />
            <span className="leaderboard-podium-name">{e.username}</span>
            <span className="leaderboard-podium-value">{e.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function LeaderboardColumn({ title, entries }: { title: string; entries: LeaderboardEntry[] }) {
  const rest = entries.slice(3);
  return (
    <div className="leaderboard-column">
      <h3 className="leaderboard-heading">{title}</h3>
      {entries.length === 0 ? (
        <p className="hint">Henüz veri yok.</p>
      ) : (
        <>
          <LeaderboardPodium entries={entries.slice(0, 3)} />
          {rest.length > 0 && (
            <ol className="leaderboard-list" start={4}>
              {rest.map((e, i) => (
                <li key={`${title}-${e.username}-${i}`} className="leaderboard-row">
                  <span className="leaderboard-rank">#{i + 4}</span>
                  <span className="leaderboard-name">{e.username}</span>
                  <span className="leaderboard-value">{e.value}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

// Liderlik Panosu (en çok asker / en çok kale). Her açılışta en güncel
// sıralama çekiliyor.
export function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);

  useEffect(() => {
    fetchLeaderboard().then(setLeaderboard).catch(() => {});
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-screen modal-leaderboard" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🏆 Liderlik Panosu</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!leaderboard ? (
            <p className="hint">Yükleniyor…</p>
          ) : (
            <div className="leaderboard-sections">
              <LeaderboardColumn title="⚔️ En Çok Askere Sahip" entries={leaderboard.topTroops} />
              <LeaderboardColumn title="🏰 En Çok Kaleye Sahip" entries={leaderboard.topCastles} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
