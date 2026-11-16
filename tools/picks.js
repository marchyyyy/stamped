/* Picks for soccer, tennis and golf (owner, 2026-11-16: "show who to place bets on and why and what they are projected to do",
   the way the NBA and NFL tabs do) -> data/picks_<sport>.json, read by live/picks.js.
   Each sport gets its own projection, built from results only (never copied from a price), and a pick is listed when
     - the price is -200 or longer (the same cap as rule 8),
     - our chance is at least 5 points above the market's chance with the bookmaker's cut removed,
     - our number is not 15+ points above the market (a gap that size has meant missing news, not value: plays test, Nov 2026),
     - and we project it to happen more often than not (50%+; 45%+ for a soccer side, where the draw takes a share): a pick is
       something we expect, not a longshot the model likes a little more than the price does.
   soccer  goals model per league (attack and defence strength, home edge, newer matches weigh more; this season and last
           from ESPN team schedules) -> projected score, win / draw / loss and total-goals chances. Prices: DraftKings via ESPN.
   tennis  Elo ratings from every tour-level singles result since Jan 2025 (ESPN) -> win chance, straight-sets chance.
           Prices: Kalshi match markets (ask plus fee).
   golf    strokes against the field per round this season (ESPN round scores, newer rounds weigh more, adjusted for field
           strength) -> 10,000 simulated finishes of this week's event (from the current scores when it has started)
           -> win, top-10 and top-20 chances and projected finish. Prices: Kalshi top-10 / top-20 markets.
   Honest status, shown on the page: each model is scored walk-forward on results (how often its favourite won, and whether
   its percentages hold), but none has been tested against prices yet, so these are new picks graded every night at the
   price first shown. State: live/.cache/picks-<sport>.json; history cache: live/.cache/picks/.
   Soccer and tennis picks are listed for events starting inside 48 hours; later matches show their projection and an early lean.
     node tools/picks.js --sport soccer|tennis|golf [--no-push]        (tools/refresh.js runs all three) */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.join(__dirname,'..'),arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null};
const SPORT=(arg('sport')||'').toLowerCase(),push=!process.argv.includes('--no-push');
if(!['soccer','tennis','golf'].includes(SPORT)){console.error('Usage: node tools/picks.js --sport soccer|tennis|golf [--no-push]');process.exit(1)}
const OUT=`data/picks_${SPORT}.json`,STATE=path.join(ROOT,'live/.cache',`picks-${SPORT}.json`),CACHE=path.join(ROOT,'live/.cache/picks');
const CAP=-200,EDGE=0.05,GAP=0.15,MINP=0.5,ESPN='https://site.api.espn.com/apis/site/v2/sports/',KAL='https://api.elections.kalshi.com/trade-api/v2';
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] picks ${SPORT}: ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u,tries=3){for(let i=0;i<tries;i++){try{const r=await fetch(u);if(r.ok)return r.json();if(r.status===404||r.status===400)return null;if(r.status===429)await sleep(2000)}catch(e){}await sleep(600*(i+1))}return null}
/* Cached read: ttl in hours, 0 = keep for good (finished seasons, finished tournaments). */
async function cached(key,url,ttl,slim){const f=path.join(CACHE,key+'.json');
 try{const st=fs.statSync(f);if(!ttl||Date.now()-st.mtimeMs<ttl*36e5)return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){}
 const j=await get(url);await sleep(60);if(!j){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){return null}}
 const v=slim?slim(j):j;fs.mkdirSync(CACHE,{recursive:true});fs.writeFileSync(f,JSON.stringify(v));return v}
const ET={timeZone:'America/New_York'},ymdET=t=>new Date(t).toLocaleDateString('en-CA',ET),NOW=Date.now(),TODAY=ymdET(NOW);
const imp=o=>o<0?-o/(-o+100):100/(o+100),toAmer=p=>p<=0||p>=1?null:Math.round(p>=0.5?-100*p/(1-p):100*(1-p)/p);
const amer=v=>{if(v==null||v==='')return null;const n=typeof v==='number'?v:parseInt(String(v).replace('+',''),10);return isNaN(n)||!n?null:n};
const pct=p=>Math.round(p*100),r1=x=>Math.round(x*10)/10;
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
function git(a){return cp.execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
/* The pick test, the same for every sport. cost = chance the price needs to break even. */
function verdict(our,mkt,price){if(price==null||mkt==null)return 'no price';if(price<CAP)return 'shorter than -200';
 if(our-mkt>=GAP)return 'gap too wide';return our-mkt>=EDGE?'pick':'no edge'}
/* Kalshi: open markets of a series; price to buy Yes = ask plus the fee (7% x p x (1-p)), as in tools/kalshi.js. */
async function kalshi(series){const out=[];let cursor='';for(let i=0;i<10;i++){const j=await get(`${KAL}/markets?series_ticker=${series}&status=open&limit=1000${cursor?`&cursor=${cursor}`:''}`);await sleep(150);if(!j)break;out.push(...(j.markets||[]));cursor=j.cursor;if(!cursor)break}
 return out.map(m=>{const ya=parseFloat(m.yes_ask_dollars),yb=parseFloat(m.yes_bid_dollars);return{ticker:m.ticker,ev:m.event_ticker,name:m.yes_sub_title||'',ya,yb,ok:ya>0&&ya<1&&yb>0&&ya-yb<=0.10,
  cost:ya>0&&ya<1?ya+0.07*ya*(1-ya):null,mid:ya>0&&yb>0?(ya+yb)/2:null}})}

/* ---------------- soccer ---------------- */
const CLUB=[['eng.1','Premier League'],['esp.1','LaLiga'],['ita.1','Serie A'],['ger.1','Bundesliga'],['fra.1','Ligue 1'],['usa.1','MLS'],['mex.1','Liga MX'],['eng.2','Championship'],['ned.1','Eredivisie'],['por.1','Primeira Liga'],['bra.1','Brazil Serie A']];
const INTL=[['uefa.nations','Nations League'],['fifa.worldq.uefa','World Cup qualifying, Europe'],['fifa.friendly','International friendly']];
const slimSched=j=>({year:(j.season&&j.season.year)||null,ev:(j.events||[]).map(e=>{const c=e.competitions[0],h=c.competitors.find(x=>x.homeAway==='home'),a=c.competitors.find(x=>x.homeAway==='away');if(!h||!a)return null;
 const sc=x=>x.score==null?null:typeof x.score==='object'?x.score.value:+x.score;return{id:e.id,d:e.date,done:!!(c.status&&c.status.type&&c.status.type.completed),h:h.team.id,a:a.team.id,hn:h.team.displayName,an:a.team.displayName,hs:sc(h),as:sc(a)}}).filter(Boolean)});
async function teamsOf(lg){const j=await cached(`soc-teams-${lg}`,`${ESPN}soccer/${lg}/teams`,24*7,j=>((((j.sports||[])[0]||{}).leagues||[])[0]||{teams:[]}).teams.map(t=>({id:t.team.id,n:t.team.displayName,logo:(t.team.logos&&t.team.logos[0]&&t.team.logos[0].href)||''})));return j||[]}
/* Every finished match of a pool: each team's schedule for this season and the one before (finished seasons kept for good). */
async function poolMatches(lgs,teamIds,seasons){const M=new Map();
 for(const lg of lgs)for(const id of teamIds){const cur=await cached(`soc-${lg}-${id}`,`${ESPN}soccer/${lg}/teams/${id}/schedule`,6,slimSched);if(!cur)continue;
  const yr=cur.year||new Date().getFullYear(),all=[cur];for(let k=1;k<=seasons;k++){const p=await cached(`soc-${lg}-${id}-${yr-k}`,`${ESPN}soccer/${lg}/teams/${id}/schedule?season=${yr-k}`,0,slimSched);if(p)all.push(p)}
  for(const s of all)for(const e of s.ev)if(e.done&&e.hs!=null&&e.as!=null&&!M.has(e.id))M.set(e.id,e)}
 return [...M.values()].sort((x,y)=>x.d<y.d?-1:1)}
/* Goals model: scoring rate = league rate x team attack x opponent defence, fitted by repeated averaging. Newer matches weigh
   more (half-life H days), and every team starts from 1 match at the league average.
   Tuned 2026-11-16 on 628 walk-forward matches (PDBG=1 prints the table; PK and PG override): a prior of 4 matches left 60-70% favourites
   winning 81%; prior 1 with the favourite's goal share stretched by 0.2 scored best (error 0.556 against 0.567) and 60-70% favourites won 70%. */
function fitSoc(M,at,H){const T={},w=M.map(m=>Math.pow(0.5,(at-Date.parse(m.d))/864e5/H));let sw=0,gh=0,ga=0;
 M.forEach((m,i)=>{sw+=w[i];gh+=w[i]*m.hs;ga+=w[i]*m.as;for(const k of [m.h,m.a])T[k]=T[k]||{att:1,def:1,n:0}});
 if(sw<20)return null;const mh=gh/sw,ma=ga/sw,mu=(mh+ma)/2,K=+process.env.PK||1;M.forEach((m,i)=>{T[m.h].n+=w[i];T[m.a].n+=w[i]});
 for(let it=0;it<25;it++){const A={},D={};for(const k in T){A[k]=[K*mu,K*mu];D[k]=[K*mu,K*mu]}
  M.forEach((m,i)=>{const h=T[m.h],a=T[m.a];A[m.h][0]+=w[i]*m.hs;A[m.h][1]+=w[i]*mh*a.def;A[m.a][0]+=w[i]*m.as;A[m.a][1]+=w[i]*ma*h.def;
   D[m.h][0]+=w[i]*m.as;D[m.h][1]+=w[i]*ma*a.att;D[m.a][0]+=w[i]*m.hs;D[m.a][1]+=w[i]*mh*h.att});
  for(const k in T){T[k].att=A[k][0]/A[k][1];T[k].def=D[k][0]/D[k][1]}}
 return{T,mh,ma}}
const STRETCH=0.2;
const pois=(l,k)=>{let p=Math.exp(-l);for(let i=1;i<=k;i++)p*=l/i;return p};
/* Score grid with the usual low-score correction (0-0, 1-0, 0-1, 1-1), then the chances read off it. */
function predSoc(F,h,a){const H=F.T[h],A=F.T[a];if(!H||!A)return null;const l0=F.mh*H.att*A.def,l1=F.ma*A.att*H.def,g=process.env.PG!=null?+process.env.PG:STRETCH,k=Math.pow(l0/l1,g/2),lh=l0*k,la=l1/k,rho=-0.08;let ph=0,pd=0,pa=0,tot=0;const G=[];
 for(let i=0;i<=9;i++)for(let j=0;j<=9;j++){let p=pois(lh,i)*pois(la,j);if(i===0&&j===0)p*=1-lh*la*rho;else if(i===0&&j===1)p*=1+lh*rho;else if(i===1&&j===0)p*=1+la*rho;else if(i===1&&j===1)p*=1-rho;G.push([i,j,p]);tot+=p}
 for(const g of G){g[2]/=tot;if(g[0]>g[1])ph+=g[2];else if(g[0]===g[1])pd+=g[2];else pa+=g[2]}
 return{lh,la,ph,pd,pa,n:Math.min(H.n,A.n),over:line=>G.reduce((q,g)=>q+(g[0]+g[1]>line?g[2]:0),0)}}
/* Walk-forward score on this season: each match day is predicted from the matches before it. */
function testSoc(M,H,since,acc){const days=[...new Set(M.filter(m=>m.d>=since).map(m=>m.d.slice(0,10)))];
 for(const d of days){const past=M.filter(m=>m.d.slice(0,10)<d),F=fitSoc(past,Date.parse(d),H);if(!F)continue;
  for(const m of M.filter(x=>x.d.slice(0,10)===d)){const p=predSoc(F,m.h,m.a);if(!p||p.n<5)continue;const res=m.hs>m.as?0:m.hs===m.as?1:2,P=[p.ph,p.pd,p.pa],fav=P.indexOf(Math.max(...P));
   acc.n++;acc.fav+=fav===res?1:0;acc.favP+=P[fav];acc.brier+=P.reduce((q,x,i)=>q+(x-(i===res?1:0))**2,0);acc.res[res]++;if(P[fav]>=0.6){acc.hiN++;acc.hi+=fav===res?1:0;acc.hiP+=P[fav]}
   acc.pg=(acc.pg||0)+p.lh+p.la;acc.ag=(acc.ag||0)+m.hs+m.as;if(process.env.PDBG){const b=Math.min(9,Math.floor(P[fav]*10));acc.cal=acc.cal||{};const c=acc.cal[b]=acc.cal[b]||[0,0,0];c[0]++;c[1]+=P[fav];c[2]+=fav===res?1:0;const ob=p.over(2.5)>=0.5?'ov':'un';const d=acc.cal[ob]=acc.cal[ob]||[0,0,0];d[0]++;d[1]+=Math.max(p.over(2.5),1-p.over(2.5));d[2]+=(p.over(2.5)>=0.5)===(m.hs+m.as>2.5)?1:0}const o=p.over(2.5);acc.ouN++;acc.ou+=(o>=0.5)===(m.hs+m.as>2.5)?1:0}}}
function socOdds(c){const o=(c.odds||[])[0];if(!o)return null;const m=o.moneyline||{},cl=x=>x?((x.close&&x.close.odds)!=null?x.close.odds:(x.open&&x.open.odds)):null;
 return{home:amer(cl(m.home)),away:amer(cl(m.away)),draw:amer(cl(m.draw)!=null?cl(m.draw):(o.drawOdds&&o.drawOdds.moneyLine)),ou:o.overUnder!=null?+o.overUnder:null,over:amer(cl(o.total&&o.total.over)),under:amer(cl(o.total&&o.total.under)),book:(o.provider&&o.provider.name)||'DraftKings'}}
const formOf=(M,id,n)=>{const L=M.filter(m=>m.h===id||m.a===id).slice(-n);let w=0,d=0,l=0,gf=0,ga=0;for(const m of L){const f=m.h===id?m.hs:m.as,a=m.h===id?m.as:m.hs;gf+=f;ga+=a;if(f>a)w++;else if(f===a)d++;else l++}return{n:L.length,w,d,l,gf:L.length?gf/L.length:0,ga:L.length?ga/L.length:0}};
async function soccer(){const picks=[],board=[],acc={n:0,fav:0,favP:0,brier:0,res:[0,0,0],hiN:0,hi:0,hiP:0,ouN:0,ou:0},grade=[];
 const pools=[...CLUB.map(([id,name])=>({lgs:[id],boards:[[id,name]],H:240,seasons:1,since:'2026-07-01',test:['eng.1','esp.1','ita.1','ger.1','fra.1'].includes(id)})),{lgs:INTL.map(x=>x[0]),boards:INTL,H:540,seasons:2,since:'2026-01-01',intl:true,test:true}];
 for(const P of pools){
  /* upcoming matches first: a pool with nothing in the next 8 days costs no history requests */
  const up=[];for(const [lg,name] of P.boards){const sb=await get(`${ESPN}soccer/${lg}/scoreboard`);await sleep(60);
   for(const e of (sb&&sb.events)||[]){const c=e.competitions[0],st=(c.status||e.status).type,t=Date.parse(e.date);grade.push({id:e.id,done:!!st.completed,c});
    if(st.state!=='pre'||t>NOW+8*864e5||t<NOW)continue;const h=c.competitors.find(x=>x.homeAway==='home'),a=c.competitors.find(x=>x.homeAway==='away');if(h&&a)up.push({e,c,h,a,lg,name})}}
  if(!up.length)continue;
  const ids=P.intl?[...new Set([...(await teamsOf('uefa.nations')).map(t=>t.id),...up.flatMap(u=>[u.h.team.id,u.a.team.id])])]:(await teamsOf(P.lgs[0])).map(t=>t.id);
  const M=await poolMatches(P.lgs,ids,P.seasons),F=fitSoc(M,NOW,P.H);if(!F){log(`${P.lgs[0]}: not enough finished matches for a model.`);continue}
  if(P.test)testSoc(M,P.H,P.since,acc);
  for(const u of up){const hid=u.h.team.id,aid=u.a.team.id,hn=u.h.team.displayName,an=u.a.team.displayName,p=predSoc(F,hid,aid),o=socOdds(u.c),title=`${an} at ${hn}`;
   if(!p||p.n<5){board.push({when:u.e.date,ev:u.name,title,note:'Not enough recent matches for a projection.'});continue}
   const fh=formOf(M,hid,8),fa=formOf(M,aid,8),rows=[],cand=[];
   const mk=o&&o.home!=null&&o.away!=null&&o.draw!=null?(()=>{const s=imp(o.home)+imp(o.draw)+imp(o.away);return[imp(o.home)/s,imp(o.draw)/s,imp(o.away)/s]})():null;
   [[`${hn} to win`,p.ph,mk&&mk[0],o&&o.home,hn],['Draw',p.pd,mk&&mk[1],o&&o.draw,null],[`${an} to win`,p.pa,mk&&mk[2],o&&o.away,an]].forEach(([label,our,mkt,price,team])=>{rows.push({label,our:pct(our),mkt:mkt==null?null:pct(mkt),price});cand.push({label,our,mkt,price,team,key:label==='Draw'?'D':team===hn?'H':'A'})});
   if(o&&o.ou!=null&&o.ou%1===0.5){const ov=p.over(o.ou),s=o.over!=null&&o.under!=null?imp(o.over)+imp(o.under):null;
    [[`Over ${o.ou} goals`,ov,s?imp(o.over)/s:null,o.over,'O'],[`Under ${o.ou} goals`,1-ov,s?imp(o.under)/s:null,o.under,'U']].forEach(([label,our,mkt,price,key])=>{rows.push({label,our:pct(our),mkt:mkt==null?null:pct(mkt),price});cand.push({label,our,mkt,price,key:key+o.ou})})}
   const proj=`Projected score: ${hn} ${r1(p.lh)}, ${an} ${r1(p.la)}`,best=cand.filter(x=>verdict(x.our,x.mkt,x.price)==='pick'&&x.our>=(x.team?0.45:MINP)).sort((x,y)=>(y.our-y.mkt)-(x.our-x.mkt))[0];
   const fs_=(n,f)=>`${n}: ${f.w}-${f.d}-${f.l} in the last ${f.n} (won-drew-lost), ${r1(f.gf)} goals scored and ${r1(f.ga)} allowed a match`;
   const why=[fs_(hn,fh),fs_(an,fa),`${proj} · ${hn} ${pct(p.ph)}%, draw ${pct(p.pd)}%, ${an} ${pct(p.pa)}%${o&&o.ou!=null?` · over ${o.ou} goals ${pct(p.over(o.ou))}%`:''}`];
   board.push({gid:u.e.id,when:u.e.date,ev:u.name,title,proj,rows,why,book:o?o.book:null,pick:best?best.label:null});
   if(best&&Date.parse(u.e.date)<NOW+48*36e5)picks.push({id:`${u.e.id}|${best.key}`,gid:u.e.id,lg:u.lg,key:best.key,when:u.e.date,ev:u.name,title,pick:best.label,price:best.price,book:o.book,our:pct(best.our),mkt:pct(best.mkt),fair:toAmer(best.our),edge:Math.round((best.our-best.mkt)*100),proj,why,
    logo:(best.team===hn?u.h:best.team===an?u.a:u.h).team.logo||''})}}
 if(process.env.PDBG)console.log('DBG K',process.env.PK||4,'n',acc.n,'brier',(acc.brier/acc.n).toFixed(4),'pred goals',(acc.pg/acc.n).toFixed(2),'actual',(acc.ag/acc.n).toFixed(2),JSON.stringify(Object.fromEntries(Object.entries(acc.cal).map(([k,v])=>[k,v[0]+' exp '+(v[1]/v[0]).toFixed(2)+' act '+(v[2]/v[0]).toFixed(2)]))));
 const t=acc.n?`Scored on ${acc.n} matches this season (five big European leagues and internationals), each predicted only from earlier matches: the model's favourite won ${pct(acc.fav/acc.n)}% (it expected ${pct(acc.favP/acc.n)}%); favourites it rated 60% or better won ${acc.hiN?pct(acc.hi/acc.hiN):0}% of ${acc.hiN} (expected ${acc.hiN?pct(acc.hiP/acc.hiN):0}%); it called over or under 2.5 goals right ${pct(acc.ou/acc.ouN)}% of the time.`:'';
 /* at most six a day, the widest gaps first: a short list that can be graded, not half the fixture list */
 picks.sort((a,b)=>b.edge-a.edge).splice(6);
 return{picks,board,model:{name:'Goals model',how:'Each team\'s attack and defence strength from this season and last, newer matches weighing more, plus the home edge. That gives a projected score and the chance of every result.',test:t},
  gradeOne:async r=>{let g=grade.find(x=>x.id===r.gid);if(!g){const d=ymdET(r.when).replace(/-/g,'');const sb=await get(`${ESPN}soccer/${r.lg}/scoreboard?dates=${d}`);const e=((sb&&sb.events)||[]).find(x=>x.id===r.gid);if(e)g={done:!!(e.competitions[0].status||e.status).type.completed,c:e.competitions[0]}}
   if(!g||!g.done)return null;const h=+g.c.competitors.find(x=>x.homeAway==='home').score,a=+g.c.competitors.find(x=>x.homeAway==='away').score,k=r.key;
   const win=k==='H'?h>a:k==='A'?a>h:k==='D'?h===a:k[0]==='O'?h+a>+k.slice(1):h+a<+k.slice(1);return{res:win?'W':'L',v:`${h}-${a}`}}}}

/* ---------------- tennis ---------------- */
const slimTen=j=>(j.events||[]).map(e=>({id:e.id,name:e.name,end:e.endDate||e.date,m:((e.groupings||[]).find(g=>/singles/.test(g.grouping.slug))||{competitions:[]}).competitions.map(c=>{const a=c.competitors||[];if(a.length!==2||!a[0].athlete||!a[1].athlete)return null;
 return{id:c.id,d:c.date,st:c.status.type.state,done:!!c.status.type.completed,rd:(c.round&&c.round.displayName)||'',p:a.map(x=>x.athlete.displayName),w:a[0].winner?0:a[1].winner?1:-1,sets:a.map(x=>(x.linescores||[]).length)}}).filter(Boolean)}));
async function tennis(){const picks=[],board=[],M=new Map(),EV={};
 for(const tour of ['atp','wta']){for(let t=Date.parse('2025-01-01T12:00:00Z');t<NOW+864e5;t+=7*864e5){const d=new Date(t).toISOString().slice(0,10).replace(/-/g,''),old=t<NOW-28*864e5;
   const ev=await cached(`ten-${tour}-${d}`,`${ESPN}tennis/${tour}/scoreboard?dates=${d}`,old?0:3,slimTen);for(const e of ev||[])for(const m of e.m)M.set(tour+m.id,{...m,tour,ev:e.name})}
  const cur=await get(`${ESPN}tennis/${tour}/scoreboard`);for(const e of slimTen(cur||{}))for(const m of e.m)M.set(tour+m.id,{...m,tour,ev:e.name})}
 const all=[...M.values()].sort((x,y)=>x.d<y.d?-1:1),R={},rowsT=[];
 const P=n=>R[n]=R[n]||{r:1500,n:0,last:[],y:[0,0]},exp=(a,b)=>1/(1+Math.pow(10,(b-a)/400));
 /* Elo: every finished match with a winner and at least one set played moves both ratings; new players move faster. */
 for(const m of all){if(!m.done||m.w<0||!m.sets[0])continue;const a=P(m.tour+'|'+m.p[0]),b=P(m.tour+'|'+m.p[1]),e=exp(a.r,b.r),s=m.w===0?1:0;
  if(m.d>='2026-01-01'&&a.n>=20&&b.n>=20)rowsT.push([a.r-b.r,s]);
  const ka=250/Math.pow(a.n+5,0.4),kb=250/Math.pow(b.n+5,0.4);a.r+=ka*(s-e);b.r+=kb*(e-s);a.n++;b.n++;
  [[a,s,m.p[1]],[b,1-s,m.p[0]]].forEach(([x,won,opp])=>{x.last.push([won,opp]);if(x.last.length>10)x.last.shift();if(m.d>='2026-01-01')x.y[won?0:1]++})}
 /* Raw Elo gaps ran too confident on 2026 (favourites expected 65%, won 62%), so the gap is scaled by the factor that scores best on those matches. */
 let SC=1,bb=1e9;for(let c=0.5;c<=1.001;c+=0.05){const b=rowsT.reduce((q,[d,s])=>q+(1/(1+Math.pow(10,-c*d/400))-s)**2,0);if(b<bb){bb=b;SC=c}}
 const cal=(a,b)=>1/(1+Math.pow(10,-SC*(a-b)/400)),acc={n:0,fav:0,favP:0,hiN:0,hi:0,hiP:0};
 for(const [d,s] of rowsT){const e=cal(d,0),f=Math.max(e,1-e),hit=(e>=0.5)===(s===1);acc.n++;acc.fav+=hit?1:0;acc.favP+=f;if(f>=0.7){acc.hiN++;acc.hi+=hit?1:0;acc.hiP+=f}}
 const rank={};for(const tour of ['atp','wta']){Object.entries(R).filter(([k,v])=>k.startsWith(tour+'|')&&v.n>=15).sort((x,y)=>y[1].r-x[1].r).forEach(([k],i)=>rank[k]=i+1)}
 const K=[...(await kalshi('KXATPMATCH')),...(await kalshi('KXWTAMATCH'))],kn=K.map(k=>({...k,nn:norm(k.name)}));
 /* ESPN lists round-robin pairings that may never be played at 05:00 UTC with no court time: those are skipped. */
 const up=all.filter(m=>m.st==='pre'&&Date.parse(m.d)>NOW&&Date.parse(m.d)<NOW+48*36e5&&!/T05:00Z$/.test(m.d));
 const kev={};for(const k of kn)(kev[k.ev]=kev[k.ev]||[]).push(k);const lastN=n=>norm(n).split(' ').pop();
 for(const m of up){const ka=m.tour+'|'+m.p[0],kb=m.tour+'|'+m.p[1],a=R[ka],b=R[kb],title=`${m.p[0]} vs ${m.p[1]}`,ev=`${m.ev}${m.rd?' · '+m.rd:''}`;
  if(!a||!b||a.n<20||b.n<20){board.push({when:m.d,ev,title,note:'Not enough tour matches for a projection.'});continue}
  const pa=cal(a.r,b.r),P2=[pa,1-pa],bo5=m.tour==='atp'&&/Australian Open|Roland|French Open|Wimbledon|US Open/i.test(m.ev);
  /* set chance that gives this match chance, then the chance of winning without dropping a set */
  const straight=p=>{let lo=0,hi=1;for(let i=0;i<40;i++){const s=(lo+hi)/2,mm=bo5?s**3*(10-15*s+6*s*s):s*s*(3-2*s);if(mm<p)lo=s;else hi=s}return Math.pow((lo+hi)/2,bo5?3:2)};
  /* a Kalshi match event is the one whose two sides are these two players, on the same day */
  const kd=m.d.slice(2,4)+['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][+m.d.slice(5,7)-1]+m.d.slice(8,10),ke=Object.entries(kev).find(([e,a])=>e.includes(kd)&&a.length===2&&m.p.every(n=>a.some(k=>k.nn===norm(n)||lastN(k.name)===lastN(n))));
  const km=m.p.map(n=>ke?ke[1].find(k=>k.nn===norm(n)||lastN(k.name)===lastN(n)):null);
  const pair=!!(km[0]&&km[1]&&km[0]!==km[1]),mids=pair&&km[0].mid&&km[1].mid?[km[0].mid/(km[0].mid+km[1].mid),km[1].mid/(km[0].mid+km[1].mid)]:null;
  const h2h=all.filter(x=>x.done&&x.w>=0&&x.p.includes(m.p[0])&&x.p.includes(m.p[1])&&x.tour===m.tour),hw=h2h.filter(x=>x.p[x.w]===m.p[0]).length;
  const rows=[0,1].map(i=>({label:`${m.p[i]} to win`,our:pct(P2[i]),mkt:mids?pct(mids[i]):null,price:pair&&km[i].cost?toAmer(km[i].cost):null}));
  const fav=pa>=0.5?0:1,proj=`Projected: ${m.p[fav]} wins ${pct(P2[fav])}% of the time, ${pct(straight(P2[fav]))}% in straight sets`;
  const line=(n,x,k)=>`${n}: Stamped rating ${Math.round(x.r)}${rank[k]?` (${rank[k]}${['th','st','nd','rd'][rank[k]%10<4&&(rank[k]%100<11||rank[k]%100>13)?rank[k]%10:0]} on tour)`:''}, ${x.y[0]}-${x.y[1]} this year, ${x.last.filter(q=>q[0]).length}-${x.last.filter(q=>!q[0]).length} in the last ${x.last.length}`;
  const why=[line(m.p[0],a,ka),line(m.p[1],b,kb),h2h.length?`Head to head since 2025: ${m.p[0]} ${hw}, ${m.p[1]} ${h2h.length-hw}`:'No meeting since 2025',proj];
  let best=null;[0,1].forEach(i=>{if(!pair||!mids||!km[i].ok||!km[i].cost)return;const price=toAmer(km[i].cost);if(P2[i]>=MINP&&verdict(P2[i],mids[i],price)==='pick'&&(!best||P2[i]-mids[i]>best.e))best={i,e:P2[i]-mids[i],price}});
  board.push({gid:m.id,when:m.d,ev,title,proj,rows,why,book:pair?'Kalshi':null,pick:best?rows[best.i].label:null});
  if(best)picks.push({id:`${m.tour}${m.id}|${best.i}`,gid:m.tour+m.id,key:m.p[best.i],when:m.d,ev,title,pick:rows[best.i].label,price:best.price,book:'Kalshi',our:pct(P2[best.i]),mkt:pct(mids[best.i]),fair:toAmer(P2[best.i]),edge:Math.round(best.e*100),proj,why,logo:''})}
 const t=acc.n?`Scored on ${acc.n} tour matches in 2026 between players with 20+ matches on file, each predicted before it was played: the higher-rated player won ${pct(acc.fav/acc.n)}% (the ratings expected ${pct(acc.favP/acc.n)}%); players rated 70% or better won ${acc.hiN?pct(acc.hi/acc.hiN):0}% of ${acc.hiN} (expected ${acc.hiN?pct(acc.hiP/acc.hiN):0}%).`:'';
 picks.sort((a,b)=>b.edge-a.edge).splice(6);
 return{picks,board,model:{name:'Stamped tennis ratings',how:'An Elo rating for every player from all tour-level singles results since January 2025: beat a strong player and the rating rises more. The gap between two ratings gives the win chance.',test:t},
  gradeOne:async r=>{const m=M.get(r.gid);if(!m||!m.done)return null;if(m.w<0||!m.sets[0])return{res:'V',v:'void'};return{res:m.p[m.w]===r.key?'W':'L',v:m.p[m.w]===r.key?'won':'lost'}}}}

/* ---------------- golf ---------------- */
const slimGolf=j=>(j.events||[]).map(e=>{const c=e.competitions[0];return{id:e.id,name:e.name,d:e.date,state:e.status.type.state,period:(c.status&&c.status.period)||0,
 pl:(c.competitors||[]).map(x=>({n:x.athlete&&x.athlete.displayName,toPar:x.score==='E'?0:parseInt(x.score,10),r:(x.linescores||[]).map(l=>[l.value||0,(l.linescores||[]).length])})).filter(x=>x.n)}});
const gauss=()=>{let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
const SD=2.85;
/* Ratings: strokes better (negative) or worse than the field each round, corrected for how strong that field was. */
function rateGolf(EV,at){const R={};let rounds=[];
 for(const e of EV){const age=(at-Date.parse(e.d))/864e5;if(age<=0)continue;const w=Math.pow(0.5,age/120);
  for(let k=0;k<4;k++){const sc=e.pl.filter(p=>p.r[k]&&p.r[k][1]===18&&p.r[k][0]>=55&&p.r[k][0]<=95);if(sc.length<20)continue;const mean=sc.reduce((q,p)=>q+p.r[k][0],0)/sc.length;rounds.push({w,names:sc.map(p=>p.n),d:sc.map(p=>p.r[k][0]-mean)})}}
 const base=()=>{const A={};for(const r of rounds)r.names.forEach((n,i)=>{const a=A[n]=A[n]||[0,0,0];a[0]+=r.w*(r.d[i]+(r.adj||0));a[1]+=r.w;a[2]++});for(const n in A)R[n]={r:A[n][0]/(A[n][1]+3)+0.4*3/(A[n][1]+3),n:A[n][2],w:A[n][1]}};
 base();for(let it=0;it<3;it++){for(const r of rounds)r.adj=r.names.reduce((q,n)=>q+R[n].r,0)/r.names.length;base()}
 return R}
/* Finishes of a finished event: position among players with four rounds, ties share the place; the rest missed the cut. */
function finishes(e){const f=e.pl.filter(p=>p.r.length>=4&&p.r.slice(0,4).every(x=>x[1]===18)).map(p=>({n:p.n,t:p.r.slice(0,4).reduce((q,x)=>q+x[0],0)})).sort((a,b)=>a.t-b.t),out={};
 f.forEach(p=>{const pos=f.findIndex(q=>q.t===p.t)+1,tie=f.filter(q=>q.t===p.t).length>1;out[p.n]={pos,txt:(tie?'T':'')+pos}});for(const p of e.pl)if(!out[p.n])out[p.n]={pos:999,txt:'MC'};return out}
/* Simulate what is left of an event. field: [{n, rating, toPar now, holes left}]; cut after round 2 at top 65 and ties when it has not been made. */
function simGolf(field,N,cutDone){const m=field.length,S={};field.forEach(p=>S[p.n]={win:0,t5:0,t10:0,t20:0,pos:[]});const tot=new Float64Array(m);
 for(let s=0;s<N;s++){const alive=new Uint8Array(m).fill(1);
  for(let i=0;i<m;i++){const p=field[i],h1=cutDone?p.left:Math.max(0,p.left-36);/* holes before the cut line is drawn */
   const pre=cutDone?0:p.left-h1;tot[i]=p.toPar+(pre?p.rating*pre/18+SD*Math.sqrt(pre/18)*gauss():0)}
  if(!cutDone){const srt=[...tot].sort((a,b)=>a-b),line=srt[Math.min(64,m-1)];for(let i=0;i<m;i++)if(tot[i]>line)alive[i]=0}
  for(let i=0;i<m;i++){if(!alive[i]){tot[i]=1e6+tot[i];continue}const p=field[i],h=cutDone?p.left:Math.min(p.left,36);if(h)tot[i]+=p.rating*h/18+SD*Math.sqrt(h/18)*gauss();tot[i]=Math.round(tot[i])/* whole strokes, so ties happen and share the place as they do on the board */}
  for(let i=0;i<m;i++){let better=0;for(let j=0;j<m;j++)if(tot[j]<tot[i])better++;const pos=better+1,x=S[field[i].n];if(pos===1)x.win++;if(pos<=5)x.t5++;if(pos<=10)x.t10++;if(pos<=20)x.t20++;if(s<800)x.pos.push(pos)}}
 for(const n in S){const x=S[n];x.win/=N;x.t5/=N;x.t10/=N;x.t20/=N;x.pos.sort((a,b)=>a-b);x.med=x.pos[x.pos.length>>1]}return S}
async function golf(){const picks=[],board=[];
 const sb=await get(`${ESPN}golf/pga/scoreboard`);if(!sb)throw new Error('ESPN golf scoreboard did not load');
 const cal=((sb.leagues||[])[0]||{}).calendar||[],EV=[];
 for(const c of cal){const t=Date.parse(c.startDate);if(t>NOW)continue;const d=new Date(t+12*36e5).toISOString().slice(0,10).replace(/-/g,''),old=t<NOW-9*864e5;
  const ev=await cached(`golf-pga-${c.id}`,`${ESPN}golf/pga/scoreboard?dates=${d}`,old?0:1,slimGolf);const e=(ev||[]).find(x=>x.id===c.id)||null;if(e&&e.pl.length)EV.push(e)}
 const cur=slimGolf(sb)[0],done=EV.filter(e=>e.state==='post'&&(!cur||e.id!==cur.id)).sort((a,b)=>a.d<b.d?-1:1),F={};for(const e of done)F[e.id]=finishes(e);
 /* walk-forward score: each event from the tenth on, top-20 chances from the ratings before it */
 const tf=path.join(CACHE,'golf-test.json');let T=null;try{T=JSON.parse(fs.readFileSync(tf,'utf8'))}catch(e){}
 if(!T||T.last!==(done[done.length-1]||{}).id){T={last:(done[done.length-1]||{}).id,n:0,brier:0,base:0,hiN:0,hi:0,hiP:0,ev:0};
  for(let k=10;k<done.length;k++){const e=done[k],R=rateGolf(done.slice(0,k),Date.parse(e.d)),field=e.pl.map(p=>({n:p.n,rating:R[p.n]?R[p.n].r:0.6,toPar:0,left:72}));if(field.length<60)continue;
   const S=simGolf(field,400,false),fin=F[e.id],b=Math.min(1,22/field.length);T.ev++;for(const p of field){const y=fin[p.n].pos<=20?1:0,q=S[p.n].t20;T.n++;T.brier+=(q-y)**2;T.base+=(b-y)**2;if(q>=0.4){T.hiN++;T.hi+=y;T.hiP+=q}}}
  fs.mkdirSync(CACHE,{recursive:true});fs.writeFileSync(tf,JSON.stringify(T))}
 const R=rateGolf(done,NOW),K20=await kalshi('KXPGATOP20'),K10=await kalshi('KXPGATOP10'),nxt=cal.find(c=>Date.parse(c.startDate)>NOW);
 let ev=null,field=[],cutDone=false,live=false;
 if(cur&&cur.state==='in'&&cur.pl.length){ev=cur;live=true;cutDone=cur.period>=3;
  field=cur.pl.filter(p=>!cutDone||p.r.length>=cur.period).map(p=>({n:p.n,rating:R[p.n]?R[p.n].r:0.6,toPar:isNaN(p.toPar)?0:p.toPar,left:Math.max(0,72-p.r.reduce((q,x)=>q+x[1],0)),thru:p.r.reduce((q,x)=>q+x[1],0)}))}
 else if(cur&&cur.state==='pre'&&cur.pl.length){ev=cur;field=cur.pl.map(p=>({n:p.n,rating:R[p.n]?R[p.n].r:0.6,toPar:0,left:72}))}
 else if(nxt){/* next event: the field from ESPN when posted, else the players Kalshi lists for it */
  const lb=await get(`https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event=${nxt.id}`),e=lb&&slimGolf(lb)[0];
  ev={id:nxt.id,name:nxt.label,d:nxt.startDate,state:'pre'};const names=e&&e.pl.length?e.pl.map(p=>p.n):[];field=names.map(n=>({n,rating:R[n]?R[n].r:0.6,toPar:0,left:72}))}
 const model={name:'Strokes against the field',how:'Each player\'s strokes better or worse than the field per round this season, newer rounds weighing more and stronger fields counting for more. The event is then played out 10,000 times to give the chance of a win, a top 10 and a top 20.',
  test:T&&T.n?`Scored on ${T.ev} events this season, each projected from the rounds before it: players given a 40% or better chance of a top 20 made it ${T.hiN?pct(T.hi/T.hiN):0}% of ${T.hiN} times (expected ${T.hiN?pct(T.hiP/T.hiN):0}%); error score ${(T.brier/T.n).toFixed(3)} against ${(T.base/T.n).toFixed(3)} for giving every player the same chance (lower is better).`:''};
 if(!ev||field.length<30){const top=Object.entries(R).filter(([n,x])=>x.n>=24).sort((a,b)=>a[1].r-b[1].r).slice(0,25);
  return{picks,board:top.map(([n,x],i)=>({title:n,proj:`${i+1}. ${r1(-x.r)} strokes a round better than the field over ${x.n} rounds`,rows:[]})),model,event:ev?{name:ev.name,when:ev.d,state:'pre',note:`The field for ${ev.name} is not posted yet. Picks appear when it is. Below: the 25 best form ratings on tour.`}:null,gradeOne:async()=>null,golfFinish:F,done}}
 const S=simGolf(field,10000,cutDone||!live&&false),ord=field.slice().sort((a,b)=>S[b.n].t20-S[a.n].t20||S[b.n].win-S[a.n].win);
 const kev=a=>{const c={};a.forEach(k=>c[k.ev]=(c[k.ev]||0)+1);const top=Object.entries(c).sort((x,y)=>y[1]-x[1])[0];return top?a.filter(k=>k.ev===top[0]):[]},k20=kev(K20),k10=kev(K10);
 const kfind=(a,n)=>{const nn=norm(n);return a.find(k=>norm(k.name)===nn)||null};
 const rk=Object.entries(R).filter(([n])=>field.some(p=>p.n===n)).sort((a,b)=>a[1].r-b[1].r).map(x=>x[0]);
 for(const p of ord){const s=S[p.n],x=R[p.n],a=kfind(k20,p.n),b=kfind(k10,p.n),rows=[],cands=[];
  [['top 20',s.t20,a,'T20'],['top 10',s.t10,b,'T10']].forEach(([lab,our,k,key])=>{const price=k&&k.cost?toAmer(k.cost):null,mkt=k&&k.mid?k.mid:null;rows.push({label:`Top ${key.slice(1)}`,our:pct(our),mkt:mkt==null?null:pct(mkt),price});
   if(k&&k.ok&&verdict(our,mkt,price)==='pick'&&our>=MINP)cands.push({lab,our,mkt,price,key})});
  rows.unshift({label:'Win',our:pct(s.win),mkt:null,price:null});
  const last=done.slice(-12).map(e=>F[e.id][p.n]).filter(Boolean).slice(-5).map(f=>f.txt),pos=live?`${p.toPar===0?'even par':(p.toPar>0?'+':'')+p.toPar} through ${p.thru} holes`:'';
  const proj=`Projected finish: ${s.med}${live?' (now '+pos+')':''} · top 20 ${pct(s.t20)}%, top 10 ${pct(s.t10)}%, win ${pct(s.win)}%`;
  board.push({title:p.n,proj,rows,book:a||b?'Kalshi':null,pick:cands.length?`${p.n} ${cands[0].lab}`:null});
  const best=cands.sort((u,v)=>(v.our-v.mkt)-(u.our-u.mkt))[0];
  if(best)picks.push({id:`${ev.id}|${p.n}|${best.key}`,gid:ev.id,key:best.key,name:p.n,when:ev.d,ev:ev.name,title:p.n,pick:`${p.n} to finish ${best.lab}`,price:best.price,book:'Kalshi',our:pct(best.our),mkt:pct(best.mkt),fair:toAmer(best.our),edge:Math.round((best.our-best.mkt)*100),proj,
   why:[x?`Form: ${r1(Math.abs(x.r))} strokes a round ${x.r<=0?'better':'worse'} than the field over ${x.n} rounds this season (${rk.indexOf(p.n)+1} of ${field.length} in this field)`:'New to the file: rated as a below-average player',last.length?`Last ${last.length} finishes: ${last.join(', ')}`:'No finished event on file this season',live?`Now ${pos}, ${p.left} holes to play`:'',proj].filter(Boolean),logo:''})}
 return{picks:picks.sort((a,b)=>b.edge-a.edge).slice(0,8),board:board.slice(0,60),model,event:{name:ev.name,when:ev.d,state:live?'in':'pre',note:live?`In progress: chances are from the current scores and the holes left.`:''},
  gradeOne:async r=>{const e=EV.find(x=>x.id===r.gid);if(!e||e.state!=='post')return null;const f=finishes(e)[r.name];if(!f)return{res:'V',v:'void'};const n=+r.key.slice(1);return{res:f.pos<=n?'W':'L',v:f.txt}}}}

/* ---------------- write, grade, push ---------------- */
(async()=>{
 const D=await {soccer,tennis,golf}[SPORT]();
 if(SPORT!=='golf')D.board.sort((a,b)=>(a.when||'')<(b.when||'')?-1:1);
 let st={recs:{},since:TODAY};try{st=JSON.parse(fs.readFileSync(STATE,'utf8'))}catch(e){}
 /* a pick is recorded once, at the price first shown, and stays on the list at that price until its event starts */
 for(const p of D.picks)if(!st.recs[p.id])st.recs[p.id]={...p,t:NOW};
 const fresh=new Set(D.picks.map(p=>p.id));
 for(const r of Object.values(st.recs)){if(r.res)continue;if(SPORT!=='golf'&&Date.parse(r.when)>NOW)continue;const g=await D.gradeOne(r).catch(()=>null);if(g){r.res=g.res;r.v=g.v;r.gd=TODAY}}
 const graded=Object.values(st.recs).filter(r=>r.res).sort((a,b)=>a.when<b.when?1:-1),rec={since:st.since,n:0,w:0,l:0,u:0};
 for(const r of graded){if(r.res==='V')continue;rec.n++;if(r.res==='W'){rec.w++;rec.u+=r.price>0?r.price/100:100/-r.price}else{rec.l++;rec.u-=1}}
 rec.u=Math.round(rec.u*100)/100;rec.last=graded.slice(0,12).map(r=>({d:ymdET(r.when),title:r.title,pick:r.pick,price:r.price,res:r.res,v:r.v}));
 /* open picks: today's list, plus earlier ones whose event has not started (shown at their first price) */
 const open=Object.values(st.recs).filter(r=>!r.res&&(fresh.has(r.id)||Date.parse(r.when)>NOW)).map(r=>{const now=D.picks.find(p=>p.id===r.id);return{...r,now:now?now.price:null,why:now?now.why:r.why,proj:now?now.proj:r.proj}}).sort((a,b)=>a.when<b.when?-1:1);
 fs.mkdirSync(path.dirname(STATE),{recursive:true});fs.writeFileSync(STATE,JSON.stringify(st));
 const out={sport:SPORT,generated:new Date().toISOString(),checked:new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET',cap:CAP,edge:Math.round(EDGE*100),
  model:D.model,event:D.event||null,picks:open,board:D.board,record:rec};
 fs.writeFileSync(path.join(ROOT,OUT),JSON.stringify(out));
 log(`${open.length} pick${open.length===1?'':'s'}, ${D.board.length} projected, record ${rec.w}-${rec.l}. Wrote ${OUT}.`);
 if(!push)return;
 try{git(['pull','-q','--rebase','--autostash']);git(['add',OUT]);if(!git(['status','--porcelain','--',OUT])){log('No change; nothing to push.');return}
  git(['commit','-q','-m',`${SPORT[0].toUpperCase()+SPORT.slice(1)} picks: ${open.length} listed, ${D.board.length} projected (${out.checked})`]);git(['push','-q','origin','main']);log('Pushed to GitHub.')}
 catch(e){log('Push failed: '+String(e.stderr||e.message).split('\n')[0])}
})().catch(e=>{log('FAILED: '+e.message);process.exit(1)});
