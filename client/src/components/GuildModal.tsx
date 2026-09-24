import { useEffect, useState } from "react";
import {
  acceptGuildInvite,
  createGuild,
  declineGuildInvite,
  inviteToGuild,
  joinGuild,
  leaveGuild,
  listGuilds,
  type Guild,
  type GuildListEntry,
  type ReceivedGuildInvite,
} from "../api";
import { GUILD_FLAG_DEFS } from "../game/guildFlags";
import { GuildFlag } from "./GuildFlag";

// Lonca paneli -- Liderlik/Raporlar ile aynı ortalanmış tam-ekran modal
// deseni (.modal-overlay/.modal-screen/.modal-header/.modal-body).
// Loncanın kendisi ve gelen davetler App'te tutuluyor (üst menü rozeti ve
// takviye hedef kontrolü için); form girdileri ve lonca listesi burada.
export function GuildModal({
  token,
  guild,
  receivedInvites,
  onGuildChange,
  onInvitesRefresh,
  setError,
  setMessage,
  onClose,
}: {
  token: string;
  guild: Guild | null;
  receivedInvites: ReceivedGuildInvite[];
  onGuildChange: (g: Guild | null) => void;
  onInvitesRefresh: () => void;
  setError: (msg: string | null) => void;
  setMessage: (msg: string | null) => void;
  onClose: () => void;
}) {
  const [availableGuilds, setAvailableGuilds] = useState<GuildListEntry[]>([]);
  const [guildNameInput, setGuildNameInput] = useState("");
  // Yeni lonca formunda seçilen bayrak, varsayılan 1.
  const [guildFlagInput, setGuildFlagInput] = useState(1);
  const [guildInviteUsername, setGuildInviteUsername] = useState("");

  useEffect(() => {
    if (!guild) listGuilds().then(setAvailableGuilds).catch(() => {});
    // Sadece açılışta -- lonca listesi, loncadan ayrılınca ayrıca tazeleniyor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInvitePlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!guildInviteUsername.trim()) return;
    setError(null);
    setMessage(null);
    const invited = guildInviteUsername.trim();
    try {
      const g = await inviteToGuild(token, invited);
      onGuildChange(g);
      setGuildInviteUsername("");
      setMessage(`${invited} loncaya davet edildi.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAcceptInvite(inviteId: number) {
    setError(null);
    setMessage(null);
    try {
      const g = await acceptGuildInvite(token, inviteId);
      onGuildChange(g);
      setMessage(`${g.name} loncasına katıldın!`);
      onInvitesRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeclineInvite(inviteId: number) {
    setError(null);
    try {
      await declineGuildInvite(token, inviteId);
      onInvitesRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateGuild(e: React.FormEvent) {
    e.preventDefault();
    if (!guildNameInput.trim()) return;
    setError(null);
    try {
      const g = await createGuild(token, guildNameInput.trim(), guildFlagInput);
      onGuildChange(g);
      setGuildNameInput("");
      setGuildFlagInput(1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleJoinGuild(guildId: number) {
    setError(null);
    try {
      const g = await joinGuild(token, guildId);
      onGuildChange(g);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleLeaveGuild() {
    setError(null);
    try {
      await leaveGuild(token);
      onGuildChange(null);
      listGuilds().then(setAvailableGuilds).catch(() => {});
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-screen modal-guild" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🛡️ Lonca</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {guild ? (
            <div>
              <p className="guild-header-row">
                <GuildFlag flagId={guild.flagId} size={36} />
                <span><strong>{guild.name}</strong> — {guild.memberCount} üye</span>
              </p>
              <ul className="city-list">
                {guild.members.map((m) => (
                  <li key={m.playerId}>
                    <div className="city-row">
                      <div>{m.username}{m.playerId === guild.leaderId ? " 👑" : ""}</div>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="hint guild-section-heading">Oyuncu davet et</p>
              <form onSubmit={handleInvitePlayer} className="guild-invite-form">
                <input
                  placeholder="Takma ad"
                  value={guildInviteUsername}
                  onChange={(e) => setGuildInviteUsername(e.target.value)}
                  minLength={3}
                  maxLength={20}
                />
                <button type="submit">Davet Et</button>
              </form>

              {guild.pendingInvites.length > 0 && (
                <>
                  <p className="hint guild-section-heading">Bekleyen davetler</p>
                  <ul className="city-list">
                    {guild.pendingInvites.map((inv) => (
                      <li key={inv.id}>
                        <div className="city-row">
                          <div>
                            <div>{inv.invitedUsername}</div>
                            <div className="stats">{inv.invitedByUsername} davet etti</div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <button onClick={handleLeaveGuild}>Loncadan Ayrıl</button>
            </div>
          ) : (
            <div>
              {receivedInvites.length > 0 && (
                <>
                  <p className="hint guild-section-heading">Sana gelen davetler</p>
                  <ul className="city-list">
                    {receivedInvites.map((inv) => (
                      <li key={inv.id}>
                        <div className="city-row">
                          <div>
                            <div>{inv.guildName}</div>
                            <div className="stats">{inv.invitedByUsername} davet etti</div>
                          </div>
                        </div>
                        <div className="row-actions">
                          <button onClick={() => handleAcceptInvite(inv.id)}>Kabul Et</button>
                          <button className="icon-btn" onClick={() => handleDeclineInvite(inv.id)}>Reddet</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <form onSubmit={handleCreateGuild} className="login-form">
                <input
                  placeholder="Yeni lonca adı"
                  value={guildNameInput}
                  onChange={(e) => setGuildNameInput(e.target.value)}
                  minLength={3}
                  maxLength={24}
                />
                {/* 10 bayrağın hepsi seçilebilir kartlar olarak listeleniyor,
                    seçili olan altın çerçeveyle vurgulanıyor. */}
                <p className="hint guild-section-heading">Lonca bayrağı seç</p>
                <div className="guild-flag-picker">
                  {GUILD_FLAG_DEFS.map((f) => (
                    <button
                      type="button"
                      key={f.id}
                      className={`guild-flag-option ${guildFlagInput === f.id ? "selected" : ""}`}
                      onClick={() => setGuildFlagInput(f.id)}
                      title={f.name}
                    >
                      <GuildFlag flagId={f.id} size={30} />
                    </button>
                  ))}
                </div>
                <button type="submit">Lonca Kur</button>
              </form>
              <p className="hint">Ya da mevcut bir loncaya katıl:</p>
              {availableGuilds.length === 0 && <p className="hint">Henüz hiç lonca yok.</p>}
              <ul className="city-list">
                {availableGuilds.map((g) => (
                  <li key={g.id}>
                    <div className="city-row">
                      <GuildFlag flagId={g.flagId} size={26} />
                      <div>
                        <div>{g.name}</div>
                        <div className="stats">👑 {g.leaderUsername} &nbsp; 👥 {g.memberCount}</div>
                      </div>
                    </div>
                    <div className="row-actions">
                      <button onClick={() => handleJoinGuild(g.id)}>Katıl</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
