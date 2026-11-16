/* Picks for soccer, tennis and golf (owner, 2026-11-16: show who to bet on, why, and what they are projected to do, the way
   the NBA and NFL tabs do). Reads data/picks_<sport>.json (tools/picks.js) and re-checks it every 5 minutes.
   Same section on each sport's Today tab: the picks that pass, then every match or player with its projection, our chance,
   the market's chance and the price, then the record and how the model scored. */
(function(){
'use strict';
const FILE={soccer:'data/picks_soccer.json',tennis:'data/picks_tennis.json',golf:'data/picks_golf.json'},S={};let hooks={};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fo=o=>o==null?'':o>0?'+'+o:String(o),win=o=>o>0?o/100:100/-o,pay=o=>`$10 wins $${(10*win(o)).toFixed(2)}`;
const TZ={timeZone:'America/New_York'};
const when=w=>{const d=new Date(w),today=d.toLocaleDateString('en-CA',TZ)===new Date().toLocaleDateString('en-CA',TZ);
 return (today?'Today':d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',...TZ}))+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',...TZ})+' ET'};
const logo=u=>u?`<img class="pl-logo" src="${esc(u)}" alt="" loading="lazy">`:'';
function load(lg){if(!FILE[lg])return Promise.resolve();
 return fetch(FILE[lg]+'?v='+Date.now()).then(r=>r.ok?r.json():null).then(j=>{if(!j)return;const ch=!S[lg]||S[lg].generated!==j.generated;S[lg]=j;if(ch&&hooks.onChange)hooks.onChange(lg)}).catch(()=>{})}
const open=new Set(['pk-board']);
const sec=(key,title,inner)=>`<details class="lv-sec" data-pk-sec="${key}" ${open.has(key)?'open':''}><summary>${title}</summary><div class="lv-secbody">${inner}</div></details>`;
const whyHTML=w=>w&&w.length?`<ul class="pk-why">${w.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'';
function pickCard(D,r){
 return `<div class="card pl-card pl-play"><div class="row between"><div style="min-width:0"><div class="pname">${logo(r.logo)}${esc(r.pick)}</div><div class="team">${esc(r.title)} · ${esc(r.ev)}${D.sport==='golf'?'':' · '+when(r.when)}</div></div><span class="odds pl-price">${fo(r.price)}</span></div>
  <div class="cap"><b>Stamped ${r.our}%</b> (fair price ${fo(r.fair)}) · market ${r.mkt}% · ${esc(r.book)} · ${pay(r.price)}${r.now!=null&&r.now!==r.price?` · now ${fo(r.now)}`:''}</div>${whyHTML(r.why)}</div>`}
/* Why a row is or is not a bet, in a few words. */
function verdict(D,x){if(x.price==null||x.mkt==null)return 'no price posted';if(x.price<D.cap)return `price ${fo(x.price)} is shorter than ${D.cap}`;
 if(x.our-x.mkt>=15)return 'our number is 15+ points above the market, which usually means news we do not have';if(x.our-x.mkt<D.edge)return x.our<x.mkt?'the price asks for more than we project':'priced about right';return x.our<50?'under 50% in our projection':'passes'}
const rowsT=(D,rows)=>rows&&rows.length?`<table class="lv-t pk-t"><thead><tr><th></th><th class="num">Stamped</th><th class="num">Market</th><th class="num">Price</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.label)}</td><td class="num"><b>${x.our}%</b></td><td class="num">${x.mkt==null?'':x.mkt+'%'}</td><td class="num">${fo(x.price)}</td></tr>`).join('')}</tbody></table>`:'';
function matchCard(D,b){if(b.note)return `<div class="card pl-card"><div class="pname">${esc(b.title)}</div><div class="team">${esc(b.ev||'')}${b.when?' · '+when(b.when):''}</div><div class="cap">${esc(b.note)}</div></div>`;
 const side=(b.rows||[]).filter(x=>/to win$/.test(x.label)).sort((x,y)=>y.our-x.our)[0];
 const lean=b.pick?`<b>Pick: ${esc(b.pick)}</b>${new Date(b.when).getTime()>Date.now()+48*36e5?' (early: listed two days before the match)':''}`:side?`Projected winner: <b>${esc(side.label.replace(/ to win$/,''))}</b> ${side.our}%. No bet: ${esc(verdict(D,side))}.`:'';
 return `<div class="card pl-card"><div class="row between"><div style="min-width:0"><div class="pname">${esc(b.title)}</div><div class="team">${esc(b.ev||'')} · ${when(b.when)}</div></div>${b.pick?'<span class="pill p-long">Pick</span>':''}</div>
  <div class="cap">${esc(b.proj||'')}</div>${lean?`<div class="cap">${lean}</div>`:''}${rowsT(D,b.rows)}${b.why&&b.why.length?`<details class="pk-more"><summary>Why</summary>${whyHTML(b.why)}</details>`:''}</div>`}
function golfTable(D){const B=D.board||[];if(!B.length)return '';
 if(!(B[0].rows||[]).length)return `<table class="lv-t"><tbody>${B.map(b=>`<tr><td><b>${esc(b.title)}</b><div class="cap">${esc(b.proj)}</div></td></tr>`).join('')}</tbody></table>`;
 const cell=x=>x?`<b>${x.our}%</b>${x.price!=null?`<div class="cap">${fo(x.price)}</div>`:''}`:'';
 return `<table class="lv-t pk-t"><thead><tr><th>Player</th><th class="num">Win</th><th class="num">Top 10</th><th class="num">Top 20</th></tr></thead><tbody>${B.map(b=>{const r=k=>(b.rows||[]).find(x=>x.label===k);
  return `<tr><td><b>${esc(b.title)}</b>${b.pick?' <span class="pill p-long">Pick</span>':''}<div class="cap">${esc((b.proj||'').split(' · ')[0])}</div></td><td class="num">${cell(r('Win'))}</td><td class="num">${cell(r('Top 10'))}</td><td class="num">${cell(r('Top 20'))}</td></tr>`}).join('')}</tbody></table>`}
const rec=R=>R&&R.n?`<b>${R.w}-${R.l}</b> (${R.u>=0?'+':''}${R.u.toFixed(2)} units)`:'none graded yet';
function recordHTML(D){const R=D.record||{},L=R.last||[];
 const rows=L.length?`<table class="lv-t"><thead><tr><th>Pick</th><th class="num">Price</th><th class="num">Result</th></tr></thead><tbody>${L.map(x=>`<tr><td>${esc(x.pick)}<div class="cap">${esc(x.title)} · ${new Date(x.d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div></td><td class="num">${fo(x.price)}</td><td class="num ${x.res==='W'?'up':x.res==='L'?'dn':''}"><b>${esc(x.res==='V'?'void':x.v||(x.res==='W'?'won':'lost'))}</b></td></tr>`).join('')}</tbody></table>`:'';
 return `<div class="cap">Graded at the price first shown${R.since?`, since ${new Date(R.since+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}`:''}: ${rec(R)}.</div>${rows}
  <div class="cap"><b>${esc(D.model.name)}.</b> ${esc(D.model.how)}</div><div class="cap">${esc(D.model.test)}</div>
  <div class="cap">Not yet tested against prices: a model can call winners well and still lose to the price. That is why every pick is graded here each night, and why a price shorter than ${D.cap} is never listed.</div>`}
function todayHTML(lg){
 const D=S[lg],head=`<h2 class="sec pl-h">Today's picks</h2>`;if(!FILE[lg])return '';
 if(!D)return `<section class="pl">${head}<div class="cap">Loading picks…</div></section>`;
 const now=Date.now(),picks=(D.picks||[]).filter(r=>lg==='golf'||new Date(r.when).getTime()>now),golf=lg==='golf',board=(D.board||[]).filter(b=>golf||!b.when||new Date(b.when).getTime()>now);
 let h=`<section class="pl">${head}<div class="cap">A pick is priced ${D.cap} or longer, projected to happen at least half the time, and at least ${D.edge} points likelier in our projection than in the market. Updated ${esc(D.checked)}.</div>`;
 if(golf&&D.event)h+=`<div class="cap"><b>${esc(D.event.name)}</b>${D.event.note?' · '+esc(D.event.note):''}</div>`;
 h+=picks.length?`<div class="list">${picks.map(r=>pickCard(D,r)).join('')}</div>`
  :`<div class="empty pl-none"><h3>No pick passes today</h3>${board.length?`Every ${golf?'player':'match'} is projected below, with the reason there is no bet.`:`Nothing to project in the next few days.`}</div>`;
 if(board.length)h+=sec('pk-board',golf?`Projected finishes (${board.length})`:`Every match, projected (${board.length})`,golf?golfTable(D):`<div class="list">${board.map(b=>matchCard(D,b)).join('')}</div>`);
 h+=sec('pk-record','Record and how the picks are made',recordHTML(D));
 return h+'</section>'}
function start(h){hooks=h||{};Object.keys(FILE).forEach(load);setInterval(()=>{if(!document.hidden)Object.keys(FILE).forEach(load)},5*60e3);
 document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.dataset&&d.dataset.pkSec){if(d.open)open.add(d.dataset.pkSec);else open.delete(d.dataset.pkSec)}},true)}
window.PICKS={start,load,todayHTML,has:lg=>!!FILE[lg],data:lg=>S[lg]||null};
})();
