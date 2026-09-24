import { useEffect, useState } from "react";
import "./App.css";
import {
  fetchAdminSettings,
  updateAdminSettings,
  fetchAdminPlayers,
  fetchAdminPlayerDetail,
  setAdminPlayerGold,
  setAdminTileTroops,
  setAdminPlayerPassword,
  setAdminPlayerBanned,
  kickAdminPlayerFromGuild,
  deleteAdminPlayer,
  resetGame,
  type SettingDef,
  type AdminPlayerSummary,
  type AdminPlayerDetail,
} from "./api";

const ADMIN_KEY_STORAGE = "fetih-diyari-admin-key";
const PAGE_SIZE = 50;

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatNumber(n: number) {
  return Math.floor(n).toLocaleString("tr-TR");
}

// -----------------------------------------------------------------------
// Oyuncu detay/müdahale ekranı -- uygulamanın geri kalanındaki
// .modal-overlay/.modal-screen deseniyle (bkz. App.css) ayrı bir ekran.
// -----------------------------------------------------------------------
function PlayerDetailModal({
  adminKey,
  playerId,
  onClose,
  onChanged,
}: {
  adminKey: string;
  playerId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AdminPlayerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [goldInput, setGoldInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [tileTroopInputs, setTileTroopInputs] = useState<Record<number, string>>({});

  function load() {
    setLoading(true);
    setError(null);
    fetchAdminPlayerDetail(adminKey, playerId)
      .then((d) => {
        setDetail(d);
        setGoldInput(String(d.gold));
        const tt: Record<number, string> = {};
        for (const t of d.tiles) tt[t.id] = String(t.troops);
        setTileTroopInputs(tt);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  function runAction(key: string, action: () => Promise<unknown>, andRefreshList = true) {
    setBusy(key);
    setError(null);
    action()
      .then(() => {
        load();
        if (andRefreshList) onChanged();
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(null));
  }

  function handleSaveGold() {
    const value = Number(goldInput);
    if (!Number.isFinite(value) || value < 0) return setError("Geçersiz altın miktarı.");
    runAction("gold", () => setAdminPlayerGold(adminKey, playerId, value));
  }

  function handleSaveTroops(tileId: number) {
    const value = Number(tileTroopInputs[tileId]);
    if (!Number.isFinite(value) || value < 0) return setError("Geçersiz asker sayısı.");
    runAction(`troops-${tileId}`, () => setAdminTileTroops(adminKey, tileId, value), false);
  }

  function handleResetPassword() {
    if (passwordInput.length < 6) return setError("Şifre en az 6 karakter olmalı.");
    runAction("password", () => setAdminPlayerPassword(adminKey, playerId, passwordInput).then(() => setPasswordInput("")), false);
  }

  function handleToggleBan() {
    if (!detail) return;
    const next = !detail.banned;
    if (next && !window.confirm(`${detail.username} adlı oyuncuyu yasaklamak istediğine emin misin?`)) return;
    runAction("ban", () => setAdminPlayerBanned(adminKey, playerId, next));
  }

  function handleKickGuild() {
    if (!detail?.guild) return;
    if (!window.confirm(`${detail.username} adlı oyuncuyu "${detail.guild.name}" loncasından atmak istediğine emin misin?`)) return;
    runAction("kick-guild", () => kickAdminPlayerFromGuild(adminKey, playerId));
  }

  function handleDelete() {
    if (!detail) return;
    if (!window.confirm(`${detail.username} hesabını KALICI olarak silmek istediğine emin misin? Bu işlem geri alınamaz.`)) return;
    setBusy("delete");
    setError(null);
    deleteAdminPlayer(adminKey, playerId)
      .then(() => {
        onChanged();
        onClose();
      })
      .catch((err) => {
        setError(err.message);
        setBusy(null);
      });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-screen admin-detail-screen" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{detail ? detail.username : "Oyuncu"}{detail?.nickname ? ` (${detail.nickname})` : ""}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>

        <div className="modal-body admin-detail-body">
          {loading && <p className="hint">Yükleniyor…</p>}
          {error && <div className="banner error">{error}</div>}

          {detail && !loading && (
            <>
              {detail.banned && <div className="banner error admin-banned-banner">🚫 Bu hesap yasaklı.</div>}

              <div className="admin-stat-grid">
                <div className="admin-stat">
                  <span className="admin-stat-label">Kayıt tarihi</span>
                  <span className="admin-stat-value">{formatDate(detail.createdAt)}</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Sezon puanı</span>
                  <span className="admin-stat-value">{formatNumber(detail.seasonPoints)}</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Altın üretimi</span>
                  <span className="admin-stat-value admin-stat-gold">+{formatNumber(detail.goldPerHour)}/sa</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Asker üretimi</span>
                  <span className="admin-stat-value admin-stat-troops">+{formatNumber(detail.troopsPerHour)}/sa</span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Lonca</span>
                  <span className="admin-stat-value">
                    {detail.guild ? `${detail.guild.name}${detail.guild.isLeader ? " (lider)" : ""}` : "—"}
                  </span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Kale sayısı</span>
                  <span className="admin-stat-value">{detail.tiles.length}</span>
                </div>
              </div>

              <div className="admin-section">
                <h3>Müdahale</h3>
                <div className="admin-action-row">
                  <label>Altın (ortak havuz)</label>
                  <div className="admin-inline-form">
                    <input
                      type="number"
                      min={0}
                      value={goldInput}
                      onChange={(e) => setGoldInput(e.target.value)}
                    />
                    <button disabled={busy === "gold"} onClick={handleSaveGold}>
                      Kaydet
                    </button>
                  </div>
                </div>

                <div className="admin-action-row">
                  <label>Yeni şifre belirle</label>
                  <div className="admin-inline-form">
                    <input
                      type="text"
                      placeholder="En az 6 karakter"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                    />
                    <button disabled={busy === "password"} onClick={handleResetPassword}>
                      Sıfırla
                    </button>
                  </div>
                </div>

                <div className="admin-action-row">
                  <label>Lonca üyeliği</label>
                  <div className="admin-inline-form">
                    <button disabled={!detail.guild || busy === "kick-guild"} onClick={handleKickGuild}>
                      Loncadan At
                    </button>
                  </div>
                </div>

                <div className="admin-action-row admin-action-row-danger">
                  <label>Hesap durumu</label>
                  <div className="admin-inline-form">
                    <button
                      className={detail.banned ? "admin-btn-success" : "admin-btn-danger"}
                      disabled={busy === "ban"}
                      onClick={handleToggleBan}
                    >
                      {detail.banned ? "Yasağı Kaldır" : "Yasakla"}
                    </button>
                    <button className="admin-btn-danger" disabled={busy === "delete"} onClick={handleDelete}>
                      Hesabı Sil
                    </button>
                  </div>
                </div>
              </div>

              <div className="admin-section">
                <h3>Kaleler ({detail.tiles.length})</h3>
                {detail.tiles.length === 0 ? (
                  <p className="hint">Bu oyuncunun hiç kalesi yok.</p>
                ) : (
                  <>
                    <div className="admin-tiles-head">
                      <span>Konum</span>
                      <span>Seviye</span>
                      <span>Üretim/sa</span>
                      <span>Asker</span>
                      <span></span>
                    </div>
                    <ul className="admin-tiles-list">
                      {detail.tiles.map((t) => (
                        <li key={t.id} className="admin-tiles-row">
                          <span className="admin-tiles-coords">
                            {t.x}, {t.y} <small>ada #{t.islandId}</small>
                          </span>
                          <span className="admin-tiles-level">Lv{t.level}</span>
                          <span className="admin-tiles-prod">
                            🪙{formatNumber(t.goldPerHour)} ⚔️{formatNumber(t.troopsPerHour)}
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={tileTroopInputs[t.id] ?? ""}
                            onChange={(e) =>
                              setTileTroopInputs((v) => ({ ...v, [t.id]: e.target.value }))
                            }
                          />
                          <button
                            className="admin-tiles-save"
                            disabled={busy === `troops-${t.id}`}
                            onClick={() => handleSaveTroops(t.id)}
                          >
                            Kaydet
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Oyuncular sekmesi -- aranabilir/sayfalanabilir liste, satıra tıklayınca
// yukarıdaki detay/müdahale ekranı açılır.
// -----------------------------------------------------------------------
function PlayersTab({ adminKey }: { adminKey: string }) {
  const [players, setPlayers] = useState<AdminPlayerSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function load(q: string, off: number) {
    setLoading(true);
    setError(null);
    fetchAdminPlayers(adminKey, q, PAGE_SIZE, off)
      .then((res) => {
        setPlayers(res.players);
        setTotal(res.total);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(query, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    load(query, 0);
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div>
      <form className="admin-search" onSubmit={handleSearchSubmit}>
        <input
          type="text"
          placeholder="Kullanıcı adına göre ara…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit">Ara</button>
      </form>

      {error && <div className="banner error">{error}</div>}

      <div className="admin-players-head">
        <span>Kullanıcı</span>
        <span>Kayıt</span>
        <span>Altın</span>
        <span>Asker</span>
        <span>Kale</span>
        <span>Lonca</span>
        <span>Durum</span>
      </div>

      {loading ? (
        <p className="hint">Yükleniyor…</p>
      ) : players.length === 0 ? (
        <p className="hint">Kayıtlı oyuncu bulunamadı.</p>
      ) : (
        <ul className="admin-players-list">
          {players.map((p) => (
            <li
              key={p.id}
              className={`admin-players-row ${p.banned ? "admin-players-row-banned" : ""}`}
              onClick={() => setSelectedId(p.id)}
            >
              <span className="admin-players-username">
                {p.username}
                {p.nickname && <small className="admin-players-nickname"> ({p.nickname})</small>}
              </span>
              <span>{formatDate(p.createdAt)}</span>
              <span className="admin-stat-gold">{formatNumber(p.gold)}</span>
              <span className="admin-stat-troops">{formatNumber(p.troops)}</span>
              <span>{p.castles}</span>
              <span className="admin-players-guild">{p.guildName ?? "—"}</span>
              <span>
                {p.banned ? <span className="admin-badge admin-badge-danger">Yasaklı</span> : <span className="admin-badge admin-badge-ok">Aktif</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <div className="admin-pagination">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            ← Önceki
          </button>
          <span className="hint">
            {from}–{to} / {total}
          </span>
          <button disabled={to >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Sonraki →
          </button>
        </div>
      )}

      {selectedId && (
        <PlayerDetailModal
          adminKey={adminKey}
          playerId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => load(query, offset)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Ayarlar sekmesi -- eski (tek ekranlı) admin panelinin ayar düzenleyicisi,
// aynen korunuyor, sadece sekmeli yapının bir parçası.
// -----------------------------------------------------------------------
function SettingsTab({ adminKey }: { adminKey: string }) {
  const [defs, setDefs] = useState<SettingDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminSettings(adminKey)
      .then((res) => {
        setDefs(res.defs);
        const asStrings: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.values)) asStrings[k] = String(v);
        setValues(asStrings);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSave() {
    setStatus(null);
    setError(null);
    const parsed: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      const num = Number(v);
      if (!Number.isFinite(num)) {
        setError(`Geçersiz sayı: ${k}`);
        return;
      }
      parsed[k] = num;
    }
    updateAdminSettings(adminKey, parsed)
      .then(() => setStatus("Ayarlar kaydedildi."))
      .catch((err) => setError(err.message));
  }

  if (loading) return <p className="hint">Yükleniyor…</p>;

  return (
    <div>
      {error && <div className="banner error">{error}</div>}
      {status && <div className="banner success">{status}</div>}

      <div className="settings-list">
        {defs.map((def) => (
          <div key={def.key} className="setting-row">
            <div>
              <label htmlFor={def.key}>{def.label}</label>
              <p className="hint">{def.description}</p>
            </div>
            <input
              id={def.key}
              type="number"
              step="any"
              value={values[def.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [def.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <button onClick={handleSave}>Kaydet</button>
    </div>
  );
}

// -----------------------------------------------------------------------
// Tehlikeli Bölge -- tüm oyunu sıfırlama. Tek bir window.confirm'e (bkz.
// PlayerDetailModal'daki hesap silme) BİLEREK güvenilmiyor -- native tarayıcı
// dialog'u bu tür gömülü/otomatize edilmiş ortamlarda (ör. webview) sessizce
// engellenebiliyor ya da sayfayı asıl işlemden habersiz kilitleyebiliyor, ve
// bu işlem oyundaki HERKESİ sildiği için o riski almaya değmez. Bunun
// yerine tamamen uygulama-içi iki adım: (1) tam olarak "SIFIRLA" yazılmadan
// buton hiç aktif olmuyor, (2) buton tıklanınca ayrı bir "son kez onayla"
// adımına geçiliyor -- gerçek silme SADECE o ikinci adımdaki ayrı butona
// basılınca tetikleniyor.
// -----------------------------------------------------------------------
const RESET_CONFIRM_PHRASE = "SIFIRLA";

function DangerZoneTab({ adminKey }: { adminKey: string }) {
  const [confirmText, setConfirmText] = useState("");
  const [awaitingFinalConfirm, setAwaitingFinalConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleReset() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    resetGame(adminKey)
      .then(() => {
        setSuccess("Oyun sıfırlandı, harita yeniden üretildi.");
        setConfirmText("");
        setAwaitingFinalConfirm(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <div className="admin-section">
      <h3>⚠️ Oyunu Sıfırla</h3>
      <div className="banner error">
        Bu, TÜM oyuncu hesaplarını, kaleleri, loncaları, saldırı/takviye siparişlerini ve raporları
        kalıcı olarak siler, ardından haritayı sıfırdan yeniden üretir. Admin ayarları (Ayarlar
        sekmesi) bu işlemden etkilenmez. <strong>Geri alınamaz.</strong>
      </div>
      {error && <div className="banner error">{error}</div>}
      {success && <div className="banner success">{success}</div>}

      {!awaitingFinalConfirm ? (
        <div className="admin-action-row admin-action-row-danger">
          <label>Onaylamak için "{RESET_CONFIRM_PHRASE}" yaz</label>
          <div className="admin-inline-form">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={RESET_CONFIRM_PHRASE}
            />
            <button
              className="admin-btn-danger"
              disabled={confirmText !== RESET_CONFIRM_PHRASE}
              onClick={() => setAwaitingFinalConfirm(true)}
            >
              Oyunu Sıfırla
            </button>
          </div>
        </div>
      ) : (
        <div className="admin-action-row admin-action-row-danger">
          <label>Son kez soruyoruz -- gerçekten TÜMÜNÜ silmek istiyor musun?</label>
          <div className="admin-inline-form">
            <button disabled={busy} onClick={() => setAwaitingFinalConfirm(false)}>
              Vazgeç
            </button>
            <button className="admin-btn-danger" disabled={busy} onClick={handleReset}>
              {busy ? "Sıfırlanıyor…" : "Evet, Kalıcı Olarak Sıfırla"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Kök bileşen -- giriş ekranı + sekmeli (Ayarlar / Oyuncular) düzen, oyunun
// lacivert/altın arayüz diliyle (bkz. App.css .admin-*).
// -----------------------------------------------------------------------
export default function AdminPanel() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? "");
  const [keyInput, setKeyInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState<"players" | "settings" | "danger">("players");

  function tryUnlock(key: string) {
    setChecking(true);
    setLoginError(null);
    fetchAdminSettings(key)
      .then(() => {
        sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
        setAdminKey(key);
      })
      .catch((err) => {
        setLoginError(err.message);
        sessionStorage.removeItem(ADMIN_KEY_STORAGE);
      })
      .finally(() => setChecking(false));
  }

  useEffect(() => {
    if (adminKey) tryUnlock(adminKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (keyInput.trim()) tryUnlock(keyInput.trim());
  }

  function handleLogout() {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    setAdminKey("");
    setKeyInput("");
  }

  if (!adminKey) {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <h1>Valerion — Yönetim</h1>
          <form onSubmit={handleUnlock}>
            <input
              type="password"
              placeholder="Admin anahtarı"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button type="submit" disabled={checking}>
              Giriş
            </button>
          </form>
          {loginError && <p className="error">{loginError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <h1>Valerion — Yönetim</h1>
        <div className="admin-header-actions">
          <a href="/">← Oyuna dön</a>
          <button className="admin-logout" onClick={handleLogout}>
            Çıkış
          </button>
        </div>
      </header>

      <nav className="admin-tabs">
        <button className={tab === "players" ? "active" : ""} onClick={() => setTab("players")}>
          👥 Oyuncular
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          ⚙️ Ayarlar
        </button>
        <button className={tab === "danger" ? "active" : ""} onClick={() => setTab("danger")}>
          ⚠️ Tehlikeli Bölge
        </button>
      </nav>

      <div className="admin-content">
        {tab === "players" ? (
          <PlayersTab adminKey={adminKey} />
        ) : tab === "settings" ? (
          <SettingsTab adminKey={adminKey} />
        ) : (
          <DangerZoneTab adminKey={adminKey} />
        )}
      </div>
    </div>
  );
}
