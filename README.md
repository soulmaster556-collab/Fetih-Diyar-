# Fetih Diyarı — Million Lords tarzı strateji oyunu (prototip)

Bu, [Million Lords: World Conquest](https://millionvictories.com/million-lords/) oyununun
temel mekaniklerinden ilham alan, sıfırdan yazılmış oynanabilir bir prototiptir. Mekaniklerin
ve teknik kararların tam açıklaması için **DESIGN.md** dosyasına bakın.

Oynanış: kayıt ol → haritada tek bir şehirle başla → altın/asker üret → komşu kareleri
(NPC kampları veya diğer oyuncular) keşfedip fethet → şehrini yükselt. Timer yok, saldırılar
anında sonuçlanır.

## Klasör yapısı

```
million-lords-clone/
  DESIGN.md          → oyun tasarımı, mekanikler, yol haritası
  server/            → Node/Express/TypeScript API + Postgres (Neon) veritabanı
  client/            → React/Vite/TypeScript arayüz
```

## Çalıştırma (yerel geliştirme)

Backend artık Postgres kullanıyor (Neon üzerinde barındırılıyor — kalıcı veri için,
bkz. DESIGN.md). Yerelde çalıştırmak için önce bir `DATABASE_URL` gerekiyor.

İki ayrı terminalde:

```bash
# 1) Backend
cd server
npm install
export DATABASE_URL="postgresql://..."   # Neon connection string'in
npm run dev        # http://localhost:4000

# 2) Frontend (başka bir terminalde)
cd client
npm install
npm run dev         # http://localhost:5173
```

Tarayıcıda `http://localhost:5173` adresini aç, bir kullanıcı adı seçip "Krallığını Kur"a
bas. Harita üzerinde bir kareye tıklayınca detayları ve (komşuysa) saldırı formunu
göreceksin. Kendi şehrine tıklayınca yükseltme butonunu göreceksin.

## Ortam değişkenleri

- **server**: `DATABASE_URL` (Postgres bağlantı dizesi, zorunlu), `PORT` (Render otomatik
  ayarlar), `CORS_ORIGIN` (virgülle ayrılmış izin verilen origin'ler; production'da frontend'in
  adresi)
- **client**: `VITE_API_URL` (production build'de backend'in tam adresi, ör.
  `https://fetih-diyari-server.onrender.com/api`; yerelde boş bırakılırsa Vite proxy'si
  üzerinden `/api` kullanılır)

## Canlı ortam

Backend: Render Web Service (Node) — Neon Postgres'e bağlı.
Frontend: Render Static Site.
Adresler için Render dashboard'una bak.

## Şu an neler çalışıyor (Faz 1)

- Kayıt olma ve otomatik başlangıç şehri atama
- Zamana bağlı altın/asker üretimi (canlı hesaplanır, sunucu tick'i gerekmez)
- Şehir yükseltme
- Komşu kareye saldırı / fetih (anlık çözümleme, timer yok)
- NPC kampları ve oyuncular arası fetih
- Basit harita görselleştirmesi (16x16 ızgara)

## Sırada ne var (DESIGN.md → "Yol haritası")

İttifaklar, gerçek zamanlı bildirimler (Socket.io), beceri ağacı, birim çeşitliliği,
sezon sistemi, düzgün kimlik doğrulama, Postgres/Neon'a geçiş, mobil istemci.
