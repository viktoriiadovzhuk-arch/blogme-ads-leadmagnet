import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response(JSON.stringify({ valid: false }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const data = JSON.parse(Buffer.from(token.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
    if (data.exp < Date.now()) return new Response(JSON.stringify({ valid: false, reason: "expired" }), { status: 200, headers: { "Content-Type": "application/json" } });

    // Admin always valid
    if (data.email === "admin") return new Response(JSON.stringify({ valid: true }), { status: 200, headers: { "Content-Type": "application/json" } });

    // Check sessionId against stored value
    const usersStore = getStore("users");
    let userData;
    try {
      const raw = await usersStore.get(data.email);
      userData = raw ? JSON.parse(raw) : null;
    } catch { userData = null; }

    if (!userData || userData.sessionId !== data.sessionId) {
      return new Response(JSON.stringify({ valid: false, reason: "another_device" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ valid: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ valid: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};
