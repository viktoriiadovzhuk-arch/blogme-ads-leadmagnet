import { getStore } from "@netlify/blobs";

function genPass() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    console.error("Parse error:", e);
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { action, adminKey } = body;
  console.log("Admin action:", action);

  // Auth
  const AK = process.env.ADMIN_KEY;
  if (!adminKey || !AK || adminKey !== AK) {
    console.log("Auth failed. Key provided:", !!adminKey, "Env key exists:", !!AK);
    return new Response(JSON.stringify({ error: "Невірний admin ключ" }), {
      status: 403, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const store = getStore("users");

    // ===== LIST =====
    if (action === "list") {
      console.log("Listing users...");
      const result = await store.list();
      console.log("Blobs found:", result.blobs.length);

      const users = [];
      for (const item of result.blobs) {
        try {
          const raw = await store.get(item.key);
          if (raw) {
            const u = JSON.parse(raw);
            // Calculate expiry
            const plan = u.plan || "start";
            const days = plan === "vip" ? 365 : 180;
            if (!u.expiresAt) {
              u.expiresAt = new Date(new Date(u.createdAt).getTime() + days * 86400000).toISOString();
            }
            u.daysLeft = Math.max(0, Math.ceil((new Date(u.expiresAt).getTime() - Date.now()) / 86400000));
            users.push(u);
          }
        } catch (e) {
          console.error("Error reading:", item.key, e.message);
        }
      }

      users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      console.log("Returning", users.length, "users");

      return new Response(JSON.stringify({ ok: true, users }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // ===== ADD =====
    if (action === "add") {
      const email = (body.email || "").toLowerCase().trim();
      const plan = body.plan === "vip" ? "vip" : "start";
      // Опціональна сума в гривнях. Якщо адмін не передав — fallback на базову ціну.
      const fallbackPrice = plan === "vip" ? 4599 : 3799;
      const amountUAH = body.amountUAH != null && !isNaN(Number(body.amountUAH))
        ? Number(body.amountUAH)
        : fallbackPrice;
      // Опціональна сума що "оплачена в моменті". Якщо адмін не передав — = amountUAH.
      // Корисно якщо адмін додає юзерку яка щось доплатила (тоді paidFeeNow = доплата)
      const paidFeeNow = body.paidFeeNow != null && !isNaN(Number(body.paidFeeNow))
        ? Number(body.paidFeeNow)
        : amountUAH;
      console.log("Adding user:", email, plan, "amount:", amountUAH, "paid_fee:", paidFeeNow);

      if (!email || !email.includes("@")) {
        return new Response(JSON.stringify({ error: "Невірний email" }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }

      const password = genPass();
      const now = new Date();
      const days = plan === "vip" ? 365 : 180;
      const expiresAt = new Date(now.getTime() + days * 86400000).toISOString();

      const userData = {
        email, password, plan,
        invoiceId: "manual_" + Date.now(),
        amountUAH,
        createdAt: now.toISOString(),
        expiresAt,
        active: true,
        addedBy: "admin"
      };

      console.log("Saving to store:", email);
      await store.set(email, JSON.stringify(userData));
      console.log("Saved OK. Password:", password);

      // SendPulse
      try {
        const label = plan === "vip" ? "VIP" : "Start";
        await fetch("https://events.sendpulse.com/events/id/f6ebe1b2240f427aa2ec77b5495f4457/9399561", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            product_name: "Блог Мі — тариф " + label,
            product_price: String(amountUAH),
            paid_fee: String(paidFeeNow),
            full_paid_url: "",
            order_date: now.toISOString().split("T")[0],
            password,
            tariff: label
          })
        });
        console.log("SendPulse sent, price:", amountUAH, "paid_fee:", paidFeeNow);
      } catch (e) {
        console.error("SendPulse err:", e.message);
      }

      return new Response(JSON.stringify({ ok: true, password, email, plan }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // ===== CHANGE PLAN =====
    if (action === "changePlan") {
      const email = (body.email || "").toLowerCase().trim();
      const newPlan = body.newPlan === "vip" ? "vip" : "start";
      console.log("Changing plan:", email, "->", newPlan);

      const raw = await store.get(email);
      if (!raw) {
        return new Response(JSON.stringify({ error: "Не знайдено" }), {
          status: 404, headers: { "Content-Type": "application/json" }
        });
      }

      const user = JSON.parse(raw);
      user.plan = newPlan;
      const days = newPlan === "vip" ? 365 : 180;
      user.expiresAt = new Date(new Date(user.createdAt).getTime() + days * 86400000).toISOString();
      await store.set(email, JSON.stringify(user));
      console.log("Plan changed OK");

      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // ===== EXTEND =====
    if (action === "extend") {
      const email = (body.email || "").toLowerCase().trim();
      const addDays = parseInt(body.days) || 30;
      console.log("Extending:", email, "+", addDays, "days");

      const raw = await store.get(email);
      if (!raw) {
        return new Response(JSON.stringify({ error: "Не знайдено" }), {
          status: 404, headers: { "Content-Type": "application/json" }
        });
      }

      const user = JSON.parse(raw);
      const plan = user.plan || "start";
      const defDays = plan === "vip" ? 365 : 180;
      const currentExpiry = user.expiresAt
        ? new Date(user.expiresAt).getTime()
        : new Date(user.createdAt).getTime() + defDays * 86400000;
      const base = Math.max(currentExpiry, Date.now());
      user.expiresAt = new Date(base + addDays * 86400000).toISOString();
      await store.set(email, JSON.stringify(user));
      console.log("Extended to:", user.expiresAt);

      return new Response(JSON.stringify({ ok: true, expiresAt: user.expiresAt }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // ===== DELETE =====
    if (action === "delete") {
      const email = (body.email || "").toLowerCase().trim();
      console.log("Deleting:", email);
      await store.delete(email);
      console.log("Deleted OK");

      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("ADMIN ERROR:", err.message, err.stack);
    return new Response(JSON.stringify({ error: "Server error: " + err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};
