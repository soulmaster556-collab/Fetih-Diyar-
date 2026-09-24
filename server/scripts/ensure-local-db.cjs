// npm run dev'den once otomatik calisir: yerel gelistirme icin kurulan Postgres
// zaten ayaktaysa dokunmaz, degilse sessizce baslatir. Kurulu degilse (baska
// bir makine/Render gibi) hicbir sey yapmadan gecer, dev akisini bozmaz.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const pgCtl = "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe";
const dataDir = path.join(os.homedir(), "pgdata", "fetih-diyari-dev");
const logFile = path.join(os.homedir(), "pgdata", "logfile.txt");

if (process.platform !== "win32" || !fs.existsSync(pgCtl) || !fs.existsSync(dataDir)) {
  process.exit(0);
}

try {
  execFileSync(pgCtl, ["-D", dataDir, "status"], { stdio: "ignore" });
  console.log("[db] Yerel Postgres zaten calisiyor.");
} catch {
  try {
    execFileSync(pgCtl, ["-D", dataDir, "-l", logFile, "start"], { stdio: "inherit" });
  } catch (err) {
    console.warn("[db] Yerel Postgres otomatik baslatilamadi:", err.message);
  }
}
