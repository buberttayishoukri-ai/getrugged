const crypto = require('crypto');
const USER = 'kurapika';
const PWKEY = 'apes:pw';

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

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  if (!b || typeof b !== 'object') b = {};

  const action = (req.query && req.query.action) || b.action || '';
  const c = db();
  const ready = !!(c.url && c.token);

  if (action === 'status') {
    let has = false;
    if (ready) { try { has = !!(await q(['GET', PWKEY])); } catch (e) {} }
    return res.status(200).json({ ok: true, db: ready, hasPassword: has });
  }

  if (!ready) return res.status(200).json({ ok: false, error: 'Keine Datenbank verbunden.' });

  if (action === 'setup') {
    const exists = await q(['GET', PWKEY]);
    if (exists) return res.status(200).json({ ok: false, error: 'Passwort ist schon gesetzt.' });

    const pw = String(b.password || '');
    if (pw.length < 4) return res.status(200).json({ ok: false, error: 'Mindestens 4 Zeichen.' });

    await q(['SET', PWKEY, sha(pw)]);
    return res.status(200).json({ ok: true });
  }

  if (action === 'login') {
    if (String(b.username || '').toLowerCase() !== USER)
      return res.status(200).json({ ok: false, error: 'Falscher Benutzername.' });

    const stored = await q(['GET', PWKEY]);
    if (!stored) return res.status(200).json({ ok: false, error: 'Passwort noch nicht gesetzt.' });
    if (sha(b.password) !== stored) return res.status(200).json({ ok: false, error: 'Falsches Passwort.' });

    const raw = (await q(['LRANGE', 'apes:hits', 0, 1999])) || [];
    const rows = raw.map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);

    return res.status(200).json({ ok: true, rows });
  }

  res.status(400).json({ ok: false, error: 'Unbekannte Aktion.' });
};