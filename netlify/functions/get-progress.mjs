import { getStore } from "@netlify/blobs";

function parseToken(token) {
  try {
    const data = JSON.parse(Buffer.from(token.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response(JSON.stringify({ error: "No token" }), { status: 401 });

  const user = parseToken(token);
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const store = getStore("progress");
  let progress;
  try {
    const raw = await store.get(user.email);
    progress = raw ? JSON.parse(raw) : { completed: [], ratings: {} };
  } catch { progress = { completed: [], ratings: {} }; }

  return new Response(JSON.stringify({ ok: true, progress }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
};
