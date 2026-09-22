import { useState } from "react";
import { login, register, type Session } from "../api";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (s: Session) => void }) {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const action = authMode === "login" ? login : register;
      const s = await action(usernameInput.trim(), passwordInput);
      onLoggedIn(s);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="login-screen">
      <h1 className="sr-only">Valerion</h1>
      <div className="login-card">
        <p className="subtitle">Timer'sız fetih dünyasına hoş geldin</p>
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
    </div>
  );
}
