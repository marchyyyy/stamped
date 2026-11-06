/* NFL team-model backtest: replays weeks 2..N using only games from earlier weeks (no look-ahead), and scores
   the new team model (offense vs this defense + DvP), the old one (season scoring margin) and the market (DraftKings'
   pregame moneyline, no-vig) against what happened. Week 1 has no prior games, so it is not scored.
   DvP is rebuilt the way DFF builds L5_dvp_rank: DraftKings points each defense allowed to QBs, RBs, WRs and TEs over
   its last 5 games, ranked 1 (fewest) to 32 (most); a team's matchup score weights its players by their average points.
   Injuries are not in this replay (no historical injury points), and rest has no NFL weight, so both are 0.
   Usage (repo root):  node tools/backtest-teams.js [--weeks 7] [--season 2026]     Cache: live/.cache (gitignored). */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:d};
const WEEKS=+arg('weeks',7),SEASON=arg('season','2026'),SITE='https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CACHE=path.join(__dirname,'..','live','.cache'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u,key){const f=key&&path.join(CACHE,key+'.json');if(f&&fs.existsSync(f))return JSON.parse(fs.readFileSync(f,'utf8'));
 for(let i=0;i<3;i++){try{const r=await fetch(u);if(r.ok){const j=await r.json();if(f){fs.mkdirSync(CACHE,{recursive:true});fs.writeFileSync(f,JSON.stringify(j))}return j}}catch(e){}await sleep(800*(i+1))}return null}
const num=v=>{const n=parseFloat(v);return isNaN(n)?0:n};
const imp=o=>o<0?-o/(-o+100):100/(o+100),dec=o=>o>0?1+o/100:1+100/-o;
const C={home:1.5,form:.5,s:7};

(async()=>{
 /* 1. Completed games with scores, pregame moneylines and every player's DraftKings points. */
 const games=[];
 for(let w=1;w<=WEEKS;w++){const sb=await get(`${SITE}/scoreboard?dates=${SEASON}&seasontype=2&week=${w}`);
  for(const ev of (sb&&sb.events)||[]){if(ev.status.type.state!=='post')continue;
   const sum=await get(`${SITE}/summary?event=${ev.id}`,`nfl-${ev.id}`);await sleep(80);if(!sum)continue;
   const comp=sum.header.competitions[0],H=comp.competitors.find(c=>c.homeAway==='home'),A=comp.competitors.find(c=>c.homeAway==='away');
   const pc=(sum.pickcenter||[]).find(p=>p.homeTeamOdds&&p.homeTeamOdds.moneyLine!=null)||{};
   const pl={};((sum.boxscore&&sum.boxscore.players)||[]).forEach(t=>(t.statistics||[]).forEach(cat=>(cat.athletes||[]).forEach(a=>{
    const s=Object.fromEntries((cat.keys||[]).map((k,i)=>[k,num((a.stats[i]||'').split('/')[0].split('-')[0])])),id=a.athlete.id;
    const P=pl[id]=pl[id]||{id,name:a.athlete.displayName,team:t.team.id,dk:0,pass:0,rush:0,rec:0};
    if(cat.name==='passing'){P.dk+=.04*s.passingYards+4*s.passingTouchdowns-s.interceptions+(s.passingYards>=300?3:0);P.pass+=s.passingAttempts||0}
    if(cat.name==='rushing'){P.dk+=.1*s.rushingYards+6*s.rushingTouchdowns+(s.rushingYards>=100?3:0);P.rush+=s.rushingAttempts||0}
    if(cat.name==='receiving'){P.dk+=s.receptions+.1*s.receivingYards+6*s.receivingTouchdowns+(s.receivingYards>=100?3:0);P.rec+=s.receptions||0}
    if(cat.name==='fumbles')P.dk-=s.fumblesLost||0})));
   games.push({id:ev.id,week:w,date:ev.date,home:{id:H.team.id,abbr:H.team.abbreviation,pts:num(H.score)},away:{id:A.team.id,abbr:A.team.abbreviation,pts:num(A.score)},
    ml:{home:pc.homeTeamOdds&&pc.homeTeamOdds.moneyLine,away:pc.awayTeamOdds&&pc.awayTeamOdds.moneyLine},players:Object.values(pl)})}
  process.stdout.write(`\rweek ${w}: ${games.length} games`)}
 console.log('');
 /* 2. Positions from current rosters; anyone missing (traded, cut) is placed by his usage. */
 const pos={};
 for(const tid of new Set(games.flatMap(g=>[g.home.id,g.away.id]))){const R=await get(`${SITE}/teams/${tid}/roster`,`nfl-roster-${tid}`);await sleep(60);
  ((R&&R.athletes)||[]).flatMap(x=>x.items||[x]).forEach(a=>{pos[a.id]=a.position&&a.position.abbreviation})}
 const posOf=p=>{const x=pos[p.id];if(['QB','RB','WR','TE'].includes(x))return x;if(x==='FB')return 'RB';return p.pass>=5?'QB':p.rush>p.rec?'RB':'WR'};
 games.forEach(g=>g.players.forEach(p=>p.pos=posOf(p)));

 /* 3. Replay each game from week 2 on with only earlier weeks. */
 const rows=[];
 for(const g of games.filter(x=>x.week>=2)){const prior=games.filter(x=>x.week<g.week);
  const team=tid=>{const gs=prior.filter(x=>x.home.id===tid||x.away.id===tid).sort((a,b)=>a.date<b.date?-1:1);
   const me=x=>x.home.id===tid?x.home:x.away,op=x=>x.home.id===tid?x.away:x.home;
   return{gs,n:gs.length,ppg:gs.reduce((a,x)=>a+me(x).pts,0)/(gs.length||1),pa:gs.reduce((a,x)=>a+op(x).pts,0)/(gs.length||1),
    wins:gs.slice(-5).filter(x=>me(x).pts>op(x).pts).length}};
  const tH=team(g.home.id),tA=team(g.away.id);if(!tH.n||!tA.n)continue;
  const ids=[...new Set(prior.flatMap(x=>[x.home.id,x.away.id]))],T=Object.fromEntries(ids.map(i=>[i,team(i)])),lg=ids.reduce((a,i)=>a+T[i].ppg,0)/ids.length;
  /* DvP: each defense's DK points allowed per position over its last 5 games, ranked across teams. */
  const allowed={};ids.forEach(d=>{const L=T[d].gs.slice(-5);allowed[d]={};['QB','RB','WR','TE'].forEach(P=>{
   allowed[d][P]=L.reduce((a,x)=>a+x.players.filter(p=>p.team!==d&&p.pos===P).reduce((b,p)=>b+p.dk,0),0)/(L.length||1)})});
  const soft={};['QB','RB','WR','TE'].forEach(P=>{const ord=[...ids].sort((a,b)=>allowed[a][P]-allowed[b][P]),N=ord.length,mid=(N+1)/2;
   ord.forEach((d,i)=>{(soft[d]=soft[d]||{})[P]=Math.max(-1,Math.min(1,((i+1)-mid)/(mid-1)))})});
  const dvp=(tid,opp)=>{const avg={};prior.forEach(x=>x.players.filter(p=>p.team===tid).forEach(p=>{const a=avg[p.id]=avg[p.id]||{pos:p.pos,s:0,n:0};a.s+=p.dk;a.n++}));
   const L=Object.values(avg).map(a=>({pos:a.pos,w:a.s/a.n})).filter(a=>a.w>0),W=L.reduce((a,x)=>a+x.w,0);return W?L.reduce((a,x)=>a+x.w*soft[opp][x.pos],0)/W:0};
  const sH=dvp(g.home.id,g.away.id),sA=dvp(g.away.id,g.home.id);
  const oH=tH.ppg+tA.pa-lg,oA=tA.ppg+tH.pa-lg,base=C.home+C.form*(tH.wins-tA.wins);
  const marketH=g.ml.home!=null&&g.ml.away!=null?imp(g.ml.home)/(imp(g.ml.home)+imp(g.ml.away)):null;
  rows.push({g,week:g.week,homeWon:g.home.pts>g.away.pts?1:g.home.pts<g.away.pts?0:.5,mOld:(tH.ppg-tH.pa)-(tA.ppg-tA.pa)+base,mNew0:(oH-oA)+base,base,nH:tH.n,nA:tA.n,dv:sH-sA,marketH})}
 const P=m=>1/(1+Math.exp(-m/C.s));
 /* 4. Score: accuracy, Brier, log loss, calibration, and Stamped-style picks (3-point edge, under +300) at the real price. */
 function score(name,pH){const R=rows.filter(r=>r.homeWon!==.5&&r.marketH!=null);let acc=0,br=0,ll=0;const cal={};
  R.forEach(r=>{const p=pH(r),fav=p>=.5;acc+=(fav?r.homeWon:1-r.homeWon);br+=(p-r.homeWon)**2;ll+=-Math.log(Math.max(1e-6,r.homeWon?p:1-p));
   const pp=Math.max(p,1-p),b=Math.min(9,Math.floor(pp*10)),c=cal[b]=cal[b]||{n:0,p:0,w:0};c.n++;c.p+=pp;c.w+=(fav?r.homeWon:1-r.homeWon)});
  let picks=0,w=0,u=0;R.forEach(r=>{if(name==='Market')return;const p=pH(r),eh=p-r.marketH,ea=(1-p)-(1-r.marketH),side=eh>=ea?'home':'away',edge=Math.max(eh,ea),ml=r.g.ml[side];
   if(edge<.03||ml>=300)return;picks++;const won=side==='home'?r.homeWon:1-r.homeWon;if(won){w++;u+=dec(ml)-1}else u-=1});
  return{name,n:R.length,acc:acc/R.length,brier:br/R.length,logloss:ll/R.length,picks,wins:w,units:u,roi:picks?u/picks:null,
   cal:Object.entries(cal).sort((a,b)=>a[0]-b[0]).map(([b,c])=>({bucket:`${b*10}-${b*10+10}%`,n:c.n,said:c.p/c.n,came:c.w/c.n}))}}
 const res=[score('Market',r=>r.marketH),score('Old model (season margin)',r=>P(r.mOld)),
  ...[0,1.5,3,4.5].map(dv=>score(`New model, DvP ±${dv}`,r=>P(r.mNew0+dv*r.dv)))];
 /* Diagnostics: a wider win-chance curve (s) and shrinking early ratings toward average (k games of "average" added). */
 const diag=[];for(const s of [7,10,13,16])for(const k of [0,2,4,8])for(const dv of [0,3]){
  const pH=r=>{const n=Math.min(r.nH,r.nA),f=n/(n+k);return 1/(1+Math.exp(-((r.mNew0-r.base)*f+r.base+dv*r.dv*f)/s))};
  const x=score(`s=${s} k=${k} dv=${dv}`,pH);diag.push(x)}
 const n=rows.filter(r=>r.marketH!=null).length;
 console.log(`\n${n} games replayed (weeks 2-${WEEKS}; week 1 has no prior games). Injuries not included.\n`);
 console.table(res.map(x=>({model:x.name,games:x.n,'picked winner':(x.acc*100).toFixed(1)+'%','Brier (lower=better)':x.brier.toFixed(4),'log loss':x.logloss.toFixed(4),
  picks:x.name==='Market'?'—':x.picks,'record':x.name==='Market'?'—':`${x.wins}-${x.picks-x.wins}`,units:x.name==='Market'?'—':(x.units>=0?'+':'')+x.units.toFixed(2),ROI:x.roi==null?'—':(x.roi*100).toFixed(1)+'%'})));
 ['Market','New model, DvP ±3'].forEach(k=>{const x=res.find(r=>r.name===k);console.log(`\nCalibration, ${k} (favorite's chance vs how often the favorite won):`);
  console.table(x.cal.map(c=>({bucket:c.bucket,games:c.n,said:(c.said*100).toFixed(0)+'%','came true':(c.came*100).toFixed(0)+'%'})))});
 const byWeek=[...new Set(rows.map(r=>r.week))].map(w=>{const R=rows.filter(r=>r.week===w&&r.marketH!=null&&r.homeWon!==.5),b=f=>R.reduce((a,r)=>a+(f(r)-r.homeWon)**2,0)/R.length;
  return{week:w,games:R.length,'Brier market':b(r=>r.marketH).toFixed(3),'Brier old':b(r=>P(r.mOld)).toFixed(3),'Brier new ±3':b(r=>P(r.mNew0+3*r.dv)).toFixed(3)}});
 console.log('\nBy week:');console.table(byWeek);
 console.log('\nFix diagnostics, best 10 by Brier (s = curve width in points, k = early-season shrink, dv = DvP weight):');
 console.table(diag.sort((a,b)=>a.brier-b.brier).slice(0,10).map(x=>({setting:x.name,Brier:x.brier.toFixed(4),'picked winner':(x.acc*100).toFixed(1)+'%',picks:x.picks,record:`${x.wins}-${x.picks-x.wins}`,ROI:x.roi==null?'—':(x.roi*100).toFixed(1)+'%'})));
 fs.writeFileSync(path.join(__dirname,'..','live','backtest-teams.json'),JSON.stringify({generated:new Date().toISOString(),weeks:`2-${WEEKS}`,games:n,results:res,byWeek},null,1));
})().catch(e=>{console.error(e);process.exit(1)});
