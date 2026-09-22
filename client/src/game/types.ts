import type { Tile } from "../api";

// Yeni akış: önce KENDİ kalene tıklarsın -> küçük bir menü (Saldır /
// Destek Gönder / Gözcü Gönder) açılır -> sonra haritada HEDEFİ seçersin
// -> asker sayısı sorulur. `ActionMode` "hedef seçme" adımındayken aktif;
// geçerli bir hedefe tıklanınca `PendingTarget` dolar ve asker sayısı
// modalı açılır.
export type ActionType = "attack" | "reinforce" | "scout";

export type ActionMode = { type: ActionType; fromTile: Tile };

export type PendingTarget = {
  type: ActionType;
  fromTile: Tile;
  targetTile: Tile;
};

export type ScreenPos = { x: number; y: number };
