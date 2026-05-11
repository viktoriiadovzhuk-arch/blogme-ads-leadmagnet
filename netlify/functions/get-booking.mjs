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
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }

    const booking = JSON.parse(raw);

    // Перевірка дедлайну
    if (new Date() > new Date(booking.payRestDeadline)) {
      return new Response(JSON.stringify({
        ok: false,
        expired: true,
        plan: booking.plan,
        message: "Термін дії посилання минув"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (booking.status === "fully_paid") {
      return new Response(JSON.stringify({
        ok: false,
        alreadyPaid: true,
        plan: booking.plan,
        email: booking.email,
        message: "Цей тариф уже повністю оплачено"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (booking.status === "pending") {
      return new Response(JSON.stringify({
        ok: false,
        notBooked: true,
        plan: booking.plan,
        message: "Бронь ще не оплачена. Спочатку треба оплатити 1000 ₴."
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // booking.status === "booked"
    return new Response(JSON.stringify({
      ok: true,
      plan: booking.plan,
      email: booking.email,
      fullPrice: booking.fullPrice,
      paidAlready: booking.bookingAmount,
      remaining: booking.remaining,
      payRestDeadline: booking.payRestDeadline
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("get-booking error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
};
