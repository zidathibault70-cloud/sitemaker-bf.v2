const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const FROM = process.env.EMAIL_FROM || 'SiteMaker BF <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const codes = new Map();
const root = __dirname;
const publishedSites = new Map();
const publishedPublications = new Map();
function slugify(v){ return String(v||'site').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50) || 'site'; }
function publicSiteHtml(d){
  const links=(d.platforms||[]).map(x=>`<span style="margin-right:10px">${String(x)}</span>`).join('');
  return `<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${String(d.name||'SiteMaker')}</title><body style="margin:0;font-family:Arial;background:#f5f7fb;color:#172033"><main style="max-width:760px;margin:auto;padding:24px"><section style="background:${d.color||'#2459dc'};color:white;border-radius:24px;padding:28px"><div style="font-size:13px;opacity:.85">Site créé avec SiteMaker BF</div>${d.logo?`<img src="${d.logo}" style="max-width:120px;max-height:80px;margin-top:12px">`:''}<h1>${String(d.name||'')}</h1><p>${String(d.desc||'')}</p></section><section style="background:white;border-radius:20px;padding:22px;margin-top:16px"><h2>Outils</h2><p>🛒 Produits · 📱 Réseaux sociaux · 💬 Contact · 💳 Paiement</p><p>${String(d.sections||'Accueil · Produits · À propos · Contact')}</p></section><section style="background:white;border-radius:20px;padding:22px;margin-top:16px"><h2>Réseaux</h2><p>${links}</p><p>Retrait : ${String(d.method||'')} · ${String(d.num||'')}</p></section></main></body></html>`;
}
function publicPublicationHtml(d){
  const links=(d.platforms||[]).map(x=>`<span style="margin-right:10px">${String(x)}</span>`).join('');
  return `<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${String(d.name||'Publication')}</title><body style="margin:0;font-family:Arial;background:#f5f7fb"><main style="max-width:620px;margin:auto;padding:20px"><article style="background:white;border-radius:22px;overflow:hidden;box-shadow:0 8px 25px #0001">${d.image?`<img src="${d.image}" style="width:100%;max-height:340px;object-fit:cover">`:''}<div style="padding:22px"><div style="font-size:12px;color:#667085">${String(d.category||'Produit')}</div><h1>${String(d.name||'')}</h1><p>${String(d.desc||'')}</p><h2>${new Intl.NumberFormat('fr-FR').format(Number(d.price||0))} F CFA</h2><p>📞 ${String(d.contact||'')}</p><p>${links}</p></div></article></main></body></html>`;
}


function json(res, status, data){
  const body = JSON.stringify(data);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
  res.end(body);
}
function makeCode(){ return crypto.randomInt(100000,1000000).toString(); }
function validEmail(e){ return typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }
function body(req){ return new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>b+=c); req.on('end',()=>{try{resolve(JSON.parse(b||'{}'))}catch(e){reject(e)}}); }); }
async function sendViaResend(email,code){
  if(!RESEND_API_KEY) throw new Error('RESEND_API_KEY non configurée');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:FROM,to:[email],subject:'Votre code SiteMaker BF',html:`<div style="font-family:Arial,sans-serif"><h2>SiteMaker BF</h2><p>Votre code de vérification :</p><p style="font-size:30px;font-weight:800;letter-spacing:8px">${code}</p><p>Ne partagez jamais ce code.</p></div>`})});
  if(!r.ok) throw new Error('Resend a refusé l’envoi');
  return r.json();
}
function serve(req,res){
  let u=decodeURIComponent((req.url||'/').split('?')[0]);
  if(u==='/') u='/index.html';
  const file=path.normalize(path.join(root,u));
  if(!file.startsWith(root)) return json(res,403,{error:'Forbidden'});
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found')} const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end();}
    if(req.method==='POST' && req.url==='/api/send-code'){
      const d=await body(req), email=String(d.email||'').trim();
      if(!validEmail(email)) return json(res,400,{error:'Adresse email invalide.'});
      const code=makeCode();
      if(!RESEND_API_KEY) return json(res,503,{error:'Le serveur n’a pas encore sa clé d’envoi e-mail (RESEND_API_KEY).'});
      await sendViaResend(email,code); codes.set(email.toLowerCase(),{code,createdAt:Date.now()}); return json(res,200,{ok:true});
    }
    if(req.method==='POST' && req.url==='/api/generate-code'){
      const d=await body(req), email=String(d.email||'').trim().toLowerCase();
      if(!validEmail(email)) return json(res,400,{error:'Adresse email invalide.'});
      const code=makeCode(); codes.set(email,{code,createdAt:Date.now()}); return json(res,200,{ok:true,code});
    }
    if(req.method==='POST' && req.url==='/api/verify-code'){
      const d=await body(req), email=String(d.email||'').trim().toLowerCase(), code=String(d.code||'').trim(), item=codes.get(email);
      if(!item || item.code!==code) return json(res,401,{ok:false,error:'Code incorrect.'});
      if(Date.now()-item.createdAt>10*60*1000) return json(res,401,{ok:false,error:'Code expiré.'});
      codes.delete(email); return json(res,200,{ok:true});
    }

    if(req.method==='POST' && req.url==='/api/publish-site'){
      const d=await body(req); if(!String(d.name||'').trim()||!String(d.desc||'').trim()) return json(res,400,{error:'Nom et description requis.'});
      let base=slugify(d.name), slug=base, i=2; while(publishedSites.has(slug)){slug=base+'-'+i++;}
      publishedSites.set(slug,d); return json(res,200,{ok:true,url:'/site/'+slug});
    }
    if(req.method==='POST' && req.url==='/api/publish-publication'){
      const d=await body(req); if(!String(d.name||'').trim()||!Number(d.price)) return json(res,400,{error:'Nom et prix requis.'});
      let base=slugify(d.name), slug=base, i=2; while(publishedPublications.has(slug)){slug=base+'-'+i++;}
      publishedPublications.set(slug,d); return json(res,200,{ok:true,url:'/publication/'+slug});
    }
    if(req.method==='GET' && req.url.startsWith('/site/')){
      const slug=req.url.slice('/site/'.length).split('?')[0], d=publishedSites.get(slug); if(!d) return json(res,404,{error:'Site introuvable.'});
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(publicSiteHtml(d));
    }
    if(req.method==='GET' && req.url.startsWith('/publication/')){
      const slug=req.url.slice('/publication/'.length).split('?')[0], d=publishedPublications.get(slug); if(!d) return json(res,404,{error:'Publication introuvable.'});
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(publicPublicationHtml(d));
    }
    serve(req,res);
  }catch(e){ json(res,500,{error:e.message||'Erreur serveur'}); }
});
server.listen(PORT,()=>console.log(`SiteMaker BF : http://localhost:${PORT}`));
