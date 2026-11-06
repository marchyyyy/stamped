/* Prop checks by game for NFL and NBA (preview, pending owner approval), in Stamped's card style with team logos.
   Reads data/nfl_week.json and data/nba_today.json (tools/props.js: ESPN games, injuries, DraftKings lines via ESPN,
   ESPN game logs, DFF) and re-checks them every 5 minutes. NBA Over lines carry DraftKings' "X or more" price; NFL props
   have no prices on ESPN, so those are leans on the line. */
(function(){
'use strict';
/* Cushion steps and matchup thresholds match Stamped's prop rules for each league. */
const LG={
 nfl:{file:'data/nfl_week.json',tot:32,fav:23,bad:10,label:'This week',
  STEP:{'rush yds':5,'rec yds':5,receptions:1,'pass yds':10,'pass TDs':1},POSN:{QB:'quarterbacks',RB:'running backs',WR:'receivers',TE:'tight ends'}},
 nba:{file:'data/nba_today.json',tot:30,fav:21,bad:10,label:'Tonight',
  STEP:{points:2,rebounds:1,assists:1,threes:1,PRA:3},POSN:{PG:'point guards',SG:'shooting guards',SF:'small forwards',PF:'power forwards',C:'centers',G:'guards',F:'forwards'}}};
const S={nfl:{data:null,sig:null},nba:{data:null,sig:null}},open=new Set();let onChange=null;
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const et=w=>new Date(w+':00-05:00');
const when=w=>et(w).toLocaleString('en-US',{weekday:'short',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET';
const fo=o=>o>0?'+'+o:String(o);
const logo=u=>u?`<img class="tlogo" src="${esc(u)}" alt="" width="20" height="20" loading="lazy">`:'';
const ord=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0])};

function lean(p,pr){const C=LG[p.lg];
 if(p.status==='out'||p.status==='doubtful')return null;
 const smp=(p.games||[]).filter(g=>g.s&&g.s[pr.stat]!=null).slice(0,5),n=smp.length;if(n<3)return null;
 const v=smp.map(g=>g.s[pr.stat]),avg=v.reduce((a,b)=>a+b,0)/n,L=pr.line,half=(C.STEP[pr.stat]||1)*.5;
 const over=v.filter(x=>x>L).length,under=v.filter(x=>x<L).length;
 let side=null;if(over/n>=.6&&avg-L>=half)side='Over';else if(under/n>=.6&&L-avg>=half)side='Under';
 const d=p.dff,ratio=d&&(d.l5||d.szn)?d.proj/(d.l5||d.szn):null,dffSide=ratio==null?null:ratio>=1.05?'Over':ratio<=.95?'Under':null;
 const rank=d&&d.dvp,grade=rank==null?null:rank>=C.fav?'favorable':rank<=C.bad?'hostile':'neutral';
 const r={p,pr,v,n,avg,over,under,ratio,dffSide,grade,rank,side,str:'',why:'',hits:v.map(x=>side==='Under'?x<L:x>L)};
 if(p.status==='questionable'){r.review='Questionable. No lean until he is cleared to play.';return r}
 /* Stamped's rule: nothing is recommended until the matchup is checked. DFF supplies it, so games off the DFF slate wait. */
 if(rank==null){r.review='Matchup not checked yet: this game is not on the DailyFantasyFuel slate.';return r}
 if(!side){r.why=`Split: ${over} over and ${under} under ${L} in his last ${n} (${v.join(', ')}), averaging ${avg.toFixed(1)}. Nothing to suggest.`;return r}
 /* Stamped's price rule on the posted Over price: worse than -160 is killed. */
 if(side==='Over'&&pr.odds!=null&&pr.odds<-160){r.side=null;r.why=`Over ${L} hit in ${over} of ${n}, but it is priced at ${fo(pr.odds)}, past −160. No pick.`;return r}
 const k=side==='Over'?over:under,against=(grade&&((side==='Over'&&grade==='hostile')||(side==='Under'&&grade==='favorable'))?1:0)+(dffSide&&dffSide!==side?1:0);
 /* Like Stamped's leans: disagreement drops Strong to Moderate and Moderate to no lean. Longshots (+150 or longer) cap at Moderate. */
 let lvl=(k>=4?2:1)-against;const long=side==='Over'&&pr.odds!=null&&pr.odds>=150;if(long)lvl=Math.min(lvl,1);
 r.str=lvl>=2?'Strong':lvl===1?'Moderate':'';if(!r.str){r.side=null;r.why=`${side} ${L} in ${k} of ${n}, but the matchup${dffSide&&dffSide!==side?' and DFF':''} point the other way. No lean.`;return r}
 r.k=k;r.long=long;r.why=`${side} ${L} in ${k} of his last ${n} (${v.join(', ')}), averaging ${avg.toFixed(1)}.${long?' Longshot price: small stakes only.':''}`;
 const agree=(dffSide===side?1:0)+((side==='Over'&&grade==='favorable')||(side==='Under'&&grade==='hostile')?1:0);
 r.score=lvl*10+agree*3+k/n+Math.abs(avg-L)/(C.STEP[pr.stat]||1)/10;return r;
}
const leansFor=players=>{const out=[];players.forEach(p=>(p.props||[]).forEach(pr=>{const r=lean(p,pr);if(r)out.push(r)}));return out};
function mline(r){if(r.grade==null)return '';const C=LG[r.p.lg],g=r.side==='Under'?(r.grade==='favorable'?'hostile':r.grade==='hostile'?'favorable':r.grade):r.grade;
 const lab=g==='favorable'?'Matchup helps':g==='hostile'?'Tough matchup':'Average matchup',cls=g==='favorable'?'p-pick':g==='hostile'?'p-stay':'p-long';
 const opp=(r.p.opp||'').replace(/^(vs|@) /,''),pos=C.POSN[r.p.pos]||'his position',T=C.tot;
 const desc=r.rank>=C.fav?`${opp} allow the ${T+1-r.rank===1?'':ord(T+1-r.rank)+'-'}most fantasy points to ${pos}`:r.rank<=C.bad?`${opp} allow the ${r.rank===1?'':ord(r.rank)+'-'}fewest fantasy points to ${pos}`:`${opp} are about average against ${pos} (${ord(r.rank)} of ${T})`;
 return `<div class="mline"><span class="pill ${cls}">${lab}${r.side==='Under'?' (Under)':''}</span><span class="cap">${esc(desc)}, last 5 (DFF).</span></div>`}
function dffLine(r){const d=r.p.dff;if(!d)return '';const t=r.ratio>=1.05?'above':r.ratio<=.95?'below':'in line with';
 return `<div class="cap"><span class="pill p-long">DFF</span> Projects ${d.proj.toFixed(1)} DK pts, ${t} his recent ${(d.l5||d.szn).toFixed(1)}${r.side&&r.dffSide?(r.dffSide===r.side?' · agrees':' · disagrees'):''}</div>`}
function spark(r){const mx=Math.max(...r.v,r.pr.line,1),s=[...r.v].reverse(),h=[...r.hits].reverse();
 return `<span class="spark" aria-hidden="true">${s.map((x,i)=>`<i style="height:${Math.round(Math.max(.12,x/mx)*22)}px;background:var(${h[i]?'--hit':'--miss'})"></i>`).join('')}</span>`}
function card(r){const p=r.p,pill=r.review?'<span class="pill p-long">Under review</span>':r.side?`<span class="pill p-pick">Lean ${r.side}</span>`:'<span class="pill p-stay">No lean</span>';
 const price=r.pr.odds!=null&&(r.side||'Over')==='Over'?`<span class="odds">${fo(r.pr.odds)}</span>`:'';
 return `<button class="card" data-prev-p="${esc(p.lg+'|'+p.id)}">
  <div class="row between"><div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="team">${logo(p.logo)}${esc(p.team)} · ${esc(p.pos)}</div><div class="team">${when(p.when)} · ${esc(p.opp)}</div></div>${pill}</div>
  <div class="row"><span class="prop">${r.side||'Over'} ${r.pr.line} ${esc(r.pr.stat)}</span>${price}${r.str?`<span class="odds">${r.str}</span>`:''}${spark(r)}</div>
  <div class="${r.side?'why':'reason'}">${esc(r.review||r.why)}</div>
  ${mline(r)}${dffLine(r)}
  ${p.injury&&p.status!=='active'?`<div class="flag">${esc(p.status[0].toUpperCase()+p.status.slice(1))}${p.injury.detail?`: ${esc(p.injury.detail)}`:''}</div>`:''}
  <div class="cap">${r.pr.odds!=null&&(r.side||'Over')==='Over'?`${esc(r.pr.book)}`:'DraftKings line via ESPN · price not posted'} · Preview</div>
 </button>`}
/* Prop checks grouped by game: one collapsible section per game, leans strongest first. Open sections stay open across refreshes. */
function checks(players){const all=leansFor(players);return{good:all.filter(r=>r.side&&!r.review).sort((a,b)=>b.score-a.score),rest:all.filter(r=>!r.side||r.review)}}
function gameSec(g,players){const {good,rest}=checks(players),strong=good.filter(r=>r.str==='Strong').length,isOpen=open.has(g.id);
 return `<details class="lv-sec nflw-sec" data-prev-sec="${esc(g.id)}" ${isOpen?'open':''}><summary>
  <span class="nflw-h"><span class="nflw-m">${logo(g.away.logo)}<b>${esc(g.away.abbr)}</b><span class="cap">@</span>${logo(g.home.logo)}<b>${esc(g.home.abbr)}</b></span>
  <span class="cap">${when(g.when)}${g.details?` · ${esc(g.details)}`:''}${g.total?` · O/U ${g.total}`:''}</span></span>
  <span class="pill ${good.length?'p-pick':'p-stay'}">${good.length?`${good.length} lean${good.length>1?'s':''}${strong?` · ${strong} strong`:''}`:players.length?'No leans':'No lines yet'}</span></summary>
  <div class="lv-secbody">${isOpen?`${good.length?`<div class="list">${good.map(card).join('')}</div>`:`<div class="cap">${players.length?"None of this game's lines has enough support yet.":'DraftKings has not posted player props for this game yet.'}</div>`}
   ${rest.length?`<details class="lv-sec"><summary>No lean or under review (${rest.length})</summary><div class="lv-secbody"><div class="list">${rest.map(card).join('')}</div></div></details>`:''}`:''}</div></details>`}
/* exclude: names already covered by Stamped's daily data (their own cards keep the full rules). */
function gamesHTML(lg,exclude){const D=S[lg]&&S[lg].data;if(!D)return '';const ex=new Set((exclude||[]).map(s=>s.toLowerCase())),now=Date.now();
 const up=D.games.filter(g=>et(g.when).getTime()>now&&g.status!=='post');if(!up.length)return '';
 return `<div class="list">${up.map(g=>gameSec(g,D.players.filter(p=>p.gameId===g.id&&!ex.has(p.name.toLowerCase())))).join('')}</div>`}
const note=lg=>`Each lean uses his last 5 games, the matchup and DailyFantasyFuel's projection.${lg==='nfl'?" NFL prop prices aren't available, so check the price in your book.":' Over prices are DraftKings\' "X or more" bets; check the Under price in your book.'}`;
/* Before Stamped's daily picks are out: every upcoming game for the league. */
function weekHTML(lg){const h=gamesHTML(lg,[]);if(!h)return '';
 return `<div class="cap">${LG[lg].label}'s prop checks by game, updated ${esc(S[lg].data.checked)}. Preview: stamps still post under the usual rules. ${note(lg)}</div><h2 class="sec">${LG[lg].label}</h2>${h}`}
/* With Stamped's daily picks out: players its data does not cover. */
function moreHTML(lg,exclude){const h=gamesHTML(lg,exclude);return h?`<h2 class="sec">More props · Preview</h2><div class="cap">Players outside today's Stamped data, updated ${esc(S[lg].data.checked)}. Not stamped. ${note(lg)}</div>${h}`:''}

function sheetHTML(key){const [lg,id]=key.split('|'),D=S[lg]&&S[lg].data,p=D&&D.players.find(x=>x.id===id);if(!p)return '';const stats=[...new Set(p.props.map(x=>x.stat))];
 return `<div class="grab"></div>
 <div class="shead"><div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="team">${logo(p.logo)}${esc(p.team)} · ${esc(p.pos)} · ${when(p.when)} · ${esc(p.opp)}</div></div><button class="x" id="close" aria-label="Close">×</button></div>
 <div class="list">${p.props.map(pr=>lean(p,pr)).filter(Boolean).map(card).join('')}</div>
 <div class="panel"><h4>This season</h4><table class="lv-t"><thead><tr><th>Game</th>${lg==='nba'?'<th class="num">min</th>':''}${stats.map(s=>`<th class="num">${esc(s)}</th>`).join('')}</tr></thead><tbody>
  ${p.games.slice(0,10).map(g=>`<tr><td>${esc(g.d.slice(5))} ${esc(g.vs)} <span class="cap">${esc(g.res)}</span></td>${lg==='nba'?`<td class="num">${g.min!=null?g.min:'—'}</td>`:''}${stats.map(s=>`<td class="num">${g.s[s]!=null?g.s[s]:'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
 <div class="panel"><h4>Sources</h4><div class="srcs">${p.sources.map(s=>`<div>${esc(s[0])}: ${esc(s[2])}</div>`).join('')}<div>Updated ${esc(D.checked)}</div></div></div>`}

function load(lg){return fetch(LG[lg].file+'?v='+Date.now()).then(r=>r.ok?r.json():null).then(d=>{if(d&&d.generated!==S[lg].sig){S[lg].data=d;S[lg].sig=d.generated;if(onChange)onChange(lg)}}).catch(()=>{})}
function start(h){h=h||{};onChange=h.onChange;const all=()=>Object.keys(LG).forEach(load);all();setInterval(all,5*60e3);
 /* Opening a game fills in its cards (they are only built for open games, which keeps the page light). */
 document.addEventListener('toggle',e=>{const s=e.target&&e.target.dataset&&e.target.dataset.prevSec;if(!s||open.has(s)===e.target.open)return;
  if(e.target.open)open.add(s);else open.delete(s);if(e.target.open&&onChange)onChange()},true);
 document.getElementById('main').addEventListener('click',e=>{const c=e.target.closest('[data-prev-p]');if(c&&h.showSheet){document.getElementById('sheet').innerHTML=sheetHTML(c.dataset.prevP);h.showSheet()}})}
window.PREV={start,load,weekHTML,moreHTML,ready:lg=>!!(S[lg]&&S[lg].data),_lean:lean,_checks:checks};
})();
