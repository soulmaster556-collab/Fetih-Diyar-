import express from "express";
import cors from "cors";
import { initSchema } from "./db.js";
import { ensureMapGenerated } from "./game/mapgen.js";
import { seedDefaultSettings, loadSettings } from "./game/settings.js";
import { playersRouter } from "./routes/players.js";
import { tilesRouter } from "./routes/tiles.js";
import { adminRouter } from "./routes/admin.js";

const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  await initSchema();
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

  const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
  app.listen(PORT, () => {
    console.log(`Fetih Diyarı sunucusu http://localhost:${PORT} adresinde çalışıyor`);
  });
}

main().catch((err) => {
  console.error("Sunucu başlatılamadı:", err);
  process.exit(1);
});
