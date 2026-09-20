import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL ortam değişkeni tanımlı değil.");
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at BIGINT NOT NULL,
      season_points INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Altın artık kale başına değil, krallık genelinde ortak bir havuzda
  // tutuluyor — bu yüzden oyuncunun kendi satırında birikmiş altın ve son
  // hesaplama zamanı tutulur (bkz. game/resources.ts computeLivePlayerGold).
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gold DOUBLE PRECISION NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS gold_collected_at BIGINT NOT NULL DEFAULT 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tiles (
      id SERIAL PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      owner_id TEXT NULL REFERENCES players(id),
      island_id INTEGER NOT NULL,
      tile_type TEXT NOT NULL CHECK (tile_type IN ('NPC','PLAYER','EMPTY')),
      level INTEGER NOT NULL DEFAULT 1,
      gold_per_hour DOUBLE PRECISION NOT NULL,
      troops_per_hour DOUBLE PRECISION NOT NULL,
      stored_gold DOUBLE PRECISION NOT NULL DEFAULT 0,
      stored_troops DOUBLE PRECISION NOT NULL DEFAULT 0,
      last_collected_at BIGINT NOT NULL,
      UNIQUE (x, y)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS battle_log (
      id SERIAL PRIMARY KEY,
      attacker_id TEXT NOT NULL,
      defender_tile_id INTEGER NOT NULL,
      attacker_power DOUBLE PRECISION NOT NULL,
      defender_power DOUBLE PRECISION NOT NULL,
      result TEXT NOT NULL,
      troops_sent DOUBLE PRECISION NOT NULL,
      occurred_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_settings (
      key TEXT PRIMARY KEY,
      value DOUBLE PRECISION NOT NULL
    );
  `);

  // Kare, adasının dış kıyısında mı (en az bir komşusu farklı bir adaya ya
  // da haritanın dışına düşüyor mu)? Kale/NPC yerleşimi bu karolarda asla
  // olmamalı (Eren'in isteği) -- hem yeni harita üretiminde hem de mevcut
  // canlı haritaya uygulanan tek seferlik göç (migration) bu alanı kullanır.
  await pool.query(`ALTER TABLE tiles ADD COLUMN IF NOT EXISTS is_coastal BOOLEAN NOT NULL DEFAULT false;`);

  // Lonca (klan) sistemi -- basit: bir oyuncu en fazla bir loncaya üye olur.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      leader_id TEXT NOT NULL REFERENCES players(id),
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_members (
      player_id TEXT PRIMARY KEY REFERENCES players(id),
      guild_id INTEGER NOT NULL REFERENCES guilds(id),
      joined_at BIGINT NOT NULL
    );
  `);

  // Klan arkadaşına gönderilen asker takviyesi kendi kalelerin arasındaki
  // takviyeden farklı: bu askerler hedef karonun stored_troops'una
  // KARIŞMAZ (sahiplenilemez), sadece savunma gücüne eklenir ve gönderen
  // istediği zaman geri çağırabilir (bkz. tiles.ts /reinforce ve /recall).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tile_reinforcements (
      id SERIAL PRIMARY KEY,
      tile_id INTEGER NOT NULL REFERENCES tiles(id),
      from_player_id TEXT NOT NULL REFERENCES players(id),
      from_tile_id INTEGER NOT NULL REFERENCES tiles(id),
      troops DOUBLE PRECISION NOT NULL,
      sent_at BIGINT NOT NULL
    );
  `);

  // Zaten canlı/dolu bir haritada geriye dönük olarak tek seferlik
  // uygulanması gereken değişiklikler için (ör. kıyı tamponu + NPC
  // yoğunluğu azaltma) -- her migration adı bir kez çalışır.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    );
  `);

  // Gözcü/casusluk sistemi: bir oyuncunun bir kareye gönderdiği en SON
  // gözcü raporunun anlık görüntüsü (asker/üretim). Eren'in isteği:
  // "gözlendiği bilgi kalıcak, yeni bilgi için yine casus gönderilmesi
  // gerekicek" -- yani bilgi CANLI değil, bir sonraki gözcüye kadar dondu.
  // Bu yüzden (scout_player_id, tile_id) başına TEK satır tutulup yeni
  // gözcü göndermede üzerine yazılıyor (UPSERT), geçmiş raporlar birikmiyor.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scout_reports (
      id SERIAL PRIMARY KEY,
      scout_player_id TEXT NOT NULL REFERENCES players(id),
      tile_id INTEGER NOT NULL REFERENCES tiles(id),
      level INTEGER NOT NULL,
      troops DOUBLE PRECISION NOT NULL,
      gold_per_hour DOUBLE PRECISION NOT NULL,
      troops_per_hour DOUBLE PRECISION NOT NULL,
      owner_username TEXT,
      scouted_at BIGINT NOT NULL,
      UNIQUE (scout_player_id, tile_id)
    );
  `);

  // Mesaj/rapor bölümü: saldırı sonuçları, gözcü raporları, gözetlendiğine
  // dair bildirimler vb. her oyuncunun kendi kutusunda (player_id) biriken,
  // en yeniden eskiye sıralı basit bir olay akışı.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_reports (
      id SERIAL PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      read_at BIGINT
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS player_reports_player_idx ON player_reports (player_id, created_at DESC);`
  );
}

export async function hasMigration(name: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
  return rows.length > 0;
}

export async function markMigration(name: string) {
  await pool.query(
    "INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
    [name, Date.now()]
  );
}
