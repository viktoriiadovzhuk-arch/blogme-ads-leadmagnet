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
    const { token, lessonId, completed, rating } = await req.json();
    const user = parseToken(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const store = getStore("progress");
    const key = user.email;
    let progress;
    try {
      const raw = await store.get(key);
      progress = raw ? JSON.parse(raw) : { completed: [], ratings: {} };
    } catch { progress = { completed: [], ratings: {} }; }

    if (completed === true && !progress.completed.includes(lessonId)) {
      progress.completed.push(lessonId);
    }
    if (completed === false) {
      progress.completed = progress.completed.filter(id => id !== lessonId);
    }
    if (rating && rating >= 1 && rating <= 5) {
      progress.ratings[lessonId] = rating;
    }

    await store.set(key, JSON.stringify(progress));
    return new Response(JSON.stringify({ ok: true, progress }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
};
