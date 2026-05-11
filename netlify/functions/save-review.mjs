import { getStore } from "@netlify/blobs";

function parseToken(token) {
  try {
    const data = JSON.parse(Buffer.from(token.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

export default async (req) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  try {
    const { token, moduleId, rating, comment, name } = await req.json();
    const user = parseToken(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    if (!moduleId || !rating || rating < 1 || rating > 5) {
      return new Response(JSON.stringify({ error: "Invalid data" }), { status: 400 });
    }

    const store = getStore("reviews");
    const key = "mod_" + moduleId;
    let reviews;
    try {
      const raw = await store.get(key);
      reviews = raw ? JSON.parse(raw) : [];
    } catch { reviews = []; }

    // Remove existing review from same user (one review per module per user)
    reviews = reviews.filter(r => r.email !== user.email);

    reviews.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      email: user.email,
      name: name || user.email.split("@")[0],
      rating,
      comment: (comment || "").slice(0, 1000),
      date: new Date().toISOString()
    });

    await store.set(key, JSON.stringify(reviews));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
};
