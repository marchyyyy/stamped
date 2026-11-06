/* Historical replay for NBA Live Intelligence.
   Usage (repo root):
     node live/backtest.js [--days 21] [--end 20261105] [--sims 2000]           score the current model on every game
     node live/backtest.js --tune --split 20261028                             tune on games before the split, report on games from it
   For each completed game it rebuilds the game state from play-by-play at fixed checkpoints, using only plays before
   the checkpoint (no look-ahead), runs the live model, and scores it against what actually happened.
   With --tune, parameters are chosen on the earlier games only and the published numbers come from the later games
   the tuning never saw. Writes live/backtest-results.json, shown on the dashboard under Historical accuracy. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const E=require('./engine.js'),S=require('./espn.js');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:d},flag=k=>process.argv.includes('--'+k);
const DAYS=+arg('days',21),SIMS=+arg('sims',2000),SPLIT=arg('split',null);
const ymd=d=>d.toISOString().slice(0,10).replace(/-/g,'');
const endArg=arg('end',null),END=endArg?new Date(`${endArg.slice(0,4)}-${endArg.slice(4,6)}-${endArg.slice(6)}T12:00:00Z`):new Date();
const CACHE=path.join(__dirname,'.cache');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,tries=3){for(let i=0;i<tries;i++){try{const r=await fetch(url);if(r.ok)return r.json();if(r.status===404)return null}catch(e){}await sleep(1000*(i+1))}return null}
async function summary(id){const f=path.join(CACHE,id+'.json');if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f,'utf8'));
 const s=await get(S.URLS.summary(id));await sleep(300);if(s&&S.finalOf(s)){fs.mkdirSync(CACHE,{recursive:true});fs.writeFileSync(f,JSON.stringify(s))}return s}

const CPS=[
 {label:'Pregame',period:1,clock:720,pre:true,q:1},
 {label:'Q1 6:00',period:1,clock:360,q:1},{label:'End Q1',period:2,clock:720,q:2},{label:'Q2 6:00',period:2,clock:360,q:2},
 {label:'Halftime',period:3,clock:720,q:3},{label:'Q3 6:00',period:3,clock:360,q:3},{label:'End Q3',period:4,clock:720,q:4},
 {label:'Q4 6:00',period:4,clock:360,q:4},{label:'Q4 2:00',period:4,clock:120,q:4}];

async function loadGames(){const games=[];let skipped=0;
 for(let k=DAYS;k>=1;k--){const d=new Date(END.getTime()-k*864e5),sb=await get(S.URLS.scoreboard(ymd(d)));await sleep(200);
  for(const ev of (sb&&sb.events)||[]){if(!ev.status||ev.status.type.state!=='post')continue;
   const sum=await summary(ev.id);
   if(!sum||!(sum.plays||[]).length){skipped++;continue}
   const fin=S.finalOf(sum),pre=S.pregameOf(sum);if(!fin||!pre||pre.homeMargin==null){skipped++;continue}
   /* Checkpoint states are built once; only the simulation changes between parameter sets. */
   const states=CPS.map(c=>c.pre?{id:ev.id,status:'pre',period:0,clock:0,home:{...fin.home,pts:0,q:[],fga:0,fta:0,oreb:0,tov:0},away:{...fin.away,pts:0,q:[],fga:0,fta:0,oreb:0,tov:0},pregame:pre,players:[]}:S.fromPlays(sum,c));
   games.push({id:ev.id,date:ymd(d),fin,pre,states})}
  process.stdout.write(`\r${ymd(d)}: ${games.length} games`)}
 console.log('');return{games,skipped}}

function evaluate(games,params){
 const qActual=(f,q)=>(f.home.q[q-1]||0)+(f.away.q[q-1]||0);
 const rows=CPS.map(c=>({label:c.label,n:0,aeTotal:0,aeQ:0,aeQNaive:0,brierWin:0,brierOver:0,nOver:0}));
 const cal=Array.from({length:10},(_,i)=>({bucket:`${i*10}–${i*10+10}%`,n:0,p:0,o:0}));
 let preAe=0;
 for(const g of games){const f=g.fin,total=f.home.pts+f.away.pts,homeWin=f.home.pts>f.away.pts?1:0;preAe+=Math.abs(g.pre.total-total);
  CPS.forEach((c,i)=>{const st=g.states[i],sim=E.simulate(st,{n:SIMS,params}),R=rows[i];R.n++;
   R.aeTotal+=Math.abs(sim.mean('game')-total);
   R.aeQ+=Math.abs(sim.mean('q'+c.q)-qActual(f,c.q));
   const before=c.pre?0:(st.home.q[c.q-1]||0)+(st.away.q[c.q-1]||0),frac=c.pre?1:(c.period===c.q?c.clock/720:1);
   R.aeQNaive+=Math.abs(before+g.pre.total/4*frac-qActual(f,c.q));
   const pw=sim.prob('game:m',0).over;R.brierWin+=Math.pow(pw-homeWin,2);
   if(total!==g.pre.total){const po=sim.prob('game',g.pre.total).over;R.brierOver+=Math.pow(po-(total>g.pre.total?1:0),2);R.nOver++}
   if(!c.pre){const b=cal[Math.min(9,Math.floor(pw*10))];b.n++;b.p+=pw;b.o+=homeWin}})}
 const by=rows.map(r=>({label:r.label,n:r.n,maeTotal:r.aeTotal/r.n,maeNextQ:r.aeQ/r.n,maeNextQNaive:r.aeQNaive/r.n,brierWin:r.brierWin/r.n,brierOver:r.nOver?r.brierOver/r.nOver:null}));
 const live=by.slice(1);
 return{byCheckpoint:by,calibration:cal.filter(b=>b.n).map(b=>({bucket:b.bucket,n:b.n,predicted:b.p/b.n,observed:b.o/b.n})),pregameMae:preAe/games.length,
  score:{brierWin:live.reduce((a,r)=>a+r.brierWin,0)/live.length,brierOver:live.reduce((a,r)=>a+r.brierOver,0)/live.length,maeTotal:live.reduce((a,r)=>a+r.maeTotal,0)/live.length}}}
/* One number to minimize: mean live Brier (win + over) plus total MAE scaled to a similar size. */
const loss=s=>s.brierWin+s.brierOver+s.maeTotal/100;
const show=(t,r)=>{console.log(`\n${t}`);console.table(r.byCheckpoint.map(x=>({checkpoint:x.label,n:x.n,'total MAE':x.maeTotal.toFixed(2),'qtr MAE':x.maeNextQ.toFixed(2),'qtr naive':x.maeNextQNaive.toFixed(2),'Brier win':x.brierWin.toFixed(3),'Brier over':x.brierOver!=null?x.brierOver.toFixed(3):'—'})));
 console.table(r.calibration.map(c=>({bucket:c.bucket,n:c.n,predicted:(c.predicted*100).toFixed(1)+'%',actual:(c.observed*100).toFixed(1)+'%'})))};

(async()=>{
 const {games,skipped}=await loadGames();
 if(!games.length){console.log('No completed games with play-by-play and a pregame line in range.');process.exit(1)}
 const train=SPLIT?games.filter(g=>g.date<SPLIT):[],test=SPLIT?games.filter(g=>g.date>=SPLIT):games;
 let tuning=null;
 if(flag('tune')){
  if(!train.length||!test.length){console.log('--tune needs --split with games on both sides.');process.exit(1)}
  /* --grid '{"blowout":[12,18],"blowPace":[.8,.88]}' tunes any engine constants; others stay at their current values. */
  const spec=JSON.parse(arg('grid','{"kRate":[12,24,48,96,192,480],"rubber":[0,0.002,0.004,0.006],"blowPace":[0.97,0.88]}'));
  const grid=Object.entries(spec).reduce((acc,[k,vs])=>acc.flatMap(p=>vs.map(v=>({...p,[k]:v}))),[{}]);
  const res=grid.map(p=>{const r=evaluate(train,p);return{p,s:r.score,l:loss(r.score)}}).sort((a,b)=>a.l-b.l);
  console.log(`Tuning on ${train.length} games before ${SPLIT}:`);console.table(res.slice(0,8).map(x=>({...x.p,'Brier win':x.s.brierWin.toFixed(4),'Brier over':x.s.brierOver.toFixed(4),'total MAE':x.s.maeTotal.toFixed(2),loss:x.l.toFixed(4)})));
  const cur=Object.fromEntries(Object.keys(spec).map(k=>[k,E.NBA[k]])),same=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]),base=res.find(x=>same(x.p,cur));
  tuning={train:train.length,trainRange:`${train[0].date}–${train[train.length-1].date}`,grid:grid.length,best:res[0].p,current:cur,trainLossBest:res[0].l,trainLossCurrent:base&&base.l};
  const tb=evaluate(test,res[0].p),tc=evaluate(test,cur);
  console.log(`\nHeld-out test (${test.length} games from ${SPLIT}): best ${JSON.stringify(res[0].p)} loss ${loss(tb.score).toFixed(4)} vs current ${JSON.stringify(cur)} loss ${loss(tc.score).toFixed(4)}`);
  tuning.testLossBest=loss(tb.score);tuning.testLossCurrent=loss(tc.score);
  console.log(`Set these in live/engine.js (NBA.${Object.keys(spec).join(', NBA.')}) only if the held-out loss improved, then rerun without --tune.`);
 }
 const r=evaluate(test,null);show(`Current engine on ${test.length} ${SPLIT?'held-out ':''}games`,r);
 const out={modelVersion:E.VERSION,params:{kRate:E.NBA.kRate,rubber:E.NBA.rubber,blowPace:E.NBA.blowPace,kPace:E.NBA.kPace},generated:new Date().toISOString(),games:test.length,skipped,
  range:`${test[0].date}–${test[test.length-1].date}`,sims:SIMS,outOfSample:!!SPLIT,tuning,pregameMae:r.pregameMae,byCheckpoint:r.byCheckpoint,calibration:r.calibration,
  notes:[SPLIT?`Parameters were tuned only on games before ${SPLIT}; these numbers are from later games the tuning never saw.`:'Parameters are fixed priors, not tuned on these games.',
   'Next-quarter MAE is for the quarter in progress (or starting) at that checkpoint; the naive reference is the pregame total split evenly by quarter.',
   'Pregame lines are ESPN pickcenter (DraftKings), known before tip-off.',
   'No historical live odds are available from the free sources, so expected value, closing line value and results after latency and fees are not evaluated yet. Paper trading on the live page fills that gap going forward.']};
 if(!flag('tune')||flag('write')){const file=path.join(__dirname,'backtest-results.json');fs.writeFileSync(file,JSON.stringify(out,null,1));console.log('Wrote '+file)}
})();
