import { Router } from "express";
import { SETTING_DEFS, loadSettings, updateSettings } from "../game/settings.js";

export const adminRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: "Admin paneli yapılandırılmamış (ADMIN_KEY eksik)." });
  }
  const provided = req.headers["x-admin-key"];
  if (provided !== adminKey) {
    return res.status(401).json({ error: "Geçersiz admin anahtarı." });
  }
  next();
}

adminRouter.get("/settings", requireAdmin, async (_req, res) => {
  try {
    const values = await loadSettings();
    res.json({
      defs: SETTING_DEFS.map(({ key, label, description, default: def }) => ({
        key,
        label,
        description,
        default: def,
      })),
      values,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

adminRouter.post("/settings", requireAdmin, async (req, res) => {
  try {
    const updates = req.body?.values;
    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ error: "Geçersiz istek gövdesi." });
    }
    await updateSettings(updates);
    const values = await loadSettings();
    res.json({ values });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Sunucu hatası." });
  }
});
