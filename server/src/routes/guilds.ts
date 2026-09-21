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
  flag_id: number;
}

// Eren: "10 adet lonca bayrağı ekle" -- geçerli bayrak kimliği 1-10, aralık
// dışı/eksik gelirse 1'e (varsayılan) düşülüyor.
const VALID_FLAG_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
function normalizeFlagId(value: unknown): number {
  const n = Number(value);
  return VALID_FLAG_IDS.has(n) ? n : 1;
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
  // Eren: "Lonca bölümünü geliştir oyuncu davet falan olsun" -- herhangi bir
  // üye kendi loncasının hâlâ bekleyen (kabul/red edilmemiş) davetlerini
  // görebilsin diye lonca detayına gömülü (aynı kişiyi iki kere davet etmeye
  // çalışınca da bu liste sayesinde "zaten davet edilmiş" fark edilebiliyor).
  const { rows: inviteRows } = await pool.query<{
    id: number;
    invited_username: string;
    invited_by_username: string;
    created_at: number;
  }>(
    `SELECT gi.id, p1.username as invited_username, p2.username as invited_by_username, gi.created_at
     FROM guild_invites gi
     JOIN players p1 ON p1.id = gi.invited_player_id
     JOIN players p2 ON p2.id = gi.invited_by_id
     WHERE gi.guild_id = $1
     ORDER BY gi.created_at DESC`,
    [guild.id]
  );
  return {
    id: guild.id,
    name: guild.name,
    leaderId: guild.leader_id,
    flagId: guild.flag_id,
    memberCount: memberRows.length,
    members: memberRows.map((m) => ({ playerId: m.player_id, username: m.username, joinedAt: m.joined_at })),
    pendingInvites: inviteRows.map((i) => ({
      id: i.id,
      invitedUsername: i.invited_username,
      invitedByUsername: i.invited_by_username,
      createdAt: i.created_at,
    })),
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
        flagId: g.flag_id,
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

    const flagId = normalizeFlagId(req.body?.flagId);
    const now = Date.now();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<GuildRow>(
        `INSERT INTO guilds (name, leader_id, created_at, flag_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        [name, player.id, now, flagId]
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

// -----------------------------------------------------------------------
// Davet sistemi -- Eren: "Lonca bölümünü geliştir oyuncu davet falan olsun".
// Herhangi bir üye (lider olması şart değil -- küçük/gündelik bir oyunda
// üyelerin de arkadaşını davet edebilmesi daha pratik) kullanıcı adıyla
// davet gönderebilir; davet edilen kişi kendi tarafında kabul/red eder.
// -----------------------------------------------------------------------

guildsRouter.post("/invite", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const username = String(req.body?.username ?? "").trim();
    if (!username) return res.status(400).json({ error: "Kullanıcı adı gerekli." });

    const guild = await getMyGuildRow(player.id);
    if (!guild) return res.status(400).json({ error: "Davet gönderebilmek için bir loncada olmalısın." });

    const { rows: targetRows } = await pool.query<{ id: string; username: string }>(
      "SELECT id, username FROM players WHERE username = $1",
      [username]
    );
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: "Bu kullanıcı adında bir oyuncu yok." });
    if (target.id === player.id) return res.status(400).json({ error: "Kendini davet edemezsin." });

    const targetGuild = await getMyGuildRow(target.id);
    if (targetGuild) return res.status(400).json({ error: `${target.username} zaten bir loncada.` });

    await pool.query(
      `INSERT INTO guild_invites (guild_id, invited_player_id, invited_by_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [guild.id, target.id, player.id, Date.now()]
    );
    res.json(await serializeGuild(guild));
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Bu oyuncu zaten davet edilmiş." });
    }
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Bana gelen, henüz cevaplamadığım davetler.
guildsRouter.get("/me/invites", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const { rows } = await pool.query<{
      id: number;
      guild_id: number;
      guild_name: string;
      invited_by_username: string;
      created_at: number;
    }>(
      `SELECT gi.id, gi.guild_id, g.name as guild_name, p.username as invited_by_username, gi.created_at
       FROM guild_invites gi
       JOIN guilds g ON g.id = gi.guild_id
       JOIN players p ON p.id = gi.invited_by_id
       WHERE gi.invited_player_id = $1
       ORDER BY gi.created_at DESC`,
      [player.id]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        guildId: r.guild_id,
        guildName: r.guild_name,
        invitedByUsername: r.invited_by_username,
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

guildsRouter.post("/invites/:id/accept", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const inviteId = Number(req.params.id);

    const existing = await getMyGuildRow(player.id);
    if (existing) return res.status(400).json({ error: "Zaten bir loncadasın. Önce ayrılmalısın." });

    const { rows } = await pool.query<{ id: number; guild_id: number; invited_player_id: string }>(
      "SELECT * FROM guild_invites WHERE id = $1",
      [inviteId]
    );
    const invite = rows[0];
    if (!invite) return res.status(404).json({ error: "Davet bulunamadı (belki geri çekilmiş)." });
    if (invite.invited_player_id !== player.id)
      return res.status(403).json({ error: "Bu davet sana ait değil." });

    const { rows: guildRows } = await pool.query<GuildRow>("SELECT * FROM guilds WHERE id = $1", [invite.guild_id]);
    const guild = guildRows[0];
    if (!guild) return res.status(404).json({ error: "Lonca artık mevcut değil." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO guild_members (player_id, guild_id, joined_at) VALUES ($1, $2, $3)`,
        [player.id, guild.id, Date.now()]
      );
      // Katılınca bekleyen TÜM davetlerin (başka loncalardan gelenler dahil)
      // artık bir anlamı yok -- tek bir loncada olunabildiği için hepsi temizlenir.
      await client.query("DELETE FROM guild_invites WHERE invited_player_id = $1", [player.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json(await serializeGuild(guild));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

guildsRouter.post("/invites/:id/decline", authenticate, async (req: any, res) => {
  try {
    const player = req.player as Player;
    const inviteId = Number(req.params.id);

    const { rows } = await pool.query<{ id: number; invited_player_id: string }>(
      "SELECT * FROM guild_invites WHERE id = $1",
      [inviteId]
    );
    const invite = rows[0];
    if (!invite) return res.status(404).json({ error: "Davet bulunamadı." });
    if (invite.invited_player_id !== player.id)
      return res.status(403).json({ error: "Bu davet sana ait değil." });

    await pool.query("DELETE FROM guild_invites WHERE id = $1", [inviteId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});
