// SendPulse REST API utilities
// Документація: https://sendpulse.com/integrations/api

const SP_BASE = "https://api.sendpulse.com";
const TOKEN_TTL = 60 * 60 * 1000; // 1 година

let cachedToken = null;
let cachedTokenAt = 0;

async function getAccessToken() {
  // Кешуємо токен на 50хв (життя у SP — 1 год)
  if (cachedToken && Date.now() - cachedTokenAt < 50 * 60 * 1000) {
    return cachedToken;
  }

  const ID = process.env.SENDPULSE_ID;
  const SECRET = process.env.SENDPULSE_SECRET;

  if (!ID || !SECRET) {
    console.warn("SendPulse credentials not configured");
    return null;
  }

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

    if (!resp.ok) {
      const text = await resp.text();
      console.error("SendPulse OAuth failed:", resp.status, text);
      return null;
    }

    const data = await resp.json();
    if (!data.access_token) return null;

    cachedToken = data.access_token;
    cachedTokenAt = Date.now();
    return cachedToken;
  } catch (err) {
    console.error("SendPulse OAuth error:", err);
    return null;
  }
}

/**
 * Додає юзерку в адресну книгу.
 * @param {string} bookId — ID книги (наприклад "654867")
 * @param {string} email
 * @param {object} variables — додаткові поля {promo_code, expires_at, ...}
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function addToAddressBook(bookId, email, variables = {}) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "no_token" };

  if (!bookId || !email) return { ok: false, error: "bad_params" };

  try {
    const resp = await fetch(`${SP_BASE}/addressbooks/${bookId}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({
        emails: [
          {
            email,
            variables
          }
        ]
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("SP addToAddressBook failed:", resp.status, text);
      return { ok: false, error: "api_failed", status: resp.status };
    }

    const data = await resp.json();
    return { ok: true, data };
  } catch (err) {
    console.error("SP addToAddressBook error:", err);
    return { ok: false, error: "network" };
  }
}
