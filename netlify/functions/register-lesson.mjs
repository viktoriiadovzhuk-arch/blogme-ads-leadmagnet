import { getStore } from "@netlify/blobs";

const TARGET_PRICES = { start: 3799, vip: 4599 };
const TTL_MS = 24 * 60 * 60 * 1000;

// SendPulse Event URL — "Промо-урок отримано код"
const SP_LESSON_EVENT = "https://events.sendpulse.com/events/id/e4926338446b49fff38d32430b6d8001/9399561";

function genCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "EARLY-" + s;
}

// Формат "28 квітня о 14:32" у Київському часі
function formatPretty(isoDate) {
  const months = [
    "січня","лютого","березня","квітня","травня","червня",
    "липня","серпня","вересня","жовтня","листопада","грудня"
  ];
  const d = new Date(isoDate);
  // Київський час (UTC+3)
  const kyiv = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const day = kyiv.getUTCDate();
  const month = months[kyiv.getUTCMonth()];
  const hh = String(kyiv.getUTCHours()).padStart(2, "0");
  const mm = String(kyiv.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} о ${hh}:${mm}`;
}

// Шле подію в SendPulse — НЕ книгу. Подія летить тільки 1 раз на email.
async function sendLessonEvent({ email, code, expiresAt, lessonWatchedAt }) {
  try {
    const resp = await fetch(SP_LESSON_EVENT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        promo_code: code,
        expires_at: expiresAt,
        expires_at_pretty: formatPretty(expiresAt),
        lesson_watched_at: lessonWatchedAt,
        tariff_start_price: String(TARGET_PRICES.start),
        tariff_vip_price: String(TARGET_PRICES.vip)
      })
    });
    const text = await resp.text();
    console.log(`📧 SP LESSON event for ${email}: status=${resp.status}, body=${text.slice(0,200)}`);
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    console.error("SP lesson event failed:", err);
    return { ok: false, error: err.message };
  }
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { email } = await req.json();
    const emailKey = (email || "").toLowerCase().trim();

    console.log(`🎓 register-lesson called for email=${emailKey}`);

    if (!emailKey || !emailKey.includes("@") || emailKey.length > 200) {
      return new Response(JSON.stringify({ error: "Введи коректний email" }), { status: 400 });
    }

    const store = getStore("dynamic_promos");

    // ===== ПЕРЕВІРКА ІСНУЮЧОГО =====
    // Логіка "1 email = 1 подія в SP назавжди"
    const existingRaw = await store.get("email_" + emailKey);

    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        const isExpired = !existing.expiresAt || new Date(existing.expiresAt) <= new Date();
        const isUsed = !!existing.used;

        // Повертаємо існуючий код, у SendPulse-подію НЕ шлемо
        console.log(`↩️ Existing in Blobs for ${emailKey}, NOT sending SP event`);
        return new Response(JSON.stringify({
          code: existing.code,
          expiresAt: existing.expiresAt,
          duplicate: true,
          expired: isExpired || undefined,
          used: isUsed || undefined
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch {}
    }

    // ===== ГЕНЕРУЄМО НОВИЙ КОД =====
    let code = null;
    for (let i = 0; i < 5; i++) {
      const candidate = genCode();
      const collision = await store.get("code_" + candidate);
      if (!collision) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return new Response(JSON.stringify({ error: "Не вдалося згенерувати код" }), { status: 500 });
    }

    const now = Date.now();
    const expiresAt = new Date(now + TTL_MS).toISOString();
    const lessonWatchedAt = new Date(now).toISOString();

    const promoData = {
      code,
      email: emailKey,
      type: "fixed_per_plan",
      prices: TARGET_PRICES,
      source: "lesson",
      createdAt: lessonWatchedAt,
      expiresAt,
      used: false
    };

    await store.set("code_" + code, JSON.stringify(promoData));
    await store.set("email_" + emailKey, JSON.stringify(promoData));

    // ===== ШЛЕМО ПОДІЮ В SENDPULSE (тільки для нового email) =====
    console.log(`📧 Sending SP LESSON event for ${emailKey}, code ${code}`);

    // Шлю синхронно з таймаутом 5с — щоб бачити response від SP
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch(SP_LESSON_EVENT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailKey,
          promo_code: code,
          expires_at: expiresAt,
          expires_at_pretty: formatPretty(expiresAt),
          lesson_watched_at: lessonWatchedAt,
          tariff_start_price: String(TARGET_PRICES.start),
          tariff_vip_price: String(TARGET_PRICES.vip)
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const text = await resp.text();
      console.log(`📧 SP LESSON response: status=${resp.status}, ok=${resp.ok}, body=${text.slice(0, 300)}`);
    } catch (err) {
      console.error(`❌ SP LESSON event FAILED for ${emailKey}: ${err.message}`);
    }

    return new Response(JSON.stringify({
      code,
      expiresAt,
      duplicate: false
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("register-lesson error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
