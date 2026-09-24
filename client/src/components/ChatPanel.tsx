import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../api";

type ChatTab = "general" | "guild";

// Oyuncu bazlı tercihler -- oturumlar arası kalıcı olsun diye localStorage
// (bkz. SESSION_KEY deseni, game/constants.ts), ama panel-özel ayarlar
// olduğu için oraya değil buraya (App.tsx'e taşımaya gerek yok).
const AUTO_OPEN_KEY = "fetih-diyari-chat-auto-open";
const LINES_KEY = "fetih-diyari-chat-lines";

// Mesaj listesinin yüksekliği artık piksel yerine "satır sayısı" cinsinden
// -- kullanıcı 3 (min) ile 10 (max) satır arasında ayarlayabiliyor (bkz.
// aşağıdaki ayarlar popover'ı), varsayılan tabanın (3) 1 fazlası (4).
// LINE_PX .chat-panel-message'ın gerçek satır yüksekliğiyle (font-size
// 12.5px * line-height 1.4) eşleşiyor, PADDING_PX .chat-panel-messages'ın
// dikey padding'i (8px üst + 8px alt, bkz. App.css).
const MIN_LINES = 3;
const MAX_LINES = 10;
const DEFAULT_LINES = MIN_LINES + 1;
const LINE_PX = 18;
const MESSAGES_PADDING_PX = 16;

// Ekranın sol alt köşesinde sabit duran, harita etkileşimini engellemeyen
// (pointer-events sadece panelin kendi kutusunda aktif) küçük bir sohbet
// widget'ı. İki sabit kanal: Genel Chat (herkes) / Lonca Chat (sadece aynı
// loncanın üyeleri). Gerçek zamanlı websocket YOK -- App.tsx projedeki her
// şeyle aynı desende (bkz. refreshReports vb.) birkaç saniyede bir polling
// yapıyor, bu bileşen sadece o veriyi gösterip gönderme aksiyonunu tetikliyor.
export function ChatPanel({
  generalMessages,
  guildMessages,
  hasGuild,
  playerId,
  onSendGeneral,
  onSendGuild,
}: {
  generalMessages: ChatMessage[];
  guildMessages: ChatMessage[];
  hasGuild: boolean;
  playerId: string;
  onSendGeneral: (message: string) => void;
  onSendGuild: (message: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<ChatTab>("general");
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(() => {
    try {
      return localStorage.getItem(AUTO_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [lines, setLines] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(LINES_KEY));
      if (Number.isFinite(stored) && stored >= MIN_LINES && stored <= MAX_LINES) return stored;
    } catch {
      // localStorage kapalıysa varsayılana düş.
    }
    return DEFAULT_LINES;
  });
  const listRef = useRef<HTMLDivElement>(null);

  const messages = tab === "general" ? generalMessages : guildMessages;

  // Yeni mesaj gelince (ya da sekme değişince) her zaman en alta kaydır --
  // sohbet penceresinde "yukarıda kal" beklenmiyor, her zaman en son mesaj
  // görünsün isteniyor.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tab, collapsed]);

  // Yeni mesaj geldiğinde (kendi yazdığı değil -- polling'den) panel
  // otomatik açılsın isteniyor, ama oyuncu bu davranışı kapatabilsin diye
  // `autoOpen` tercihi de kontrol ediliyor. İlk mount'taki mesaj yüklemesini
  // (0 -> N) "yeni mesaj" saymamak için ilk çalıştırma sadece referansı
  // kaydediyor, açma tetiklemiyor.
  const prevTotalRef = useRef<number | null>(null);
  useEffect(() => {
    const total = generalMessages.length + guildMessages.length;
    if (prevTotalRef.current === null) {
      prevTotalRef.current = total;
      return;
    }
    if (total > prevTotalRef.current && autoOpen) {
      setCollapsed(false);
    }
    prevTotalRef.current = total;
  }, [generalMessages.length, guildMessages.length, autoOpen]);

  function toggleAutoOpen() {
    setAutoOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_OPEN_KEY, next ? "1" : "0");
      } catch {
        // localStorage kapalıysa (gizli sekme vb.) tercih sadece bu oturum
        // için geçerli olur, sorun değil.
      }
      return next;
    });
  }

  function changeLines(delta: number) {
    setLines((prev) => {
      const next = Math.min(MAX_LINES, Math.max(MIN_LINES, prev + delta));
      try {
        localStorage.setItem(LINES_KEY, String(next));
      } catch {
        // localStorage kapalıysa (gizli sekme vb.) tercih sadece bu oturum
        // için geçerli olur, sorun değil.
      }
      return next;
    });
  }

  function submit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (tab === "general") onSendGeneral(trimmed);
    else onSendGuild(trimmed);
    setDraft("");
  }

  return (
    <div className={`chat-panel ${collapsed ? "chat-panel-collapsed" : ""}`}>
      <div className="chat-panel-header">
        {/* Açma/kapama TEK kontrol -- kullanıcı isteğiyle sekmeler/zil
            sağa taşındı, solda sadece bu kalıyor. */}
        <button
          className="chat-panel-collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Sohbeti aç" : "Sohbeti küçült"}
        >
          {collapsed ? "▲" : "▼"} Sohbet
        </button>
        <div className="chat-panel-header-right">
          <div className="chat-panel-tabs">
            <button
              className={`chat-panel-tab ${tab === "general" ? "active" : ""}`}
              onClick={() => setTab("general")}
            >
              💬 Genel
            </button>
            <button
              className={`chat-panel-tab ${tab === "guild" ? "active" : ""}`}
              onClick={() => setTab("guild")}
              disabled={!hasGuild}
              title={hasGuild ? undefined : "Bir loncaya üye değilsiniz"}
            >
              🛡️ Lonca
            </button>
          </div>
          <div className="chat-panel-settings">
            <button
              className="chat-panel-settings-btn"
              onClick={() => setSettingsOpen((o) => !o)}
              title="Sohbet ayarları"
            >
              ⚙️
            </button>
            {settingsOpen && (
              <div className="chat-panel-settings-popover">
                <button
                  className={`chat-panel-autoopen-btn ${autoOpen ? "active" : ""}`}
                  onClick={toggleAutoOpen}
                >
                  {autoOpen ? "🔔" : "🔕"} Yeni mesajda otomatik aç
                </button>
                <div className="chat-panel-lines-row">
                  <span>Satır sayısı</span>
                  <div className="chat-panel-lines-stepper">
                    <button onClick={() => changeLines(-1)} disabled={lines <= MIN_LINES}>
                      −
                    </button>
                    <span>{lines}</span>
                    <button onClick={() => changeLines(1)} disabled={lines >= MAX_LINES}>
                      +
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {!collapsed && (
        <>
          <div
            className="chat-panel-messages"
            ref={listRef}
            style={{ height: lines * LINE_PX + MESSAGES_PADDING_PX }}
          >
            {tab === "guild" && !hasGuild ? (
              <p className="chat-panel-empty-hint">Lonca sohbeti için önce bir loncaya katılman gerekiyor.</p>
            ) : messages.length === 0 ? (
              <p className="chat-panel-empty-hint">Henüz mesaj yok -- ilk mesajı sen yaz.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`chat-panel-message ${m.playerId === playerId ? "chat-panel-message-mine" : ""}`}>
                  <span className="chat-panel-message-author">{m.username}</span>
                  <span className="chat-panel-message-text">{m.message}</span>
                </div>
              ))
            )}
          </div>
          <div className="chat-panel-input-row">
            <input
              type="text"
              value={draft}
              maxLength={300}
              placeholder={tab === "guild" && !hasGuild ? "Lonca yok" : "Mesaj yaz…"}
              disabled={tab === "guild" && !hasGuild}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button
              className="chat-panel-send-btn"
              disabled={!draft.trim() || (tab === "guild" && !hasGuild)}
              onClick={submit}
            >
              Gönder
            </button>
          </div>
        </>
      )}
    </div>
  );
}
