/* Walk-forward backtest of NBA player props: does Stamped's last-5 lean beat the posted price, and what Stamped % is honest?
     node tools/tune-props.js [--diag]   --diag also prints single-signal checks. Needs live/.cache/props-nba.json (tools/hist-props.js) and the cached box scores (tools/hist.js)
   Every line is graded on the box score (did not play = void, like the books). Features use only games before that day.
   Models (each predicts the chance of the Over):
     Market    no-vig price of the posted Over/Under pair
     Market+   the market's chance adjusted by recent form, fitted on earlier days only (logistic, ridge, market as offset)
   The app's lean rule (last 5: 3+ on one side and a half-step cushion; Strong = 4+ of 5) is graded at the posted price.
   DFF matchup ranks and projections are not kept historically, so that part of the rule cannot be replayed.
   Results -> live/backtest-props-nba.json. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const CACHE=path.join(__dirname,'..','live','.cache');
const STEP={points:2,rebounds:1,assists:1,threes:1,PRA:3};
const imp=o=>o>0?100/(o+100):-o/(-o+100),win=o=>o>0?o/100:100/-o;
const lg=p=>Math.log(p/(1-p)),sg=z=>1/(1+Math.exp(-z));

/* Box scores -> per-player game list, in date order. */
const H=JSON.parse(fs.readFileSync(path.join(CACHE,'hist-nba.json'),'utf8')).sort((a,b)=>a.date<b.date?-1:1);
const games={},hist={},teamG={},G={};
for(const g of H){const f=path.join(CACHE,`nba-${g.id}.json`);if(!fs.existsSync(f))continue;const sum=JSON.parse(fs.readFileSync(f,'utf8')),box={},coach=new Set();
 ((sum.boxscore&&sum.boxscore.players)||[]).forEach(t=>{const S=(t.statistics||[])[0];if(!S)return;const K=S.keys||[],ix=k=>K.indexOf(k);
  (S.athletes||[]).forEach(a=>{const v=k=>{const x=parseFloat(String((a.stats||[])[ix(k)]||'').split('-')[0]);return isNaN(x)?0:x};
   const min=v('minutes');if(!(min>0)){if(/coach/i.test(a.reason||''))coach.add(a.athlete.id);return}
   const s={min,team:t.team.id,pos:(a.athlete.position&&a.athlete.position.abbreviation||'F')[0],points:v('points'),rebounds:v('rebounds'),assists:v('assists'),threes:v('threePointFieldGoalsMade-threePointFieldGoalsAttempted')};s.PRA=s.points+s.rebounds+s.assists;
   box[a.athlete.id]=s;(hist[a.athlete.id]=hist[a.athlete.id]||[]).push({date:g.date,season:g.season,s})})});
 games[g.id]=box;G[g.id]={g,coach};[g.home.id,g.away.id].forEach(t=>(teamG[t]=teamG[t]||[]).push(g.id))}
const before=(a,date)=>{const h=hist[a]||[];let i=h.length;while(i>0&&h[i-1].date>=date)i--;return h.slice(0,i)};
const STATS=Object.keys(STEP);
/* Team context for one game, from earlier games only:
   miss[team][stat]  share of the team's production missing: regulars (3+ of the team's last 5, 15+ minutes) who do not
                     play and were not benched by the coach (the same pregame-knowable rule as tools/tune.js)
   dvp[team][pos][stat]  what the team allowed to each position (G/F/C) per game over its last 10, relative to the league */
const ctxCache={};
function ctx(gid){if(ctxCache[gid])return ctxCache[gid];const {g,coach}=G[gid],box=games[gid],miss={},dvp={};
 for(const t of [g.home.id,g.away.id]){const prior=teamG[t].filter(id=>G[id].g.date<g.date&&G[id].g.season===g.season),L5=prior.slice(-5);
  const reg={};L5.forEach(id=>Object.entries(games[id]).forEach(([a,s])=>{if(s.team!==t)return;const R=reg[a]=reg[a]||{n:0,min:0,s:{}};R.n++;R.min+=s.min;STATS.forEach(k=>R.s[k]=(R.s[k]||0)+s[k])}));
  const tot={};L5.forEach(id=>Object.values(games[id]).forEach(s=>{if(s.team===t)STATS.forEach(k=>tot[k]=(tot[k]||0)+s[k])}));
  miss[t]={};STATS.forEach(k=>miss[t][k]=0);
  Object.entries(reg).forEach(([a,R])=>{if(R.n<3||R.min/R.n<15||box[a]||coach.has(a))return;STATS.forEach(k=>miss[t][k]+=tot[k]?(R.s[k]/R.n)/(tot[k]/L5.length):0)});
  const L10=prior.slice(-10),al={};L10.forEach(id=>Object.values(games[id]).forEach(s=>{if(s.team===t)return;const A=al[s.pos]=al[s.pos]||{};STATS.forEach(k=>A[k]=(A[k]||0)+s[k]/L10.length)}));
  dvp[t]={n:L10.length,al}}
 /* League average allowed per position, over the same window for every team (approximated by these two teams' peers). */
 return ctxCache[gid]={miss,dvp}}
const lgAvg={};{const tot={},n={};Object.values(games).forEach(b=>{const per={};Object.values(b).forEach(s=>{STATS.forEach(k=>{per[s.pos+k]=(per[s.pos+k]||0)+s[k]})});
 Object.entries(per).forEach(([k,v])=>{tot[k]=(tot[k]||0)+v/2;n[k]=(n[k]||0)+1})});Object.keys(tot).forEach(k=>lgAvg[k]=tot[k]/n[k])}

/* Rows with features and outcomes. */
const P=JSON.parse(fs.readFileSync(path.join(CACHE,'props-nba.json'),'utf8')),rows=[];
for(const r of P){const box=games[r.id];if(!box)continue;const me=box[r.a];if(!me)continue;/* did not play: void */
 const y=me[r.st];if(y===r.L)continue;/* push */
 const h=before(r.a,r.date).reverse(),l5=h.slice(0,5).map(x=>x.s[r.st]);if(l5.length<3)continue;
 const avg=a=>a.reduce((s,x)=>s+x,0)/a.length,cur=h.filter(x=>x.season===r.season),sd=Math.sqrt(Math.max(r.L,1));
 const l10=h.slice(0,10),pm=imp(r.o)/(imp(r.o)+imp(r.u));
 const n=l5.length,over=l5.filter(x=>x>r.L).length,under=l5.filter(x=>x<r.L).length,a5=avg(l5),half=STEP[r.st]*.5;
 let side=null;if(over/n>=.6&&a5-r.L>=half)side='O';else if(under/n>=.6&&r.L-a5>=half)side='U';
 const g=G[r.id].g,team=me.team,opp=team===g.home.id?g.away.id:g.home.id,C=ctx(r.id),a10=avg(l10.map(x=>x.s[r.st]));
 const D=C.dvp[opp],dv=D.n>=5&&D.al[me.pos]&&lgAvg[me.pos+r.st]?D.al[me.pos][r.st]/lgAvg[me.pos+r.st]-1:0;
 const b2b=h.length&&(Date.parse(r.date)-Date.parse(h[0].date))<30*36e5?1:0;
 rows.push({...r,y:y>r.L?1:0,pm,n,over,under,a5,side,k:side==='O'?over:side==='U'?under:0,miss:C.miss[team][r.st],dv,b2b,
  x:[1,(a5-r.L)/sd,over/n-.5,(a10-r.L)/sd,cur.length>=3?(avg(cur.map(x=>x.s[r.st]))-r.L)/sd:0,
     (avg(h.slice(0,3).map(x=>x.s.min))-avg(l10.map(x=>x.s.min)))/10,
     C.miss[team][r.st]*a10/sd,dv*a10/sd,b2b,team===g.home.id?1:0]})}
rows.sort((a,b)=>a.date<b.date?-1:1);
const FEAT=['intercept','L5 avg vs line','L5 over rate','L10 avg vs line','season avg vs line','minutes trend','teammates out','opponent vs position','back-to-back','home'];

/* Logistic regression with the market as offset, ridge penalty, Newton steps. */
function fit(T,lam=20){const d=T[0].x.length;let w=new Array(d).fill(0);
 for(let it=0;it<8;it++){const g=new Array(d).fill(0),Hm=[...Array(d)].map(()=>new Array(d).fill(0));
  for(const r of T){const p=sg(lg(r.pm)+r.x.reduce((s,v,i)=>s+v*w[i],0)),e=p-r.y,q=p*(1-p);for(let i=0;i<d;i++){g[i]+=e*r.x[i];for(let j=0;j<d;j++)Hm[i][j]+=q*r.x[i]*r.x[j]}}
  for(let i=0;i<d;i++){g[i]+=lam*w[i];Hm[i][i]+=lam}
  /* Solve Hm * step = g (Gaussian elimination). */
  const A=Hm.map((row,i)=>[...row,g[i]]);for(let i=0;i<d;i++){let m=i;for(let k=i+1;k<d;k++)if(Math.abs(A[k][i])>Math.abs(A[m][i]))m=k;[A[i],A[m]]=[A[m],A[i]];
   for(let k=i+1;k<d;k++){const f=A[k][i]/A[i][i];for(let j=i;j<=d;j++)A[k][j]-=f*A[i][j]}}
  const s=new Array(d).fill(0);for(let i=d-1;i>=0;i--){let v=A[i][d];for(let j=i+1;j<d;j++)v-=A[i][j]*s[j];s[i]=v/A[i][i]}
  w=w.map((v,i)=>v-s[i])}
 return w}
const days=[...new Set(rows.map(r=>r.date.slice(0,10)))].sort();let W=null;
for(const day of days){const T=rows.filter(r=>r.date.slice(0,10)<day);if(T.length<3000)continue;W=fit(T);
 rows.filter(r=>r.date.slice(0,10)===day).forEach(r=>r.pp=sg(lg(r.pm)+r.x.reduce((s,v,i)=>s+v*W[i],0)))}
const final=fit(rows);

/* Scoring. */
const brier=(R,f)=>R.reduce((s,r)=>s+(f(r)-r.y)**2,0)/R.length,ll=(R,f)=>-R.reduce((s,r)=>{const p=Math.min(.999,Math.max(.001,f(r)));return s+(r.y?Math.log(p):Math.log(1-p))},0)/R.length;
const bet=(R,sideOf)=>{let n=0,w=0,u=0;R.forEach(r=>{const s=sideOf(r);if(!s)return;const o=s==='O'?r.o:r.u,hit=s==='O'?r.y===1:r.y===0;n++;if(hit){w++;u+=win(o)}else u-=1});return{n,w,l:n-w,hit:n?+(w/n).toFixed(3):null,roi:n?+(u/n).toFixed(3):null}};
const calib=(R,f)=>{const b={};R.forEach(r=>{const p=f(r),k=Math.min(9,Math.floor(p*10));const B=b[k]=b[k]||{n:0,p:0,y:0};B.n++;B.p+=p;B.y+=r.y});
 return Object.keys(b).sort((a,c)=>a-c).map(k=>({bucket:`${k*10}-${k*10+10}%`,n:b[k].n,predicted:+(b[k].p/b[k].n).toFixed(3),actual:+(b[k].y/b[k].n).toFixed(3)}))};
const T=rows.filter(r=>r.pp!=null),edge=(r,th)=>{const eo=r.pp-imp(r.o),eu=(1-r.pp)-imp(r.u);return eo>=th&&eo>=eu?'O':eu>=th?'U':null};
/* The app's rule, and the chance it really had: market+ chance of the lean side. */
const rule=R=>({all:bet(R,r=>r.side),strong:bet(R,r=>r.k>=4?r.side:null),moderate:bet(R,r=>r.k===3?r.side:null),
 over:bet(R,r=>r.side==='O'?'O':null),under:bet(R,r=>r.side==='U'?'U':null)});
const out={generated:new Date().toISOString(),lines:rows.length,tested:T.length,
 books:[...new Set(rows.map(r=>r.book))].map(b=>({book:b,lines:rows.filter(r=>r.book===b).length})),
 accuracy:{Market:{brier:+brier(T,r=>r.pm).toFixed(4),logloss:+ll(T,r=>r.pm).toFixed(4)},'Market+':{brier:+brier(T,r=>r.pp).toFixed(4),logloss:+ll(T,r=>r.pp).toFixed(4)}},
 overRate:+(rows.reduce((s,r)=>s+r.y,0)/rows.length).toFixed(3),marketOver:+(rows.reduce((s,r)=>s+r.pm,0)/rows.length).toFixed(3),
 calibration:{Market:calib(T,r=>r.pm),'Market+':calib(T,r=>r.pp)},
 rule:{allLines:rule(rows),tested:rule(T),byStat:Object.fromEntries(Object.keys(STEP).map(s=>[s,bet(rows.filter(r=>r.st===s),r=>r.side)]))},
 ruleChance:{strong:+(T.filter(r=>r.k>=4).reduce((s,r)=>s+(r.side==='O'?r.pp:1-r.pp),0)/(T.filter(r=>r.k>=4).length||1)).toFixed(3),
  moderate:+(T.filter(r=>r.k===3).reduce((s,r)=>s+(r.side==='O'?r.pp:1-r.pp),0)/(T.filter(r=>r.k===3).length||1)).toFixed(3)},
 edges:Object.fromEntries([.02,.04,.06,.08].map(th=>[`${th*100}%+`,bet(T,r=>edge(r,th))])),
 weights:Object.fromEntries(FEAT.map((f,i)=>[f,+final[i].toFixed(3)]))};
fs.writeFileSync(path.join(__dirname,'..','live','backtest-props-nba.json'),JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
if(process.argv.includes('--diag')){const grp=(name,f)=>{const R=rows.filter(f);console.log(name.padEnd(28),R.length,'over',(R.reduce((s,r)=>s+r.y,0)/R.length).toFixed(3),'market',(R.reduce((s,r)=>s+r.pm,0)/R.length).toFixed(3))};
 grp('all',r=>1);grp('teammates out >10%',r=>r.miss>.1);grp('teammates out >25%',r=>r.miss>.25);grp('opp soft >10%',r=>r.dv>.1);grp('opp tough <-10%',r=>r.dv<-.1);
 grp('b2b',r=>r.b2b);grp('line moved up 1+',r=>r.open!=null&&r.L-r.open>=1);grp('line moved down 1+',r=>r.open!=null&&r.open-r.L>=1);
 STATS.forEach(s=>grp('stat '+s,r=>r.st===s));['ESPN BET','DraftKings'].forEach(b=>grp(b,r=>r.book===b))}
if(process.argv.includes('--diag')){const half=rows[rows.length>>1].date;
 const show=(name,f)=>{const a=bet(rows,r=>f(r)?'U':null),e=bet(rows.filter(r=>r.date<half),r=>f(r)?'U':null),l=bet(rows.filter(r=>r.date>=half),r=>f(r)?'U':null),
  s25=bet(rows.filter(r=>r.season==='2025'),r=>f(r)?'U':null),s26=bet(rows.filter(r=>r.season==='2026'),r=>f(r)?'U':null);
  console.log(('UNDER '+name).padEnd(34),`all ${a.n} ${a.hit} roi ${a.roi} | 2025 ${s25.n} ${s25.roi} | 2026 ${s26.n} ${s26.roi}`)};
 show('every line',r=>1);show('teammates out >10%',r=>r.miss>.1);show('teammates out >25%',r=>r.miss>.25);show('teammates out >40%',r=>r.miss>.4);
 show('teammates out >25% & price<=-100',r=>r.miss>.25&&r.u<=-100);show('no teammates out',r=>r.miss===0)}
