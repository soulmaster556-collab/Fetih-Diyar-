import { Router } from "express";
import { pool } from "../db.js";
import { authenticate } from "./players.js";
import type { Player } from "../types.js";

export const guildsRouter = Router();

interface GuildRow {
  id: number;
  name: string;
  leader_id: string;
  created_at: number;
}

async function getMyGuildRow(playerId: string) {
  const { rows } = await pool.query<GuildRow>(
    `SELECT g.* FROM guilds g
     JOIN guild_members gm ON gm.guild_id = g.id
     WHERE gm.player_id = $1`,
    [playerId]
  );
  return rows[0] ?? null;
}

async function serializeGuild(guild: GuildRow) {
  const { rows: memberRows } = await pool.query<{ player_id: string; username: string; joined_at: number }>(
    `SELECT p.id as player_id, p.username, gm.joined_at
     FROM guild_members gm
     JOIN players p ON p.id = gm.player_id
     WHERE gm.guild_id = $1
     ORDER BY gm.joined_at ASC`,
    [guild.id]
  );
  return {
    id: guild.id,
    name: guild.name,
    leaderId: guild.leader_id,
    memberCount: memberRows.length,
    members: memberRows.map((m) => ({ playerId: m.player_id, username: m.username, joinedAt: m.joined_at })),
  };
}

// Herkese açık: lonca listesi (katılmak için gezinme).
guildsRouter.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query<GuildRow & { member_count: string; leader_username: string }>(
      `SELECT g.*, p.username as leader_username,
              (SELECT COUNT(*)::int FROM guild_members gm WHERE gm.guild_id = g.id) as member_count
       FROM guilds g
       JOIN players p ON p.id = g.leader_id
       ORDER BY g.created_at ASC`
    );
    res.json(
      rows.map((g) => ({
        id: g.id,
        name: g.name,
        leaderUsername: g.leader_username,
        memberCount: Number(g.member_count),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Kendi loncam + üye listesi (klan arkadaşlarına takviye gönderebilmek için
// istemcinin üye kimliklerini bilmesi gerekiyor).
guildsRouter.get("/me", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const guild = await getMyGuildRow(player.id);
    if (!guild) return res.json(null);
    res.json(await serializeGuild(guild));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

guildsRouter.post("/", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 3 || name.length > 24) {
      return res.status(400).json({ error: "Lonca adı 3-24 karakter olmalı." });
    }

    const existing = await getMyGuildRow(player.id);
    if (existing) return res.status(400).json({ error: "Zaten bir loncadasın. Önce ayrılmalısın." });

    const now = Date.now();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<GuildRow>(
        `INSERT INTO guilds (name, leader_id, created_at) VALUES ($1, $2, $3) RETURNING *`,
        [name, player.id, now]
      );
      const guild = rows[0];
      await client.query(
        `INSERT INTO guild_members (player_id, guild_id, joined_at) VALUES ($1, $2, $3)`,
        [player.id, guild.id, now]
      );
      await client.query("COMMIT");
      res.json(await serializeGuild(guild));
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Bu isimde bir lonca zaten var." });
    }
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

guildsRouter.post("/:id/join", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const guildId = Number(req.params.id);

    const existing = await getMyGuildRow(player.id);
    if (existing) return res.status(400).json({ error: "Zaten bir loncadasın. Önce ayrılmalısın." });

    const { rows } = await pool.query<GuildRow>("SELECT * FROM guilds WHERE id = $1", [guildId]);
    const guild = rows[0];
    if (!guild) return res.status(404).json({ error: "Lonca bulunamadı." });

    await pool.query(
      `INSERT INTO guild_members (player_id, guild_id, joined_at) VALUES ($1, $2, $3)`,
      [player.id, guild.id, Date.now()]
    );
    res.json(await serializeGuild(guild));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Lider ayrılırsa: başka üye varsa en eski üyeye liderlik devredilir, tek
// üye kendisiyse lonca tamamen silinir. Sıradan üye ayrılırsa sadece kendi
// üyeliği kalkar.
guildsRouter.post("/leave", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const guild = await getMyGuildRow(player.id);
    if (!guild) return res.status(400).json({ error: "Bir loncada değilsin." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (guild.leader_id === player.id) {
        const { rows: others } = await client.query<{ player_id: string }>(
          `SELECT player_id FROM guild_members WHERE guild_id = $1 AND player_id != $2 ORDER BY joined_at ASC LIMIT 1`,
          [guild.id, player.id]
        );
        if (others[0]) {
          await client.query("UPDATE guilds SET leader_id = $1 WHERE id = $2", [others[0].player_id, guild.id]);
          await client.query("DELETE FROM guild_members WHERE player_id = $1", [player.id]);
        } else {
          await client.query("DELETE FROM guild_members WHERE guild_id = $1", [guild.id]);
          await client.query("DELETE FROM guilds WHERE id = $1", [guild.id]);
        }
      } else {
        await client.query("DELETE FROM guild_members WHERE player_id = $1", [player.id]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});
