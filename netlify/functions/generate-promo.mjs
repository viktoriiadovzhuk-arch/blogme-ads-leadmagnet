import { getStore } from "@netlify/blobs";
import crypto from "crypto";

// Прайси, на які встановлюється фінальна ціна за згенерованим кодом
const TARGET_PRICES = {
  start: 3799,
  vip:   4599
};

// 24 години у мілісекундах
const TTL_MS = 24 * 60 * 60 * 1000;

// Генерує читабельний код типу "EARLY-A8K2X"
function genCode() {
  // Без літер, які легко сплутати: O/0, I/1, L
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return "EARLY-" + s;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { email } = await req.json();
    const emailKey = (email || "").toLowerCase().trim();

    if (!emailKey || !emailKey.includes("@") || emailKey.length > 200) {
      return new Response(JSON.stringify({ error: "Введи коректний email" }), { status: 400 });
    }

    const store = getStore("dynamic_promos");

    // ===== ПЕРЕВІРКА: один email — один код назавжди =====
    // Якщо за цим email хоч раз генерувався код — більше не видаємо.
    // Виняток: код досі валідний (не протермінований і не використаний) —
    // повертаємо його (захист від спаму своїх же кодів).
    const existingRaw = await store.get("email_" + emailKey);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        const isExpired = !existing.expiresAt || new Date(existing.expiresAt) <= new Date();
        const isUsed = !!existing.used;

        if (!isExpired && !isUsed) {
          // Активний код — повертаємо його
          return new Response(JSON.stringify({
            code: existing.code,
            expiresAt: existing.expiresAt,
            duplicate: true
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        // Старий код є, але невалідний (протерміновано або використано) — НЕ ВИДАЄМО НОВИЙ
        if (isUsed) {
          return new Response(JSON.stringify({
            error: "Цей email вже використовував промокод. Якщо щось не вийшло — пиши Вікторії в Telegram.",
            alreadyUsed: true
          }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        // isExpired
        return new Response(JSON.stringify({
          error: "Термін дії твого промокоду минув. Він був дійсний 24 години.",
          expired: true
        }), { status: 410, headers: { "Content-Type": "application/json" } });
      } catch {}
    }

    // ===== ГЕНЕРАЦІЯ НОВОГО =====
    // Перевірка унікальності — спробуємо до 5 разів
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
      return new Response(JSON.stringify({ error: "Не вдалося згенерувати код, спробуйте ще раз" }), { status: 500 });
    }

    const now = Date.now();
    const expiresAt = new Date(now + TTL_MS).toISOString();

    const promoData = {
      code,
      email: emailKey,
      type: "fixed_per_plan",
      prices: TARGET_PRICES, // { start: 3799, vip: 4599 }
      createdAt: new Date(now).toISOString(),
      expiresAt,
      used: false
    };

    // Індекси: за кодом і за email
    await store.set("code_" + code, JSON.stringify(promoData));
    await store.set("email_" + emailKey, JSON.stringify(promoData));

    return new Response(JSON.stringify({
      code,
      expiresAt,
      duplicate: false
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("generate-promo error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
