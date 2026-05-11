import { getStore } from "@netlify/blobs";

const ACCESS_DAYS = { start: 180, vip: 365 };

export default async (req, context) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });

  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email і пароль обовʼязкові" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // ===== ADMIN LOGIN =====
    const ADMIN_KEY = process.env.ADMIN_KEY;
    if (ADMIN_KEY && password.trim() === ADMIN_KEY) {
      const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const token = Buffer.from(JSON.stringify({
        email: "admin",
        plan: "admin",
        sessionId,
        exp: Date.now() + 24 * 60 * 60 * 1000
      })).toString("base64url");

      return new Response(JSON.stringify({
        success: true, plan: "admin", daysLeft: 999,
        expiresAt: "2099-12-31T23:59:59Z", sessionId, token
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ===== NORMAL LOGIN =====
    const usersStore = getStore("users");
    const userKey = email.toLowerCase().trim();

    let userData;
    try {
      const raw = await usersStore.get(userKey);
      userData = raw ? JSON.parse(raw) : null;
    } catch { userData = null; }

    if (!userData) return new Response(JSON.stringify({ error: "Користувача не знайдено" }), { status: 401, headers: { "Content-Type": "application/json" } });
    if (userData.password !== password.trim()) return new Response(JSON.stringify({ error: "Невірний пароль" }), { status: 401, headers: { "Content-Type": "application/json" } });
    if (!userData.active) return new Response(JSON.stringify({ error: "Акаунт деактивовано" }), { status: 403, headers: { "Content-Type": "application/json" } });

    // Check access expiration
    const plan = userData.plan || "start";
    const maxDays = ACCESS_DAYS[plan] || 180;
    const created = new Date(userData.createdAt).getTime();
    const expiresAt = userData.expiresAt
      ? new Date(userData.expiresAt).getTime()
      : created + maxDays * 24 * 60 * 60 * 1000;
    if (Date.now() > expiresAt) return new Response(JSON.stringify({ error: "Термін доступу закінчився. Зверніться до підтримки." }), { status: 403, headers: { "Content-Type": "application/json" } });

    // ===== SINGLE DEVICE: generate new sessionId, invalidating previous =====
    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    userData.sessionId = sessionId;
    await usersStore.set(userKey, JSON.stringify(userData));

    const token = Buffer.from(JSON.stringify({
      email: userKey, plan, sessionId,
      createdAt: userData.createdAt, expiresAt: new Date(expiresAt).toISOString(),
      exp: Date.now() + 24 * 60 * 60 * 1000
    })).toString("base64url");

    return new Response(JSON.stringify({
      success: true, plan, sessionId,
      createdAt: userData.createdAt,
      expiresAt: new Date(expiresAt).toISOString(),
      daysLeft: Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000)),
      token
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Login error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
