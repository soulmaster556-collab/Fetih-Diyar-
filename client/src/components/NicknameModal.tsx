import { useState } from "react";
import { setNickname } from "../api";

// İlk girişte ZORUNLU takma ad seçimi -- App.tsx bunu `profile` yüklenip
// `profile.nickname` hâlâ null olduğu sürece render eder (bkz. orada).
// Diğer modallerin aksine (.modal-overlay/.modal-screen deseni aynı) burada
// BİLEREK bir `onClose`/✕ butonu YOK -- arka plana tıklamak da kapatmıyor,
// tek çıkış yolu başarılı bir onay (bkz. dosya başı görev tarifi: "onaylanınca
// otomatik kapanıcak").
export function NicknameModal({
  token,
  onConfirmed,
}: {
  token: string;
  onConfirmed: (nickname: string) => void;
}) {
  const [nicknameInput, setNicknameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nicknameInput.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await setNickname(token, trimmed);
      // Onaylanınca modal App.tsx'teki `profile.nickname` güncellemesiyle
      // (render koşulu artık false) otomatik kapanıyor -- burada ayrı bir
      // "kapat" çağrısına gerek yok.
      onConfirmed(result.nickname);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-screen modal-nickname" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>👑 Krallığına Bir İsim Ver</h2>
        </div>
        <div className="modal-body">
          <p className="hint">
            Bu, diğer oyunculara haritada, liderlik panosunda ve raporlarda görünecek takma
            adın/kale adın — giriş yaparken kullandığın kullanıcı adından farklı. Sadece bir kez
            seçebilirsin, sonra değiştirilemez.
          </p>
          <form onSubmit={handleSubmit} className="login-form">
            <input
              autoFocus
              placeholder="Örn. DemirKral"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              minLength={2}
              maxLength={20}
              required
              disabled={submitting}
            />
            <button type="submit" disabled={submitting || !nicknameInput.trim()}>
              {submitting ? "Kaydediliyor…" : "Onayla"}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
