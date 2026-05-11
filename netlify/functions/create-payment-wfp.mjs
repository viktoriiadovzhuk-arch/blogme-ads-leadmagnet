import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import { applyPromoAsync } from "./_promos.mjs";

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { plan, email, promoCode } = await req.json();

    if (!plan || !email) {
      return new Response(JSON.stringify({ error: "plan and email are required" }), { status: 400 });
    }
    if (!["start", "vip"].includes(plan)) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400 });
    }

    const WFP_MERCHANT = process.env.WFP_MERCHANT;
    const WFP_SECRET = process.env.WFP_SECRET;

    if (!WFP_MERCHANT || !WFP_SECRET) {
      return new Response(JSON.stringify({ error: "WayForPay not configured" }), { status: 500 });
    }

    const SITE_URL = process.env.URL || "https://blogminorets.netlify.app";

    // =============== APPLY PROMO (SERVER-SIDE) ===============
    const priced = await applyPromoAsync(promoCode, plan, email);
    if (!priced.ok) {
      return new Response(JSON.stringify({ error: priced.error }), { status: 400 });
    }

    const planName = plan === "vip" ? "Блог Мі — тариф VIP" : "Блог Мі — тариф Start";
    const displayName = priced.code ? `${planName} (${priced.code})` : planName;
    const amountStr = String(priced.price); // WFP працює з рядками гривень
    // =========================================================

    const orderReference = "BM_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const orderDate = Math.floor(Date.now() / 1000).toString();

    // HMAC_MD5 signature
    // String: merchantAccount;merchantDomainName;orderReference;orderDate;amount;currency;productName;productCount;productPrice
    const signString = [
      WFP_MERCHANT,
      "blogminorets.netlify.app",
      orderReference,
      orderDate,
      amountStr,
      "UAH",
      displayName,
      "1",
      amountStr
    ].join(";");

    const merchantSignature = crypto
      .createHmac("md5", WFP_SECRET)
      .update(signString)
      .digest("hex");

    // Save payment info for webhook matching
    const store = getStore("payments");
    await store.set("wfp_" + orderReference, JSON.stringify({
      email: email.toLowerCase().trim(),
      plan,
      promoCode: priced.code || null,
      amountUAH: priced.price,
      orderReference,
      method: "wfp",
      status: "pending",
      createdAt: new Date().toISOString()
    }));

    // Return widget params to frontend
    const widgetParams = {
      merchantAccount: WFP_MERCHANT,
      merchantDomainName: "blogminorets.netlify.app",
      authorizationType: "SimpleSignature",
      merchantSignature,
      orderReference,
      orderDate,
      amount: amountStr,
      currency: "UAH",
      productName: [displayName],
      productPrice: [amountStr],
      productCount: ["1"],
      clientEmail: email,
      language: "UA",
      returnUrl: SITE_URL + "/thankyou",
      serviceUrl: SITE_URL + "/.netlify/functions/webhook"
    };

    return new Response(JSON.stringify({ ok: true, widgetParams }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("WFP create-payment error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
