/* Historical NBA player-prop lines with prices -> live/.cache/props-nba.json (local only, gitignored), for tools/tune-props.js.
   ESPN keeps past prop boards for two books: ESPN BET (provider 58, Oct-Dec 2025, Over/Under labeled) and DraftKings
   (provider 100, this season, pairs unlabeled). A DraftKings pair is labeled with its "X+" milestone at floor(line)+1 (same
   price as the Over) when one is posted; otherwise the first item of the pair is the Over (true in 914 of 930 checked pairs).
   Needs live/.cache/hist-nba.json from tools/hist.js. Downloads are cached per game. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const CACHE=path.join(__dirname,'..','live','.cache'),CORE='https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const STAT={'Total Points':'points','Total Rebounds':'rebounds','Total Assists':'assists','Total 3-Point Field Goals':'threes','Total Points, Rebounds, and Assists':'PRA'};
const MS={points:'Points Milestones',rebounds:'Rebounds Milestones',assists:'Assists Milestones',threes:'3-Point Field Goals Milestones',PRA:'Points + Assists + Rebounds Milestones'};
const imp=o=>o>0?100/(o+100):-o/(-o+100);
async function json(u){for(let i=0;i<3;i++){try{const r=await fetch(u);if(r.ok)return await r.json();if(r.status===404)return null}catch(e){}await sleep(900*(i+1))}return undefined}
async function board(id,prov){const items=[];for(let p=1;p<=5;p++){const j=await json(`${CORE}/events/${id}/competitions/${id}/odds/${prov}/propBets?limit=1000&page=${p}`);
  if(j===undefined)return undefined;if(!j)return items.length?items:null;items.push(...(j.items||[]));if(!j.pageCount||p>=j.pageCount)break;await sleep(60)}return items}
/* One main line per player and stat: the pair priced closest to even. */
function lines(items,prov){const ath=x=>(x.athlete&&x.athlete.$ref.match(/athletes\/(\d+)/)||[])[1],am=x=>parseFloat(x.odds&&x.odds.american&&x.odds.american.value);
 const pairs={},out=[];
 items.forEach((x,i)=>{const st=STAT[x.type&&x.type.name],a=ath(x);if(!st||!a)return;const L=parseFloat(x.odds.total&&x.odds.total.value),o=am(x);if(isNaN(L)||isNaN(o))return;
  const k=`${a}|${st}|${L}`,P=pairs[k]=pairs[k]||{a,st,L,open:parseFloat(x.odds.total.open),items:[]};
  P.items.push({i,o,side:x.current&&x.current.over?'O':x.current&&x.current.under?'U':null})});
 Object.values(pairs).forEach(P=>{let O,U;
  if(prov===58){O=P.items.find(x=>x.side==='O');U=P.items.find(x=>x.side==='U')}
  else if(P.items.length===2){const [x,y]=P.items.sort((p,q)=>p.i-q.i);O=x;U=y;
   const m=items.find(z=>z.type&&z.type.name===MS[P.st]&&ath(z)===P.a&&parseFloat(z.odds.total.value)===Math.floor(P.L)+1);
   if(m){const mp=am(m);if(Math.abs(imp(y.o)-imp(mp))<Math.abs(imp(x.o)-imp(mp))){O=y;U=x}}}
  if(!O||!U)return;out.push({a:P.a,st:P.st,L:P.L,open:isNaN(P.open)?null:P.open,o:O.o,u:U.o,bal:Math.abs(imp(O.o)-imp(U.o))})});
 const best={};out.forEach(r=>{const k=r.a+'|'+r.st;if(!best[k]||r.bal<best[k].bal)best[k]=r});return Object.values(best).map(({bal,...r})=>r)}
(async()=>{
 const H=JSON.parse(fs.readFileSync(path.join(CACHE,'hist-nba.json'),'utf8')),rows=[];let i=0,got=0;
 for(const g of H){i++;if(i%25===0)process.stdout.write(`\r${i}/${H.length} games, ${got} with props`);
  const prov=g.season==='2025'?58:100,f=path.join(CACHE,`props-nba-${g.id}.json`);let L;
  if(fs.existsSync(f))L=JSON.parse(fs.readFileSync(f,'utf8'));
  else{/* ESPN BET's boards stop in early December 2025; skip the rest of that season without asking. */
   if(prov===58&&g.date>'2025-12-03')continue;const items=await board(g.id,prov);if(items===undefined)continue;
   L=items?lines(items,prov):[];fs.writeFileSync(f,JSON.stringify(L));await sleep(60)}
  if(L.length)got++;L.forEach(r=>rows.push({id:g.id,date:g.date,season:g.season,book:prov===58?'ESPN BET':'DraftKings',...r}))}
 fs.writeFileSync(path.join(CACHE,'props-nba.json'),JSON.stringify(rows));console.log(`\nWrote live/.cache/props-nba.json: ${rows.length} lines from ${got} games`);
})().catch(e=>{console.error(e);process.exit(1)});
