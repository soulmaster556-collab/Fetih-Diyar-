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
}

export interface PlayerSummary {
  gold: number;
  goldPerHour: number;
  troopsPerHour: number;
}

export interface Session {
  playerId: string;
  username: string;
  token: string;
  startingTileId?: number;
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
  }).then((r) => handle<{ result: string; attackerPower: number; defenderPower: number }>(r));
}

// Asker takviyesi -- hedef kendi kalenmiş gibi (askerler doğrudan
// karışır) ya da bir klan arkadaşınınmış gibi (askerler ayrı, sadece
// savunma için, geri çağrılabilir -- bkz. recallReinforcement) çalışır.
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
  }).then((r) => handle<Tile>(r));
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

export interface Guild {
  id: number;
  name: string;
  leaderId: string;
  memberCount: number;
  members: GuildMember[];
}

export interface GuildListEntry {
  id: number;
  name: string;
  leaderUsername: string;
  memberCount: number;
}

export function listGuilds() {
  return fetch(`${BASE}/guilds`).then((r) => handle<GuildListEntry[]>(r));
}

export function fetchMyGuild(token: string) {
  return fetch(`${BASE}/guilds/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<Guild | null>(r));
}

export function createGuild(token: string, name: string) {
  return fetch(`${BASE}/guilds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
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
