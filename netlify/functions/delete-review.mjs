import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  try {
    const { adminKey, moduleId, reviewId } = await req.json();

    // Admin auth via environment variable
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }

    const store = getStore("reviews");
    const key = "mod_" + moduleId;
    let reviews;
    try {
      const raw = await store.get(key);
      reviews = raw ? JSON.parse(raw) : [];
    } catch { reviews = []; }

    reviews = reviews.filter(r => r.id !== reviewId);
    await store.set(key, JSON.stringify(reviews));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch {
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
};
