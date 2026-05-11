import { getStore } from "@netlify/blobs";
import crypto from "crypto";

// Бронь — фіксована сума 1000 ₴, без промокодів
const BOOKING_AMOUNT = 1000;

// Допустимі повні ціни тарифу (для броні):
// до 30.04 — 3799/4599, після — 4399/5299
const ALLOWED_FULL_PRICES = {
  start: [3799, 4399],
  vip:   [4599, 5299]
};

// Дефолтна ціна (поточна) — якщо фронт не передав
const DEFAULT_FULL_PRICES = {
  start: 3799,
  vip:   4599
};

// Дедлайн доплати — день старту курсу
const PAY_REST_DEADLINE = new Date('2026-05-18T23:59:59+03:00').toISOString();

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { plan, email, fullPrice: requestedFullPrice } = await req.json();
    const emailKey = (email || "").toLowerCase().trim();

    if (!emailKey || !emailKey.includes("@")) {
      return new Response(JSON.stringify({ error: "Невірний email" }), { status: 400 });
    }
    if (!["start", "vip"].includes(plan)) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400 });
    }

    const MONO_TOKEN = process.env.MONO_TOKEN;
    if (!MONO_TOKEN) {
      return new Response(JSON.stringify({ error: "Payment system not configured" }), { status: 500 });
    }

    const SITE_URL = process.env.URL || "https://julianorets.online";

    // ===== ПЕРЕВІРКА ДУБЛЯ =====
    // Якщо вже є активна бронь по цьому email і плану — повертаємо існуюче посилання
    const bookingsStore = getStore("bookings");
    const existingRaw = await bookingsStore.get("email_" + emailKey + "_" + plan);

    if (existingRaw) {
      const existing = JSON.parse(existingRaw);
      // Якщо бронь оплачена і ще не доплачена — даємо посилання на доплату
      if (existing.status === "booked" && existing.fullPaidUrl) {
        return new Response(JSON.stringify({
          duplicate: true,
          fullPaidUrl: existing.fullPaidUrl,
          pageUrl: null,
          message: "У тебе вже є активна бронь. Ось посилання на доплату."
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // Якщо вже повністю оплачено — теж повідомляємо
      if (existing.status === "fully_paid") {
        return new Response(JSON.stringify({
          alreadyPaid: true,
          message: "Цей тариф уже повністю оплачено. Перевір email — там доступ до платформи."
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }

    // ===== ГЕНЕРАЦІЯ ТОКЕНА =====
    // Без дефісів — щоб точно влазив у Telegram start-параметр (ліміт 64, дозволені тільки [a-zA-Z0-9_-])
    const token = crypto.randomBytes(16).toString("hex"); // 32 hex символи
    const fullPaidUrl = `${SITE_URL}/pay-rest?token=${token}`;

    const planName = plan === "vip" ? "Бронь місця — тариф VIP" : "Бронь місця — тариф Start";

    // Валідація fullPrice: має бути одним з допустимих або дефолтним
    let fullPrice = DEFAULT_FULL_PRICES[plan];
    if (requestedFullPrice != null) {
      const num = Number(requestedFullPrice);
      if (ALLOWED_FULL_PRICES[plan].includes(num)) {
        fullPrice = num;
      }
    }

    const remaining = fullPrice - BOOKING_AMOUNT;
    const amountKop = BOOKING_AMOUNT * 100;

    // Reference для webhook — позначка що це бронь
    const reference = Buffer.from(JSON.stringify({
      email: emailKey,
      plan,
      kind: "booking",
      token,
      ts: Date.now()
    })).toString("base64url");

    // ===== ВИКЛИК Monobank =====
    const webHookUrl = `${SITE_URL}/.netlify/functions/webhook`;
    console.log(`📤 Booking: creating Mono invoice. webHookUrl=${webHookUrl}, redirectUrl=${SITE_URL}/thankyou-booking?token=${token}`);

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
          destination: planName,
          comment: planName + " (передоплата 1000 ₴)",
          basketOrder: [{
            name: planName,
            qty: 1,
            sum: amountKop,
            total: amountKop,
            unit: "шт."
          }]
        },
        redirectUrl: `${SITE_URL}/thankyou-booking?token=${token}`,
        webHookUrl,
        validity: 3600,
        paymentType: "debit"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Mono booking error:", response.status, errText);
      return new Response(JSON.stringify({ error: "Не вдалося створити платіж" }), { status: 500 });
    }

    const data = await response.json();

    // ===== ЗБЕРІГАЄМО БРОНЬ =====
    const bookingData = {
      token,
      email: emailKey,
      plan,
      fullPrice,
      bookingAmount: BOOKING_AMOUNT,
      remaining,
      fullPaidUrl,
      payRestDeadline: PAY_REST_DEADLINE,
      bookingInvoiceId: data.invoiceId,
      bookingReference: reference,
      status: "pending",      // pending → booked → fully_paid
      createdAt: new Date().toISOString()
    };

    // Індекс по email+plan (для дедуплікації)
    await bookingsStore.set("email_" + emailKey + "_" + plan, JSON.stringify(bookingData));
    // Індекс по токену (для сторінки доплати)
    await bookingsStore.set("token_" + token, JSON.stringify(bookingData));
    // Індекс по invoiceId (для webhook)
    await bookingsStore.set("invoice_" + data.invoiceId, JSON.stringify(bookingData));

    return new Response(JSON.stringify({
      pageUrl: data.pageUrl,
      token
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("create-booking error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
