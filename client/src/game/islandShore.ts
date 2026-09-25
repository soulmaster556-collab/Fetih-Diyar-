import type { Tile } from "../api";
import { HEX_DIRECTIONS } from "./mountains";
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

// ---------------------------------------------------------------------
// "Bu karo denize kaç hex uzaklıkta" -- orman/dağ/kayalık/kristal
// kümelerinin kök hex'i kara olsa bile kendi sprite'ı (jitter+scale ile)
// komşu bir denize taşabiliyordu (kullanıcı geri bildirimi: "adaların
// dışına taşan dekorlar var") -- göllerdeki isWaterAtWorldPosition'ın AYNI
// prensibi, ama göllerin aksine ada şekli deterministik bir formülle değil
// gerçek yüklü `tiles` verisinden biliniyor, o yüzden mesafe BFS ile
// hesaplanıyor. maxRings'in ötesindeki karolar "güvenli" (Infinity) sayılır
// -- performans için sınırsız BFS yerine küçük bir üst sınır yeterli, hiçbir
// dekor kümesi birkaç hex'ten fazla taşmıyor zaten.
export function computeSeaDistanceMap(tiles: Tile[], maxRings = 3): Map<string, number> {
  const landSet = new Set(tiles.map((t) => `${t.x},${t.y}`));
  const dist = new Map<string, number>();
  let frontier: [number, number][] = [];

  // 0. halka: denize doğrudan komşu (kıyı) karolar.
  for (const t of tiles) {
    const key = `${t.x},${t.y}`;
    let isCoastal = false;
    for (const [dx, dy] of HEX_DIRECTIONS) {
      if (!landSet.has(`${t.x + dx},${t.y + dy}`)) {
        isCoastal = true;
        break;
      }
    }
    if (isCoastal) {
      dist.set(key, 0);
      frontier.push([t.x, t.y]);
    }
  }

  for (let ring = 1; ring <= maxRings && frontier.length > 0; ring++) {
    const next: [number, number][] = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of HEX_DIRECTIONS) {
        const nx = x + dx;
        const ny = y + dy;
        const nKey = `${nx},${ny}`;
        if (!landSet.has(nKey) || dist.has(nKey)) continue;
        dist.set(nKey, ring);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }

  return dist;
}
