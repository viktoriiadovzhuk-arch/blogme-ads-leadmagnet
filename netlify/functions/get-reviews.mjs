import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const moduleId = url.searchParams.get("moduleId");
  if (!moduleId) return new Response(JSON.stringify({ reviews: [], avg: 0 }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });

  const store = getStore("reviews");
  let reviews;
  try {
    const raw = await store.get("mod_" + moduleId);
    reviews = raw ? JSON.parse(raw) : [];
  } catch { reviews = []; }

  const avg = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : 0;

  // Hide emails from public (show only first part)
  const safe = reviews.map(r => ({
    ...r,
    email: undefined,
    author: r.name || "Учасниця"
  }));

  return new Response(JSON.stringify({ reviews: safe, avg: parseFloat(avg), count: reviews.length }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
};
