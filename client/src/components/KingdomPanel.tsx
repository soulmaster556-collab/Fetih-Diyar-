import { useMemo, useState } from "react";
import type { Tile } from "../api";

type KingdomSort = "level" | "troops" | "gold" | "coords";

// "Krallığım" şehir listesi -- üst menüdeki butona basınca açılan/kapanan
// yüzen bir açılır liste. Oyuncu yüzlerce kaleye sahip olabileceği için
// arama, sıralama ve sayfalama (hepsini birden render etmemek için) var.
export function KingdomPanel({
  myTiles,
  onClose,
  onUpgrade,
  onGoTo,
}: {
  myTiles: Tile[];
  onClose: () => void;
  onUpgrade: (tileId: number) => void;
  onGoTo: (tile: Tile) => void;
}) {
  const [kingdomSearch, setKingdomSearch] = useState("");
  const [kingdomSort, setKingdomSort] = useState<KingdomSort>("level");
  // Arama/sıralama değişince sayfalama başa sarılıyor (bkz. onChange'ler)
  // -- aksi halde yeni bir filtrede eski sayfa konumunda kalır.
  const [kingdomVisibleCount, setKingdomVisibleCount] = useState(25);


  // Arama + sıralama uygulanmış hâli -- tam liste yerine filtrelenip
  // sıralanmış, sonra sayfa sayfa gösterilen bir liste.
  const filteredSortedMyTiles = useMemo(() => {
    const q = kingdomSearch.trim().toLowerCase();
    let list = myTiles;
    if (q) {
      list = list.filter((t) => {
        const haystack = `(${t.x}, ${t.y}) ada #${t.islandId} lv${t.level} seviye ${t.level}`.toLowerCase();
        return haystack.includes(q);
      });
    }
    const sorted = [...list];
    switch (kingdomSort) {
      case "level":
        sorted.sort((a, b) => b.level - a.level);
        break;
      case "troops":
        sorted.sort((a, b) => (b.troops ?? 0) - (a.troops ?? 0));
        break;
      case "gold":
        sorted.sort((a, b) => (b.goldPerHour ?? 0) - (a.goldPerHour ?? 0));
        break;
      case "coords":
        sorted.sort((a, b) => a.x - b.x || a.y - b.y);
        break;
    }
    return sorted;
  }, [myTiles, kingdomSearch, kingdomSort]);

  return (
    <div className="kingdom-dropdown kingdom-dropdown-wide">
      <div className="tile-card-header">
        <h2>Krallığım ({myTiles.length})</h2>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>
      {myTiles.length === 0 ? (
        <p className="hint">Henüz bir şehrin yok.</p>
      ) : (
        <>
          <div className="kingdom-toolbar">
            <input
              className="kingdom-search"
              placeholder="Ara: koordinat, ada veya seviye…"
              value={kingdomSearch}
              onChange={(e) => {
                setKingdomSearch(e.target.value);
                setKingdomVisibleCount(25);
              }}
            />
            <select
              className="kingdom-sort"
              value={kingdomSort}
              onChange={(e) => {
                setKingdomSort(e.target.value as KingdomSort);
                setKingdomVisibleCount(25);
              }}
            >
              <option value="level">Seviyeye göre</option>
              <option value="troops">Askere göre</option>
              <option value="gold">Altına göre</option>
              <option value="coords">Konuma göre</option>
            </select>
          </div>

          {filteredSortedMyTiles.length === 0 ? (
            <p className="hint">Aramayla eşleşen kale yok.</p>
          ) : (
            <>
              <div className="kingdom-table-head">
                <span>Kale</span>
                <span>Lv</span>
                <span>⚔️</span>
                <span>🪙/sa</span>
                <span></span>
              </div>
              <ul className="kingdom-table">
                {filteredSortedMyTiles.slice(0, kingdomVisibleCount).map((t) => (
                  <li key={t.id} className="kingdom-table-row">
                    <span className="kingdom-table-coords">
                      ({t.x}, {t.y}) <small>Ada #{t.islandId}</small>
                    </span>
                    <span className="kingdom-table-level">Lv{t.level}</span>
                    <span className="kingdom-table-troops">{t.troops}</span>
                    <span className="kingdom-table-gold">+{t.goldPerHour}</span>
                    <span className="kingdom-table-actions">
                      <button className="icon-btn" onClick={() => onUpgrade(t.id)} title="Yükselt">⬆️</button>
                      <button className="icon-btn" onClick={() => onGoTo(t)} title="Haritada göster">🗺️</button>
                    </span>
                  </li>
                ))}
              </ul>
              {filteredSortedMyTiles.length > kingdomVisibleCount && (
                <button
                  className="kingdom-load-more"
                  onClick={() => setKingdomVisibleCount((v) => v + 25)}
                >
                  Daha Fazla Göster ({filteredSortedMyTiles.length - kingdomVisibleCount} kale kaldı)
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
