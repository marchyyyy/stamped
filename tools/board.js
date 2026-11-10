/* DraftKings prop board for one game, read from ESPN's core API (provider 100): main lines, the Over/Under price pair
   (NBA) and the "X or more" ladders. Shared by tools/props.js (full build) and tools/track.js (line history). */
'use strict';
const num=v=>{const n=parseFloat(v);return isNaN(n)?null:n};
async function board(get,sleep,CORE,CFG,gid){
  const items=[];for(let pg=1;pg<=4;pg++){const p=await get(`${CORE}/events/${gid}/competitions/${gid}/odds/100/propBets?lang=en&region=us&limit=1000&page=${pg}`);await sleep(150);if(!p)break;items.push(...(p.items||[]));if(pg>=(p.pageCount||1))break}
  /* The prop's athlete link is season-specific, and only that record carries the player's current team. */
  const lines={},refs={},miles={},pairs={};
  items.forEach(x=>{const ref=String((x.athlete&&x.athlete.$ref)||''),id=(ref.match(/athletes\/(\d+)/)||[])[1];if(!id)return;const tn=x.type&&x.type.name,T=x.current&&x.current.target&&x.current.target.value;
   if(CFG.lines[tn]&&T!=null){(lines[id]=lines[id]||{})[CFG.lines[tn]]=+T;refs[id]=ref;
    /* NBA lines come as an Over/Under pair with prices (NFL: no prices). Kept in board order for pairing below. */
    const pv=x.odds&&x.odds.american&&num(x.odds.american.value);if(pv!=null){const P=((pairs[id]=pairs[id]||{})[CFG.lines[tn]]=pairs[id][CFG.lines[tn]]||{});(P[+T]=P[+T]||[]).push(pv)}}
   /* "X or more" ladder for alt lines. NBA carries prices; NFL lists the same rungs without prices (kept as null). */
   const pr=x.odds&&x.odds.american&&num(x.odds.american.value);if(CFG.miles[tn]&&T!=null)((miles[id]=miles[id]||{})[CFG.miles[tn]]=miles[id][CFG.miles[tn]]||{})[+T]=pr!=null?pr:null});
  /* Main line with both prices: of the priced pairs, the one closest to even. The Over is the pair's first item (914 of
     930 pairs checked against the "X+" price); when the "X+" rung is posted, its price settles which one is the Over. */
  const ip=o=>o>0?100/(o+100):-o/(-o+100),ou={};
  Object.entries(pairs).forEach(([id,S])=>Object.entries(S).forEach(([stat,P])=>{let best=null;
   Object.entries(P).forEach(([T,v])=>{if(v.length!==2)return;let [o,u]=v;const m=miles[id]&&miles[id][stat]&&miles[id][stat][Math.floor(+T)+1];
    if(m!=null&&Math.abs(ip(u)-ip(m))<Math.abs(ip(o)-ip(m)))[o,u]=[u,o];const bal=Math.abs(ip(o)-ip(u));if(!best||bal<best.bal)best={T:+T,o,u,bal}});
   if(best){lines[id][stat]=best.T;(ou[id]=ou[id]||{})[stat]=best}}));
 return{items:items.length,lines,refs,miles,ou}}
module.exports={board};
/* ESPN's names for the NBA board (the same table as CFG.nba in tools/props.js). */
board.NBA={lines:{'Total Points':'points','Total Rebounds':'rebounds','Total Assists':'assists','Total 3-Point Field Goals':'threes','Total Points, Rebounds, and Assists':'PRA'},
 miles:{'Points Milestones':'points','Rebounds Milestones':'rebounds','Assists Milestones':'assists','3-Point Field Goals Milestones':'threes','Points + Assists + Rebounds Milestones':'PRA'}};
