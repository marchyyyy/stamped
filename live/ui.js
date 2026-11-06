/* NBA Live Intelligence dashboard. Mounted by index.html into #main when the NBA "Live" mode is selected.
   Polls ESPN while the page is open (also in other views, so alerts keep working). Never places bets. */
(function(){
'use strict';
const E=window.LiveEngine,S=window.LiveESPN;
const $=s=>document.querySelector(s);
const fo=o=>o==null?'—':o>0?'+'+o:String(o);
const pc=p=>p==null?'—':(p*100).toFixed(1)+'%';
const pts=v=>v==null?'—':(v>0?'+':'')+(v*100).toFixed(1);
const r1=v=>v==null?'—':(Math.round(v*10)/10).toFixed(1);
const tm=t=>new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'America/New_York'});
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const load=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}};
const store=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};

const ui={
 filters:Object.assign({period:'all',team:'',player:'',market:'all',book:'all',minEdge:0,conf:'any'},load('stamped-live-filters',{})),
 cfg:Object.assign({},E.ALERT_DEFAULTS,load('stamped-live-alerts',{})),
 paper:load('stamped-live-paper',[]),
 seen:new Set(load('stamped-live-seen',[])),anchor:{},log:[],
 view:{},status:null,accuracy:undefined,open:null,calc:{key:'game',line:'',price:''},data:null,
 secs:load('stamped-live-secs',{})
};
let feed=null,root=null,hooks={};

/* ---------- per-game analysis ---------- */
function analyze(g){
 const s=g.summary||g.board;if(!s)return null;
 const now=Date.now(),prev=ui.view[g.id];
 const key=[s.lastSeq,s.status,s.period,s.clock,s.home.pts,s.away.pts,!!s.pregame,(s.players||[]).length].join('|');
 const same=prev&&prev.key===key;
 const st=same?prev.st:Object.assign({},s,{players:s.players||[]});
 if(!same&&!st.pregame&&ui.data){const dg=(ui.data.games||[]).find(x=>x.lg==='nba'&&x.home.n===st.home.name&&x.away.n===st.away.name);
  if(dg&&dg.spread&&dg.spread.home!=null)st.pregame={total:null,homeMargin:-dg.spread.home,src:`Stamped data.json spread (${dg.ml&&dg.ml.book||'book'})`}}
 const sim=same?prev.sim:E.simulate(st,{n:4000});
 /* Feed age keeps moving even without new data, so freshness and the rule gate are re-checked on every paint. */
 const fr=g.fresh?Object.assign({},g.fresh,E.freshness(g.prevSummary,g.summary,now)):{stale:false,why:''};
 /* The two ESPN feeds refresh at different moments, so a mismatch only counts once it survives two scoreboard updates in a row. */
 const raw=g.board&&g.summary&&Math.abs((g.board.fetched||0)-(g.summary.fetched||0))<10e3?E.reconcile(g.board,g.summary):{conflict:false};
 if(!raw.conflict)g.cf=0;else if(g.board.fetched!==g.cfAt){g.cf=(g.cf||0)+1;g.cfAt=g.board.fetched}
 const rc=raw.conflict&&g.cf>=2?raw:{conflict:false,why:''};
 const mk=g.market&&g.market.available?g.market:null;
 const q={stale:!!fr.stale||!!(g.market&&g.market.stale),conflict:rc.conflict,why:[fr.why,rc.why].filter(Boolean)};
 const opps=st.status==='in'?E.opportunities(sim,mk,q,now,{minEdge:.03}):[];
 const v={id:g.id,key,st,sim,q,market:g.market||null,opps,proj:sim.mean('game'),players:same?prev.players:null,at:same?prev.at:now,sources:sourcesOf(g)};
 v.props=g.props||null;
 v.propOpps=st.status==='in'&&g.props?E.propOpportunities(st,players(v),g.props,q,now,{minEdge:.03}):[];
 const al=E.alertsFor(prev?{state:prev.st,market:prev.market}:null,{state:st,market:v.market,proj:st.status==='in'?v.proj:null,opps:[...opps,...v.propOpps]},{now,anchor:ui.anchor},ui.cfg,ui.seen);
 if(prev||st.status==='in')al.forEach(fire);
 paperLog(v);
 ui.view[g.id]=v;return v;
}
function sourcesOf(g){const o=[];
 if(g.summary)o.push(['ESPN box score + play-by-play',S.URLS.summary(g.id),g.summary.fetched]);
 if(g.board)o.push(['ESPN scoreboard',S.URLS.scoreboard(),g.board.fetched]);
 if(g.market)o.push([g.market.available?'DraftKings live odds (via ESPN)':'DraftKings live odds: not posted',S.URLS.odds(g.id),g.market.fetched]);
 if(g.props)o.push([`DraftKings live player props (via ESPN), ${g.props.items.length} milestones${g.props.frozen?' — not moving':''}`,S.URLS.props(g.id),g.props.fetched]);
 if(g.summary&&g.summary.pregame)o.push(['Pregame baseline: '+g.summary.pregame.src,S.URLS.summary(g.id),g.summary.fetched]);
 return o}
function players(v){if(v.players)return v.players;
 v.players=v.st.players.filter(p=>!p.dnp&&(p.min>0||p.starter||v.st.status==='pre')).map(p=>E.projectPlayer(p,v.st,ui.data,{n:2500}));return v.players}

/* ---------- paper trading (per browser; see README limitations) ---------- */
function paperLog(v){let ch=false;
 [...v.opps,...(v.propOpps||[])].filter(o=>o.qualifies).forEach(o=>{if(ui.paper.some(x=>x.id===o.id))return;
  ui.paper.push({id:o.id,game:v.id,name:`${v.st.away.abbr} @ ${v.st.home.abbr}`,market:o.market,side:o.side,line:o.line,stat:o.stat,target:o.target,playerId:o.playerId,price:o.price,book:o.book,p:o.p,edge:o.edge,ev:o.ev,
   at:Date.now(),when:`${E.periodName(v.st.period)} ${clk(v.st.clock)}`,score:`${v.st.away.pts}-${v.st.home.pts}`,model:o.modelVersion,why:o.why,sources:v.sources.map(s=>[s[0],s[2]])});ch=true});
 if(v.st.status==='post')ui.paper.filter(x=>x.game===v.id&&!x.result).forEach(x=>{const r=E.settle(x,v.st);if(r){Object.assign(x,r,{final:`${v.st.away.pts}-${v.st.home.pts}`});ch=true}});
 if(ch)store('stamped-live-paper',ui.paper.slice(-500))}
function paperStats(){const s=ui.paper.filter(x=>x.result),w=s.filter(x=>x.result==='win').length,l=s.filter(x=>x.result==='loss').length,p=s.filter(x=>x.result==='push').length;
 const u=s.reduce((a,x)=>a+x.units,0),gr=s.filter(x=>x.result!=='push'),brier=gr.length?gr.reduce((a,x)=>a+Math.pow(x.p-(x.result==='win'?1:0),2),0)/gr.length:null;
 return{n:ui.paper.length,settled:s.length,w,l,p,u,roi:s.length?u/s.length:null,brier,open:ui.paper.length-s.length}}

/* ---------- alerts ---------- */
function fire(a){ui.log.unshift(a);ui.log=ui.log.slice(0,60);store('stamped-live-seen',[...ui.seen].slice(-800));
 toast(a.text);
 try{if(ui.cfg.notify&&'Notification' in window&&Notification.permission==='granted')new Notification('Stamped · NBA Live',{body:a.text,tag:a.key,icon:'icons/icon-192.png'})}catch(e){}}
function toast(t){let box=$('#lv-toasts');if(!box){box=document.createElement('div');box.id='lv-toasts';box.setAttribute('aria-live','polite');document.body.appendChild(box)}
 const d=document.createElement('div');d.className='lv-toast';d.textContent=t;box.appendChild(d);setTimeout(()=>d.remove(),7000)}

/* ---------- rendering ---------- */
const clk=s=>{s=Math.max(0,s);const m=Math.floor(s/60),x=s-m*60;return m?`${m}:${String(Math.floor(x)).padStart(2,'0')}`:x.toFixed(1)};
function statusLine(st){if(st.status==='pre')return `${new Date(st.start).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})} ET`;
 if(st.status==='post')return 'Final'+(st.period>4?` (${E.periodName(st.period)})`:'');
 if(st.clock<=0)return st.period===2?'Halftime':`End of ${E.periodName(st.period)}`;return `${E.periodName(st.period)} ${clk(st.clock)}`}
function colsFor(v){const f=ui.filters.period,ot=v.st.period>4,all=['q1','q2','q3','q4',...(ot?['ot']:[]),'h1','h2','game'];
 return f==='all'?all:f==='game'?['game']:[f,'game']}
const LBL={q1:'Q1',q2:'Q2',q3:'Q3',q4:'Q4',ot:'OT',h1:'1H',h2:'2H',game:'Game'};
function cell(v,k,s){const sim=v.sim,st=v.st;
 if(k==='ot'){const o=x=>(x.q||[]).slice(4).reduce((a,b)=>a+b,0);const val=s==='h'?o(st.home):s==='a'?o(st.away):o(st.home)+o(st.away);return `<td class="num lv-act">${val}</td>`}
 const key=s?k+':'+s:k;
 if(sim.done(k))return `<td class="num lv-act" title="Final">${sim.actual(k,s)}</td>`;
 const m=sim.summary(key);return `<td class="num lv-proj" title="Likely range ${m.lo}–${m.hi}">${Math.round(m.mean)}</td>`}
function qtable(v){const c=colsFor(v),st=v.st;
 return `<div class="chartbox"><table class="lv-q"><thead><tr><th></th>${c.map(k=>`<th class="num">${LBL[k]}</th>`).join('')}</tr></thead><tbody>
  <tr><td>${esc(st.away.abbr)}</td>${c.map(k=>cell(v,k,'a')).join('')}</tr>
  <tr><td>${esc(st.home.abbr)}</td>${c.map(k=>cell(v,k,'h')).join('')}</tr>
  <tr class="lv-tot"><td>Total</td>${c.map(k=>cell(v,k,'')).join('')}</tr></tbody></table></div>
  <div class="cap"><span class="lv-act">Bold</span> = final. Grey = the computer's guess.</div>`}
function oppRow(o,full){return `<tr class="${o.qualifies?'':'dim'}"><td>${esc(o.side)} ${o.line!=null?(o.market==='Spread'&&o.line>0?'+':'')+o.line:''} <span class="cap">${o.market}</span></td><td class="num">${fo(o.price)}</td><td class="num">${pc(o.p)}</td><td class="num">${pc(o.novig)}</td><td class="num ${o.edge>0?'up':'dn'}">${pts(o.edge)}</td><td class="num ${o.ev>0?'up':'dn'}">${o.ev==null?'—':pc(o.ev)}</td>${full?`<td class="cap">${o.qualifies?'Qualifies (Paper)':esc([...o.rule.why,...o.gate.why].join(' '))}</td>`:''}</tr>`}
const oppHead=full=>`<thead><tr><th>Market</th><th class="num">Price</th><th class="num">Model</th><th class="num">No-vig</th><th class="num">Edge</th><th class="num">EV</th>${full?'<th>Rules</th>':''}</tr></thead>`;
function marketOk(o){const m=ui.filters.market,k=o.market==='Prop'?'props':o.market.toLowerCase();if(m!=='all'&&m!==k)return false;
 if(ui.filters.book==='yours')return false;
 if(!['all','game'].includes(ui.filters.period))return false;
 if(o.edge==null||o.edge*100<(+ui.filters.minEdge||0))return false;
 if(ui.filters.conf==='medium'&&o.confidence==='Low')return false;if(ui.filters.conf==='high'&&o.confidence!=='High')return false;return true}
function teamOk(v){const t=ui.filters.team;return !t||v.st.home.abbr===t||v.st.away.abbr===t}
function freshBadge(v){const a=v.q;return a.stale||a.conflict?`<span class="pill p-long" title="${esc(a.why.join(' '))}">${a.conflict?'Syncing':'Delayed'}</span>`:v.st.status==='in'?'<span class="live">Live</span>':''}
/* "Good bets right now": only picks with positive expected value that pass every rule, written in plain words. */
const KSTAT={points:'points',rebounds:'rebounds',assists:'assists',threes:'three-pointers',PRA:'points, rebounds and assists added together'};
const outOf=p=>Math.max(1,Math.min(99,Math.round(p*100)));
const usd=x=>'$'+x.toFixed(2).replace(/\.00$/,'');
function kidAsk(v,o){const st=v.st;
 if(o.market==='Prop')return `Will ${esc(o.player)} get ${o.target} or more ${KSTAT[o.stat]}?`;
 if(o.market==='Total')return `Will the two teams score ${o.side==='Over'?'more':'fewer'} than ${o.line} points in all?`;
 if(o.market==='Moneyline')return `Will the ${esc(o.side)} win the game?`;
 const n=Math.abs(o.line);return o.line<0?`Will the ${esc(o.side)} win by ${Math.floor(n)+1} or more points?`:`Will the ${esc(o.side)} win, or lose by ${Math.floor(n)} points or less?`}
function kidNow(v,o){const st=v.st,score=`${esc(st.away.name)} ${st.away.pts}, ${esc(st.home.name)} ${st.home.pts}`;
 if(o.market==='Prop')return `He has <b>${o.now}</b> so far, after ${Math.round((v.st.players.find(p=>p.id===o.playerId)||{}).min||0)} minutes. Score: ${score} (${statusLine(st)}).`;
 return `Score: ${score} (${statusLine(st)}).`}
function kidGuess(v,o){const sim=v.sim,st=v.st;
 if(o.market==='Prop')return `Our computer guesses he ends with about <b>${Math.round(o.proj.mean)}</b>.`;
 if(o.market==='Total')return `Our computer guesses about <b>${Math.round(sim.mean('game'))}</b> points in all.`;
 const m=sim.mean('game:m'),lead=m>=0?st.home.name:st.away.name;return Math.abs(m)<1?'Our computer guesses a very close finish.':`Our computer guesses the ${esc(lead)} win by about <b>${Math.round(Math.abs(m))}</b>.`}
function kidLine(v,o){const st=v.st,score=`${esc(st.away.abbr)} ${st.away.pts}–${st.home.pts} ${esc(st.home.abbr)}, ${statusLine(st)}`;
 if(o.market==='Prop')return `Has ${o.now} now · computer guesses ${Math.round(o.proj.mean)} · ${score}`;
 if(o.market==='Total')return `Computer guesses ${Math.round(v.sim.mean('game'))} total · ${score}`;
 return score}
function kidCard(v,o){
 return `<button class="card lv-kid" data-lv-game="${v.id}">
  <div class="lv-ask">${kidAsk(v,o)}</div>
  <div class="cap">${kidLine(v,o)}</div>
  <div class="lv-odds2"><div><span>Computer</span><b>${outOf(o.p)} in 100</b></div><div><span>Price says</span><b>${outOf(o.novig)} in 100</b></div></div>
  <div class="row between"><span class="why">${usd(10)} at ${fo(o.price)} wins <b>${usd(10*(E.dec(o.price)-1))}</b></span><span class="pill p-long">Practice</span></div>
 </button>`}
function oppList(vs){
 const qs=vs.flatMap(v=>[...v.opps,...(v.propOpps||[])].filter(o=>o.qualifies&&o.ev>0&&marketOk(o)&&playerOk(o)).map(o=>[v,o])).sort((a,b)=>b[1].ev-a[1].ev);
 return qs.length?`<div class="list">${qs.map(([v,o])=>kidCard(v,o)).join('')}</div><div class="cap">Only bets the computer thinks are priced too generously. It is still learning and can be wrong, so these are practice picks.</div>`
  :`<div class="empty"><h3>No good bets right now</h3>Every price is fair or worse. Waiting is the right move.</div>`}
/* Collapsible sections keep their open/closed state across live repaints. */
const secOpen=(k,title)=>`<details class="lv-sec" data-lv-sec="${k}" ${ui.secs[k]?'open':''}><summary>${title}</summary><div class="lv-secbody">`;
const sec=(k,title,inner)=>`${secOpen(k,title)}${inner}</div></details>`;
function gameRow(v){const st=v.st,sim=v.sim,wh=sim.prob('game:m',0).over,fav=wh>=.5?st.home:st.away,fp=Math.max(wh,1-wh);
 const top=st.status==='pre'?`${esc(st.away.abbr)} at ${esc(st.home.abbr)}`:`${esc(st.away.abbr)} ${st.away.pts} · ${esc(st.home.abbr)} ${st.home.pts}`;
 const sub=st.status==='post'?`Final ${esc(st.away.abbr)} ${st.away.pts}, ${esc(st.home.abbr)} ${st.home.pts}`
  :`Projected ${esc(st.away.abbr)} ${Math.round(sim.mean('game:a'))}, ${esc(st.home.abbr)} ${Math.round(sim.mean('game:h'))} · ${esc(fav.abbr)} ${outOf(fp)}% to win`;
 return `<button class="card lv-row" data-lv-game="${v.id}"><div class="row between"><b class="lv-teams">${top}</b>${v.q.stale||v.q.conflict?freshBadge(v):`<span class="${st.status==='in'?'live':'cap'}">${statusLine(st)}</span>`}</div><div class="cap">${sub}</div></button>`}
function playerOk(o){const t=ui.filters.player.trim().toLowerCase();return !t||(o.market==='Prop'&&o.player.toLowerCase().includes(t))}
function playerPanel(vs){const t=ui.filters.player.trim().toLowerCase();if(!t&&ui.filters.market!=='props')return '';
 const rows=vs.flatMap(v=>players(v).filter(p=>!t||p.name.toLowerCase().includes(t)).map(p=>[v,p]));
 return `<h2 class="sec">Player projections</h2>${rows.length?`<div class="panel"><div class="chartbox">${ptable(rows)}</div>${propNote}</div>`:'<div class="empty">No player in an active game matches.</div>'}`}
const propNote='<div class="cap">Now → projected final (80% range). Lines shown are the pregame lines from Stamped data, not live prices, so no edge or EV is computed for props. Live prop prices need an odds feed (see README).</div>';
function ptable(rows){const ST=[['points','PTS'],['rebounds','REB'],['assists','AST'],['threes','3PM'],['PRA','PRA']];
 return `<table class="lv-p"><thead><tr><th>Player</th><th class="num">MIN</th>${ST.map(s=>`<th class="num">${s[1]}</th>`).join('')}</tr></thead><tbody>
 ${rows.map(([v,p])=>{const pl=(p.hist&&p.hist.props)||[];return `<tr><td>${esc(p.name)} <span class="cap">${esc(p.team==='home'?v.st.home.abbr:v.st.away.abbr)}${p.pf?` · ${p.pf} PF`:''}</span>${p.flags.length?`<div class="cap">${esc(p.flags.join(' '))}</div>`:''}</td><td class="num">${Math.round(p.min)}→${p.expMin}</td>
  ${ST.map(([s])=>{const x=p.stats[s],ln=pl.find(y=>y.stat===s);return `<td class="num">${x.now}→${r1(x.mean)}<small>${x.lo}–${x.hi}</small>${ln?`<small>pre ${ln.line}: ${pc(p.probOver(s,ln.line))} over</small>`:''}</td>`}).join('')}</tr>`}).join('')}</tbody></table>`}
function accuracyPanel(){const a=ui.accuracy,ps=paperStats();
 const bt=a===undefined?'<div class="cap">Loading backtest…</div>':!a?'<div class="cap">No backtest results published yet. Run <code>node live/backtest.js</code> (see README).</div>'
  :`<div class="chartbox"><table><thead><tr><th>Checkpoint</th><th class="num">Games</th><th class="num">Final total MAE</th><th class="num">Next-quarter MAE</th><th class="num">Brier (win)</th><th class="num">Brier (over pregame)</th></tr></thead><tbody>
   ${a.byCheckpoint.map(c=>`<tr><td>${esc(c.label)}</td><td class="num">${c.n}</td><td class="num">${r1(c.maeTotal)}</td><td class="num">${c.maeNextQ!=null?r1(c.maeNextQ):'—'}</td><td class="num">${c.brierWin.toFixed(3)}</td><td class="num">${c.brierOver!=null?c.brierOver.toFixed(3):'—'}</td></tr>`).join('')}</tbody></table></div>
   <div class="cap">${a.games} completed games, ${esc(a.range)}, model ${esc(a.modelVersion)}. Replayed from play-by-play using only what was known at each checkpoint. Pregame-only reference: final total MAE ${r1(a.pregameMae)}. ${esc((a.notes||[]).join(' '))}</div>
   ${a.calibration&&a.calibration.length?`<div class="chartbox"><table><thead><tr><th>Win probability bucket</th><th class="num">n</th><th class="num">Predicted</th><th class="num">Actual</th></tr></thead><tbody>${a.calibration.map(c=>`<tr><td>${esc(c.bucket)}</td><td class="num">${c.n}</td><td class="num">${pc(c.predicted)}</td><td class="num">${pc(c.observed)}</td></tr>`).join('')}</tbody></table></div>`:''}`;
 return `<h2 class="sec">Historical accuracy</h2><div class="panel">${bt}</div>
 <h2 class="sec">Paper record (this browser)</h2><div class="panel"><div class="stats"><div class="stat"><span>Logged</span><b>${ps.n}</b></div><div class="stat"><span>W-L-P</span><b>${ps.w}-${ps.l}-${ps.p}</b></div><div class="stat"><span>Units</span><b>${ps.u>=0?'+':''}${ps.u.toFixed(2)}</b></div></div>
  <div class="cap">${ps.settled?`ROI ${pc(ps.roi)} per pick · Brier ${ps.brier!=null?ps.brier.toFixed(3):'—'} · `:''}${ps.open} open. Flat 1 unit at the logged price, before latency (prices can move before you can bet). Recommendations stay Paper until a few hundred settled picks show positive results after costs.</div>
  ${ui.paper.length?`<div class="chartbox"><table><thead><tr><th>Pick</th><th>When</th><th class="num">Price</th><th class="num">Edge</th><th>Result</th></tr></thead><tbody>${ui.paper.slice(-15).reverse().map(x=>`<tr><td>${esc(x.name)} · ${x.market==='Prop'?`${esc(x.side)} ${x.target}+ ${esc(x.stat)}`:`${esc(x.side)} ${x.line!=null?x.line:''} ${esc(x.market)}`}</td><td class="cap">${esc(x.when)} (${esc(x.score)})</td><td class="num">${fo(x.price)}</td><td class="num">${pts(x.edge)}</td><td>${x.result?`${x.result} ${x.final?`(${esc(x.final)})`:''}`:'open'}</td></tr>`).join('')}</tbody></table></div>`:''}</div>`}
function alertsPanel(){const c=ui.cfg,ck=(k,t)=>`<label class="lv-ck"><input type="checkbox" data-lv-cfg="${k}" ${c[k]?'checked':''}> ${t}</label>`;
 const perm='Notification' in window?Notification.permission:'unsupported';
 return `<h2 class="sec">Alerts</h2><div class="panel">
  <div class="lv-cks">${ck('quarter','Quarter start / end')}${ck('projection','Projection moves')}${ck('line','Line changes')}${ck('opportunity','Qualifying opportunity')}${ck('player','Foul trouble / injury')}${ck('notify','Desktop notifications')}</div>
  <div class="row"><label class="cap">Projection move ≥ <input type="number" min="1" max="15" step="0.5" value="${c.projDelta}" data-lv-cfgn="projDelta" class="lv-num"> pts</label><label class="cap">Line move ≥ <input type="number" min="0.5" max="10" step="0.5" value="${c.lineDelta}" data-lv-cfgn="lineDelta" class="lv-num"></label></div>
  ${c.notify&&perm!=='granted'?`<button class="btn" data-lv-perm>${perm==='denied'?'Notifications blocked in browser settings':'Allow desktop notifications'}</button>`:''}
  <div class="cap">Alerts fire only while this page is open. Each alert fires once.</div>
  ${ui.log.length?`<ul class="checks">${ui.log.slice(0,12).map(a=>`<li><span class="cap">${tm(a.at)}</span> ${esc(a.text)}</li>`).join('')}</ul>`:''}</div>`}

function shell(){const f=ui.filters,teams=[...new Set(Object.values(ui.view).flatMap(v=>[v.st.away.abbr,v.st.home.abbr]))].sort();
 const sel=(k,opts)=>`<select data-lv-f="${k}" aria-label="${k}">${opts.map(([v,t])=>`<option value="${v}" ${String(f[k])===String(v)?'selected':''}>${t}</option>`).join('')}</select>`;
 return `<div class="lv">
 <div class="slate"><h1>NBA Live</h1><p id="lv-fresh"></p></div>
 <details class="lv-sec" data-lv-sec="filters" ${ui.secs.filters?'open':''}><summary>Filters</summary><div class="lv-secbody lv-filters">
  ${sel('period',[['all','All periods'],['q1','Q1'],['q2','Q2'],['q3','Q3'],['q4','Q4'],['h1','1st half'],['h2','2nd half'],['game','Full game']])}
  <span id="lv-teamsel">${sel('team',[['','All teams'],...teams.map(t=>[t,t])])}</span>
  ${sel('market',[['all','All markets'],['total','Totals'],['spread','Spreads'],['moneyline','Moneylines'],['props','Player props']])}
  ${sel('book',[['all','All books'],['dk','DraftKings (live)'],['yours','Your price only']])}
  ${sel('conf',[['any','Any confidence'],['medium','Medium+'],['high','High']])}
  <label class="cap">Min edge <input type="number" class="lv-num" step="0.5" min="0" max="20" value="${f.minEdge}" data-lv-f="minEdge"> pts</label>
  <input type="search" placeholder="Player" value="${esc(f.player)}" data-lv-f="player" class="lv-search" aria-label="Player">
 </div></details>
 <div id="lv-body"></div></div>`}
function body(){
 const vs=Object.values(feed?feed.games:{}).map(analyze).filter(Boolean).sort((a,b)=>({in:0,pre:1,post:2}[a.st.status]-{in:0,pre:1,post:2}[b.st.status])||(a.st.start<b.st.start?-1:1));
 const live=vs.filter(v=>v.st.status==='in'&&teamOk(v)),pre=vs.filter(v=>v.st.status==='pre'&&teamOk(v)),fin=vs.filter(v=>v.st.status==='post'&&teamOk(v));
 const fr=$('#lv-fresh');if(fr)fr.textContent=ui.status?ui.status.ok?`ESPN feed ok · ${tm(ui.status.at)}`:`Feed error: ${ui.status.error} · retrying`:'Connecting to ESPN…';
 const ts=root.querySelector('[data-lv-f="team"]'),teams=[...new Set(vs.flatMap(v=>[v.st.away.abbr,v.st.home.abbr]))].sort();
 if(ts&&ts.options.length-1!==teams.length)ts.innerHTML=`<option value="">All teams</option>`+teams.map(t=>`<option value="${esc(t)}" ${ui.filters.team===t?'selected':''}>${esc(t)}</option>`).join('');
 let h='';
 h+=`<h2 class="sec">Good bets right now</h2>${live.length?oppList(live):`<div class="empty"><h3>No games on right now</h3>${pre.length?`Next tip: ${esc(pre[0].st.away.name)} at ${esc(pre[0].st.home.name)}, ${statusLine(pre[0].st)}. This page starts watching automatically.`:'No more games today.'}</div>`}`;
 h+=playerPanel([...live,...pre]);
 const all=[...live,...pre,...fin];
 if(all.length)h+=`<h2 class="sec">Games</h2><div class="list">${all.map(gameRow).join('')}</div><div class="cap">Tap a game for the full breakdown.</div>`;
 h+=sec('more','Track record, accuracy and alerts',accuracyPanel()+alertsPanel());
 return h;
}
function paint(){const mark=$('#sheet [data-lv-sheet]');
 if(!root||!root.isConnected){if(feed)Object.values(feed.games).forEach(analyze)}
 else{const b=root.querySelector('#lv-body');if(b)b.innerHTML=body()}
 /* Only refresh the sheet while it still shows this game (index.html replaces the content when it opens its own sheets). */
 if(mark&&!$('#scrim').hidden)sheet(mark.dataset.lvSheet,true);else ui.open=null}

/* ---------- game detail sheet ---------- */
const CALC_KEYS=[['game','Game total'],['h1','1st half total'],['h2','2nd half total'],['q1','Q1 total'],['q2','Q2 total'],['q3','Q3 total'],['q4','Q4 total'],['game:h','Home team total'],['game:a','Away team total'],['h1:h','Home 1H total'],['h1:a','Away 1H total'],['spread','Home spread']];
function calcOut(v){const c=ui.calc,L=parseFloat(c.line),P=parseInt(c.price,10);if(isNaN(L))return '<div class="cap">Enter a line from your book to get the model probability. Add the price to get expected value.</div>';
 const k=c.key,sim=v.sim;
 if(k==='spread'){const r=E.priceSide(sim,'game',L,isNaN(P)?null:P,null,'home'),a=E.priceSide(sim,'game',-L,null,null,'away');
  return `<div class="why">${esc(v.st.home.abbr)} ${L>0?'+':''}${L}: covers ${pc(r.p)} · ${esc(v.st.away.abbr)} ${-L>0?'+':''}${-L}: covers ${pc(a.p)}${r.push>0?` · push ${pc(r.push)}`:''}. Fair ${esc(v.st.home.abbr)} price ${fo(r.fair)}.${r.ev!=null?` EV at ${fo(P)}: <b class="${r.ev>0?'up':'dn'}">${pc(r.ev)}</b> (vs vigged price).`:''}</div>`}
 const base=k.split(':')[0];if(sim.done(base))return `<div class="cap">That period is complete: actual ${sim.actual(base,k.split(':')[1]||'')}.</div>`;
 const o=E.priceSide(sim,k,L,isNaN(P)?null:P,null,'over'),u=E.priceSide(sim,k,L,null,null,'under');
 return `<div class="why">Over ${L}: <b>${pc(o.p)}</b> (fair ${fo(o.fair)}) · Under: <b>${pc(u.p)}</b> (fair ${fo(u.fair)})${o.push>0?` · push ${pc(o.push)}`:''}.${o.ev!=null?` EV on the over at ${fo(P)}: <b class="${o.ev>0?'up':'dn'}">${pc(o.ev)}</b>.`:''}</div><div class="cap">Your price, not checked against the rules or a live feed. Projections only; not a recommendation.</div>`}
function sheet(id,refresh){const v=ui.view[id];if(!v)return;const st=v.st,R=v.sim.rates,cf=E.confidence(v.sim,v.q);
 const ae=document.activeElement,aid=ae&&ae.dataset&&ae.dataset.lvCalc,pos=ae&&ae.selectionStart;
 ui.open=id;
 $('#sheet').innerHTML=`<div class="grab" data-lv-sheet="${id}"></div>
 <div class="shead"><div style="min-width:0"><div class="pname">${esc(st.away.name)} at ${esc(st.home.name)}</div><div class="team">${statusLine(st)} · ${esc(st.away.abbr)} ${st.away.pts}, ${esc(st.home.abbr)} ${st.home.pts}</div></div><button class="x" id="close" aria-label="Close">×</button></div>
 ${(()=>{const good=[...v.opps,...(v.propOpps||[])].filter(o=>o.qualifies&&o.ev>0);return good.length?`<h2 class="sec">Good bets in this game</h2><div class="list">${good.map(o=>kidCard(v,o)).join('')}</div>`:''})()}
 <div class="panel"><h4>Score by quarter</h4>${qtable(v)}</div>
 ${secOpen('s-markets','Every line checked')}
 <div class="panel"><h4>Game lines</h4>${st.status!=='in'?'<div class="cap">Live recommendations only run while the game is in progress.</div>':v.opps.length?`<div class="chartbox"><table>${oppHead(true)}<tbody>${v.opps.filter(o=>o.ev>0).map(o=>oppRow(o,true)).join('')||'<tr><td colspan="7" class="cap">No game line pays more than it should.</td></tr>'}</tbody></table></div><div class="cap">Only lines with positive expected value are listed. Edge = model chance minus the book's no-vig chance. Existing Stamped rules apply: −160 or worse is killed, +300 or longer is too long, 3-point minimum edge. Live rules: odds under 90 s old, feed not stale, no conflict, not inside the last 2:00, confidence Medium or better, and no edge above 10 points (a gap that big against a live market usually means the model is missing something).</div>${v.opps.filter(o=>o.qualifies).map(o=>`<div class="why"><b>${esc(o.side)} ${o.line!=null?o.line:''} ${o.market}:</b> ${o.why.map(esc).join(' ')}</div>`).join('')}`:`<div class="flag">${esc(v.market&&v.market.why||'No live market posted.')}</div>`}</div>
 <div class="panel"><h4>Player props</h4>${st.status!=='in'?'<div class="cap">Live props only run while the game is in progress.</div>':!v.props?'<div class="cap">No live player props posted.</div>':(()=>{const pos=(v.propOpps||[]).filter(o=>o.ev>0);
  return `${pos.length?`<div class="chartbox"><table><thead><tr><th>Bet</th><th class="num">Price</th><th class="num">Model</th><th class="num">Implied</th><th class="num">EV</th><th>Rules</th></tr></thead><tbody>${pos.map(o=>`<tr class="${o.qualifies?'':'dim'}"><td>${esc(o.player)} ${o.target}+ ${esc(o.stat)} <span class="cap">now ${o.now}, proj ${r1(o.proj.mean)}</span></td><td class="num">${fo(o.price)}</td><td class="num">${pc(o.p)}</td><td class="num">${pc(o.novig)}</td><td class="num up">${pc(o.ev)}</td><td class="cap">${o.qualifies?'Qualifies (Paper)':esc([...o.rule.why,...o.gate.why].join(' '))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="cap">No live prop pays more than the model thinks it should.</div>'}
  <div class="cap">${v.propOpps.length} DraftKings "X or more" milestones checked · ${tm(v.props.fetched)}${v.props.frozen?' · prices not moving':''}. Only bets with positive expected value are listed. Over/under prop pairs are skipped because the feed does not label which side is which. Implied includes the book's margin.</div>`})()}</div>
 </div></details>
 ${secOpen('s-calc','Check a line from your book')}
  <div class="row lv-calc"><select data-lv-calc="key">${CALC_KEYS.map(([k,t])=>`<option value="${k}" ${ui.calc.key===k?'selected':''}>${t}</option>`).join('')}</select>
  <input data-lv-calc="line" class="lv-num" inputmode="decimal" placeholder="Line" value="${esc(ui.calc.line)}"><input data-lv-calc="price" class="lv-num" inputmode="numeric" placeholder="Price" value="${esc(ui.calc.price)}"></div>
  <div id="lv-calc-out">${calcOut(v)}</div></div></details>
 ${secOpen('s-players','Player projections')}<div class="chartbox">${ptable(players(v).map(p=>[v,p]))}</div>${propNote}</div></details>
 ${secOpen('s-how','How the computer got this')}
 <div class="cap">Model ${E.VERSION} · confidence ${cf.level}${cf.why.length?` (${esc(cf.why.join(', '))})`:''} · practice picks only, never places a bet.</div>
 <table><tbody>
  <tr><td>Pregame baseline</td><td>${esc(R.base.src||'none')} → total ${r1(R.base.T)}, ${esc(st.home.abbr)} margin ${R.base.M>=0?'+':''}${r1(R.base.M)}</td></tr>
  <tr><td>Pace (poss / 48)</td><td>${R.obsPace!=null?`observed ${r1(R.obsPace)} · `:''}pregame ${r1(R.pace0)} · used ${r1(R.pace)} (${Math.round(R.wPace*100)}% live)</td></tr>
  <tr><td>Scoring rate (pts / min)</td><td>${R.obsPpm!=null?`observed ${R.obsPpm.toFixed(2)} · `:''}pregame ${R.ppm0.toFixed(2)} · used ${R.ppm.toFixed(2)} (${Math.round(R.wRate*100)}% live)</td></tr>
  <tr><td>Points / possession</td><td>${esc(st.away.abbr)} ${R.obsPppA!=null?`${R.obsPppA.toFixed(3)} live → `:''}${R.pppA.toFixed(3)} · ${esc(st.home.abbr)} ${R.obsPppH!=null?`${R.obsPppH.toFixed(3)} live → `:''}${R.pppH.toFixed(3)}</td></tr>
  <tr><td>Simulation</td><td>${v.sim.n.toLocaleString()} seeded runs, possession by possession; Q4 bench units in blowouts (18+), intentional fouling in the last minute</td></tr>
  ${R.flags.length?`<tr><td>Flags</td><td>${esc(R.flags.join(' '))}</td></tr>`:''}</tbody></table>
 <h4>Sources</h4><div class="srcs">${v.sources.map(s=>`<div>${esc(s[0])} · ${s[2]?tm(s[2]):'—'} · <a href="${esc(s[1])}" target="_blank" rel="noopener">${esc(s[1])}</a></div>`).join('')}${v.q.why.length?`<div class="wn">${esc(v.q.why.join(' '))}</div>`:''}</div></div></details>`;
 if(!refresh)hooks.showSheet();
 else if(aid){const el=$('#sheet').querySelector(`[data-lv-calc="${aid}"]`);if(el){el.focus();try{el.setSelectionRange(pos,pos)}catch(e){}}}}

/* ---------- wiring ---------- */
function onMainInput(e){const t=e.target;if(!root||!root.contains(t))return;
 if(t.dataset.lvF){ui.filters[t.dataset.lvF]=t.value;store('stamped-live-filters',Object.assign({},ui.filters,{player:''}));paint();return}
 if(t.dataset.lvCfg){ui.cfg[t.dataset.lvCfg]=t.checked;store('stamped-live-alerts',ui.cfg);if(t.dataset.lvCfg==='notify'&&t.checked)perm();paint();return}
 if(t.dataset.lvCfgn){const n=parseFloat(t.value);if(!isNaN(n)){ui.cfg[t.dataset.lvCfgn]=n;store('stamped-live-alerts',ui.cfg)}}}
function perm(){try{if('Notification' in window&&Notification.permission==='default')Notification.requestPermission().then(()=>paint())}catch(e){}}
function onMainClick(e){if(!root||!root.contains(e.target))return;const g=e.target.closest('[data-lv-game]');if(g){ui.open=g.dataset.lvGame;sheet(ui.open);return}
 if(e.target.closest('[data-lv-perm]'))perm()}
function onSheetInput(e){const t=e.target;if(!t.dataset||!t.dataset.lvCalc||!ui.open)return;ui.calc[t.dataset.lvCalc]=t.value;const v=ui.view[ui.open],o=$('#lv-calc-out');if(v&&o)o.innerHTML=calcOut(v)}

function start(data,h){ui.data=data;hooks=h||{};if(feed)return;
 feed=new S.LiveFeed({onUpdate:paint,onStatus:s=>{ui.status=s}});
 feed.start();
 fetch('live/backtest-results.json?v='+Date.now()).then(r=>r.ok?r.json():null).then(a=>{ui.accuracy=a;paint()}).catch(()=>{ui.accuracy=null;paint()});
 const m=$('#main');m.addEventListener('change',onMainInput);m.addEventListener('input',e=>{if(e.target.matches('input[type=search],input[type=number]'))onMainInput(e)});m.addEventListener('click',onMainClick);
 $('#sheet').addEventListener('input',onSheetInput);$('#sheet').addEventListener('change',onSheetInput);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint()});
 document.addEventListener('toggle',e=>{const k=e.target&&e.target.dataset&&e.target.dataset.lvSec;if(!k||!!ui.secs[k]===e.target.open)return;ui.secs[k]=e.target.open;store('stamped-live-secs',ui.secs)},true);
}
function mount(el){root=el;el.innerHTML=shell();paint()}
window.LiveUI={start,mount,_ui:ui};
})();
