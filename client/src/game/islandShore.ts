import type { Tile } from "../api";
import { chaikinSmooth, closedPathD, traceBoundaryLoops, type TerritoryPoint } from "./territory";

// ---------------------------------------------------------------------
// Ada kıyı şeridi -- deniz + kumsal render'ı (bkz. kullanıcı isteği:
// "çoklu ada" + "gerçek deniz" + "kumsalda asla kale")
// ---------------------------------------------------------------------
// territory.ts'teki AYNI hex-sınır-çıkarma (traceBoundaryLoops) ve
// Chaikin-yumuşatma tekniğini "sahiplik" yerine "yüklü tiles penceresinde
// bu karo var mı" sorusuna uyguluyor -- her `tiles` satırı zaten KARA demek
// (bkz. server/mapgen.ts ensureMapGenerated, deniz için hiç satır
// üretilmiyor), o yüzden tüm yüklü karoları TEK bir "land" kümesi olarak
// traceBoundaryLoops'a veriyoruz. Sonuç: görünen pencerede kaç ayrı ada
// (ya da bir adanın kaç parçası) varsa o kadar kapalı loop -- birden çok
// ada aynı SVG clip-path/stroke'unda birleşik olarak render edilebiliyor.
export function computeIslandShoreLoops(tiles: Tile[]): TerritoryPoint[][] {
  const memberSet = new Set<string>();
  for (const t of tiles) memberSet.add(`${t.x},${t.y}`);
  return traceBoundaryLoops(memberSet);
}

const CHAIKIN_ITERATIONS = 2;

// Tüm loop'ları TEK bir (çoklu alt-path'li) SVG path string'ine çeviriyor --
// hem CSS clip-path (grass'ı ada şekline kırpmak için) hem de stroke tabanlı
// kumsal bandı (aşağısı) AYNI path'i kullanıyor, ikisi arasında asla sapma
// olamaz (göldeki eski daire-vs-çokgen hatasından ders, bkz. sohbet geçmişi).
export function buildIslandShorePathD(loops: TerritoryPoint[][], tileWidth: number): string {
  return loops
    .map((loop) => {
      const smoothed = chaikinSmooth(loop, CHAIKIN_ITERATIONS).map((p) => ({
        x: p.x * tileWidth,
        y: p.y * tileWidth,
      }));
      return closedPathD(smoothed);
    })
    .filter((d) => d.length > 0)
    .join(" ");
}
