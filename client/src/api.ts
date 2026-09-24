export interface ReinforcementInfo {
  id: number;
  fromPlayerId: string;
  fromUsername: string;
  troops: number;
}

export interface Tile {
  id: number;
  x: number;
  y: number;
  islandId: number;
  ownerId: string | null;
  // Kale sahibinin kullanıcı adı -- seviye gibi her zaman herkese açık
  // (yeni altıgen aksiyon menüsü banner'ında gösteriliyor). Boş kare/NPC
  // için her zaman null.
  ownerUsername: string | null;
  tileType: "NPC" | "PLAYER" | "EMPTY";
  // Seviye her zaman herkese açık (gözcü gerekmez).
  level: number;
  // Gözcü/casusluk sistemi: kendi/klan kaleleri için hep dolu (canlı), ama
  // düşman oyuncu ya da NPC kaleleri için `scoutTile` ile daha önce gözcü
  // gönderilmemişse bu üç alan `null` gelir (bkz. server tiles.ts
  // serializeTile). Dolu geldiğinde de -- kendi/klan hariç -- CANLI değil,
  // gözcünün gönderildiği andaki donmuş bilgidir (bkz. `scoutedAt`).
  goldPerHour: number | null;
  troopsPerHour: number | null;
  // Not: altın artık kale başına değil, krallık genelinde ortak bir havuzda
  // tutuluyor (bkz. PlayerSummary) — bu yüzden karo başına "gold" alanı yok.
  troops: number | null;
  // Klan arkadaşlarından gelen, sahiplenilemeyen (sadece savunma için)
  // takviye askerleri -- `troops` alanına dahil değil.
  reinforcementTroops: number;
  reinforcements: ReinforcementInfo[];
  // Görüntüleyenin bu kareye en son ne zaman gözcü gönderdiği (ms epoch),
  // yoksa null. Kendi/klan kalelerinde her zaman null (gözcüye gerek yok).
  scoutedAt: number | null;
  // Sahibinin kayıt olurken aldığı ilk ("merkez") kalesi mi -- true ise bu
  // kareye saldırı sunucu tarafından reddedilir (bkz. server tiles.ts POST
  // /:id/attack) ve haritada ayırt edici bir glow efekti gösterilir. NPC/boş
  // karolarda her zaman false.
  isCapital: boolean;
  // Sahibinin flaması -- kale üstünde büyük gösterilir (bkz. MapView.tsx
  // .iso-flags-layer). NPC/boş karolarda ya da sahipsizse null.
  ownerFlagShape: number | null;
  ownerFlagColor: number | null;
  ownerFlagLogo: number | null;
}

export interface PlayerSummary {
  gold: number;
  goldPerHour: number;
  troopsPerHour: number;
}

export interface Session {
  playerId: string;
  username: string;
  // Diğer oyunculara gösterilen takma ad -- henüz seçilmemişse null (yeni
  // kayıtta her zaman null). App.tsx bu null olduğu sürece NicknameModal'ı
  // zorunlu olarak açık tutar (bkz. o dosya).
  nickname: string | null;
  token: string;
  startingTileId?: number;
  // İlk ana kalenin koordinatları, hem register hem login cevabında gelir
  // (bkz. server routes/players.ts). Çok eski hesaplarda (home_tile_id
  // backfill'i öncesi, ya da kale hiç yoksa) null olabilir.
  homeX?: number | null;
  homeY?: number | null;
}

// In production (Render static site) this is baked in at build time via
// VITE_API_URL. In local dev it's left unset and falls back to the relative
// "/api" path, which Vite's dev server proxies to the local backend.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Bilinmeyen hata");
  return body as T;
}

export function register(username: string, password: string) {
  return fetch(`${BASE}/players/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).then((r) => handle<Session>(r));
}

export function login(username: string, password: string) {
  return fetch(`${BASE}/players/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).then((r) => handle<Session>(r));
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// bbox verilmezse tüm harita döner (küçük haritalarda/testte kullanışlı);
// büyük dünyada App.tsx her zaman görünen bölgenin bbox'unu gönderir.
// `token` verilirse (artık her zaman veriliyor) sunucu gözcü/klan
// görünürlüğünü buna göre uygular -- bkz. Tile arayüzündeki not.
export function fetchMap(bbox?: BoundingBox, token?: string) {
  const qs = bbox
    ? `?minX=${Math.floor(bbox.minX)}&maxX=${Math.ceil(bbox.maxX)}&minY=${Math.floor(bbox.minY)}&maxY=${Math.ceil(bbox.maxY)}`
    : "";
  return fetch(`${BASE}/tiles${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }).then((r) => handle<Tile[]>(r));
}

export function fetchMyTiles(token: string) {
  return fetch(`${BASE}/tiles/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<Tile[]>(r));
}

// Tek yerde: ortak altın havuzu + krallığın toplam altın/asker üretimi.
export function fetchPlayerSummary(token: string) {
  return fetch(`${BASE}/players/me/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<PlayerSummary>(r));
}

export function upgradeTile(token: string, tileId: number) {
  return fetch(`${BASE}/tiles/${tileId}/upgrade`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<Tile>(r));
}

export interface SettingDef {
  key: string;
  label: string;
  description: string;
  default: number;
}

export interface SettingsResponse {
  defs: SettingDef[];
  values: Record<string, number>;
}

export function fetchAdminSettings(adminKey: string) {
  return fetch(`${BASE}/admin/settings`, {
    headers: { "x-admin-key": adminKey },
  }).then((r) => handle<SettingsResponse>(r));
}

export function updateAdminSettings(adminKey: string, values: Record<string, number>) {
  return fetch(`${BASE}/admin/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
    body: JSON.stringify({ values }),
  }).then((r) => handle<{ values: Record<string, number> }>(r));
}

// Admin -- Oyuncular bölümü (bkz. server/src/routes/admin.ts).
export interface AdminPlayerSummary {
  id: string;
  username: string;
  nickname: string | null;
  createdAt: number;
  seasonPoints: number;
  banned: boolean;
  gold: number;
  goldPerHour: number;
  troops: number;
  troopsPerHour: number;
  castles: number;
  guildName: string | null;
}

export interface AdminPlayerTile {
  id: number;
  x: number;
  y: number;
  islandId: number;
  level: number;
  goldPerHour: number;
  troopsPerHour: number;
  troops: number;
}

export interface AdminPlayerDetail {
  id: string;
  username: string;
  nickname: string | null;
  createdAt: number;
  seasonPoints: number;
  banned: boolean;
  gold: number;
  goldPerHour: number;
  troopsPerHour: number;
  guild: { id: number; name: string; isLeader: boolean } | null;
  tiles: AdminPlayerTile[];
}

function adminHeaders(adminKey: string, withJson = false): Record<string, string> {
  const headers: Record<string, string> = { "x-admin-key": adminKey };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

export function fetchAdminPlayers(adminKey: string, q: string, limit = 50, offset = 0) {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  return fetch(`${BASE}/admin/players?${params.toString()}`, {
    headers: adminHeaders(adminKey),
  }).then((r) => handle<{ players: AdminPlayerSummary[]; total: number }>(r));
}

export function fetchAdminPlayerDetail(adminKey: string, playerId: string) {
  return fetch(`${BASE}/admin/players/${playerId}`, {
    headers: adminHeaders(adminKey),
  }).then((r) => handle<AdminPlayerDetail>(r));
}

export function setAdminPlayerGold(adminKey: string, playerId: string, gold: number) {
  return fetch(`${BASE}/admin/players/${playerId}/gold`, {
    method: "POST",
    headers: adminHeaders(adminKey, true),
    body: JSON.stringify({ gold }),
  }).then((r) => handle<{ ok: true }>(r));
}

export function setAdminTileTroops(adminKey: string, tileId: number, troops: number) {
  return fetch(`${BASE}/admin/tiles/${tileId}/troops`, {
    method: "POST",
    headers: adminHeaders(adminKey, true),
    body: JSON.stringify({ troops }),
  }).then((r) => handle<{ ok: true }>(r));
}

export function setAdminPlayerPassword(adminKey: string, playerId: string, password: string) {
  return fetch(`${BASE}/admin/players/${playerId}/password`, {
    method: "POST",
    headers: adminHeaders(adminKey, true),
    body: JSON.stringify({ password }),
  }).then((r) => handle<{ ok: true }>(r));
}

export function setAdminPlayerBanned(adminKey: string, playerId: string, banned: boolean) {
  return fetch(`${BASE}/admin/players/${playerId}/${banned ? "ban" : "unban"}`, {
    method: "POST",
    headers: adminHeaders(adminKey),
  }).then((r) => handle<{ ok: true }>(r));
}

export function kickAdminPlayerFromGuild(adminKey: string, playerId: string) {
  return fetch(`${BASE}/admin/players/${playerId}/kick-guild`, {
    method: "POST",
    headers: adminHeaders(adminKey),
  }).then((r) => handle<{ ok: true }>(r));
}

export function deleteAdminPlayer(adminKey: string, playerId: string) {
  return fetch(`${BASE}/admin/players/${playerId}`, {
    method: "DELETE",
    headers: adminHeaders(adminKey),
  }).then((r) => handle<{ ok: true }>(r));
}

// TÜM oyun verisini siler ve haritayı sıfırdan yeniden üretir -- GERİ
// ALINAMAZ (bkz. server routes/admin.ts POST /reset-game). AdminPanel.tsx
// çift onay istiyor.
export function resetGame(adminKey: string) {
  return fetch(`${BASE}/admin/reset-game`, {
    method: "POST",
    headers: adminHeaders(adminKey),
  }).then((r) => handle<{ ok: true }>(r));
}

// Saldırı anında sonuçlanmıyor, askerler yola çıkıyor (bkz. server
// game/attacks.ts) ve sonuç arrivesAt'te (raporlar üzerinden) geliyor. Bu
// yüzden cevap bir sonuç değil, bir "sipariş" (yolda giden ordu) bilgisi.
export interface AttackOrder {
  orderId: number;
  fromTileId: number;
  targetTileId: number;
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  troopsSent: number;
  departedAt: number;
  arrivesAt: number;
  // bkz. ActiveAttack üstündeki "saat farkı" (clock offset) yorumu.
  serverNow: number;
}

export function attackTile(
  token: string,
  targetTileId: number,
  fromTileId: number,
  troopsSent: number
) {
  return fetch(`${BASE}/tiles/${targetTileId}/attack`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromTileId, troopsSent }),
  }).then((r) => handle<AttackOrder>(r));
}

// Asker sayısı onaylanmadan ÖNCE tahmini seyahat süresini göstermek için
// (bkz. server tiles.ts GET /attack-eta). Sunucudaki formülle birebir aynı.
export function fetchAttackEta(token: string, fromTileId: number, targetTileId: number) {
  const params = new URLSearchParams({ fromTileId: String(fromTileId), targetTileId: String(targetTileId) });
  return fetch(`${BASE}/tiles/attack-eta?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<{ durationMs: number }>(r));
}

// Haritada gösterilecek, hâlâ yolda olan tüm saldırılar VE takviyeler (kendi
// + klanınki -- bkz. server routes/tiles.ts GET /attacks/active, artık
// attack_orders ∪ reinforcement_orders). Animasyonlu yolculuk hattı/flama
// marker'ı bu listeyle beslenir -- isim tarihsel nedenlerle "Attack" ama
// orderType alanıyla iki sipariş türü de ayırt edilebiliyor.
export interface ActiveAttack {
  id: number;
  orderType: "attack" | "reinforce";
  attackerId: string;
  attackerUsername: string;
  // Gönderenin flaması -- haritadaki marker artık kılıç ikonu yerine bunu
  // çiziyor (bkz. MapView.tsx, components/PlayerFlag.tsx).
  attackerFlagShape: number;
  attackerFlagColor: number;
  attackerFlagLogo: number;
  fromX: number;
  fromY: number;
  targetX: number;
  targetY: number;
  troopsSent: number;
  departedAt: number;
  arrivesAt: number;
  isMine: boolean;
}

// bkz. AttackOrder.serverNow yorumu -- istemci saatiyle sunucu saati arasında
// fark olabileceği (farklı makine/saat dilimi) için her "yolda olanlar"
// cevabı sunucunun kendi "şu an"ını da taşıyor.
export interface ActiveAttacksResponse {
  serverNow: number;
  attacks: ActiveAttack[];
}

export function fetchActiveAttacks(token: string) {
  return fetch(`${BASE}/tiles/attacks/active`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<ActiveAttacksResponse>(r));
}

// Asker takviyesi -- artık saldırı gibi anında değil, mesafeye bağlı bir
// yolculuk süresi sonunda hedefe ulaşıyor (bkz. server game/
// reinforcements.ts), bu yüzden cevap da AttackOrder ile aynı "yolda giden
// ordu" şeklini paylaşıyor. Hedef kendi kalenmiş gibi (askerler varışta
// doğrudan karışır) ya da bir klan arkadaşınınmış gibi (askerler ayrı,
// sadece savunma için, geri çağrılabilir -- bkz. recallReinforcement)
// çalışır.
export function reinforceTile(
  token: string,
  targetTileId: number,
  fromTileId: number,
  troopsSent: number
) {
  return fetch(`${BASE}/tiles/${targetTileId}/reinforce`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromTileId, troopsSent }),
  }).then((r) => handle<AttackOrder>(r));
}

// Bir klan arkadaşına gönderilmiş takviyeyi geri çağırır (sadece gönderen
// yapabilir) -- askerler gönderenin bir kalesine döner.
export function recallReinforcement(token: string, reinforcementId: number) {
  return fetch(`${BASE}/tiles/reinforcements/${reinforcementId}/recall`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<{ ok: true; returnedTo: number; troops: number }>(r));
}

// Gözcü/casusluk: hedef karenin o ANKİ (donmuş) bilgisini öğrenir --
// yeniden gönderene kadar bu bilgi güncellenmez (bkz. Tile arayüzündeki not).
export interface ScoutResult {
  ok: true;
  tileId: number;
  level: number;
  troops: number;
  goldPerHour: number;
  troopsPerHour: number;
  scoutedAt: number;
}

export function scoutTile(token: string, targetTileId: number, fromTileId: number, troopsSent: number) {
  return fetch(`${BASE}/tiles/${targetTileId}/scout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromTileId, troopsSent }),
  }).then((r) => handle<ScoutResult>(r));
}

export interface GuildMember {
  playerId: string;
  username: string;
  joinedAt: number;
}

// Lonca davetleri.
export interface GuildPendingInvite {
  id: number;
  invitedUsername: string;
  invitedByUsername: string;
  createdAt: number;
}

export interface Guild {
  id: number;
  name: string;
  leaderId: string;
  flagId: number;
  memberCount: number;
  members: GuildMember[];
  pendingInvites: GuildPendingInvite[];
}

export interface GuildListEntry {
  id: number;
  name: string;
  leaderUsername: string;
  memberCount: number;
  flagId: number;
}

export function listGuilds() {
  return fetch(`${BASE}/guilds`).then((r) => handle<GuildListEntry[]>(r));
}

export function fetchMyGuild(token: string) {
  return fetch(`${BASE}/guilds/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<Guild | null>(r));
}

// flagId (1-10) opsiyonel, verilmezse sunucu 1'i (varsayılan) kullanıyor.
export function createGuild(token: string, name: string, flagId?: number) {
  return fetch(`${BASE}/guilds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, flagId }),
  }).then((r) => handle<Guild>(r));
}

export function joinGuild(token: string, guildId: number) {
  return fetch(`${BASE}/guilds/${guildId}/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<Guild>(r));
}

export function leaveGuild(token: string) {
  return fetch(`${BASE}/guilds/leave`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<{ ok: true }>(r));
}

// Davet takma ada göre gönderilir -- oyuncular birbirinin login kullanıcı
// adını değil, oyun içi takma adını bilir (bkz. server routes/guilds.ts).
export function inviteToGuild(token: string, nickname: string) {
  return fetch(`${BASE}/guilds/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nickname }),
  }).then((r) => handle<Guild>(r));
}

// Bana (henüz bir loncada olmasam bile) gelmiş, cevaplanmamış davetler.
export interface ReceivedGuildInvite {
  id: number;
  guildId: number;
  guildName: string;
  invitedByUsername: string;
  createdAt: number;
}

export function fetchMyGuildInvites(token: string) {
  return fetch(`${BASE}/guilds/me/invites`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<ReceivedGuildInvite[]>(r));
}

export function acceptGuildInvite(token: string, inviteId: number) {
  return fetch(`${BASE}/guilds/invites/${inviteId}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<Guild>(r));
}

export function declineGuildInvite(token: string, inviteId: number) {
  return fetch(`${BASE}/guilds/invites/${inviteId}/decline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<{ ok: true }>(r));
}

// Liderlik Panosu: en çok asker / en çok kaleye sahip ilk 10 oyuncu.
// Herkese açık (giriş gerekmez).
export interface LeaderboardEntry {
  username: string;
  value: number;
}

export interface LeaderboardResponse {
  topTroops: LeaderboardEntry[];
  topCastles: LeaderboardEntry[];
}

export function fetchLeaderboard() {
  return fetch(`${BASE}/players/leaderboard`).then((r) => handle<LeaderboardResponse>(r));
}

// Mesaj/rapor kutusu -- saldırı sonuçları, gözcü raporları, gözetlendiğine
// dair bildirimler (bkz. server game/reports.ts).
export type ReportType =
  | "attack_won"
  | "attack_lost"
  | "defended_win"
  | "defended_loss"
  | "scout_sent"
  | "scouted_by";

export interface Report {
  id: number;
  type: ReportType;
  title: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export function fetchMyReports(token: string) {
  return fetch(`${BASE}/players/me/reports`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<Report[]>(r));
}

export function markReportsRead(token: string) {
  return fetch(`${BASE}/players/me/reports/read-all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<{ ok: true }>(r));
}

// Sohbet -- Genel Chat / Lonca Chat (bkz. server routes/chat.ts). Basit
// polling, websocket YOK -- ChatPanel.tsx birkaç saniyede bir GET ile son
// mesajları çekiyor (diğer her şeyle aynı desen, bkz. App.tsx refreshXxx).
export interface ChatMessage {
  id: number;
  playerId: string;
  username: string;
  message: string;
  createdAt: number;
}

export function fetchGeneralChat(token: string) {
  return fetch(`${BASE}/chat/general`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<ChatMessage[]>(r));
}

export function sendGeneralChat(token: string, message: string) {
  return fetch(`${BASE}/chat/general`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  }).then((r) => handle<ChatMessage>(r));
}

// Loncası olmayan oyuncu için `guildId: null` + boş liste döner (hata değil).
export function fetchGuildChat(token: string) {
  return fetch(`${BASE}/chat/guild`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<{ guildId: number | null; messages: ChatMessage[] }>(r));
}

export function sendGuildChat(token: string, message: string) {
  return fetch(`${BASE}/chat/guild`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  }).then((r) => handle<ChatMessage>(r));
}

// Oyuncu profili (avatar) -- üst menüdeki profil widget'ı bu ikisiyle
// besleniyor.
export interface MyProfile {
  playerId: string;
  username: string;
  nickname: string | null;
  avatarData: string | null;
  // Oyuncu flaması -- bkz. game/playerFlags.ts (şekil 1-10 / renk 1-20 / logo 1-20).
  flagShape: number;
  flagColor: number;
  flagLogo: number;
}

export function fetchMyProfile(token: string) {
  return fetch(`${BASE}/players/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<MyProfile>(r));
}

// Takma ad SADECE bir kere seçilebilir -- sunucu ikinci çağrıda 409 döner
// (bkz. server routes/players.ts). NicknameModal.tsx bunu ilk girişte zorunlu
// olarak çağırır.
export function setNickname(token: string, nickname: string) {
  return fetch(`${BASE}/players/me/nickname`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nickname }),
  }).then((r) => handle<{ ok: true; nickname: string }>(r));
}

// avatarData: "data:image/..." base64 -- null/"" gönderilirse avatar kaldırılır.
export function uploadAvatar(token: string, avatarData: string | null) {
  return fetch(`${BASE}/players/me/avatar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ avatarData }),
  }).then((r) => handle<{ ok: true; avatarData: string | null }>(r));
}

// Flama tasarım ekranından (bkz. components/PlayerFlagModal.tsx) kaydetme.
export function updatePlayerFlag(
  token: string,
  flag: { flagShape: number; flagColor: number; flagLogo: number }
) {
  return fetch(`${BASE}/players/me/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(flag),
  }).then((r) => handle<{ ok: true; flagShape: number; flagColor: number; flagLogo: number }>(r));
}
