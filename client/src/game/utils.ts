import type { Session } from "../api";
import { SESSION_KEY } from "./constants";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

// Profil fotoğrafı sunucuya gönderilmeden ÖNCE tarayıcıda küçük bir kareye
// (cover-crop) küçültülüp JPEG'e sıkıştırılıyor -- sonuç genelde birkaç
// KB, sunucudaki ~300kb sınırının (bkz. server players.ts
// MAX_AVATAR_DATA_URL_LENGTH) çok altında kalıyor.
export function resizeImageToDataUrl(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Görsel okunamadı."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Görsel yüklenemedi."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Bu tarayıcı görsel işlemeyi desteklemiyor."));
          return;
        }
        // Kısa kenar referans alınıp ortadan kare kırpılıyor (cover), sonra
        // hedef boyuta gerdiriliyor -- yükleyen kişinin fotoğrafı hangi
        // oranda olursa olsun yuvarlak profil çerçevesine düzgün oturuyor.
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Göreli zaman metni ("3 dk önce" gibi) -- yüzlerce olay biriktiğinde tam
// tarih/saatten daha hızlı taranabiliyor.
export function timeAgo(ts: number) {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "az önce";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} sa önce`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} gün önce`;
}
