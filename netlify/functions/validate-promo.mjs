import { applyPromoAsync } from './_promos.mjs';

// Викликається, коли користувач натискає "Застосувати" у попапі.
// Тепер приймає опціональний email — для перевірки динамічних кодів,
// привʼязаних до email.
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { plan, code, email } = await req.json();

    if (!['start', 'vip'].includes(plan)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid plan' }), { status: 400 });
    }

    const result = await applyPromoAsync(code, plan, email);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error('validate-promo error:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), { status: 500 });
  }
};
