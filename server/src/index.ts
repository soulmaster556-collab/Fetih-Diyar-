import express from "express";
import cors from "cors";
import { initSchema } from "./db.js";
import {
  ensureMapGenerated,
  applyHexGridConversionMigration,
  applyBigSingleIslandMigration,
  applyRectSingleIslandMigration,
  applyNpcBorderMigration,
  applyNpcDensityReductionMigration,
} from "./game/mapgen.js";
import { seedDefaultSettings, loadSettings } from "./game/settings.js";
import { playersRouter } from "./routes/players.js";
import { tilesRouter } from "./routes/tiles.js";
import { adminRouter } from "./routes/admin.js";
import { guildsRouter } from "./routes/guilds.js";

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
  await seedDefaultSettings();
  const settings = await loadSettings();
  await ensureMapGenerated(settings);

  const app = express();
  app.use(
    cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    })
  );
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/players", playersRouter);
  app.use("/api/tiles", tilesRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/guilds", guildsRouter);

  // Render (ve benzeri PaaS'lar) bir portun açılmasını belirli bir süre
  // bekler; o süre dolmadan port dinlemeye başlamazsak deploy "port scan
  // timeout" ile başarısız sayılır. Bu yüzden ÖNCE portu dinlemeye
  // başlıyoruz, tek seferlik/geriye dönük geçişler (migration) gibi yavaş
  // olabilecek işleri arka planda, sunucu zaten ayaktayken çalıştırıyoruz.
  const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
  app.listen(PORT, () => {
    console.log(`Fetih Diyarı sunucusu http://localhost:${PORT} adresinde çalışıyor`);
  });

  applyNpcBorderMigration(settings)
    .then(() => applyNpcDensityReductionMigration(settings))
    .catch((err) => {
      console.error("[migration] npc geçişleri başarısız oldu:", err);
    });
}

main().catch((err) => {
  console.error("Sunucu başlatılamadı:", err);
  process.exit(1);
});
