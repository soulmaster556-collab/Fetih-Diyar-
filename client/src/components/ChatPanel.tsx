import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../api";

type ChatTab = "general" | "guild";

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
  const listRef = useRef<HTMLDivElement>(null);

  const messages = tab === "general" ? generalMessages : guildMessages;

  // Yeni mesaj gelince (ya da sekme değişince) her zaman en alta kaydır --
  // sohbet penceresinde "yukarıda kal" beklenmiyor, her zaman en son mesaj
  // görünsün isteniyor.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tab, collapsed]);

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
        <button
          className="chat-panel-collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Sohbeti aç" : "Sohbeti küçült"}
        >
          {collapsed ? "▲" : "▼"}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="chat-panel-messages" ref={listRef}>
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
