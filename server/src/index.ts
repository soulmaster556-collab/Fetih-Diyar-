import express from "express";
import cors from "cors";
import { ensureMapGenerated } from "./game/mapgen.js";
import { playersRouter } from "./routes/players.js";
import { tilesRouter } from "./routes/tiles.js";

ensureMapGenerated();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/players", playersRouter);
app.use("/api/tiles", tilesRouter);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`Fetih Diyarı sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
