export interface Tile {
  id: number;
  x: number;
  y: number;
  ownerId: string | null;
  tileType: "NPC" | "PLAYER" | "EMPTY";
  level: number;
  goldPerHour: number;
  troopsPerHour: number;
  gold: number;
  troops: number;
}

export interface Session {
  playerId: string;
  username: string;
  token: string;
  startingTileId: number;
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

export function register(username: string) {
  return fetch(`${BASE}/players/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  }).then((r) => handle<Session>(r));
}

export function fetchMap() {
  return fetch(`${BASE}/tiles`).then((r) => handle<Tile[]>(r));
}

export function fetchMyTiles(token: string) {
  return fetch(`${BASE}/tiles/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<Tile[]>(r));
}

export function upgradeTile(token: string, tileId: number) {
  return fetch(`${BASE}/tiles/${tileId}/upgrade`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => handle<Tile>(r));
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
