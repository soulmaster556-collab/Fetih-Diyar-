import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  attackTile,
  fetchMap,
  register,
  upgradeTile,
  type Session,
  type Tile,
} from "./api";

const SESSION_KEY = "fetih-diyari-session";

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

function isAdjacent(a: Tile, b: Tile) {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && a.id !== b.id;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession());
  const [usernameInput, setUsernameInput] = useState("");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [attackFromId, setAttackFromId] = useState<number | null>(null);
  const [troopsToSend, setTroopsToSend] = useState(10);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const myAdjacentTiles = useMemo(() => {
    if (!selectedTile) return [];
    return myTiles.filter((mine) => isAdjacent(mine, selectedTile));
  }, [selectedTile, myTiles]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const s = await register(usernameInput.trim());
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

  if (!session) {
    return (
      <div className="login-screen">
        <h1>Fetih Diyarı</h1>
        <p className="subtitle">Million Lords tarzı, timer'sız fetih prototipi</p>
        <form onSubmit={handleRegister} className="login-form">
          <input
            placeholder="Kullanıcı adı seç"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            minLength={3}
            maxLength={20}
            required
          />
          <button type="submit">Krallığını Kur</button>
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
          <div className="map-grid">
            {tiles
              .slice()
              .sort((a, b) => a.y - b.y || a.x - b.x)
              .map((tile) => (
                <div
                  key={tile.id}
                  className={`tile ${selectedId === tile.id ? "selected" : ""}`}
                  style={{ backgroundColor: tileColor(tile, session.playerId) }}
                  onClick={() => {
                    setSelectedId(tile.id);
                    setAttackFromId(null);
                    setMessage(null);
                    setError(null);
                  }}
                  title={`(${tile.x}, ${tile.y}) Lv${tile.level}`}
                >
                  {tile.tileType === "PLAYER" && tile.ownerId === session.playerId && "★"}
                </div>
              ))}
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
                  <div>
                    ({t.x},{t.y}) — Lv{t.level}
                  </div>
                  <div className="stats">
                    🪙 {t.gold} &nbsp; ⚔️ {t.troops}
                  </div>
                  <button onClick={() => handleUpgrade(t.id)}>Yükselt</button>
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
                  {selectedTile.level}
                </p>
                <p>🪙 {selectedTile.gold} &nbsp; ⚔️ {selectedTile.troops}</p>

                {selectedTile.ownerId !== session.playerId && (
                  <div className="attack-form">
                    {myAdjacentTiles.length === 0 ? (
                      <p className="hint">
                        Buraya saldırmak için komşu bir kareye sahip olmalısın.
                      </p>
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
                            {myAdjacentTiles.map((t) => (
                              <option key={t.id} value={t.id}>
                                ({t.x},{t.y}) — {t.troops} asker
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
