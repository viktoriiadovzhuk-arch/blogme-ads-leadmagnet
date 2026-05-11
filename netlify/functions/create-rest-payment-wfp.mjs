import { getStore } from "@netlify/blobs";
import crypto from "crypto";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "no_token" }), { status: 400 });
    }

    const bookingsStore = getStore("bookings");
    const raw = await bookingsStore.get("token_" + token);
    if (!raw) {
      return new Response(JSON.stringify({ error: "Бронь не знайдено" }), { status: 404 });
    }

    const booking = JSON.parse(raw);

    if (new Date() > new Date(booking.payRestDeadline)) {
      return new Response(JSON.stringify({ error: "Термін дії посилання минув" }), { status: 410 });
    }
    if (booking.status === "fully_paid") {
      return new Response(JSON.stringify({ error: "Вже повністю оплачено" }), { status: 409 });
    }
    if (booking.status !== "booked") {
      return new Response(JSON.stringify({ error: "Бронь не активна" }), { status: 409 });
    }

    const WFP_MERCHANT = process.env.WFP_MERCHANT;
    const WFP_SECRET = process.env.WFP_SECRET;

    if (!WFP_MERCHANT || !WFP_SECRET) {
      return new Response(JSON.stringify({ error: "WayForPay not configured" }), { status: 500 });
    }

    const SITE_URL = process.env.URL || "https://blogminorets.netlify.app";

    const planLabel = booking.plan === "vip" ? "VIP" : "Start";
    const productName = "Доплата залишку — тариф " + planLabel;
    const amountStr = String(booking.remaining); // у гривнях

    const orderReference = "BMR_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const orderDate = Math.floor(Date.now() / 1000).toString();

    // HMAC_MD5 signature
    const signString = [
      WFP_MERCHANT,
      "blogminorets.netlify.app",
      orderReference,
      orderDate,
      amountStr,
      "UAH",
      productName,
      "1",
      amountStr
    ].join(";");

    const merchantSignature = crypto
      .createHmac("md5", WFP_SECRET)
      .update(signString)
      .digest("hex");

    // Save для webhook — як rest_payment з токеном
    const paymentsStore = getStore("payments");
    await paymentsStore.set("wfp_" + orderReference, JSON.stringify({
      email: booking.email,
      plan: booking.plan,
      kind: "rest_payment",
      token,
      amountUAH: booking.remaining,
      orderReference,
      method: "wfp",
      status: "pending",
      createdAt: new Date().toISOString()
    }));

    // Зберігаємо посилання у самій броні теж
    booking.wfpRestOrderRef = orderReference;
    await bookingsStore.set("token_" + token, JSON.stringify(booking));
    await bookingsStore.set("email_" + booking.email + "_" + booking.plan, JSON.stringify(booking));

    const widgetParams = {
      merchantAccount: WFP_MERCHANT,
      merchantDomainName: "blogminorets.netlify.app",
      authorizationType: "SimpleSignature",
      merchantSignature,
      orderReference,
      orderDate,
      amount: amountStr,
      currency: "UAH",
      productName: [productName],
      productPrice: [amountStr],
      productCount: ["1"],
      clientEmail: booking.email,
      language: "UA",
      returnUrl: SITE_URL + "/thankyou",
      serviceUrl: SITE_URL + "/.netlify/functions/webhook"
    };

    return new Response(JSON.stringify({ ok: true, widgetParams }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("create-rest-payment-wfp error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
