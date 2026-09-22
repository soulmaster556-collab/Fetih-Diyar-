import { useEffect, useState } from "react";
import { fetchLeaderboard, type LeaderboardResponse } from "../api";

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
              <div className="leaderboard-column">
                <h3 className="leaderboard-heading">⚔️ En Çok Askere Sahip</h3>
                {leaderboard.topTroops.length === 0 && <p className="hint">Henüz veri yok.</p>}
                <ol className="leaderboard-list">
                  {leaderboard.topTroops.map((e, i) => (
                    <li key={`troops-${e.username}-${i}`} className={`leaderboard-row ${i < 3 ? `leaderboard-top leaderboard-top-${i + 1}` : ""}`}>
                      <span className="leaderboard-rank">#{i + 1}</span>
                      <span className="leaderboard-name">{e.username}</span>
                      <span className="leaderboard-value">{e.value}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="leaderboard-column">
                <h3 className="leaderboard-heading">🏰 En Çok Kaleye Sahip</h3>
                {leaderboard.topCastles.length === 0 && <p className="hint">Henüz veri yok.</p>}
                <ol className="leaderboard-list">
                  {leaderboard.topCastles.map((e, i) => (
                    <li key={`castles-${e.username}-${i}`} className={`leaderboard-row ${i < 3 ? `leaderboard-top leaderboard-top-${i + 1}` : ""}`}>
                      <span className="leaderboard-rank">#{i + 1}</span>
                      <span className="leaderboard-name">{e.username}</span>
                      <span className="leaderboard-value">{e.value}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
