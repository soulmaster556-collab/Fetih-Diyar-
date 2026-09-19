import { useEffect, useState } from "react";
import "./App.css";
import { fetchAdminSettings, updateAdminSettings, type SettingDef } from "./api";

const ADMIN_KEY_STORAGE = "fetih-diyari-admin-key";

export default function AdminPanel() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? "");
  const [keyInput, setKeyInput] = useState("");
  const [defs, setDefs] = useState<SettingDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function load(key: string) {
    setLoading(true);
    setError(null);
    fetchAdminSettings(key)
      .then((res) => {
        setDefs(res.defs);
        const asStrings: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.values)) asStrings[k] = String(v);
        setValues(asStrings);
        sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
        setAdminKey(key);
      })
      .catch((err) => {
        setError(err.message);
        setAdminKey("");
        sessionStorage.removeItem(ADMIN_KEY_STORAGE);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (adminKey) load(adminKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (keyInput.trim()) load(keyInput.trim());
  }

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

  if (!adminKey) {
    return (
      <div className="admin-login">
        <h1>Fetih Diyarı — Admin</h1>
        <form onSubmit={handleUnlock}>
          <input
            type="password"
            placeholder="Admin anahtarı"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <button type="submit" disabled={loading}>
            Giriş
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <header>
        <h1>Fetih Diyarı — Admin</h1>
        <a href="/">← Oyuna dön</a>
      </header>

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
