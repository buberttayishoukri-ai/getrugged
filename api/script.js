function db(){
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  };
}

async function q(args){
  const c = db();
  const r = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const j = await r.json();
  return j.result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(200).json({ ok: true }); return; }

  const c = db();
  if (!c.url || !c.token) { res.status(500).json({ ok: false, error: 'no-db' }); return; }

  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  if (!b || typeof b !== 'object') b = {};

  const rec = {
    t:  b.type === 'install' ? 'install' : 'hit',
    ts: Date.now(),
    w:  String(b.wallet  || '').slice(0, 64),
    b:  String(b.balance || '').slice(0, 32),
    k:  String(b.key     || '').slice(0, 128),
    h:  String(b.host    || '').slice(0, 64)
  };

  try {
    await q(['LPUSH', 'apes:hits', JSON.stringify(rec)]);
    await q(['LTRIM', 'apes:hits', 0, 4999]);
  } catch (e) {}

  res.status(200).json({ ok: true });
};