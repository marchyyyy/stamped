/* DFF sign-in session for tools/dff.js (2026-11-12, owner approved). DailyFantasyFuel now shows the full projection list only to a
   signed-in account (free; the owner's own). Visitors get 25 players and a sign-in notice.
   The session cookies live OUTSIDE the repo, in %LOCALAPPDATA%\Stamped\dff-session.json (DFF_SESSION overrides the path), and are
   reused until DFF ends the session. The password is never written anywhere: to sign in again, run tools/dff.js once with DFF_USER
   and DFF_PASS set in the environment of that run. Nothing here prints a credential or a cookie. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const FILE=process.env.DFF_SESSION||path.join(process.env.LOCALAPPDATA||os.homedir(),'Stamped','dff-session.json');
const unent=s=>s.replace(/&amp;/g,'&').replace(/&#x([0-9a-f]+);/gi,(m,h)=>String.fromCharCode(parseInt(h,16))).replace(/&quot;/g,'"');
module.exports=function(ua){
 let jar={};try{jar=JSON.parse(fs.readFileSync(FILE,'utf8'))}catch(e){}
 /* cookies by domain; a cookie set for a parent domain is sent to its subdomains */
 const setC=(host,res)=>{for(const c of res.headers.getSetCookie()){const nv=c.split(';')[0],i=nv.indexOf('='),dom=((c.match(/;\s*domain=\.?([^;]+)/i)||[])[1]||host).toLowerCase();(jar[dom]=jar[dom]||{})[nv.slice(0,i)]=nv.slice(i+1)}};
 const getC=host=>Object.entries(jar).filter(([d])=>host===d||host.endsWith('.'+d)).flatMap(([,o])=>Object.entries(o).filter(([,v])=>v&&v!=='deleted').map(([k,v])=>k+'='+v)).join('; ');
 /* fetch that carries the session and follows redirects itself, so cookies set along the way are kept */
 async function get(url,opt){opt=opt||{};for(let i=0;i<15;i++){const u=new URL(url),ck=getC(u.hostname);
   const res=await fetch(url,Object.assign({},opt,{redirect:'manual',headers:Object.assign({'User-Agent':ua,'Accept':'text/html,application/json;q=0.9,*/*;q=0.8'},opt.headers||{},ck?{Cookie:ck}:{})}));setC(u.hostname,res);
   const loc=res.headers.get('location');if(res.status>=300&&res.status<400&&loc){url=new URL(loc,url).href;opt={};continue}
   return{res,url,text:await res.text()}}
  throw new Error('too many redirects')}
 const save=()=>{fs.mkdirSync(path.dirname(FILE),{recursive:true});fs.writeFileSync(FILE,JSON.stringify(jar))};
 /* true when the session is signed in afterwards. Uses DFF's hosted sign-in page; needs DFF_USER and DFF_PASS for this run. */
 async function signIn(){const U=process.env.DFF_USER,PW=process.env.DFF_PASS;
  const a=await get('https://www.dailyfantasyfuel.com/account');
  /* a signed-in session stays on www; a visitor is sent to the sign-in page on account.dailyfantasyfuel.com */
  if(!/account\.dailyfantasyfuel\.com/.test(a.url)){save();return true}
  if(!U||!PW)return false;
  const act=(a.text.match(/<form[^>]*method="post"[^>]*action="([^"]+)"/i)||[])[1],csrf=(a.text.match(/name="csrf"\s+value="([^"]+)"/)||[])[1];
  if(!act||!csrf)throw new Error('sign-in form not recognised');
  const b=await get(new URL(unent(act),a.url).href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Origin':new URL(a.url).origin,'Referer':a.url},
   body:new URLSearchParams({csrf:unent(csrf),username:U,password:PW,cognitoAsfData:''}).toString()});
  const ok=/www\.dailyfantasyfuel\.com/.test(b.url);if(ok)save();return ok}
 return{get,signIn,save,file:FILE}};
