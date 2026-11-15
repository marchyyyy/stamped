/* Today's plays (owner, 2026-11-15, rule 8): a play needs a price of -200 or longer and a source that beat the price in
   testing. Reads data/plays_<sport>.json (tools/plays.js) and re-checks it every 5 minutes. The section looks the same for
   every sport; a sport with no tested source says so instead of filling the space. */
(function(){
'use strict';
const FILE={nba:'data/plays_nba.json',nfl:'data/plays_nfl.json'},S={};let hooks={};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fo=o=>o>0?'+'+o:String(o);
const et=w=>new Date(w+':00-05:00');
const when=w=>{const d=et(w),tz={timeZone:'America/New_York'},today=d.toLocaleDateString('en-CA',tz)===new Date().toLocaleDateString('en-CA',tz);
 return (today?'Today':d.toLocaleDateString('en-US',{weekday:'short',...tz}))+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',...tz})+' ET'};
const logo=u=>u?`<img class="pl-logo" src="${esc(u)}" alt="" loading="lazy">`:'';
const win=o=>o>0?o/100:100/-o;
const pre=r=>et(r.when).getTime()>Date.now();
function load(lg){if(!FILE[lg])return Promise.resolve();
 return fetch(FILE[lg]+'?v='+Date.now()).then(r=>r.ok?r.json():null).then(j=>{if(!j)return;const ch=!S[lg]||S[lg].generated!==j.generated;S[lg]=j;if(ch&&hooks.onChange)hooks.onChange(lg)}).catch(()=>{})}
/* The Stamped number for a posted prop: {n: projection, p: chance of the Over, in %}. */
const num=(lg,aid,stat)=>(S[lg]&&S[lg].numbers&&S[lg].numbers[aid+'|'+stat])||null;
const pay=o=>`$10 wins $${(10*win(o)).toFixed(2)}`;
function teamCard(r,play){
 return `<div class="card pl-card${play?' pl-play':''}"><div class="row between"><div style="min-width:0"><div class="pname">${logo(r.logo)}${esc(r.label)}</div><div class="team">${r.home?'vs':'@'} ${esc(r.opp)} · ${when(r.when)}</div></div><span class="odds pl-price">${fo(play?r.now:r.price)}</span></div>
  <div class="cap"><b>Stamped ${r.pct}%</b> · market ${r.mkt}% · ${r.edge} points above the opening line (${fo(r.open)} at the open)${play?' · '+pay(r.now):''}</div>
  ${r.missing&&r.missing.length?`<div class="cap">Out: ${esc(r.missing.join(', '))}</div>`:''}</div>`}
function capRow(r){
 return `<div class="card pl-card"><div class="row between"><div style="min-width:0"><div class="pname">${logo(r.logo)}${esc(r.name)}</div><div class="team">${esc(r.abbr)} ${esc(r.opp||'')} · ${when(r.when)}</div></div><span class="pill p-long">Practice</span></div>
  <div class="row"><span class="prop">${esc(r.label)}</span><span class="odds">${fo(r.price)}</span></div>
  <div class="cap">Market ${r.mkt}% · Stamped number <b>${r.num}</b>${r.mins!=null?` at ${r.mins} minutes`:''} · ${esc(r.how)} · ${pay(r.price)}</div></div>`}
const rec=x=>x&&x.n?`<b>${x.w}-${x.l}</b> (${x.u>=0?'+':''}${x.u.toFixed(2)} units)`:'none graded yet';
function recordHTML(D){const R=D.record||{},L=R.last;
 const rows=L&&L.rows&&L.rows.length?`<table class="lv-t"><thead><tr><th>${new Date(L.d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</th><th>Pick</th><th class="num">Price</th><th class="num">Result</th></tr></thead><tbody>${L.rows.map(x=>`<tr><td>${esc(x.name)} <span class="cap">${esc(x.abbr||'')}</span></td><td>${esc(x.label)}${x.kind==='cap'?' <span class="cap">practice</span>':''}</td><td class="num">${fo(x.price)}</td><td class="num ${x.res==='W'?'up':x.res==='L'?'dn':''}"><b>${x.res==='V'?'void':x.v!=null?x.v:x.res==='W'?'won':'lost'}</b></td></tr>`).join('')}</tbody></table>`:'';
 return `<div class="cap">Graded at the price first shown, every night${R.since?`, since ${new Date(R.since+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}`:''}: plays ${rec(R.team)} · practice props ${rec(R.practice)}.</div>${rows}`}
/* Open sections stay open across the page's one-minute redraw. */
const open=new Set(['pl-practice']);
const sec=(key,title,inner)=>`<details class="lv-sec" data-pl-sec="${key}" ${open.has(key)?'open':''}><summary>${title}</summary><div class="lv-secbody">${inner}</div></details>`;
function todayHTML(lg,extra){
 const D=S[lg],head=`<h2 class="sec pl-h">Today's plays</h2>`;
 if(!FILE[lg])return `<section class="pl">${head}<div class="empty pl-none"><h3>No play passes today</h3>A play needs a price of -200 or longer and a source that beat the price in testing. No ${lg.toUpperCase()} source has passed that test yet${extra&&extra.hasProps?'; the leans on the Props tab are information':''}.</div></section>`;
 if(!D)return `<section class="pl">${head}<div class="cap">Loading plays…</div></section>`;
 const plays=(D.plays||[]).filter(pre),near=(D.near||[]).filter(pre),prac=(D.practice||[]).filter(pre),leans=(extra&&extra.leans)||'';
 let h=`<section class="pl">${head}<div class="cap">Priced ${D.cap} or longer, from a source that beat the price in testing. Updated ${esc(D.checked)}.</div>`;
 h+=plays.length||leans?`<div class="list">${plays.map(r=>teamCard(r,true)).join('')}${leans}</div>`
  :`<div class="empty pl-none"><h3>No play passes today</h3>${D.sport!=='nba'?`No ${D.sport.toUpperCase()} team signal has beaten the market in testing.`:near.length?`The team model has ${near.length} pick${near.length>1?'s':''} today, all priced shorter than ${D.cap}.`:'The team model is within 5 points of every opening line.'} No prop source has beaten the price in testing, so none is forced onto the list.</div>`;
 if(near.length)h+=sec('pl-near',`Model picks shorter than ${D.cap} (${near.length})`,`<div class="cap">Same tested model, but the price pays too little for the standard: a $10 bet at -400 wins $2.50.</div><div class="list">${near.map(r=>teamCard(r,false)).join('')}</div>`);
 if(prac.length)h+=sec('pl-practice',`Practice props · most likely at the price cap (${prac.length})`,`<div class="cap">The props closest to the standard: the likeliest legs still priced -200 or longer, Under side only, where our own number agrees. Not plays: ${D.sport==='nba'?'in the Nov 6-14 test legs like these lost about 3% a bet, and Overs lost 6% to 14%':'this is not yet tested for the '+D.sport.toUpperCase()+'; the same legs in the NBA lost about 3% a bet'}. Graded every night.</div><div class="list">${prac.map(capRow).join('')}</div>`);
 h+=sec('pl-record','Record and how plays are tested',`${recordHTML(D)}<div class="cap">${esc(D.test.team)}</div><div class="cap">${esc(D.test.practice)} ${esc(D.test.numbers)}</div>`);
 return h+'</section>'}
function start(h){hooks=h||{};Object.keys(FILE).forEach(load);setInterval(()=>{if(!document.hidden)Object.keys(FILE).forEach(load)},5*60e3);
 document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.dataset&&d.dataset.plSec){if(d.open)open.add(d.dataset.plSec);else open.delete(d.dataset.plSec)}},true)}
window.PLAYS={start,load,todayHTML,num,has:lg=>!!FILE[lg],data:lg=>S[lg]||null};
})();
