import { useMemo, useState } from "react";
import type { Report } from "../api";
import { timeAgo } from "../game/utils";

// Mesaj/rapor kutusu -- saldırı sonuçları, gözcü raporları, gözetlenme
// bildirimleri. Raporların kendisi App'te tutuluyor (okunmamış rozeti
// için), burada sadece tür filtresi.
export function ReportsModal({ reports, onClose }: { reports: Report[]; onClose: () => void }) {
  const [reportFilter, setReportFilter] = useState<"all" | "attack" | "scout">("all");

  const filteredReports = useMemo(() => {
    if (reportFilter === "all") return reports;
    if (reportFilter === "attack") {
      return reports.filter((r) => r.type === "attack_won" || r.type === "attack_lost" || r.type === "defended_win" || r.type === "defended_loss");
    }
    return reports.filter((r) => r.type === "scout_sent" || r.type === "scouted_by");
  }, [reports, reportFilter]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-screen modal-reports" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📨 Mesaj &amp; Raporlar</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="filter-chip-row">
            <button className={`filter-chip ${reportFilter === "all" ? "active" : ""}`} onClick={() => setReportFilter("all")}>
              Tümü
            </button>
            <button className={`filter-chip ${reportFilter === "attack" ? "active" : ""}`} onClick={() => setReportFilter("attack")}>
              ⚔️ Savaş
            </button>
            <button className={`filter-chip ${reportFilter === "scout" ? "active" : ""}`} onClick={() => setReportFilter("scout")}>
              🔭 Gözcü
            </button>
          </div>
          {filteredReports.length === 0 && <p className="hint">Bu filtrede henüz bir mesaj yok.</p>}
          <ul className="report-list">
            {filteredReports.map((r) => (
              <li key={r.id} className={`report-row report-${r.type}`}>
                <div className="report-row-header">
                  <span className="report-title">{r.title}</span>
                  <span className="report-time">{timeAgo(r.createdAt)}</span>
                </div>
                <p className="report-body">{r.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
