// netlify/functions/sendpulse-event.js
// Проксі для Sendpulse Automation 360 event
// Викликається з фронту на /.netlify/functions/sendpulse-event

const SENDPULSE_EVENT_URL =
  'https://events.sendpulse.com/events/id/e4926338446b49fff38d32430b6d8001/9399561';

exports.handler = async function (event) {
  // Тільки POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { variables = {} } = payload;

  // Формуємо тіло події для Sendpulse
  const spBody = {
    email:              variables.email              || '',
    phone:              variables.phone              || '',
    user_id:            variables.user_id            || 0,
    event_date:         variables.event_date         || new Date().toISOString(),
    promo_code:         variables.promo_code         || '',
    expires_at:         variables.expires_at         || '',
    expires_at_pretty:  variables.expires_at_pretty  || '',
    lesson_watched_at:  variables.lesson_watched_at  || '',
    tariff_start_price: variables.tariff_start_price || 3799,
    tariff_vip_price:   variables.tariff_vip_price   || 4599,
  };

  try {
    const resp = await fetch(SENDPULSE_EVENT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(spBody),
    });

    const text = await resp.text();

    if (!resp.ok) {
      console.error('Sendpulse error:', resp.status, text);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Sendpulse error', detail: text }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('sendpulse-event fetch error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal error', detail: err.message }),
    };
  }
};
