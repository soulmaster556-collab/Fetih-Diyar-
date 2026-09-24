import { Router } from "express";
import { pool } from "../db.js";
import { authenticate } from "./players.js";
import type { Player } from "../types.js";

// ---------------------------------------------------------------------
// Sohbet -- Genel Chat / Lonca Chat
// ---------------------------------------------------------------------
// İki sabit kanal: "general" (herkese açık, guild_id her zaman NULL) ve
// "guild" (sadece isteği atan oyuncunun O ANKİ loncasına ait mesajlar,
// guild_id ile filtrelenir). Gerçek zamanlı bir websocket/pub-sub sistemi
// YOK -- projedeki diğer her şey gibi (bkz. reports/active-attacks) basit
// polling: istemci birkaç saniyede bir GET ile son mesajları çekiyor.
export const chatRouter = Router();

interface ChatRow {
  id: number;
  player_id: string;
  username: string;
  message: string;
  created_at: number;
}

const MAX_MESSAGE_LENGTH = 300;
const HISTORY_LIMIT = 50;

function serializeRow(r: ChatRow) {
  return {
    id: r.id,
    playerId: r.player_id,
    username: r.username,
    message: r.message,
    createdAt: Number(r.created_at),
  };
}

async function getMyGuildId(playerId: string): Promise<number | null> {
  const { rows } = await pool.query<{ guild_id: number }>(
    "SELECT guild_id FROM guild_members WHERE player_id = $1",
    [playerId]
  );
  return rows[0]?.guild_id ?? null;
}

// En yeni HISTORY_LIMIT mesaj, ama görüntüye eskiden-yeniye (kronolojik)
// sırayla dönüyor -- istemci hiçbir ek sıralama yapmadan direkt render edebilsin.
chatRouter.get("/general", authenticate, async (_req: any, res) => {
  try {
    const { rows } = await pool.query<ChatRow>(
      `SELECT id, player_id, username, message, created_at FROM chat_messages
       WHERE channel = 'general' ORDER BY created_at DESC LIMIT $1`,
      [HISTORY_LIMIT]
    );
    res.json(rows.reverse().map(serializeRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

chatRouter.post("/general", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Mesaj boş olamaz." });
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.` });
    }
    const username = player.nickname ?? player.username;
    const { rows } = await pool.query<ChatRow>(
      `INSERT INTO chat_messages (channel, guild_id, player_id, username, message, created_at)
       VALUES ('general', NULL, $1, $2, $3, $4)
       RETURNING id, player_id, username, message, created_at`,
      [player.id, username, message, Date.now()]
    );
    res.json(serializeRow(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Loncası olmayan bir oyuncu için hata DEĞİL, boş liste + guildId:null
// dönüyor -- istemci (ChatPanel.tsx) bunu "lonca yok" durumuna çeviriyor.
chatRouter.get("/guild", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const guildId = await getMyGuildId(player.id);
    if (!guildId) return res.json({ guildId: null, messages: [] });
    const { rows } = await pool.query<ChatRow>(
      `SELECT id, player_id, username, message, created_at FROM chat_messages
       WHERE channel = 'guild' AND guild_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [guildId, HISTORY_LIMIT]
    );
    res.json({ guildId, messages: rows.reverse().map(serializeRow) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

chatRouter.post("/guild", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const guildId = await getMyGuildId(player.id);
    if (!guildId) return res.status(400).json({ error: "Bir loncaya üye değilsiniz." });
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Mesaj boş olamaz." });
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.` });
    }
    const username = player.nickname ?? player.username;
    const { rows } = await pool.query<ChatRow>(
      `INSERT INTO chat_messages (channel, guild_id, player_id, username, message, created_at)
       VALUES ('guild', $1, $2, $3, $4, $5)
       RETURNING id, player_id, username, message, created_at`,
      [guildId, player.id, username, message, Date.now()]
    );
    res.json(serializeRow(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});
