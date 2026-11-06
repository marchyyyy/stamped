/* Market-anchored team model: tuning and walk-forward test. Reads live/.cache/hist-<sport>.json (tools/hist.js).
   Every prediction uses only games before it: ratings are rebuilt from earlier games, and the model's weights are refit
   each week (NFL) or day (NBA) on all earlier games. Nothing is tuned on the games it is scored on.
     Market      DraftKings/ESPN BET pregame moneyline, no-vig
     Recal       logit p = a + b*logit(market)                         (fixes the market's own lean, if any)
     Market+     Recal + learned weights on our signals: opponent-adjusted rating gap, last season's rating gap,
                 rest gap, back-to-backs (NBA), DvP matchup (NFL)
     Ours only   the same signals without the market (how much our information knows on its own)
     App now     the model running in the app today (season rating gap, home, form, logistic width 7 / 8.5)
   Usage (repo root):  node tools/tune.js --sport nfl|nba [--from 2025]
                       node tools/tune.js --sport nba --today [--no-push]   practice picks for today's and tomorrow's games:
     fits "Market+ (open)" on all history, prices upcoming games from their opening line plus our signals, flags a
     Practice pick when the model differs from the opening line by 5+ points, and keeps data/practice_<sport>_teams.json
     (every pick, then its closing line, line movement, result and units at the opening price). */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:d};
const SPORT=arg('sport','nfl'),FROM=arg('from','2025'),CACHE=path.join(__dirname,'..','live','.cache');
const H=JSON.parse(fs.readFileSync(path.join(CACHE,`hist-${SPORT}.json`),'utf8')).filter(g=>g.home.pts!=null&&g.away.pts!=null).sort((a,b)=>a.date<b.date?-1:1);
const CFG={nfl:{cap:24,lam:3,s:7,home:1.5,form:.5},nba:{cap:30,lam:5,s:8.5,home:2.5,form:.3}}[SPORT];
const imp=o=>o<0?-o/(-o+100):100/(o+100),dec=o=>o>0?1+o/100:1+100/-o,logit=p=>Math.log(p/(1-p)),sig=x=>1/(1+Math.exp(-x));
const noVig=(h,a)=>h!=null&&a!=null?imp(h)/(imp(h)+imp(a)):null;
const fmt=(x,d=4)=>x==null||isNaN(x)?'—':x.toFixed(d);

/* ---------- 1. Which market line is truly pregame? ---------- */
/* ESPN's odds history sometimes stores a "close" captured after kickoff. Where a game has both the summary's DraftKings
   pregame line and an odds-history close, compare them; a source whose close drifts from the pregame line is rejected. */
const audit={};H.forEach(g=>{if(!g.pc)return;const pc=noVig(g.pc.h,g.pc.a);g.core.forEach(c=>{if(/live/i.test(c.prov||''))return;const k=c.prov||'?',cl=noVig(c.close.h,c.close.a);if(cl==null)return;
 const A=audit[k]=audit[k]||{n:0,bad:0};A.n++;if(Math.abs(cl-pc)>.03)A.bad++})});
const okProv=new Set(Object.entries(audit).filter(([,a])=>a.n>=20&&a.bad/a.n<=.1).map(([k])=>k));
H.forEach(g=>{const pc=g.pc&&noVig(g.pc.h,g.pc.a);const c=g.core.find(x=>!/live/i.test(x.prov||'')&&okProv.has(x.prov)&&x.close.h!=null)||null;
 const o=g.core.find(x=>!/live/i.test(x.prov||'')&&x.open.h!=null)||null;
 g.open=o&&o.open.a!=null?{p:noVig(o.open.h,o.open.a),h:o.open.h,a:o.open.a}:null;
 /* Closing line when it is verified pregame; otherwise the opening line, which is always set before kickoff. */
 g.mkt=pc!=null?{p:pc,h:g.pc.h,a:g.pc.a,src:'pickcenter'}:c?{p:noVig(c.close.h,c.close.a),h:c.close.h,a:c.close.a,src:c.prov+' close'}:g.open?Object.assign({src:'open'},g.open):null;g.won=g.home.pts>g.away.pts?1:g.home.pts<g.away.pts?0:null});

/* ---------- 2. Our signals, built only from earlier games ---------- */
function srs(games,lam){const t={};games.forEach(g=>{t[g.home.id]=t[g.home.id]||0;t[g.away.id]=t[g.away.id]||0});
 const hfa=games.length?games.reduce((a,g)=>a+(g.neutral?0:Math.max(-CFG.cap,Math.min(CFG.cap,g.home.pts-g.away.pts))),0)/Math.max(1,games.filter(g=>!g.neutral).length):0;
 for(let it=0;it<40;it++){const num={},den={};
  games.forEach(g=>{const m=Math.max(-CFG.cap,Math.min(CFG.cap,g.home.pts-g.away.pts))-(g.neutral?0:hfa);
   num[g.home.id]=(num[g.home.id]||0)+m+t[g.away.id];den[g.home.id]=(den[g.home.id]||0)+1;
   num[g.away.id]=(num[g.away.id]||0)-m+t[g.home.id];den[g.away.id]=(den[g.away.id]||0)+1});
  Object.keys(t).forEach(k=>t[k]=(num[k]||0)/((den[k]||0)+lam))}
 return t}
/* NFL DvP from box scores, the way DFF builds L5_dvp_rank (DK points allowed per position, last 5, ranked). */
function boxPlayers(id){const f=path.join(CACHE,`${SPORT}-${id}.json`);if(!fs.existsSync(f))return[];const sum=JSON.parse(fs.readFileSync(f,'utf8')),pl={};
 const n=v=>{const x=parseFloat(String(v).split('/')[0].split('-')[0]);return isNaN(x)?0:x};
 ((sum.boxscore&&sum.boxscore.players)||[]).forEach(t=>(t.statistics||[]).forEach(cat=>(cat.athletes||[]).forEach(a=>{const s=Object.fromEntries((cat.keys||[]).map((k,i)=>[k,n(a.stats[i])])),P=pl[a.athlete.id]=pl[a.athlete.id]||{id:a.athlete.id,team:t.team.id,dk:0,pass:0,rush:0,rec:0};
  if(cat.name==='passing'){P.dk+=.04*s.passingYards+4*s.passingTouchdowns-s.interceptions;P.pass+=s.passingAttempts||0}
  if(cat.name==='rushing'){P.dk+=.1*s.rushingYards+6*s.rushingTouchdowns;P.rush+=s.rushingAttempts||0}
  if(cat.name==='receiving'){P.dk+=s.receptions+.1*s.receivingYards+6*s.receivingTouchdowns;P.rec+=s.receptions||0}})));
 return Object.values(pl).map(p=>Object.assign(p,{pos:p.pass>=5?'QB':p.rush>p.rec?'RB':'WR'}))}
const seasons=[...new Set(H.map(g=>g.season))].sort(),finalSRS={};
seasons.forEach(s=>{finalSRS[s]=srs(H.filter(g=>g.season===s),CFG.lam)});
const rows=[];
for(const s of seasons){const G=H.filter(g=>g.season===s),prev=finalSRS[String(+s-1)]||null,dates=[...new Set(G.map(g=>g.date.slice(0,10)))];
 let cacheKey=null,R=null,soft=null,wgt=null;
 for(const g of G){const day=g.date.slice(0,10),key=SPORT==='nfl'?g.week:day,prior=G.filter(x=>x.date<g.date&&x.date.slice(0,10)<day);
  if(key!==cacheKey){cacheKey=key;R=srs(prior,CFG.lam);
   if(SPORT==='nfl'){const ids=[...new Set(prior.flatMap(x=>[x.home.id,x.away.id]))];const box={};prior.forEach(x=>box[x.id]=boxPlayers(x.id));
    const allowed={};ids.forEach(d=>{const L=prior.filter(x=>x.home.id===d||x.away.id===d).slice(-5);allowed[d]={};['QB','RB','WR'].forEach(P=>{allowed[d][P]=L.reduce((a,x)=>a+box[x.id].filter(p=>p.team!==d&&p.pos===P).reduce((b,p)=>b+p.dk,0),0)/(L.length||1)})});
    soft={};['QB','RB','WR'].forEach(P=>{const ord=[...ids].sort((a,b)=>allowed[a][P]-allowed[b][P]),N=ord.length,mid=(N+1)/2;ord.forEach((d,i)=>{(soft[d]=soft[d]||{})[P]=N>2?((i+1)-mid)/(mid-1):0})});
    wgt={};prior.forEach(x=>box[x.id].forEach(p=>{const t=wgt[p.team]=wgt[p.team]||{};const a=t[p.id]=t[p.id]||{pos:p.pos,s:0,n:0};a.s+=p.dk;a.n++}))}}
  const last=tid=>{const x=prior.filter(y=>y.home.id===tid||y.away.id===tid).pop();return x?Math.min(10,(Date.parse(g.date)-Date.parse(x.date))/864e5):7};
  const dvp=(tid,opp)=>{if(!soft||!soft[opp]||!wgt[tid])return 0;const L=Object.values(wgt[tid]).map(a=>({pos:a.pos,w:a.s/a.n})).filter(a=>a.w>0),W=L.reduce((a,x)=>a+x.w,0);return W?L.reduce((a,x)=>a+x.w*soft[opp][x.pos],0)/W:0};
  const rH=last(g.home.id),rA=last(g.away.id),nH=prior.filter(y=>y.home.id===g.home.id||y.away.id===g.home.id).length,nA=prior.filter(y=>y.home.id===g.away.id||y.away.id===g.away.id).length;
  const wins=tid=>prior.filter(y=>y.home.id===tid||y.away.id===tid).slice(-5).filter(y=>(y.home.id===tid?y.home.pts-y.away.pts:y.away.pts-y.home.pts)>0).length;
  const appM=(nH&&nA?(R[g.home.id]||0)-(R[g.away.id]||0):0)+(g.neutral?0:CFG.home)+CFG.form*(wins(g.home.id)-wins(g.away.id));
  rows.push({g,season:s,key,x:{srs:(R[g.home.id]||0)-(R[g.away.id]||0),prev:prev?(prev[g.home.id]||0)-(prev[g.away.id]||0):0,hasPrev:prev?1:0,rest:rH-rA,
   b2b:SPORT==='nba'?(rA<=1.5?1:0)-(rH<=1.5?1:0):0,dvp:dvp(g.home.id,g.away.id)-dvp(g.away.id,g.home.id),home:g.neutral?0:1,games:Math.min(nH,nA)},appP:sig(appM/CFG.s)})}}

/* ---------- Practice picks for upcoming games (--today) ---------- */
async function today(){
 const P={nba:['basketball/nba','basketball/leagues/nba'],nfl:['football/nfl','football/leagues/nfl']}[SPORT],J=async u=>{try{const r=await fetch(u);return r.ok?r.json():null}catch(e){return null}};
 const ROOT=path.join(__dirname,'..'),cp=require('node:child_process'),git=a=>cp.execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const W=fit(usable.map(MODELS['Market+ (open)']),usable.map(r=>r.g.won),1);
 const cur=seasons[seasons.length-1],G=H.filter(g=>g.season===cur),prev=finalSRS[String(+cur-1)]||null,R=srs(G,CFG.lam);
 const day=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:'America/New_York'}).replace(/-/g,''),up=[];
 for(const d of [day(Date.now()),day(Date.now()+864e5)]){const s=await J(`https://site.api.espn.com/apis/site/v2/sports/${P[0]}/scoreboard?dates=${d}`);((s&&s.events)||[]).filter(e=>e.status.type.state==='pre').forEach(e=>up.push(e))}
 const am=x=>x&&x.american!=null?parseFloat(x.american):null,games=[];
 for(const e of up){const c=e.competitions[0],Hc=c.competitors.find(x=>x.homeAway==='home'),Ac=c.competitors.find(x=>x.homeAway==='away'),hid=Hc.team.id,aid=Ac.team.id;
  const o=await J(`https://sports.core.api.espn.com/v2/sports/${P[1]}/events/${e.id}/competitions/${e.id}/odds`);
  const it=((o&&o.items)||[]).find(x=>!/live/i.test((x.provider&&x.provider.name)||'')&&x.homeTeamOdds&&x.homeTeamOdds.open&&am(x.homeTeamOdds.open.moneyLine)!=null&&am(x.awayTeamOdds.open.moneyLine)!=null);
  if(!it)continue;
  const open={h:am(it.homeTeamOdds.open.moneyLine),a:am(it.awayTeamOdds.open.moneyLine)},now={h:it.homeTeamOdds.moneyLine,a:it.awayTeamOdds.moneyLine};
  open.p=noVig(open.h,open.a);now.p=now.h!=null&&now.a!=null?noVig(now.h,now.a):null;
  const n=tid=>G.filter(y=>y.home.id===tid||y.away.id===tid).length,last=tid=>{const x=G.filter(y=>y.home.id===tid||y.away.id===tid).pop();return x?Math.min(10,(Date.parse(e.date)-Date.parse(x.date))/864e5):7};
  const rH=last(hid),rA=last(aid);
  const r={g:{open,mkt:{p:open.p}},x:{srs:(R[hid]||0)-(R[aid]||0),prev:prev?(prev[hid]||0)-(prev[aid]||0):0,hasPrev:prev?1:0,rest:rH-rA,b2b:(rA<=1.5?1:0)-(rH<=1.5?1:0),dvp:0,home:c.neutralSite?0:1,games:Math.min(n(hid),n(aid))}};
  const p=sig(MODELS['Market+ (open)'](r).reduce((a,v,j)=>a+v*W[j],0)),eh=p-open.p,ea=(1-p)-(1-open.p),side=eh>=ea?'home':'away',edge=Math.max(eh,ea),ml=open[side==='home'?'h':'a'];
  games.push({id:e.id,date:e.date,away:{abbr:Ac.team.abbreviation,n:Ac.team.name},home:{abbr:Hc.team.abbreviation,n:Hc.team.name},open,now,model:p,side,edge,pick:edge>=.05&&ml<300,
   book:it.provider&&it.provider.name,why:{rating:r.x.srs,lastSeason:r.x.prev,rest:r.x.rest,b2b:r.x.b2b}})}
 /* Practice log: add new picks at the opening price; settle finished ones with the closing line, line movement and result. */
 const logF=path.join(ROOT,'data',`practice_${SPORT}_teams.json`),L=fs.existsSync(logF)?JSON.parse(fs.readFileSync(logF,'utf8')):{picks:[]};
 games.filter(g=>g.pick&&!L.picks.some(x=>x.id===g.id)).forEach(g=>{const s=g.side==='home'?'h':'a';
  L.picks.push({id:g.id,date:g.date,team:g[g.side].n,opp:g[g.side==='home'?'away':'home'].n,side:g.side,openML:g.open[s],openP:s==='h'?g.open.p:1-g.open.p,modelP:g.side==='home'?g.model:1-g.model,edge:g.edge,logged:new Date().toISOString()})});
 L.picks.filter(x=>x.result==null).forEach(x=>{const h=H.find(g=>g.id===x.id);if(!h||h.won==null)return;const won=x.side==='home'?h.won:1-h.won;
  x.result=won?'win':'loss';x.units=won?dec(x.openML)-1:-1;if(h.mkt){x.closeP=x.side==='home'?h.mkt.p:1-h.mkt.p;x.closeML=x.side==='home'?h.mkt.h:h.mkt.a;x.clv=x.closeP-x.openP}});
 const S=L.picks.filter(x=>x.result);L.summary={picks:L.picks.length,settled:S.length,wins:S.filter(x=>x.result==='win').length,units:S.reduce((a,x)=>a+x.units,0),
  clv:S.filter(x=>x.clv!=null).reduce((a,x)=>a+x.clv,0)/Math.max(1,S.filter(x=>x.clv!=null).length),since:L.picks[0]&&L.picks[0].logged||null};
 L.weights=W;L.updated=new Date().toISOString();
 const sigF=path.join(ROOT,'data',`team_signals_${SPORT}.json`);
 fs.writeFileSync(sigF,JSON.stringify({sport:SPORT,generated:new Date().toISOString(),checked:new Date().toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET',
  rule:'Practice pick when the tested model differs from the opening line by 5+ points (walk-forward test 2025-26: 229-147, +2.8% at the opening price, not yet proven)',games}));
 fs.writeFileSync(logF,JSON.stringify(L,null,1));
 console.log(`${SPORT.toUpperCase()} signals: ${games.length} upcoming games with an opening line, ${games.filter(g=>g.pick).length} practice picks. Log: ${L.summary.picks} picks, ${L.summary.settled} settled.`);
 games.forEach(g=>console.log(`  ${g.away.abbr} @ ${g.home.abbr}: open ${g.open.h}/${g.open.a} (${Math.round(g.open.p*100)}% home) · model ${Math.round(g.model*100)}% · edge ${(g.edge*100).toFixed(1)} on ${g[g.side].abbr}${g.pick?'  << PRACTICE PICK':''}`));
 if(process.argv.includes('--no-push'))return;
 try{git(['pull','-q','--rebase','--autostash']);const f=[path.relative(ROOT,sigF),path.relative(ROOT,logF)].map(x=>x.replace(/\\/g,'/'));git(['add',...f]);
  if(git(['status','--porcelain','--',...f])){git(['commit','-q','-m',`${SPORT.toUpperCase()} team signals and practice log`]);git(['push','-q','origin','main']);console.log('Pushed to GitHub.')}}
 catch(e){console.log('Git step failed: '+String(e.stderr||e.message).trim());process.exit(1)}
}

/* ---------- 3. Logistic regression with ridge, fit by Newton steps ---------- */
function fit(X,y,lam){const k=X[0].length;let w=new Array(k).fill(0);
 for(let it=0;it<25;it++){const g=new Array(k).fill(0),Hm=Array.from({length:k},()=>new Array(k).fill(0));
  X.forEach((x,i)=>{const p=sig(x.reduce((a,v,j)=>a+v*w[j],0)),e=p-y[i],v=p*(1-p);for(let a=0;a<k;a++){g[a]+=e*x[a];for(let b=0;b<k;b++)Hm[a][b]+=v*x[a]*x[b]}});
  for(let a=1;a<k;a++){g[a]+=lam*w[a];Hm[a][a]+=lam}
  const M=Hm.map((r,i)=>[...r,g[i]]);for(let c=0;c<k;c++){let p=c;for(let r=c+1;r<k;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;[M[c],M[p]]=[M[p],M[c]];if(Math.abs(M[c][c])<1e-12)continue;
   for(let r=0;r<k;r++)if(r!==c){const f=M[r][c]/M[c][c];for(let j=c;j<=k;j++)M[r][j]-=f*M[c][j]}}
  const step=M.map((r,i)=>Math.abs(r[i])<1e-12?0:r[k]/r[i]);w=w.map((v,i)=>v-step[i]);if(step.every(s=>Math.abs(s)<1e-7))break}
 return w}
const sc=SPORT==='nfl'?{srs:1/7,prev:1/7,rest:1/7,dvp:1,b2b:1}:{srs:1/10,prev:1/10,rest:1/2,dvp:1,b2b:1};
const feats=r=>[r.x.srs*sc.srs*Math.min(1,r.x.games/4),r.x.prev*sc.prev*r.x.hasPrev,r.x.rest*sc.rest,SPORT==='nba'?r.x.b2b:r.x.dvp*sc.dvp];
const FEAT=['rating gap (this season)','rating gap (last season)','rest gap',SPORT==='nba'?'back-to-back':'DvP matchup'];
const MODELS={
 /* Same signals anchored on the OPENING line: the realistic workflow (bet when lines first post), scored at the open price. */
 'Market+ (open)':r=>[1,logit(r.g.open&&r.g.open.p>0&&r.g.open.p<1?r.g.open.p:r.g.mkt.p),...feats(r)],
 'Open line':r=>[1,logit(r.g.open&&r.g.open.p>0&&r.g.open.p<1?r.g.open.p:r.g.mkt.p)],
 'Recal':r=>[1,logit(r.g.mkt.p)],
 'Market+':r=>[1,logit(r.g.mkt.p),...feats(r)],
 'Ours only':r=>[1,r.x.home,...feats(r)]};
const usable=rows.filter(r=>r.g.mkt&&r.g.mkt.p>0&&r.g.mkt.p<1&&r.g.won!=null);
const test=usable.filter(r=>r.season>=FROM);
console.log(`${SPORT.toUpperCase()}: ${rows.length} games, ${usable.length} with a trusted pregame line; scored on ${test.length} games from season ${FROM} (walk-forward).`);
console.log('Line audit (odds-history close vs DraftKings pregame, games with both):',Object.entries(audit).map(([k,a])=>`${k} ${a.n} games, ${Math.round(a.bad/a.n*100)}% off by >3%`).join(' · ')||'none',`→ trusted: ${[...okProv].join(', ')||'pickcenter only'}`);
if(process.argv.includes('--today')){today().catch(e=>{console.error(e);process.exit(1)});return}
const pred={Market:[],'App now':[]};Object.keys(MODELS).forEach(m=>pred[m]=[]);let lastW={};
const keys=[...new Set(test.map(r=>`${r.season}|${r.key}`))];
for(const k of keys){const T=test.filter(r=>`${r.season}|${r.key}`===k),t0=T.reduce((a,r)=>r.g.date<a?r.g.date:a,T[0].g.date),
  train=usable.filter(r=>r.g.date<t0&&!(r.season===T[0].season&&r.key===T[0].key));
 for(const [m,f] of Object.entries(MODELS)){
  /* Too little history to learn from yet: fall back to the market (or 50/50 for "ours only"). */
  if(train.length<40){T.forEach(r=>pred[m].push([r,m==='Ours only'?.5:r.g.mkt.p]));continue}
  const w=fit(train.map(f),train.map(r=>r.g.won),1);lastW[m]=w;T.forEach(r=>pred[m].push([r,sig(f(r).reduce((a,v,j)=>a+v*w[j],0))]))}
 T.forEach(r=>{pred.Market.push([r,r.g.mkt.p]);pred['App now'].push([r,r.appP])})}

/* ---------- 4. Scoring ---------- */
function evalP(list){let br=0,ll=0,acc=0;const cal={};list.forEach(([r,p])=>{const y=r.g.won;br+=(p-y)**2;ll+=-Math.log(Math.max(1e-6,y?p:1-p));acc+=(p>=.5)===(y===1)?1:0;
 const pp=Math.max(p,1-p),b=Math.min(9,Math.floor(pp*10)),c=cal[b]=cal[b]||{n:0,s:0,w:0};c.n++;c.s+=pp;c.w+=((p>=.5)===(y===1))?1:0});
 return{n:list.length,brier:br/list.length,ll:ll/list.length,acc:acc/list.length,cal}}
function bets(list,th,useOpen){let n=0,w=0,u=0,clv=0,nc=0;list.forEach(([r,p])=>{const m=useOpen?r.g.open:r.g.mkt;if(!m||m.p==null)return;const eh=p-m.p,ea=(1-p)-(1-m.p),side=eh>=ea?'h':'a',e=Math.max(eh,ea),ml=m[side];
  if(e<th||ml==null||ml>=300)return;n++;const won=side==='h'?r.g.won:1-r.g.won;if(won){w++;u+=dec(ml)-1}else u-=1;
  if(r.g.open&&r.g.mkt&&r.g.open.p!=null){const po=side==='h'?r.g.open.p:1-r.g.open.p,pc=side==='h'?r.g.mkt.p:1-r.g.mkt.p;clv+=pc-po;nc++}});
 return{n,w,u,roi:n?u/n:null,clv:nc?clv/nc:null}}
const res=Object.entries(pred).map(([m,l])=>({m,...evalP(l)}));
console.table(res.map(x=>({model:x.m,games:x.n,'Brier (lower=better)':fmt(x.brier),'log loss':fmt(x.ll),'picked winner':(x.acc*100).toFixed(1)+'%'})));
console.log('\nCalibration (favorite\'s chance → how often the favorite won):');
const cal=Object.fromEntries(res.map(x=>[x.m,x.cal])),bk=[5,6,7,8,9];
console.table(bk.map(b=>Object.fromEntries([['bucket',`${b*10}-${b*10+10}%`],...res.map(x=>{const c=x.cal[b];return[x.m,c?`${Math.round(c.s/c.n*100)}→${Math.round(c.w/c.n*100)}% (${c.n})`:'—']})])));
console.log('\nPicks at the closing price (edge = our chance minus the no-vig chance; +300 or longer skipped):');
const B=[];[['Market+ (open)',true],['Market+',false],['Ours only',false],['App now',false]].forEach(([m,op])=>[.02,.03,.05].forEach(th=>{const b=bets(pred[m],th,op);B.push({model:m+(op?' @ open price':' @ close price'),'min edge':`${th*100} pts`,picks:b.n,record:`${b.w}-${b.n-b.w}`,units:(b.u>=0?'+':'')+b.u.toFixed(2),ROI:b.roi==null?'—':(b.roi*100).toFixed(1)+'%','line moved our way':b.clv==null?'—':(b.clv*100).toFixed(2)+' pts'})}));
console.table(B);
console.log('\nLearned weights (last refit):');Object.entries(lastW).forEach(([m,w])=>console.log(`  ${m}: ${w.map(v=>v.toFixed(3)).join(', ')}  [${/Recal|Open line/.test(m)?'intercept, market':/Market\+/.test(m)?['intercept','market',...FEAT].join(', '):['intercept','home',...FEAT].join(', ')}]`));
fs.writeFileSync(path.join(__dirname,'..','live',`backtest-v2-${SPORT}.json`),JSON.stringify({generated:new Date().toISOString(),sport:SPORT,from:FROM,games:test.length,audit,results:res.map(({cal,...x})=>x),calibration:cal,bets:B,weights:lastW,features:FEAT},null,1));
