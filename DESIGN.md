# Fetih Diyarı — Million Lords Tarzı Tarayıcı Stratejisi (Tasarım Dokümanı)

Bu doküman, [Million Lords: World Conquest](https://millionvictories.com/million-lords/) oyununun
temel mekaniklerini analiz edip bunları web tabanlı, sıfırdan geliştirilebilir bir prototipe
uyarlıyor. Amaç; "timer'sız" (zaman kilidi olmayan), harita üzerinde şehir fethine dayalı,
ittifak destekli bir gerçek-zamanlı strateji oyununun iskeletini kurmak.

## 1. Million Lords'tan alınan temel fikirler

- **Tek şehirle başla, haritada genişle.** Oyuncu bir "ana üs" ile başlar, komşu şehirleri
  keşfedip (scout) fethederek imparatorluğunu büyütür.
- **Sadece 2 kaynak: Altın ve Asker.** Kaynak yönetimi basit ama her şehir ayrı üretim/saat
  değerine sahip olduğu için "hangi şehri yükseltip hangisini savunacağım" kararı derinlik katıyor.
- **Timer yok, anlık çözümleme.** İnşaat/saldırı için saatlerce beklemek yok; saldırılar anında
  sonuçlanıyor. Bu, mobil "idle" oyunlardan ayrışan en belirgin özellik.
- **Şehir kaybedilirse yükseltmeler de gider.** Risk/ödül dengesini kurar; aşırı yayılmak
  cezalandırılır.
- **İttifaklar (clan) savunma amaçlı.** Oyuncular birlikte bölge tutar, birbirini savunur.
- **Beceri ağacı ile oynanış tarzı özelleştirme.** Saldırgan/hızlı/savunmacı gibi build'ler.
- **Sezon sistemi.** Ayda bir harita sıfırlanır, bir önceki sezonun üst sıradakileri küçük
  avantajlarla yeni sezona başlar.

## 2. Basitleştirilmiş oynanış döngüsü (MVP)

1. Oyuncu kayıt olur → haritada boş bir karede başlangıç şehri kurulur.
2. Şehir, zamana bağlı olarak **altın/saat** ve **asker/saat** üretir (üretim, son güncelleme
   zamanına göre "talep anında" hesaplanır — sunucuda sürekli çalışan bir tick döngüsüne gerek
   yoktur).
3. Oyuncu altınla şehrini yükseltir (üretim artar) veya yeni asker üretimine ağırlık verir.
4. Oyuncu haritada komşu bir kareyi (NPC kampı veya başka oyuncunun şehri) **keşfeder**
   (rakip güç tahmini görür) ve **saldırır**.
5. Saldırı anında çözümlenir: saldıran asker gücü vs savunan asker gücü (+ savunma bonusları).
   Kazanan kareyi ele geçirir; kaybeden askerlerini/şehrini kaybeder.
6. Oyuncular ittifak kurup birbirinin şehirlerine asker/kaynak yardımı gönderebilir, ittifak
   üyesine saldırıyı önceden görebilir (basit bir "tehdit uyarısı").
7. Sezon sonunda skor tablosu dondurulur, harita sıfırlanır, yeni sezon başlar.

## 3. Veri modeli (ilk sürüm)

```
players        (id, username, created_at, season_points)
seasons        (id, started_at, ended_at, is_active)
tiles          (id, x, y, owner_id NULL, tile_type[NPC|PLAYER|EMPTY],
                level, gold_per_hour, troops_per_hour,
                stored_gold, stored_troops, last_collected_at)
alliances      (id, name, owner_player_id)
alliance_members (alliance_id, player_id, role)
battle_log     (id, attacker_id, defender_tile_id, attacker_power,
                defender_power, result, occurred_at)
```

- `stored_gold` / `stored_troops` her API çağrısında `last_collected_at`'a göre yeniden
  hesaplanır (idle-game deseni): `biriken = üretim/saat * geçen_saat`, üst sınır (cap)
  ile birlikte.
- Bu tasarım, mevcut **Kadim Topraklar** projesindeki zaman-bazlı üretim mantığına
  (Travian tarzı) çok benzer; oradaki deneyim doğrudan buraya taşınabilir.

## 4. Savaş formülü (basit, MVP)

```
saldırgan_gücü = gönderilen_asker * saldırı_katsayısı (beceri ağacı bonusu dahil)
savunma_gücü   = kare.stored_troops * savunma_katsayısı * (1 + surve_bonusu)

eğer saldırgan_gücü > savunma_gücü:
    kare el değiştirir, saldırgan (saldırgan_gücü - savunma_gücü) kadar asker ile kalır
değilse:
    saldırgan tüm gönderdiği askeri kaybeder, savunan kalan gücüyle kare sahibi kalır
```

İleride: birim çeşitleri (piyade/okçu/süvari gibi taş-kağıt-makas), item/skill bonusları,
scout ile gerçek gücü %100 doğru göstermeme (sis-of-war) eklenebilir.

## 5. Teknik mimari

| Katman     | Seçim                                   | Neden |
|------------|------------------------------------------|-------|
| Frontend   | React + Vite + TypeScript                | Kadim Topraklar ile aynı yığın, tanıdık |
| Backend    | Node.js + Express + TypeScript           | Aynı sebep |
| Veritabanı | SQLite (better-sqlite3) — prototipte     | Kurulum gerektirmez, tek dosya; üretimde birebir aynı SQL ile Postgres/Neon'a taşınabilir |
| Gerçek zamanlı güncellemeler | Socket.io (Faz 2)       | Harita üzerinde başkalarının hamlelerini anlık görmek için |
| Kimlik doğrulama | Basit token tabanlı (Faz 1), sonra JWT + şifre | MVP'de hız için basitleştirildi |

**Not:** Prototip SQLite ile geliyor çünkü bu ortamda dışarıdan bir Postgres/Neon
bağlantı bilgisi yok; ileride tek yapman gereken `db.ts` içindeki bağlantı katmanını
`pg` sürücüsüyle değiştirmek (SQL sorguları neredeyse birebir aynı kalır).

## 6. Yol haritası

**Faz 1 — Çekirdek döngü (bu prototipte kurulan kısım):**
şehir kurma, kaynak üretimi/toplama, komşu kare keşfi, saldırı/fetih, basit skor tablosu.

**Faz 2:** İttifaklar, gerçek zamanlı harita güncellemeleri (Socket.io), saldırı bildirimleri.

**Faz 3:** Beceri ağacı, item/ekipman sistemi, birim çeşitliliği.

**Faz 4:** Sezon sistemi, ödüller, düzgün kimlik doğrulama, mobil (React Native/Expo)
istemcisi — Kadim Topraklar'daki gibi.
