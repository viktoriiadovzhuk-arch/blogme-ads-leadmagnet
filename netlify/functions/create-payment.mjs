import { getStore } from "@netlify/blobs";
import { applyPromoAsync } from "./_promos.mjs";

export default async (req, context) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { plan, email, promoCode } = await req.json();

    // Validate input
    if (!plan || !email) {
      return new Response(JSON.stringify({ error: "plan and email are required" }), { status: 400 });
    }
    if (!["start", "vip"].includes(plan)) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400 });
    }

    const MONO_TOKEN = process.env.MONO_TOKEN;
    if (!MONO_TOKEN) {
      return new Response(JSON.stringify({ error: "Payment system not configured" }), { status: 500 });
    }

    const SITE_URL = process.env.URL || "https://blogmenorets.netlify.app";

    // =============== APPLY PROMO (SERVER-SIDE) ===============
    const priced = await applyPromoAsync(promoCode, plan, email);
    if (!priced.ok) {
      return new Response(JSON.stringify({ error: priced.error }), { status: 400 });
    }

    const planName = plan === "vip" ? "Блог Мі — тариф VIP" : "Блог Мі — тариф Start";
    const amountKop = priced.price * 100; // UAH → копійки
    // =========================================================

    // Generate unique reference (embeds email + plan + promo for webhook)
    const reference = Buffer.from(JSON.stringify({
      email, plan, promo: priced.code || null, ts: Date.now()
    })).toString("base64url");

    // === КОРОТКИЙ monoRef для URL/polling ===
    // Monobank API підтримує лише redirectUrl (не successUrl/failUrl),
    // який спрацьовує однаково при успіху, відмові й скасуванні.
    // Тому генеруємо короткий ID, передаємо його у redirectUrl як ?ref=,
    // а на thankyou.html робимо polling статусу через check-payment-status.
    const monoRef = "m" + Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8);

    // Create Monobank invoice
    const response = await fetch("https://api.monobank.ua/api/merchant/invoice/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Token": MONO_TOKEN
      },
      body: JSON.stringify({
        amount: amountKop,
        ccy: 980, // UAH
        merchantPaymInfo: {
          reference: reference,
          destination: planName,
          comment: priced.code ? `${planName} (промокод: ${priced.code})` : planName,
          basketOrder: [{
            name: planName,
            qty: 1,
            sum: amountKop,
            total: amountKop,
            unit: "шт."
          }]
        },
        redirectUrl: `${SITE_URL}/thankyou?ref=${monoRef}`,
        webHookUrl: `${SITE_URL}/.netlify/functions/webhook`,
        validity: 3600, // 1 hour
        paymentType: "debit"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Monobank error:", response.status, errText);
      return new Response(JSON.stringify({ error: "Payment creation failed" }), { status: 500 });
    }

    const data = await response.json();

    // Store pending payment info for webhook matching
    const store = getStore("payments");
    await store.set(data.invoiceId, JSON.stringify({
      email,
      plan,
      promoCode: priced.code || null,
      amountUAH: priced.price,
      invoiceId: data.invoiceId,
      reference,
      monoRef,
      status: "created",
      createdAt: new Date().toISOString()
    }));

    // Mapping monoRef → invoiceId, щоб thankyou.html знайшов статус
    // через короткий ID із URL (?ref=monoRef).
    await store.set(`mono_ref_${monoRef}`, data.invoiceId);

    return new Response(JSON.stringify({ pageUrl: data.pageUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("create-payment error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
