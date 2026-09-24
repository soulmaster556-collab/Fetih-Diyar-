import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL ortam değişkeni tanımlı değil.");
}

const isLocalDb = /^(localhost|127\.0\.0\.1)/.test(
  connectionString.replace(/^postgres(ql)?:\/\/[^@]*@/, ""),
);

export const pool = new Pool({
  connectionString,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
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

  // Admin panelinden oyuncu yasaklama -- yasaklı oyuncunun mevcut token'ı
  // ban anında döndürülür (bkz. routes/admin.ts) ve authenticate/login bu
  // bayrağı kontrol edip erişimi reddeder (bkz. routes/players.ts).
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false;`);

  // Takma ad (kale adı): login için kullanılan `username`'den TAMAMEN ayrı --
  // diğer oyunculara HER YERDE (harita, liderlik, lonca, raporlar) bu
  // gösterilir, `username` artık sadece giriş kimlik bilgisi. NULL = henüz
  // seçilmemiş; ilk girişte istemci (bkz. NicknameModal.tsx) oyuncuyu bunu
  // seçmeye zorluyor ve bir kez seçildikten sonra POST /me/nickname bir daha
  // değiştirmeye izin vermiyor (bkz. routes/players.ts). Benzersizlik
  // büyük/küçük harf duyarsız (aşağıdaki fonksiyonel unique index).
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS nickname TEXT NULL;`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS players_nickname_lower_idx ON players (lower(nickname)) WHERE nickname IS NOT NULL;`
  );

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

  // Oyuncunun ilk ana kalesinin tile id'si; kayıt olurken set edilir,
  // login/register cevabında koordinatları (x,y) hesaplamak için kullanılır
  // ki client her girişte haritayı ana kaleye ortalayabilsin.
  // (tiles tablosundan SONRA eklenir, çünkü REFERENCES tiles(id) veriyor.)
  await pool.query(
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS home_tile_id INTEGER NULL REFERENCES tiles(id);`
  );

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
  // olmamalı -- hem yeni harita üretiminde hem de mevcut canlı haritaya
  // uygulanan tek seferlik göç (migration) bu alanı kullanır.
  await pool.query(`ALTER TABLE tiles ADD COLUMN IF NOT EXISTS is_coastal BOOLEAN NOT NULL DEFAULT false;`);

  // Kare, client'ın (game/decor.ts, riversLakes.ts'in sunucu portu) tamamen
  // dünya-koordinatına göre çizdiği bir gölün altında mı? Kale/NPC yerleşimi
  // bu karolarda asla olmamalı (bkz. is_coastal yorumu, aynı gerekçe) --
  // hem yeni harita üretiminde hem de mevcut canlı haritaya uygulanan tek
  // seferlik göç (applyLakeLockMigration) bu alanı kullanır.
  await pool.query(`ALTER TABLE tiles ADD COLUMN IF NOT EXISTS is_water BOOLEAN NOT NULL DEFAULT false;`);

  // Lonca (klan) sistemi -- basit: bir oyuncu en fazla bir loncaya üye olur.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      leader_id TEXT NOT NULL REFERENCES players(id),
      created_at BIGINT NOT NULL
    );
  `);
  // Lonca bayrağı: görselin kendisi client'ta sabit bir SVG şablonu +
  // renk/amblem (bkz. client game/guildFlags.ts GUILD_FLAG_DEFS), burada
  // sadece hangi bayrağın seçildiği (1-10) saklanıyor. Eski loncalar için
  // varsayılan 1.
  await pool.query(`ALTER TABLE guilds ADD COLUMN IF NOT EXISTS flag_id INTEGER NOT NULL DEFAULT 1;`);

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
  // gözcü raporunun anlık görüntüsü (asker/üretim). Bilgi CANLI değil, bir
  // sonraki gözcüye kadar donmuş kalır. Bu yüzden (scout_player_id,
  // tile_id) başına TEK satır tutulup yeni gözcüde üzerine yazılıyor
  // (UPSERT), geçmiş raporlar birikmiyor.
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

  // Zamanlı saldırılar: saldırı TEK bir istekte anında çözülmüyor, önce bu
  // tabloya bir "yolda" kaydı düşülüyor (bkz. game/attacks.ts
  // createAttackOrder), asıl çarpışma askerler hedefe ULAŞTIĞINDA
  // (arrives_at geçince) arka planda çözülüyor (bkz. resolveDueAttackOrders,
  // index.ts'teki periyodik tur). from_x/from_y/target_x/target_y bilerek
  // DENORMALİZE edildi (tiles'a JOIN gerekmesin diye) -- istemci bu
  // satırları animasyon hattı çizmek için sık sık çekiyor (bkz. GET
  // /tiles/attacks/active).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attack_orders (
      id SERIAL PRIMARY KEY,
      attacker_id TEXT NOT NULL REFERENCES players(id),
      from_tile_id INTEGER NOT NULL REFERENCES tiles(id),
      target_tile_id INTEGER NOT NULL REFERENCES tiles(id),
      from_x INTEGER NOT NULL,
      from_y INTEGER NOT NULL,
      target_x INTEGER NOT NULL,
      target_y INTEGER NOT NULL,
      troops_sent DOUBLE PRECISION NOT NULL,
      departed_at BIGINT NOT NULL,
      arrives_at BIGINT NOT NULL
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS attack_orders_arrives_idx ON attack_orders (arrives_at);`
  );

  // Lonca davetleri -- kullanıcı adıyla gönderilen, kabul/reddedilene kadar
  // bekleyen basit bir davet kuyruğu. Bir oyuncunun aynı loncadan birden
  // fazla bekleyen daveti olmasın diye (guild_id, invited_player_id) tekil.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_invites (
      id SERIAL PRIMARY KEY,
      guild_id INTEGER NOT NULL REFERENCES guilds(id),
      invited_player_id TEXT NOT NULL REFERENCES players(id),
      invited_by_id TEXT NOT NULL REFERENCES players(id),
      created_at BIGINT NOT NULL,
      UNIQUE (guild_id, invited_player_id)
    );
  `);

  // Profil fotoğrafı -- avatar küçük bir data-URL (base64) olarak doğrudan
  // players satırında tutuluyor (ayrı dosya depolama/CDN kurmaya değecek
  // kadar büyük bir ihtiyaç değil -- bkz. routes/players.ts avatar yükleme
  // ucu, istemci tarafında zaten küçük bir kareye indirgenip sıkıştırılıyor).
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_data TEXT NULL;`);

  // Oyuncu flaması: şekil (1-10), renk (1-20), logo (1-20). Kayıtta rastgele
  // atanır (bkz. routes/players.ts /register), profil ekranından
  // değiştirilebilir (bkz. POST /players/me/flag). Görselin kendisi tamamen
  // client'ta üretiliyor (bkz. client/src/game/playerFlags.ts) -- lonca
  // flamasından (guilds.flag_id) bağımsız, ayrı bir sistem. Varsayılan
  // (1,1,1) eski hesaplar için.
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS flag_shape INTEGER NOT NULL DEFAULT 1;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS flag_color INTEGER NOT NULL DEFAULT 1;`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS flag_logo INTEGER NOT NULL DEFAULT 1;`);

  // Takviye siparişleri de (attack_orders gibi) anında değil, mesafeye bağlı
  // yolculuk süresiyle hedefe ulaşıyor (bkz. game/reinforcements.ts). Aynı
  // travelDurationMs formülünü kullanıyor -- ayrı bir "hız" ayarı yok,
  // askerin yürüme hızı saldırı/takviye farketmeksizin aynı.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reinforcement_orders (
      id SERIAL PRIMARY KEY,
      from_player_id TEXT NOT NULL REFERENCES players(id),
      from_tile_id INTEGER NOT NULL REFERENCES tiles(id),
      target_tile_id INTEGER NOT NULL REFERENCES tiles(id),
      from_x INTEGER NOT NULL,
      from_y INTEGER NOT NULL,
      target_x INTEGER NOT NULL,
      target_y INTEGER NOT NULL,
      troops_sent DOUBLE PRECISION NOT NULL,
      departed_at BIGINT NOT NULL,
      arrives_at BIGINT NOT NULL
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS reinforcement_orders_arrives_idx ON reinforcement_orders (arrives_at);`
  );

  // Sohbet: iki sabit kanal -- "general" (herkese açık) ve "guild" (sadece
  // aynı loncanın üyeleri, guild_id ile filtrelenir). `username` gönderim
  // anında DENORMALİZE ediliyor (player_reports/attack_orders'taki aynı
  // gerekçe -- her poll'da players'a JOIN gerekmesin) -- takma ad zaten bir
  // kez seçilip bir daha değişmiyor (bkz. players.nickname yorumu), o yüzden
  // bu bir tutarsızlık riski taşımıyor.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      channel TEXT NOT NULL CHECK (channel IN ('general', 'guild')),
      guild_id INTEGER NULL REFERENCES guilds(id),
      player_id TEXT NOT NULL REFERENCES players(id),
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS chat_messages_general_idx ON chat_messages (created_at DESC) WHERE channel = 'general';`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS chat_messages_guild_idx ON chat_messages (guild_id, created_at DESC) WHERE channel = 'guild';`
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
