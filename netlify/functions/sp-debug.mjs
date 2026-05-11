// Діагностика SendPulse інтеграції.
// Захищена ADMIN_KEY — щоб не міг кожен викликати.
//
// Виклик:
//   POST /.netlify/functions/sp-debug
//   { "adminKey": "...", "testEmail": "test@example.com" }
//
// Повертає докладний звіт по всіх кроках.

const SP_BASE = "https://api.sendpulse.com";
const SP_BOOK_ID = "654867";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  const { adminKey, testEmail } = await req.json().catch(() => ({}));

  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: "Auth failed" }), { status: 403 });
  }

  const report = {
    step1_envCheck: null,
    step2_oauth: null,
    step3_addToBook: null,
    step4_listBooks: null
  };

  // ===== STEP 1: env check =====
  const ID = process.env.SENDPULSE_ID;
  const SECRET = process.env.SENDPULSE_SECRET;
  report.step1_envCheck = {
    SENDPULSE_ID_present: !!ID,
    SENDPULSE_ID_length: ID ? ID.length : 0,
    SENDPULSE_ID_first6: ID ? ID.slice(0, 6) + "…" : null,
    SENDPULSE_SECRET_present: !!SECRET,
    SENDPULSE_SECRET_length: SECRET ? SECRET.length : 0,
    SENDPULSE_SECRET_first6: SECRET ? SECRET.slice(0, 6) + "…" : null
  };

  if (!ID || !SECRET) {
    report.error = "Credentials missing in Netlify env";
    return new Response(JSON.stringify(report, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // ===== STEP 2: OAuth =====
  let token = null;
  try {
    const resp = await fetch(SP_BASE + "/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: ID,
        client_secret: SECRET
      })
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    report.step2_oauth = {
      status: resp.status,
      ok: resp.ok,
      response: parsed || text.slice(0, 500),
      tokenReceived: !!(parsed && parsed.access_token)
    };

    if (parsed && parsed.access_token) {
      token = parsed.access_token;
    }
  } catch (err) {
    report.step2_oauth = { error: err.message };
  }

  if (!token) {
    report.error = "OAuth failed — credentials wrong, or SP API down";
    return new Response(JSON.stringify(report, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // ===== STEP 3: add to book =====
  if (testEmail && testEmail.includes("@")) {
    try {
      const resp = await fetch(`${SP_BASE}/addressbooks/${SP_BOOK_ID}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
          emails: [{
            email: testEmail,
            variables: {
              promo_code: "DEBUG-TEST",
              expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
              expires_at_pretty: "(тестова вставка)",
              tariff_start_price: 3799,
              tariff_vip_price: 4599
            }
          }]
        })
      });
      const text = await resp.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}

      report.step3_addToBook = {
        status: resp.status,
        ok: resp.ok,
        bookId: SP_BOOK_ID,
        testEmail,
        response: parsed || text.slice(0, 500)
      };
    } catch (err) {
      report.step3_addToBook = { error: err.message };
    }
  } else {
    report.step3_addToBook = "skipped — no testEmail provided";
  }

  // ===== STEP 4: list books to verify book exists =====
  try {
    const resp = await fetch(`${SP_BASE}/addressbooks?limit=100`, {
      headers: { "Authorization": "Bearer " + token }
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    if (Array.isArray(parsed)) {
      const ourBook = parsed.find(b => String(b.id) === SP_BOOK_ID);
      report.step4_listBooks = {
        status: resp.status,
        totalBooks: parsed.length,
        ourBookId: SP_BOOK_ID,
        ourBookFound: !!ourBook,
        ourBookName: ourBook ? ourBook.name : null,
        firstFewBooks: parsed.slice(0, 5).map(b => ({ id: b.id, name: b.name }))
      };
    } else {
      report.step4_listBooks = { status: resp.status, raw: parsed || text.slice(0, 500) };
    }
  } catch (err) {
    report.step4_listBooks = { error: err.message };
  }

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};
