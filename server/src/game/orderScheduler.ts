import { pool } from "../db.js";
import { resolveOneAttackOrder, type AttackOrderRow } from "./attacks.js";
import { resolveOneReinforcementOrder, type ReinforcementOrderRow } from "./reinforcements.js";

// Saldırı/takviye siparişi oluşturulur oluşturulmaz, o siparişe ÖZEL bir
// zamanlayıcı kurar -- index.ts'teki 2sn'lik genel süpürmenin YERİNE değil,
// YANINA (sunucu yeniden başlarsa in-memory setTimeout'lar kaybolur, 2sn'lik
// periyodik tur bunun için güvenlik ağı olarak kalıyor). Bu, kullanıcının
// "ikon hedefe erken varıyor" şikayetinin asıl sebebini çözüyor: eskiden
// TEK çözüm yolu 2sn'lik genel süpürmeydi, markörün CSS animasyonu tam
// arrives_at'te bitip hedefte "asılı" kalıyor ama savaş sonucu/takviye
// birkaç saniye SONRA geliyordu. Sipariş zaten (periyodik tur ya da bu
// zamanlayıcı tarafından) çözülmüşse resolveOne*Order'ın kendi "DELETE ...
// WHERE id=$1" kontrolü sayesinde bu ikinci çağrı güvenle no-op olur.
export function scheduleOrderResolution(kind: "attack" | "reinforce", orderId: number, delayMs: number): void {
  setTimeout(() => {
    resolveOrderNow(kind, orderId).catch((err) => {
      console.error(`[${kind}] zamanlanmış çözüm başarısız oldu:`, orderId, err);
    });
  }, Math.max(0, delayMs));
}

async function resolveOrderNow(kind: "attack" | "reinforce", orderId: number): Promise<void> {
  const now = Date.now();
  if (kind === "attack") {
    const { rows } = await pool.query<AttackOrderRow>("SELECT * FROM attack_orders WHERE id = $1", [orderId]);
    if (rows[0]) await resolveOneAttackOrder(rows[0], now);
  } else {
    const { rows } = await pool.query<ReinforcementOrderRow>(
      "SELECT * FROM reinforcement_orders WHERE id = $1",
      [orderId]
    );
    if (rows[0]) await resolveOneReinforcementOrder(rows[0], now);
  }
}
