import { getStore } from "@netlify/blobs";

// Адмінська функція: масово завантажити одноразові промокоди.
// Захищена ADMIN_KEY (тим самим, що використовується в admin-users.mjs).
//
// Кожен код у Blobs зберігається у форматі для applyPromoAsync:
//   {
//     code: "LAST-XXXXX",
//     type: "fixed_per_plan",
//     prices: { start: 3799, vip: 4599 },
//     email: null,            // НЕ привʼязаний до email
//     expiresAt: null,        // без терміну дії
//     used: false             // одноразовий
//   }
//
// Коли юзерка використовує код при оплаті — webhook викликає
// markDynamicPromoUsed → ставить used: true → код "згорає".

const TARGET_PRICES = { start: 3799, vip: 4599 };

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { action, adminKey, codes } = body;

  // Auth
  const AK = process.env.ADMIN_KEY;
  if (!adminKey || !AK || adminKey !== AK) {
    return new Response(JSON.stringify({ error: "Auth failed" }), { status: 403 });
  }

  const store = getStore("dynamic_promos");

  // ===== BULK IMPORT =====
  if (action === "import") {
    if (!Array.isArray(codes) || codes.length === 0) {
      return new Response(JSON.stringify({ error: "codes повинен бути масивом" }), { status: 400 });
    }

    const results = { added: 0, skipped: 0, errors: [] };

    for (const rawCode of codes) {
      const code = String(rawCode).trim().toUpperCase();
      if (!code || code.length > 50) {
        results.errors.push({ code: rawCode, reason: "Invalid format" });
        continue;
      }

      // Перевірка: чи вже існує
      const existing = await store.get("code_" + code);
      if (existing) {
        results.skipped++;
        continue;
      }

      const data = {
        code,
        type: "fixed_per_plan",
        prices: TARGET_PRICES,
        email: null,           // не привʼязаний до email
        expiresAt: null,       // без терміну дії
        used: false,
        bulkImported: true,
        importedAt: new Date().toISOString()
      };

      await store.set("code_" + code, JSON.stringify(data));
      results.added++;
    }

    return new Response(JSON.stringify({ ok: true, ...results }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  // ===== LIST (показати всі імпортовані коди + статуси) =====
  if (action === "list") {
    const list = await store.list({ prefix: "code_" });
    const codes = [];
    for (const item of list.blobs) {
      try {
        const raw = await store.get(item.key);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (!data.bulkImported) continue; // тільки масово імпортовані
        codes.push({
          code: data.code,
          used: !!data.used,
          usedAt: data.usedAt || null,
          importedAt: data.importedAt || null
        });
      } catch {}
    }

    codes.sort((a, b) => a.code.localeCompare(b.code));
    const usedCount = codes.filter(c => c.used).length;

    return new Response(JSON.stringify({
      ok: true,
      total: codes.length,
      used: usedCount,
      remaining: codes.length - usedCount,
      codes
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
};
