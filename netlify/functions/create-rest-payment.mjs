import { getStore } from "@netlify/blobs";

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

    const MONO_TOKEN = process.env.MONO_TOKEN;
    if (!MONO_TOKEN) {
      return new Response(JSON.stringify({ error: "Payment system not configured" }), { status: 500 });
    }

    const SITE_URL = process.env.URL || "https://julianorets.online";

    const planLabel = booking.plan === "vip" ? "VIP" : "Start";
    const productName = "Доплата залишку — тариф " + planLabel;
    const amountKop = booking.remaining * 100;

    const reference = Buffer.from(JSON.stringify({
      email: booking.email,
      plan: booking.plan,
      kind: "rest_payment",
      token,
      ts: Date.now()
    })).toString("base64url");

    // === КОРОТКИЙ monoRef для thankyou-booking polling ===
    // Окремий префікс "r" щоб відрізнити від звичайної повної оплати ("m"),
    // тому що thankyou-booking.html — інша сторінка.
    const monoRef = "r" + Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8);

    const response = await fetch("https://api.monobank.ua/api/merchant/invoice/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Token": MONO_TOKEN
      },
      body: JSON.stringify({
        amount: amountKop,
        ccy: 980,
        merchantPaymInfo: {
          reference,
          destination: productName,
          comment: productName,
          basketOrder: [{
            name: productName,
            qty: 1,
            sum: amountKop,
            total: amountKop,
            unit: "шт."
          }]
        },
        redirectUrl: `${SITE_URL}/thankyou-booking?ref=${monoRef}`,
        webHookUrl: `${SITE_URL}/.netlify/functions/webhook`,
        validity: 3600,
        paymentType: "debit"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Mono rest payment error:", response.status, errText);
      return new Response(JSON.stringify({ error: "Не вдалося створити платіж" }), { status: 500 });
    }

    const data = await response.json();

    // Записуємо invoice_id залишку, щоб webhook знав куди це відносити
    booking.restInvoiceId = data.invoiceId;
    booking.restMonoRef = monoRef;
    await bookingsStore.set("token_" + token, JSON.stringify(booking));
    await bookingsStore.set("email_" + booking.email + "_" + booking.plan, JSON.stringify(booking));
    await bookingsStore.set("invoice_" + data.invoiceId, JSON.stringify(booking));

    // Початковий запис у payments для polling із thankyou-booking
    // (webhook оновить його при зміні статусу).
    const paymentsStore = getStore("payments");
    await paymentsStore.set(data.invoiceId, JSON.stringify({
      email: booking.email,
      plan: booking.plan,
      kind: "rest_payment",
      token,
      invoiceId: data.invoiceId,
      reference,
      monoRef,
      status: "created",
      amountUAH: booking.remaining,
      createdAt: new Date().toISOString()
    }));
    await paymentsStore.set(`mono_ref_${monoRef}`, data.invoiceId);

    return new Response(JSON.stringify({ pageUrl: data.pageUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("create-rest-payment error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
