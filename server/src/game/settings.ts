import { pool } from "../db.js";

// Her ayarın anahtarı, varsayılan değeri, gösterim adı ve açıklaması.
// Admin paneli bu listeyi olduğu gibi kullanıcıya gösterir.
export const SETTING_DEFS = [
  {
    key: "gold_per_level",
    label: "Seviye başına altın/saat",
    description: "Bir şehrin saatlik altın üretimi = bu değer × şehir seviyesi.",
    default: 10,
  },
  {
    key: "troops_per_level",
    label: "Seviye başına asker/saat",
    description: "Bir şehrin saatlik asker üretimi = bu değer × şehir seviyesi.",
    default: 10,
  },
  {
    key: "upgrade_cost_multiplier",
    label: "Yükseltme maliyeti çarpanı",
    description: "Yükseltme maliyeti = bu değer × (seviye ^ üs).",
    default: 50,
  },
  {
    key: "upgrade_cost_exponent",
    label: "Yükseltme maliyeti üssü",
    description: "Yükseltme maliyeti formülündeki üs değeri.",
    default: 1.5,
  },
  {
    key: "resource_cap_hours",
    label: "Kaynak birikim tavanı (saat)",
    description: "Toplanmayan kaynaklar en fazla bu kadar saatlik üretim kadar birikir.",
    default: 24,
  },
  {
    key: "combat_defense_bonus",
    label: "Savunma bonusu çarpanı",
    description: "Savunan tarafın gücü bu çarpanla artırılır (1.1 = %10 bonus).",
    default: 1.1,
  },
  {
    key: "npc_spawn_chance",
    label: "NPC kampı oluşma olasılığı",
    description:
      "Yeni harita üretildiğinde adanın İÇ kısmındaki (kıyı hariç) her karenin NPC kampı olma ihtimali (0-1); geri kalanı boş kare olur (oyuncu başlangıç noktaları). Kıyı karolarında hiçbir zaman NPC/kale olmaz. Boş karelere saldırı olmadığı için ilerleme büyük ölçüde NPC fethine dayanır. Mevcut haritayı etkilemez (bkz. applyNpcBorderMigration / applyNpcDensityReductionMigration canlı haritayı bir kereliğine seyrekleştirir).",
    // Sırasıyla 0.6, 0.3, 0.15, 0.08, 0.04, 0.02, 0.01 idi -- 0.01 haritayı
    // gereğinden fazla seyrekleştirdiği için (kullanıcı geri bildirimi:
    // "haritada sadece birkaç tane var") 0.05'e yükseltilmişti (bkz.
    // applyNpcDensityIncreaseMigrationV4), sonra kullanıcı isteğiyle
    // ("NPC'leri %40 azalt") tekrar 0.03'e düşürüldü (bkz.
    // applyNpcDensityReductionMigrationV5 canlı haritayı da seyrekleştirir).
    default: 0.03,
  },
  {
    key: "starting_troops",
    label: "Başlangıç askeri",
    description: "Yeni bir oyuncunun kurduğu ilk şehirdeki başlangıç asker sayısı.",
    default: 20,
  },
  {
    key: "naval_attack_range",
    label: "Deniz aşımı saldırı menzili",
    description:
      "Farklı bir adadaki kareye saldırabilmek için izin verilen maksimum mesafe. Aynı adadaki komşu karelere bu sınırdan bağımsız her zaman saldırılabilir.",
    default: 15,
  },
  {
    key: "game_speed",
    label: "Oyun hızı çarpanı",
    description:
      "Genel hız çarpanı: üretim (altın/asker) bu kat hızlı birikir, saldırı seyahat süresi bu kata bölünür kısalır. 1 = normal, 2 = iki kat hızlı sunucu.",
    default: 1,
  },
  {
    key: "attack_travel_seconds_per_tile",
    label: "Saldırı: karo başına seyahat süresi (sn)",
    description:
      "Bir saldırının kaynak ile hedef arasındaki her 1 karolik mesafe için ne kadar sürede yol aldığı (saniye), oyun hızına bölünür. Saldırı artık anında sonuçlanmıyor -- bu süre kadar yolda kalıyor (bkz. attack_orders).",
    // x3 yavaşlatıldı (eski değer 3). Canlıdaki değer admin panelinden/DB'den
    // ayrıca güncellendi, bu default sadece SIFIRDAN kurulan ortam için.
    default: 9,
  },
  {
    key: "attack_min_travel_seconds",
    label: "Saldırı: minimum seyahat süresi (sn)",
    description:
      "Çok yakın hedeflerde bile saldırının en az bu kadar sürede ulaşmasını sağlayan taban değer (yolda giderken animasyonun görünür olması için).",
    // x3 yavaşlatıldı (eski değer 4).
    default: 12,
  },
] as const;

export type SettingKey = (typeof SETTING_DEFS)[number]["key"];
export type Settings = Record<SettingKey, number>;

const DEFAULTS: Settings = Object.fromEntries(
  SETTING_DEFS.map((s) => [s.key, s.default])
) as Settings;

export async function seedDefaultSettings() {
  for (const def of SETTING_DEFS) {
    await pool.query(
      "INSERT INTO game_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
      [def.key, def.default]
    );
  }
}

export async function loadSettings(): Promise<Settings> {
  const { rows } = await pool.query<{ key: string; value: number }>(
    "SELECT key, value FROM game_settings"
  );
  const result = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in result) {
      (result as Record<string, number>)[row.key] = Number(row.value);
    }
  }
  return result;
}

export async function updateSettings(updates: Record<string, number>) {
  const validKeys = new Set(SETTING_DEFS.map((s) => s.key));
  const entries = Object.entries(updates).filter(([k]) => validKeys.has(k as SettingKey));
  if (entries.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of entries) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Geçersiz değer: ${key}`);
      }
      await client.query(
        `INSERT INTO game_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
