// Grid koordinatını (artık axial hex koordinatı: x=q, y=r) ekran merkezine
// çevirir. Sivri-uçlu (pointy-top) altıgen döşeme kullanıyoruz: aynı satırda
// (r sabit) yan yana karolar tam "tileWidth" kadar kayar; bir alt satıra
// (r+1) geçmek hem yarım karo sağa hem de karo yüksekliğinin 3/4'ü kadar
// aşağı kaydırır -- bu standart axial-to-pixel dönüşümü, klasik altıgen
// petek görünümünü verir. x,y her zaman >= 0 olduğu için (WORLD_SIZE içinde)
// eski baklava sisteminin aksine negatif koordinatı önlemek için ayrı bir
// offsetX'e gerek yok.
export function isoCenter(x: number, y: number, tileWidth: number) {
  const tileHeight = tileWidth * (2 / Math.sqrt(3));
  return {
    cx: tileWidth * (x + y / 2),
    cy: tileHeight * 0.75 * y,
  };
}

// isoCenter'ın tam tersi (doğrusal bir dönüşüm olduğu için yaklaşık değil,
// birebir ters çözüm): ekrandaki bir (screenX, screenY) noktasının hangi
// axial (q,r) hücresine denk geldiğini bulur. Dört köşeyi bu şekilde çözüp
// min/max alarak, görünen alanın kapsadığı aralığı buluyoruz — sunucudan
// sadece bu aralığı istemek için yeterli.
export function screenToWorld(sx: number, sy: number, tileWidth: number) {
  const tileHeight = tileWidth * (2 / Math.sqrt(3));
  const y = sy / (tileHeight * 0.75);
  const x = sx / tileWidth - y / 2;
  return { x, y };
}
