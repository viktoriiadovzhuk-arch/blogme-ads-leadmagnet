import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import { markDynamicPromoUsed } from "./_promos.mjs";

// SendPulse Events URLs
const SP_FULL_PAID = "https://events.sendpulse.com/events/id/f6ebe1b2240f427aa2ec77b5495f4457/9399561";
const SP_BOOKING   = "https://events.sendpulse.com/events/id/9f6928a6c59c48a7fa68914cfc8afb6b/9399561";

function generatePassword() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ===== SENDPULSE: подія "повна оплата" — створює юзера =====
async function sendpulseFullyPaid({ email, productName, fullPrice, paidFeeNow, password, planLabel }) {
  try {
    // paidFeeNow — сума що оплачена ЦІЄЮ операцією
    // (при повній оплаті = fullPrice, при доплаті залишку = remaining)
    const feeNow = paidFeeNow != null ? paidFeeNow : fullPrice;
    await fetch(SP_FULL_PAID, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        product_name: productName,
        product_price: String(fullPrice),
        paid_fee: String(feeNow),
        full_paid_url: "",
        order_date: new Date().toISOString().split("T")[0],
        password,
        tariff: planLabel
      })
    });
    console.log(`📧 SendPulse FULL PAID for ${email}, fullPrice: ${fullPrice}, paid_fee: ${feeNow}`);
  } catch (e) {
    console.error("SendPulse full paid error:", e);
  }
}

// ===== SENDPULSE: подія "бронь" — без юзера, без пароля =====
async function sendpulseBooking({ email, planLabel, fullPrice, paidFee, fullPaidUrl }) {
  try {
    const remaining = Math.max(0, Number(fullPrice) - Number(paidFee));
    await fetch(SP_BOOKING, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        product_name: "Блог Мі — тариф " + planLabel + " (бронь)",
        product_price: String(fullPrice),
        paid_fee: String(paidFee),
        remaining_amount: String(remaining),
        is_fully_paid: "false",
        full_paid_url: fullPaidUrl,
        order_date: new Date().toISOString().split("T")[0],
        tariff: planLabel
      })
    });
    console.log(`📧 SendPulse BOOKING for ${email}, paid: ${paidFee}, remaining: ${remaining}, url: ${fullPaidUrl}`);
  } catch (e) {
    console.error("SendPulse booking error:", e);
  }
}

// ===== Створення юзера в LMS =====
async function createUser(email, plan, invoiceId, amountUAH, paidFeeNow) {
  const usersStore = getStore("users");
  const password = generatePassword();
  const now = new Date();
  const userKey = email.toLowerCase().trim();
  const planLabel = plan === "vip" ? "VIP" : "Start";

  await usersStore.set(userKey, JSON.stringify({
    email, password, plan, invoiceId,
    amountUAH: amountUAH || null,
    createdAt: now.toISOString(),
    active: true
  }));

  console.log(`✅ User created: ${email}, plan: ${plan}, amount: ${amountUAH}`);

  // SendPulse: повна оплата
  // paidFeeNow — реальна сума цієї операції (доплата) або повна ціна (одразу)
  await sendpulseFullyPaid({
    email,
    productName: "Блог Мі — тариф " + planLabel,
    fullPrice: amountUAH,
    paidFeeNow: paidFeeNow != null ? paidFeeNow : amountUAH,
    password,
    planLabel
  });

  // External webhook
  const EW = process.env.EXTERNAL_WEBHOOK_URL;
  if (EW) {
    try { await fetch(EW, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, plan: planLabel, invoiceId, amountUAH }) }); } catch {}
  }

  return password;
}

// ===== Обробник: успішна повна оплата =====
async function handleSuccessFull(email, plan, invoiceId, amountUAH, promoCode) {
  await createUser(email, plan, invoiceId, amountUAH);
  // Якщо був використаний динамічний промокод — позначаємо як використаний
  if (promoCode) {
    await markDynamicPromoUsed(promoCode);
  }
}

// ===== Обробник: успішна бронь =====
async function handleSuccessBooking(token) {
  const bookingsStore = getStore("bookings");
  const raw = await bookingsStore.get("token_" + token);
  if (!raw) {
    console.error("Booking not found for token:", token);
    return;
  }

  const booking = JSON.parse(raw);
  if (booking.status === "booked" || booking.status === "fully_paid") {
    console.log("Booking already processed:", token);
    return;
  }

  booking.status = "booked";
  booking.bookedAt = new Date().toISOString();

  // Перезаписуємо у всі індекси
  await bookingsStore.set("token_" + token, JSON.stringify(booking));
  await bookingsStore.set("email_" + booking.email + "_" + booking.plan, JSON.stringify(booking));
  await bookingsStore.set("invoice_" + booking.bookingInvoiceId, JSON.stringify(booking));

  const planLabel = booking.plan === "vip" ? "VIP" : "Start";

  await sendpulseBooking({
    email: booking.email,
    planLabel,
    fullPrice: booking.fullPrice,
    paidFee: booking.bookingAmount,
    fullPaidUrl: booking.fullPaidUrl
  });

  console.log(`✅ Booking confirmed: ${booking.email}, plan: ${booking.plan}`);
}

// ===== Обробник: успішна доплата залишку =====
async function handleSuccessRest(token, paymentRef) {
  const bookingsStore = getStore("bookings");
  const raw = await bookingsStore.get("token_" + token);
  if (!raw) {
    console.error("Booking not found for rest payment, token:", token);
    return;
  }

  const booking = JSON.parse(raw);
  if (booking.status === "fully_paid") {
    console.log("Booking already fully paid:", token);
    return;
  }

  booking.status = "fully_paid";
  booking.fullyPaidAt = new Date().toISOString();
  if (paymentRef) booking.fullyPaidRef = paymentRef;
  await bookingsStore.set("token_" + token, JSON.stringify(booking));
  await bookingsStore.set("email_" + booking.email + "_" + booking.plan, JSON.stringify(booking));
  if (booking.restInvoiceId) {
    await bookingsStore.set("invoice_" + booking.restInvoiceId, JSON.stringify(booking));
  }

  // Створюємо юзера + летить SendPulse "повна оплата"
  // У SP передаємо: product_price=повна ціна, paid_fee=сума доплати (booking.remaining)
  const ref = paymentRef || booking.restInvoiceId || booking.wfpRestOrderRef;
  await createUser(booking.email, booking.plan, ref, booking.fullPrice, booking.remaining);
  console.log(`✅ Booking fully paid: ${booking.email}, plan: ${booking.plan}, ref: ${ref}, paid_fee=${booking.remaining}`);
}

// ===== Допоміжне: оновити payments[invoiceId] зі статусом =====
// Викликаємо для будь-якого Monobank webhook (full / booking / rest_payment),
// щоб polling з thankyou.html / thankyou-booking.html бачив актуальний статус.
async function updatePaymentStatus(invoiceId, status, extra = {}) {
  const paymentsStore = getStore("payments");
  try {
    const raw = await paymentsStore.get(invoiceId);
    const data = raw ? JSON.parse(raw) : { invoiceId };
    data.status = status;
    Object.assign(data, extra);
    await paymentsStore.set(invoiceId, JSON.stringify(data));
  } catch (e) {
    console.error("updatePaymentStatus error:", e);
  }
}

// ===== ГОЛОВНИЙ HANDLER =====
export default async (req) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  try {
    const body = await req.json();
    const paymentsStore = getStore("payments");
    const bookingsStore = getStore("bookings");

    // ========== WAYFORPAY ==========
    if (body.merchantAccount && body.orderReference) {
      console.log("WFP webhook:", body.orderReference, body.transactionStatus);

      const orderRef = body.orderReference;
      const status = body.transactionStatus;

      let paymentData;
      try {
        const raw = await paymentsStore.get("wfp_" + orderRef);
        paymentData = raw ? JSON.parse(raw) : null;
      } catch { paymentData = null; }

      if (paymentData) {
        paymentData.status = status;
        await paymentsStore.set("wfp_" + orderRef, JSON.stringify(paymentData));

        if (status === "Approved") {
          if (paymentData.kind === "rest_payment" && paymentData.token) {
            // WFP-доплата залишку
            await handleSuccessRest(paymentData.token, orderRef);
          } else {
            // WFP — звичайна повна оплата
            await handleSuccessFull(paymentData.email, paymentData.plan, orderRef, paymentData.amountUAH, paymentData.promoCode);
          }
        }
      }

      // Sign WFP response
      const WFP_SECRET = process.env.WFP_SECRET;
      const time = Math.floor(Date.now() / 1000);
      const responseStatus = "accept";
      const responseSignString = orderRef + ";" + responseStatus + ";" + time;
      const responseSignature = crypto
        .createHmac("md5", WFP_SECRET || "")
        .update(responseSignString)
        .digest("hex");

      return new Response(JSON.stringify({
        orderReference: orderRef,
        status: responseStatus,
        time,
        signature: responseSignature
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ========== MONOBANK ==========
    if (body.invoiceId) {
      console.log("Mono webhook:", body.invoiceId, body.status);

      const { invoiceId, status, reference } = body;

      // Декодуємо reference щоб зрозуміти тип платежу
      let decoded = null;
      if (reference) {
        try {
          decoded = JSON.parse(Buffer.from(reference, "base64url").toString());
        } catch {}
      }

      const kind = decoded?.kind || "full"; // full | booking | rest_payment

      // ВСІ Monobank webhooks → оновлюємо payments[invoiceId] зі статусом,
      // щоб thankyou polling бачив актуальний стан.
      // Це працює для всіх трьох kind: full, booking, rest_payment.
      const failureReason = body.failureReason || body.errCode || null;
      await updatePaymentStatus(invoiceId, status, failureReason ? { failureReason } : {});

      if (status !== "success") {
        // Будь-який не-success статус — оновлення вже зроблено вище, виходимо.
        return new Response("OK", { status: 200 });
      }

      // ===== status === "success" =====
      const monoAmountUAH = body.amount ? Math.round(body.amount / 100) : null;

      if (kind === "booking") {
        await handleSuccessBooking(decoded.token);
      } else if (kind === "rest_payment") {
        await handleSuccessRest(decoded.token);
      } else {
        // Звичайна повна оплата
        let paymentData;
        try {
          const raw = await paymentsStore.get(invoiceId);
          paymentData = raw ? JSON.parse(raw) : null;
        } catch { paymentData = null; }

        if (!paymentData && decoded) {
          paymentData = { email: decoded.email, plan: decoded.plan, invoiceId };
        }

        if (paymentData) {
          const finalAmount = paymentData.amountUAH != null ? paymentData.amountUAH : monoAmountUAH;
          await handleSuccessFull(paymentData.email, paymentData.plan, invoiceId, finalAmount, paymentData.promoCode);
        }
      }

      return new Response("OK", { status: 200 });
    }

    console.log("Unknown webhook format:", JSON.stringify(body).slice(0, 200));
    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("OK", { status: 200 });
  }
};
