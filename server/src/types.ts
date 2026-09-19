export interface Player {
  id: string;
  username: string;
  token: string;
  created_at: number;
  season_points: number;
}

export type TileType = "NPC" | "PLAYER" | "EMPTY";

export interface TileRow {
  id: number;
  x: number;
  y: number;
  owner_id: string | null;
  tile_type: TileType;
  level: number;
  gold_per_hour: number;
  troops_per_hour: number;
  stored_gold: number;
  stored_troops: number;
  last_collected_at: number;
}

export interface TileView extends TileRow {
  // stored_gold / stored_troops here are the *live* computed values,
  // not necessarily what's persisted in the DB row.
  owner_username?: string | null;
}
