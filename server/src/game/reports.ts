import { pool } from "../db.js";

// Mesaj/rapor kutusu: saldırı sonuçları, gözcü raporları ve gözetlendiğine
// dair bildirimler her oyuncunun kendi kutusuna düşer. Şimdilik hazır
// (Türkçe) başlık/metin ile tutuluyor -- ayrı bir yapılandırılmış şema
// yerine basit tutmak için bilerek böyle.
export type ReportType =
  | "attack_won"
  | "attack_lost"
  | "defended_win"
  | "defended_loss"
  | "scout_sent"
  | "scouted_by";

export interface ReportRow {
  id: number;
  type: ReportType;
  title: string;
  body: string;
  created_at: string | number;
  read_at: string | number | null;
}

export async function addReport(
  playerId: string,
  type: ReportType,
  title: string,
  body: string,
  createdAt: number = Date.now()
) {
  await pool.query(
    `INSERT INTO player_reports (player_id, type, title, body, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [playerId, type, title, body, createdAt]
  );
}
