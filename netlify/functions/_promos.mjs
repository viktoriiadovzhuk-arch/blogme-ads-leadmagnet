// =====================================================================
// ПРИХОВАНІ ПРОМОКОДИ
// ---------------------------------------------------------------------
// Цей файл виконується ТІЛЬКИ на сервері Netlify і ніколи не віддається
// в браузер. Його не видно у DevTools.
//
// СТАТИЧНІ КОДИ (нижче в PROMOS) — додаються в коді, працюють завжди.
// ДИНАМІЧНІ КОДИ — генеруються через /generate-promo, лежать у Blobs,
// прив'язані до email + 24год TTL.
// =====================================================================

import { getStore } from "@netlify/blobs";

const PROMOS = {
  FRIEND50: { type: 'percent', value: 50,   plans: ['start', 'vip'] },
  VIP1000:  { type: 'fixed',   value: 1000, plans: ['vip'] }
};

// Базові ціни у ГРИВНЯХ
const BASE_PRICES = {
  start: { regular: 3799, expired: 4399 },
  vip:   { regular: 4599, expired: 5299 }
};

const EB_DEADLINE = new Date('2026-04-30T23:59:00+03:00').getTime();

export function getBasePrice(plan) {
  const p = BASE_PRICES[plan];
  if (!p) return null;
  return Date.now() > EB_DEADLINE ? p.expired : p.regular;
}

// ===== СТАТИЧНІ КОДИ (синхронно) =====
export function applyPromo(rawCode, plan) {
  const basePrice = getBasePrice(plan);
  if (basePrice == null) return { ok: false, error: 'Невідомий тариф' };

  if (!rawCode || !String(rawCode).trim()) {
    return { ok: true, price: basePrice, basePrice, discountLabel: null, code: null };
  }

  const code = String(rawCode).trim().toUpperCase();
  const promo = PROMOS[code];

  if (!promo) {
    return { ok: false, error: 'NOT_STATIC' }; // Сигнал — спробуй у динаміці
  }
  if (!promo.plans.includes(plan)) {
    return { ok: false, error: 'Цей промокод не діє для обраного тарифу' };
  }

  let price;
  if (promo.type === 'percent') price = Math.round(basePrice * (1 - promo.value / 100));
  else if (promo.type === 'fixed') price = promo.value;
  else return { ok: false, error: 'Внутрішня помилка' };

  if (price < 1) return { ok: false, error: 'Некоректна ціна' };

  return formatResult(price, basePrice, code);
}

// ===== ДИНАМІЧНІ КОДИ (async) =====
// Перевіряє і статичні, і коди зі стори. Email потрібен для динамічних
// (бо вони привʼязані до email).
export async function applyPromoAsync(rawCode, plan, email) {
  const basePrice = getBasePrice(plan);
  if (basePrice == null) return { ok: false, error: 'Невідомий тариф' };

  if (!rawCode || !String(rawCode).trim()) {
    return { ok: true, price: basePrice, basePrice, discountLabel: null, code: null };
  }

  const code = String(rawCode).trim().toUpperCase();

  // 1) Статичний?
  if (PROMOS[code]) {
    return applyPromo(rawCode, plan);
  }

  // 2) Динамічний (зі стори)
  try {
    const store = getStore("dynamic_promos");
    const raw = await store.get("code_" + code);
    if (!raw) {
      return { ok: false, error: 'Промокод не знайдено' };
    }

    const promoData = JSON.parse(raw);

    // Перевірка терміну дії
    if (promoData.expiresAt && new Date(promoData.expiresAt) < new Date()) {
      return { ok: false, error: 'Термін дії промокоду минув' };
    }

    // Перевірка використаності
    if (promoData.used) {
      return { ok: false, error: 'Промокод уже використано' };
    }

    // Перевірка прив'язки до email
    if (email && promoData.email) {
      const emailKey = String(email).toLowerCase().trim();
      if (emailKey !== promoData.email) {
        return { ok: false, error: 'Цей промокод прив\'язаний до іншого email' };
      }
    }

    // Розрахунок ціни — для типу fixed_per_plan
    if (promoData.type === 'fixed_per_plan') {
      const targetPrice = promoData.prices?.[plan];
      if (!targetPrice) {
        return { ok: false, error: 'Цей промокод не діє для обраного тарифу' };
      }
      // Якщо базова ціна вже нижча або дорівнює target — код не дає вигоди
      if (basePrice <= targetPrice) {
        return { ok: true, price: basePrice, basePrice, discountLabel: null, code };
      }
      return formatResult(targetPrice, basePrice, code);
    }

    return { ok: false, error: 'Невідомий тип промокоду' };

  } catch (err) {
    console.error('applyPromoAsync error:', err);
    return { ok: false, error: 'Помилка валідації промокоду' };
  }
}

// ===== Помічник для форматування результату =====
function formatResult(price, basePrice, code) {
  const savings = basePrice - price;
  const percent = Math.round((savings / basePrice) * 100);
  const discountLabel = percent > 0
    ? `−${percent}% · економія ${savings.toLocaleString('uk-UA')} ₴`
    : null;
  return { ok: true, price, basePrice, discountLabel, code };
}

// ===== Помітити динамічний код як використаний =====
export async function markDynamicPromoUsed(code) {
  if (!code) return;
  try {
    const store = getStore("dynamic_promos");
    const raw = await store.get("code_" + code);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.used) return;
    data.used = true;
    data.usedAt = new Date().toISOString();
    await store.set("code_" + code, JSON.stringify(data));
    if (data.email) {
      await store.set("email_" + data.email, JSON.stringify(data));
    }
  } catch (err) {
    console.error('markDynamicPromoUsed error:', err);
  }
}
