import "dotenv/config";
import express from "express";
import cors from "cors";
import { initSchema } from "./db.js";
import {
  ensureMapGenerated,
  applyHexGridConversionMigration,
  applyBigSingleIslandMigration,
  applyRectSingleIslandMigration,
  applyDecorRebalanceResetMigration,
  applyNpcBorderMigration,
  applyNpcDensityReductionMigration,
  applyNpcDensityReductionMigrationV3,
  applyNpcDensityIncreaseMigrationV4,
  applyLakeLockMigration,
  applyHomeTileBackfillMigration,
} from "./game/mapgen.js";
import { seedDefaultSettings, loadSettings } from "./game/settings.js";
import { resolveDueAttackOrders } from "./game/attacks.js";
import { resolveDueReinforcementOrders } from "./game/reinforcements.js";
import { playersRouter } from "./routes/players.js";
import { tilesRouter } from "./routes/tiles.js";
import { adminRouter } from "./routes/admin.js";
import { guildsRouter } from "./routes/guilds.js";
import { chatRouter } from "./routes/chat.js";

const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  await initSchema();
  // Hex geçişi -- tek seferlik, test haritasını/hesaplarını sıfırlar (bkz.
  // mapgen.ts). ensureMapGenerated'dan ÖNCE ve senkron çalışmalı ki tiles
  // tablosu boşaldıktan hemen sonra yeni hex-komşuluklu ada üretimi devreye
  // girsin.
  await applyHexGridConversionMigration();
  // Tek büyük test adasına geçiş -- yukarıdaki gibi ÖNCE ve senkron
  // çalışmalı ki tiles tablosu boşaldıktan hemen sonra ensureMapGenerated
  // tek büyük adayı üretsin.
  await applyBigSingleIslandMigration();
  // Organik adadan düz dikdörtgen adaya geçiş + NPC yoğunluğunu bir kademe
  // daha düşürme -- yine ÖNCE ve senkron (bkz. yukarıdaki notlar).
  await applyRectSingleIslandMigration();
  // Dağ dekoru yeniden tasarımı (tek-hex + 1 tur boşluk kuralı, zoom, ışıltı)
  // sonrası doğrudan "sunucuyu sıfırla" isteği -- bkz. mapgen.ts yorumu.
  await applyDecorRebalanceResetMigration();
  await seedDefaultSettings();
  const settings = await loadSettings();
  await ensureMapGenerated(settings);

  const app = express();
  app.use(
    cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    })
  );
  // Profil fotoğrafı base64 olarak JSON gövdesinde geliyor, varsayılan
  // 100kb limiti küçük bir resim için bile yetmez. 3mb, makul boyutta
  // küçültülmüş bir kare fotoğrafı (client tarafında zaten küçültülüyor)
  // rahatça karşılar; asıl sıkı sınır avatar endpoint'inin kendisinde (bkz.
  // players.ts) ayrıca uygulanıyor.
  app.use(express.json({ limit: "3mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/players", playersRouter);
  app.use("/api/tiles", tilesRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/guilds", guildsRouter);
  app.use("/api/chat", chatRouter);

  // Render (ve benzeri PaaS'lar) bir portun açılmasını belirli bir süre
  // bekler; o süre dolmadan port dinlemeye başlamazsak deploy "port scan
  // timeout" ile başarısız sayılır. Bu yüzden ÖNCE portu dinlemeye
  // başlıyoruz, tek seferlik/geriye dönük geçişler (migration) gibi yavaş
  // olabilecek işleri arka planda, sunucu zaten ayaktayken çalıştırıyoruz.
  const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
  app.listen(PORT, () => {
    console.log(`Fetih Diyarı sunucusu http://localhost:${PORT} adresinde çalışıyor`);
  });

  // Zamanlı saldırılar/takviyeler: kaynak-üretim gibi "isteğe bağlı hesapla"
  // (lazy accrual) yerine burada gerçek bir periyodik tur gerekiyor, çünkü
  // kale el değiştirmesi/takviye teslimi kimse haritaya bakmasa/istek
  // atmasa bile askerler ulaştığı AN gerçekleşmeli. Asıl hız artık her
  // siparişe özel kurulan setTimeout'ta (bkz. game/orderScheduler.ts) -- bu
  // 2 saniyelik tur sadece sunucu yeniden başladığında in-memory
  // zamanlayıcıları kaybedilen siparişler için güvenlik ağı.
  setInterval(() => {
    resolveDueAttackOrders().catch((err) => {
      console.error("[attack] resolveDueAttackOrders turu başarısız oldu:", err);
    });
    resolveDueReinforcementOrders().catch((err) => {
      console.error("[reinforce] resolveDueReinforcementOrders turu başarısız oldu:", err);
    });
  }, 2000);

  applyNpcBorderMigration(settings)
    .then(() => applyNpcDensityReductionMigration(settings))
    .then(() => applyNpcDensityReductionMigrationV3(settings))
    .then(() => applyNpcDensityIncreaseMigrationV4(settings))
    .then(() => applyLakeLockMigration(settings))
    .then(() => applyHomeTileBackfillMigration())
    .catch((err) => {
      console.error("[migration] npc/home-tile geçişleri başarısız oldu:", err);
    });
}

main().catch((err) => {
  console.error("Sunucu başlatılamadı:", err);
  process.exit(1);
});
