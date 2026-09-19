import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  attackTile,
  fetchMap,
  login,
  register,
  upgradeTile,
  type Session,
  type Tile,
} from "./api";

const SESSION_KEY = "fetih-diyari-session";
const WORLD_SIZE = 80;
const CELL_SIZES = [8, 12, 16, 22, 28];
const DEFAULT_CELL_SIZE_INDEX = 2;
// 256px varyantı: küçük karolarda da netliğini korur, tek dosya olduğu için
// (aynı URL) tarayıcı sadece bir kez indirir, tüm şehir karolarında paylaşılır.
const CASTLE_ICON = "/buildings/Kale_Assest_256.png";
const CASTLE_ICON_MIN_CELL = 14;

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function tileColor(tile: Tile, myId: string | undefined) {
  if (tile.tileType === "NPC") return "#8d6e63";
  if (tile.tileType === "EMPTY") return "#dcd3c0";
  if (tile.ownerId === myId) return "#4caf50";
  return "#e53935";
}

function distance(a: Tile, b: Tile) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession());
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [attackFromId, setAttackFromId] = useState<number | null>(null);
  const [troopsToSend, setTroopsToSend] = useState(10);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cellSizeIndex, setCellSizeIndex] = useState(DEFAULT_CELL_SIZE_INDEX);
  const cellSize = CELL_SIZES[cellSizeIndex];

  const refresh = () => {
    fetchMap().then(setTiles).catch((e) => setError(e.message));
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  const myTiles = useMemo(
    () => tiles.filter((t) => t.ownerId === session?.playerId),
    [tiles, session]
  );

  const selectedTile = tiles.find((t) => t.id === selectedId) ?? null;

  // Every owned tile is a *candidate* attack origin — same-island targets
  // still need direct adjacency, but a different island only needs to be
  // within naval range, which the client doesn't know exactly. The server
  // is the source of truth; this list is sorted by distance so the most
  // plausible origins show up first.
  const attackCandidates = useMemo(() => {
    if (!selectedTile) return [];
    return myTiles
      .map((t) => ({ tile: t, dist: distance(t, selectedTile), sameIsland: t.islandId === selectedTile.islandId }))
      .sort((a, b) => a.dist - b.dist);
  }, [selectedTile, myTiles]);

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const action = authMode === "login" ? login : register;
      const s = await action(usernameInput.trim(), passwordInput);
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      setSession(s);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  async function handleUpgrade(tileId: number) {
    if (!session) return;
    setError(null);
    setMessage(null);
    try {
      await upgradeTile(session.token, tileId);
      setMessage("Şehir yükseltildi!");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAttack() {
    if (!session || !selectedTile || attackFromId === null) return;
    setError(null);
    setMessage(null);
    try {
      const result = await attackTile(session.token, selectedTile.id, attackFromId, troopsToSend);
      setMessage(
        result.result === "ATTACKER_WINS"
          ? `Zafer! Kare ele geçirildi. (Güç: ${Math.round(result.attackerPower)} vs ${Math.round(result.defenderPower)})`
          : `Saldırı püskürtüldü. (Güç: ${Math.round(result.attackerPower)} vs ${Math.round(result.defenderPower)})`
      );
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function goToTile(tileId: number) {
    setSelectedId(tileId);
    setAttackFromId(null);
    document
      .querySelector(`[data-tile-id="${tileId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  if (!session) {
    return (
      <div className="login-screen">
        <h1>Fetih Diyarı</h1>
        <p className="subtitle">Million Lords tarzı, timer'sız fetih prototipi</p>
        <div className="auth-tabs">
          <button
            className={authMode === "login" ? "active" : ""}
            onClick={() => { setAuthMode("login"); setError(null); }}
            type="button"
          >
            Giriş Yap
          </button>
          <button
            className={authMode === "register" ? "active" : ""}
            onClick={() => { setAuthMode("register"); setError(null); }}
            type="button"
          >
            Kayıt Ol
          </button>
        </div>
        <form onSubmit={handleAuthSubmit} className="login-form">
          <input
            placeholder="Kullanıcı adı"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            minLength={3}
            maxLength={20}
            required
          />
          <input
            type="password"
            placeholder="Şifre (en az 6 karakter)"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            minLength={6}
            required
          />
          <button type="submit">{authMode === "login" ? "Giriş Yap" : "Krallığını Kur"}</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="game-layout">
      <header className="topbar">
        <h1>Fetih Diyarı</h1>
        <div className="player-info">
          <span>{session.username}</span>
          <button onClick={handleLogout}>Çıkış</button>
        </div>
      </header>

      {message && <div className="banner success">{message}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="main-area">
        <div className="map-wrapper">
          <div className="map-toolbar">
            <button onClick={() => setCellSizeIndex((i) => Math.max(0, i - 1))} disabled={cellSizeIndex === 0}>
              − Uzaklaş
            </button>
            <button
              onClick={() => setCellSizeIndex((i) => Math.min(CELL_SIZES.length - 1, i + 1))}
              disabled={cellSizeIndex === CELL_SIZES.length - 1}
            >
              + Yakınlaş
            </button>
            {myTiles[0] && <button onClick={() => goToTile(myTiles[0].id)}>Krallığıma git</button>}
          </div>
          <div className="map-viewport">
            <div
              className="map-grid"
              style={{
                gridTemplateColumns: `repeat(${WORLD_SIZE}, ${cellSize}px)`,
                gridTemplateRows: `repeat(${WORLD_SIZE}, ${cellSize}px)`,
              }}
            >
              {tiles.map((tile) => {
                const showCastle = tile.tileType === "PLAYER" && cellSize >= CASTLE_ICON_MIN_CELL;
                const isMine = tile.ownerId === session.playerId;
                return (
                  <div
                    key={tile.id}
                    data-tile-id={tile.id}
                    className={`tile ${selectedId === tile.id ? "selected" : ""} ${showCastle ? "tile-city" : ""}`}
                    style={{
                      gridColumn: tile.x + 1,
                      gridRow: tile.y + 1,
                      width: cellSize,
                      height: cellSize,
                      backgroundColor: showCastle ? undefined : tileColor(tile, session.playerId),
                      backgroundImage: showCastle ? `url(${CASTLE_ICON})` : undefined,
                      borderColor: showCastle ? (isMine ? "#4caf50" : "#e53935") : "transparent",
                    }}
                    onClick={() => {
                      setSelectedId(tile.id);
                      setAttackFromId(null);
                      setMessage(null);
                      setError(null);
                    }}
                    title={`(${tile.x}, ${tile.y}) Lv${tile.level} — ada #${tile.islandId}`}
                  >
                    {!showCastle &&
                      tile.tileType === "PLAYER" &&
                      isMine &&
                      cellSize >= 16 &&
                      "★"}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="legend">
            <span><i style={{ background: "#4caf50" }} /> Senin şehrin</span>
            <span><i style={{ background: "#e53935" }} /> Düşman</span>
            <span><i style={{ background: "#8d6e63" }} /> NPC kampı</span>
            <span><i style={{ background: "#dcd3c0" }} /> Boş kare</span>
          </div>
        </div>

        <aside className="side-panel">
          <section>
            <h2>Krallığım</h2>
            <ul className="city-list">
              {myTiles.map((t) => (
                <li key={t.id}>
                  <div className="city-row">
                    <img src={CASTLE_ICON} alt="" className="city-icon" />
                    <div>
                      <div>
                        ({t.x},{t.y}) — Lv{t.level} — ada #{t.islandId}
                      </div>
                      <div className="stats">
                        🪙 {t.gold} &nbsp; ⚔️ {t.troops}
                      </div>
                    </div>
                  </div>
                  <div className="row-actions">
                    <button onClick={() => handleUpgrade(t.id)}>Yükselt</button>
                    <button onClick={() => goToTile(t.id)}>Haritada göster</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Seçili Kare</h2>
            {!selectedTile && <p className="hint">Haritadan bir kare seç.</p>}
            {selectedTile && (
              <div>
                <p>
                  ({selectedTile.x}, {selectedTile.y}) — {selectedTile.tileType} — Lv
                  {selectedTile.level} — ada #{selectedTile.islandId}
                </p>
                <p>🪙 {selectedTile.gold} &nbsp; ⚔️ {selectedTile.troops}</p>

                {selectedTile.ownerId !== session.playerId && (
                  <div className="attack-form">
                    {attackCandidates.length === 0 ? (
                      <p className="hint">Önce bir şehrin olmalı.</p>
                    ) : (
                      <>
                        <label>
                          Nereden saldırılsın:
                          <select
                            value={attackFromId ?? ""}
                            onChange={(e) => setAttackFromId(Number(e.target.value))}
                          >
                            <option value="" disabled>
                              Şehir seç
                            </option>
                            {attackCandidates.map(({ tile: t, dist, sameIsland }) => (
                              <option key={t.id} value={t.id}>
                                ({t.x},{t.y}) — {t.troops} asker — {sameIsland ? "aynı ada" : `${Math.round(dist)} mesafe (deniz aşımı)`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Gönderilecek asker:
                          <input
                            type="number"
                            min={1}
                            value={troopsToSend}
                            onChange={(e) => setTroopsToSend(Number(e.target.value))}
                          />
                        </label>
                        <button disabled={attackFromId === null} onClick={handleAttack}>
                          Saldır
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
