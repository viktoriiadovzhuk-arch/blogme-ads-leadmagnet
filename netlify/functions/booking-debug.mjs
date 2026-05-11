import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }

  if (body.adminKey !== process.env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: "Auth failed" }), { status: 403 });
  }

  const store = getStore("bookings");

  // ===== Search by email =====
  if (body.action === "searchEmail" && body.email) {
    const searchEmail = body.email.toLowerCase().trim();
    const list = await store.list({ prefix: "token_" });
    const items = [];

    for (const item of list.blobs) {
      try {
        const raw = await store.get(item.key);
        if (!raw) continue;
        const d = JSON.parse(raw);
        if (!d.email) continue;
        // Часткове співпадіння (якщо вводять без точного домену)
        if (d.email.toLowerCase().includes(searchEmail)) {
          items.push({
            token: d.token?.slice(0, 12) + "...",
            tokenFull: d.token,
            email: d.email,
            plan: d.plan,
            fullPrice: d.fullPrice,
            paidFee: d.paidFee || 1000,
            remaining: d.remaining,
            status: d.status,
            bookingInvoiceId: d.bookingInvoiceId,
            restInvoiceId: d.restInvoiceId,
            wfpRestOrderRef: d.wfpRestOrderRef,
            createdAt: d.createdAt,
            bookedAt: d.bookedAt || null,
            fullyPaidAt: d.fullyPaidAt || null,
            fullPaidUrl: d.fullPaidUrl,
            payRestDeadline: d.payRestDeadline
          });
        }
      } catch {}
    }

    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return new Response(JSON.stringify({
      ok: true,
      query: searchEmail,
      count: items.length,
      results: items
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // ===== List last bookings =====
  if (body.action === "list") {
    const list = await store.list({ prefix: "token_" });
    const items = [];

    for (const item of list.blobs) {
      try {
        const raw = await store.get(item.key);
        if (!raw) continue;
        const d = JSON.parse(raw);
        items.push({
          token: d.token?.slice(0, 12) + "...",
          email: d.email,
          plan: d.plan,
          fullPrice: d.fullPrice,
          status: d.status,
          bookingInvoiceId: d.bookingInvoiceId,
          createdAt: d.createdAt,
          bookedAt: d.bookedAt || null,
          fullyPaidAt: d.fullyPaidAt || null,
          fullPaidUrl: d.fullPaidUrl
        });
      } catch {}
    }

    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return new Response(JSON.stringify({
      ok: true,
      count: items.length,
      lastFifty: items.slice(0, 50),
      env: {
        URL_env: process.env.URL || "(не встановлено)",
        SITE_URL_default: "https://julianorets.online"
      }
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // ===== Check single invoice in Mono =====
  if (body.action === "checkMono" && body.invoiceId) {
    const MONO_TOKEN = process.env.MONO_TOKEN;
    if (!MONO_TOKEN) {
      return new Response(JSON.stringify({ error: "no MONO_TOKEN" }), { status: 500 });
    }

    try {
      const resp = await fetch(
        `https://api.monobank.ua/api/merchant/invoice/status?invoiceId=${body.invoiceId}`,
        { headers: { "X-Token": MONO_TOKEN } }
      );
      const data = await resp.json();
      return new Response(JSON.stringify({
        ok: true,
        monoData: data
      }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // ===== Manually trigger booking confirmation =====
  // Якщо знайшли в Mono "success" — викликаємо handleSuccessBooking вручну
  if (body.action === "manualConfirm" && body.token) {
    try {
      // Просто шлемо в той же webhook, імітуючи Mono
      const fakeRef = Buffer.from(JSON.stringify({
        kind: "booking",
        token: body.token
      })).toString("base64url");

      const SITE_URL = process.env.URL || "https://julianorets.online";
      const resp = await fetch(`${SITE_URL}/.netlify/functions/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: "manual-trigger-" + Date.now(),
          status: "success",
          reference: fakeRef,
          amount: 100000 // 1000 ₴ в копійках
        })
      });

      const text = await resp.text();
      return new Response(JSON.stringify({
        ok: true,
        webhookResponse: { status: resp.status, body: text }
      }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({
    error: "Unknown action",
    available: ["list", "checkMono (invoiceId)", "manualConfirm (token)"]
  }), { status: 400 });
};
