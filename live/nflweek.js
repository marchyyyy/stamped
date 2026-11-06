/* NFL this week (preview, pending owner approval): games with logos and regular player-prop leans in Stamped's card style.
   Reads data/nfl_week.json (tools/nfl-props.js: ESPN games, injuries, DraftKings lines via ESPN, ESPN game logs, DFF)
   and re-checks it every 5 minutes. ESPN carries no NFL prop prices, so these are leans on the line, not priced picks. */
(function(){
'use strict';
const W={data:null,sig:null,game:null,onChange:null};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const et=w=>new Date(w+':00-05:00');
const when=w=>et(w).toLocaleString('en-US',{weekday:'short',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET';
const logo=(u,cls)=>u?`<img class="tlogo${cls?' '+cls:''}" src="${esc(u)}" alt="" width="20" height="20" loading="lazy">`:'';
/* Same cushion steps and matchup thresholds as Stamped's prop rules (NFL: 23rd or worse favorable, 10th or better hostile). */
const STEP={'rush yds':5,'rec yds':5,receptions:1,'pass yds':10,'pass TDs':1};
const STATN={'rush yds':'rushing yards','rec yds':'receiving yards',receptions:'catches','pass yds':'passing yards','pass TDs':'passing TDs'};
const POSN={QB:'quarterbacks',RB:'running backs',WR:'receivers',TE:'tight ends'};
const ord=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0])};

function lean(p,pr){
 if(p.status==='out'||p.status==='doubtful')return null;
 const smp=(p.games||[]).filter(g=>g.s&&g.s[pr.stat]!=null).slice(0,5),n=smp.length;if(n<3)return null;
 const v=smp.map(g=>g.s[pr.stat]),avg=v.reduce((a,b)=>a+b,0)/n,L=pr.line,half=(STEP[pr.stat]||1)*.5;
 const over=v.filter(x=>x>L).length,under=v.filter(x=>x<L).length;
 let side=null;if(over/n>=.6&&avg-L>=half)side='Over';else if(under/n>=.6&&L-avg>=half)side='Under';
 const d=p.dff,ratio=d&&(d.l5||d.szn)?d.proj/(d.l5||d.szn):null,dffSide=ratio==null?null:ratio>=1.05?'Over':ratio<=.95?'Under':null;
 const rank=d&&d.dvp,grade=rank==null?null:rank>=23?'favorable':rank<=10?'hostile':'neutral';
 const r={p,pr,v,n,avg,over,under,ratio,dffSide,grade,rank,side,str:'',why:'',hits:v.map(x=>side==='Under'?x<L:x>L)};
 if(p.status==='questionable'){r.review='Questionable. No lean until he is cleared to play.';return r}
 /* Stamped's rule: nothing is recommended until the matchup is checked. DFF supplies it, so games off the DFF slate wait. */
 if(rank==null){r.review='Matchup not checked yet: this game is not on the DailyFantasyFuel slate.';return r}
 if(!side){r.why=`Split: ${over} over and ${under} under ${L} in his last ${n} (${v.join(', ')}), averaging ${avg.toFixed(1)}. Nothing to suggest.`;return r}
 const k=side==='Over'?over:under,against=(grade&&((side==='Over'&&grade==='hostile')||(side==='Under'&&grade==='favorable'))?1:0)+(dffSide&&dffSide!==side?1:0);
 /* Like Stamped's leans: disagreement drops Strong to Moderate and Moderate to no lean. */
 const base=k>=4?2:1,lvl=base-against;
 r.str=lvl>=2?'Strong':lvl===1?'Moderate':'';if(!r.str){r.side=null;r.why=`${side} ${L} in ${k} of ${n}, but the matchup${dffSide&&dffSide!==side?' and DFF':''} point the other way. No lean.`;return r}
 r.k=k;r.why=`${side} ${L} in ${k} of his last ${n} (${v.join(', ')}), averaging ${avg.toFixed(1)}.`;
 const agree=(dffSide===side?1:0)+((side==='Over'&&grade==='favorable')||(side==='Under'&&grade==='hostile')?1:0);
 r.score=lvl*10+agree*3+k/n+Math.abs(avg-L)/(STEP[pr.stat]||1)/10;return r;
}
function leansFor(players){const out=[];players.forEach(p=>(p.props||[]).forEach(pr=>{const r=lean(p,pr);if(r)out.push(r)}));return out}
function mline(r){if(r.grade==null)return '';const g=r.side==='Under'?(r.grade==='favorable'?'hostile':r.grade==='hostile'?'favorable':r.grade):r.grade;
 const lab=g==='favorable'?'Matchup helps':g==='hostile'?'Tough matchup':'Average matchup',cls=g==='favorable'?'p-pick':g==='hostile'?'p-stay':'p-long';
 const opp=(r.p.opp||'').replace(/^(vs|@) /,''),pos=POSN[r.p.pos]||'his position';
 const desc=r.rank>=23?`${opp} allow the ${33-r.rank===1?'':ord(33-r.rank)+'-'}most fantasy points to ${pos}`:r.rank<=10?`${opp} allow the ${r.rank===1?'':ord(r.rank)+'-'}fewest fantasy points to ${pos}`:`${opp} are about average against ${pos} (${ord(r.rank)} of 32)`;
 return `<div class="mline"><span class="pill ${cls}">${lab}${r.side==='Under'?' (Under)':''}</span><span class="cap">${esc(desc)}, last 5 (DFF).</span></div>`}
function dffLine(r){const d=r.p.dff;if(!d)return '';const t=r.ratio>=1.05?'above':r.ratio<=.95?'below':'in line with';
 return `<div class="cap"><span class="pill p-long">DFF</span> Projects ${d.proj.toFixed(1)} DK pts, ${t} his recent ${(d.l5||d.szn).toFixed(1)}${r.side&&r.dffSide?(r.dffSide===r.side?' · agrees':' · disagrees'):''}</div>`}
function spark(r){const mx=Math.max(...r.v,r.pr.line,1),s=[...r.v].reverse(),h=[...r.hits].reverse();
 return `<span class="spark" aria-hidden="true">${s.map((x,i)=>`<i style="height:${Math.round(Math.max(.12,x/mx)*22)}px;background:var(${h[i]?'--hit':'--miss'})"></i>`).join('')}</span>`}
function card(r){const p=r.p,pill=r.review?'<span class="pill p-long">Under review</span>':r.side?`<span class="pill p-pick">Lean ${r.side}</span>`:'<span class="pill p-stay">No lean</span>';
 return `<button class="card" data-nflw-p="${esc(p.id)}">
  <div class="row between"><div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="team">${logo(p.logo)}${esc(p.team)} · ${esc(p.pos)}</div><div class="team">${when(p.when)} · ${esc(p.opp)}</div></div>${pill}</div>
  <div class="row"><span class="prop">${r.side||'Over'} ${r.pr.line} ${esc(r.pr.stat)}</span>${r.str?`<span class="odds">${r.str}</span>`:''}${spark(r)}</div>
  <div class="${r.side?'why':'reason'}">${esc(r.review||r.why)}</div>
  ${mline(r)}${dffLine(r)}
  ${p.injury&&p.status!=='active'?`<div class="flag">${esc(p.status[0].toUpperCase()+p.status.slice(1))}${p.injury.detail?`: ${esc(p.injury.detail)}`:''}</div>`:''}
  <div class="cap">DraftKings line via ESPN · price not posted · Preview</div>
 </button>`}
/* Compact game tile; tap to show only that game's props, tap again for all. */
function gameRow(g){const sel=W.game===g.id;
 return `<button class="nflw-g${sel?' sel':''}" data-nflw-g="${esc(g.id)}" aria-pressed="${sel}">
  <span class="nflw-m">${logo(g.away.logo)}<b>${esc(g.away.abbr)}</b><span class="cap">@</span>${logo(g.home.logo)}<b>${esc(g.home.abbr)}</b></span>
  <span class="cap">${when(g.when).replace(' ET','')}${g.details?` · ${esc(g.details)}`:''}</span></button>`}
/* exclude: names already covered by Stamped's daily data (their own cards keep the full rules). */
function listHTML(exclude){const D=W.data;if(!D)return '';
 const ex=new Set((exclude||[]).map(s=>s.toLowerCase())),now=Date.now();
 const players=D.players.filter(p=>!ex.has(p.name.toLowerCase())&&et(p.when).getTime()>now&&(!W.game||p.gameId===W.game));
 const all=leansFor(players),good=all.filter(r=>r.side&&!r.review).sort((a,b)=>b.score-a.score),rest=all.filter(r=>!r.side||r.review);
 const g=W.game&&D.games.find(x=>x.id===W.game);
 return `${g?`<div class="row between"><span class="cap">Showing ${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</span><button class="chip nflw-clear" data-nflw-g="">All games</button></div>`:''}
  ${good.length?`<div class="list">${good.slice(0,12).map(card).join('')}</div>`:`<div class="empty"><h3>No leans${g?' in this game':''} yet</h3>None of the posted lines has enough support in the last 5 games.</div>`}
  ${good.length>12?`<details class="lv-sec"><summary>More leans (${good.length-12})</summary><div class="lv-secbody"><div class="list">${good.slice(12).map(card).join('')}</div></div></details>`:''}
  ${rest.length?`<details class="lv-sec"><summary>No lean or under review (${rest.length})</summary><div class="lv-secbody"><div class="list">${rest.map(card).join('')}</div></div></details>`:''}`}
/* Before game day: the whole weekend. */
function weekHTML(){const D=W.data;if(!D)return '';const up=D.games.filter(g=>et(g.when).getTime()+4*3600e3>Date.now());if(!up.length)return '';
 return `<div class="cap">This week's games and prop leans, updated ${esc(D.checked)}. Preview: stamps still post on game day under the usual rules. Leans use his last 5 games, the matchup and DailyFantasyFuel's projection. NFL prop prices aren't available, so check the price in your book.</div>
 <h2 class="sec">Games</h2><div class="nflw-grid">${up.map(gameRow).join('')}</div>
 <h2 class="sec">Props</h2>${listHTML([])}`}
/* On game day: players Stamped's daily data does not cover. */
function moreHTML(exclude){if(!W.data)return '';const h=listHTML(exclude);return h?`<h2 class="sec">More props · Preview</h2><div class="cap">Players outside today's Stamped data: ESPN game logs, DraftKings lines and DFF. Not stamped.</div>${h}`:''}

function sheetHTML(id){const p=W.data&&W.data.players.find(x=>x.id===id);if(!p)return '';const stats=[...new Set(p.props.map(x=>x.stat))];
 return `<div class="grab"></div>
 <div class="shead"><div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="team">${logo(p.logo)}${esc(p.team)} · ${esc(p.pos)} · ${when(p.when)} · ${esc(p.opp)}</div></div><button class="x" id="close" aria-label="Close">×</button></div>
 <div class="list">${p.props.map(pr=>lean(p,pr)).filter(Boolean).map(card).join('')}</div>
 <div class="panel"><h4>This season</h4><table class="lv-t"><thead><tr><th>Game</th>${stats.map(s=>`<th class="num">${esc(s)}</th>`).join('')}</tr></thead><tbody>
  ${p.games.slice(0,10).map(g=>`<tr><td>${esc(g.d.slice(5))} ${esc(g.vs)} <span class="cap">${esc(g.res)}</span></td>${stats.map(s=>`<td class="num">${g.s[s]!=null?g.s[s]:'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
 <div class="panel"><h4>Sources</h4><div class="srcs">${p.sources.map(s=>`<div>${esc(s[0])}: ${esc(s[2])}</div>`).join('')}<div>Updated ${esc(W.data.checked)}</div></div></div>`}

function load(){return fetch('data/nfl_week.json?v='+Date.now()).then(r=>r.ok?r.json():null).then(d=>{if(!d)return;const sig=d.generated;if(sig!==W.sig){W.data=d;W.sig=sig;if(W.onChange)W.onChange()}}).catch(()=>{})}
function start(h){h=h||{};W.onChange=h.onChange;load();setInterval(load,5*60e3);
 document.getElementById('main').addEventListener('click',e=>{const g=e.target.closest('[data-nflw-g]');if(g){W.game=g.dataset.nflwG&&W.game!==g.dataset.nflwG?g.dataset.nflwG:null;if(W.onChange)W.onChange();return}
  const c=e.target.closest('[data-nflw-p]');if(c&&h.showSheet){document.getElementById('sheet').innerHTML=sheetHTML(c.dataset.nflwP);h.showSheet()}})}
window.NFLW={start,load,weekHTML,moreHTML,ready:()=>!!W.data,_lean:lean};
})();
