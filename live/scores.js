/* Live scoreboard tiles for the Today tab (owner, 2026-11-07: Linemate-style matchups, red live dot, scores as they happen).
   NBA shows today's games, NFL this week's (finals from earlier days drop off). Source: ESPN site scoreboard (CORS *), polled in the browser; never writes data.json.
   2026-11-15: soccer, golf and tennis read the same feed and use the same tiles (their daily data.json run stopped on Nov 5, so those tabs were empty):
   soccer = today's and the coming week's matches in the main leagues with DraftKings lines, golf = each tour's leaderboard, tennis = singles matches. */
(function(){
'use strict';
const URL={nba:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',nfl:'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'};
const S={};let opts={};
const tz={timeZone:'America/New_York'};
const ymd=d=>d.toLocaleDateString('en-CA',tz);
const side=c=>({abbr:c.team.abbreviation,name:c.team.name||c.team.shortDisplayName,color:'#'+(c.team.color||'5a6478'),logo:c.team.logo||'',
 score:c.score!=null&&c.score!==''?+c.score:null,win:!!c.winner,rec:((c.records||[])[0]||{}).summary||''});
function norm(e){const c=e.competitions[0],st=c.status||e.status,t=st.type;
 return{id:String(e.id),date:e.date,state:t.state,detail:t.shortDetail||t.detail||'',
  home:side(c.competitors.find(x=>x.homeAway==='home')),away:side(c.competitors.find(x=>x.homeAway==='away'))}}
/* A game still belongs on the board: not final, or final today (ET). Owner, 2026-11-09: Sunday's finals were still up on Monday. */
const fresh=g=>g.state!=='post'||ymd(new Date(g.date))===ymd(new Date());
async function load(lg){if(LOADX[lg]){try{await LOADX[lg]()}catch(_){}return}
 /* NBA asks for today's ET date: ESPN's undated board keeps yesterday's slate until late morning. */
 const u=lg==='nba'?URL[lg]+'?dates='+ymd(new Date()).replace(/-/g,''):URL[lg];
 try{const r=await fetch(u),j=await r.json();
  let week=j.week&&j.week.number,gs=(j.events||[]).map(norm);
  /* NFL: once every game this week is final from an earlier day (Tue-Wed), show next week's schedule instead. */
  if(lg==='nfl'&&gs.length&&!gs.some(fresh)&&week){const st=(j.season&&j.season.type)||2;
   try{const n=await (await fetch(URL[lg]+'?week='+(week+1)+'&seasontype='+st)).json(),ng=(n.events||[]).map(norm);if(ng.length){gs=ng;week=week+1}}catch(_){}}
  S[lg]={at:Date.now(),week,games:gs};paint(lg)}catch(_){}
}
/* NBA: today's games in ET. NFL: this week's games, minus finals from earlier days. Live first, then upcoming by start, finals last. */
function games(lg){const s=S[lg];if(!s)return[];const t=ymd(new Date()),rank={in:0,pre:1,post:2};
 let gs=s.games;if(lg==='nba')gs=gs.filter(g=>ymd(new Date(g.date))===t);else gs=gs.filter(fresh);
 return gs.slice().sort((a,b)=>(rank[a.state]-rank[b.state])||(a.state==='post'?b.date.localeCompare(a.date):a.date.localeCompare(b.date)))}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const logo=t=>t.logo?`<img class="sc-lt" src="${t.logo}" alt="" loading="lazy"><img class="sc-dk" src="${t.logo.replace('/500/','/500-dark/')}" alt="" loading="lazy" onerror="this.src='${t.logo}'">`:'';
function team(t,g){const out=g.state==='post'&&!t.win;
 return `<div class="sc-t${out?' sc-out':''}">${logo(t)}<b>${esc(t.abbr)}</b>${t.rec&&g.state==='pre'?`<small>${esc(t.rec)}</small>`:''}</div>`}
function mid(g){const d=new Date(g.date),time=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',...tz});
 if(g.state==='in')return `<span class="sc-live"><i></i>LIVE</span><span class="sc-clk">${esc(g.detail)}</span>`;
 if(g.state==='post')return `<span class="sc-fin">${esc(/final/i.test(g.detail)?g.detail:'Final')}</span>`;
 if(/postponed|canceled|delayed/i.test(g.detail))return `<span class="sc-fin">${esc(g.detail)}</span>`;
 const day=ymd(d)===ymd(new Date())?'Today':d.toLocaleDateString('en-US',{month:'short',day:'2-digit',...tz});
 return `<span>${day}</span><span>${time} ET</span>`}
const sc=(t,g)=>g.state==='pre'||t.score==null?'<span class="sc-n"></span>':`<span class="sc-n${g.state==='post'&&!t.win?' sc-out':''}">${t.score}</span>`;
/* Tap opens the Stamped game sheet when the daily data has that game. */
function stampedId(lg,g){const day=ymd(new Date(g.date));
 const m=(window.GAMES_ALL||[]).find(x=>x.lg===lg&&x.when.slice(0,10)===day&&x.home.n===g.home.name&&x.away.n===g.away.name);return m&&m.id}
function tile(lg,g){const id=stampedId(lg,g),tag=id?'button':'div';
 return `<${tag} class="sc-g sc-${g.state}"${id?` data-game="${id}"`:''} style="--ca:${g.away.color};--ch:${g.home.color}">${team(g.away,g)}${sc(g.away,g)}<div class="sc-m">${mid(g)}</div>${sc(g.home,g)}${team(g.home,g)}</${tag}>`}

/* ---------- soccer, golf, tennis ---------- */
const BASE='https://site.api.espn.com/apis/site/v2/sports/';
const SOC=[['eng.1','Premier League'],['esp.1','LaLiga'],['ita.1','Serie A'],['ger.1','Bundesliga'],['fra.1','Ligue 1'],['uefa.champions','Champions League'],['uefa.europa','Europa League'],['usa.1','MLS'],['mex.1','Liga MX'],
 ['uefa.nations','Nations League'],['fifa.worldq.uefa','World Cup qualifying, Europe'],['fifa.worldq.conmebol','World Cup qualifying, South America'],['fifa.worldq.concacaf','World Cup qualifying, CONCACAF'],['fifa.friendly','International friendly']];
const GOLF=[['pga','PGA Tour'],['lpga','LPGA'],['eur','DP World Tour'],['champions-tour','PGA Tour Champions'],['liv','LIV Golf']];
const TEN=[['atp','ATP'],['wta','WTA']];
const EXTRA={soccer:1,golf:1,tennis:1};
const getJ=async u=>{const r=await fetch(u);if(!r.ok)throw new Error(r.status);return r.json()};
const amer=v=>{if(v==null||v==='')return null;const n=typeof v==='number'?v:parseInt(String(v).replace('+',''),10);return isNaN(n)?null:n};
const fo=o=>o==null?'':o>0?'+'+o:String(o);
const cl=x=>x?((x.close&&x.close.odds)!=null?x.close.odds:(x.open&&x.open.odds)):null;
function socOdds(c){const o=(c.odds||[])[0];if(!o)return null;const m=o.moneyline||{};
 const r={home:amer(cl(m.home)),away:amer(cl(m.away)),draw:amer(cl(m.draw)!=null?cl(m.draw):(o.drawOdds&&o.drawOdds.moneyLine)),ou:o.overUnder!=null?+o.overUnder:null,
  over:amer(cl(o.total&&o.total.over)),under:amer(cl(o.total&&o.total.under)),book:(o.provider&&o.provider.name)||''};
 return r.home==null&&r.away==null&&r.ou==null?null:r}
function normSoc(e,lgName){const g=norm(e),c=e.competitions[0],st=c.status||e.status;g.league=lgName;g.odds=socOdds(c);if(st.type.state==='in'&&st.displayClock)g.detail=st.displayClock;return g}
async function loadSoccer(){const all=await Promise.all(SOC.map(async([id,name])=>{try{const j=await getJ(BASE+'soccer/'+id+'/scoreboard');return (j.events||[]).map(e=>normSoc(e,name))}catch(_){return null}}));
 if(all.every(x=>x===null))return;S.soccer={at:Date.now(),games:all.filter(Boolean).flat()};paint('soccer')}
function normGolf(e,tour){const c=e.competitions[0],st=(c.status||e.status).type;
 const ps=(c.competitors||[]).map(p=>{const rs=(p.linescores||[]).filter(l=>l.value!=null||(l.linescores||[]).length),cur=rs[rs.length-1],holes=cur?(cur.linescores||[]).length:0;
  return{name:p.athlete.displayName,flag:(p.athlete.flag&&p.athlete.flag.href)||'',score:p.score==null?'':String(p.score),order:p.order||999,today:cur&&cur.displayValue!=null?String(cur.displayValue):'',thru:holes>=18?'F':holes?String(holes):'',round:rs.length}});
 const num=x=>x==='E'?0:parseInt(x,10),mx=Math.max(0,...ps.map(p=>p.round)),act=p=>p.round>=mx-1&&!isNaN(num(p.score))?0:1;
 /* Players still in the event by score (ESPN's own order lags during a round), then the ones who missed the cut in ESPN's order. */
 ps.sort((a,b)=>(act(a)-act(b))||(act(a)?a.order-b.order:(num(a.score)-num(b.score))||(a.order-b.order)));
 /* Position from the score (ESPN's order breaks ties silently): T2 when two or more share it. */
 ps.forEach(p=>{const v=num(p.score);if(isNaN(v)){p.pos='';return}const first=ps.findIndex(q=>num(q.score)===v),tie=ps.filter(q=>num(q.score)===v).length>1;p.pos=(tie?'T':'')+(first+1)});
 return{id:String(e.id),tour,name:e.name||e.shortName,date:e.date,end:e.endDate,state:st.state,detail:st.description||st.detail||'',round:Math.max(0,...ps.map(p=>p.round)),players:ps}}
async function loadGolf(){const all=await Promise.all(GOLF.map(async([id,name])=>{try{const j=await getJ(BASE+'golf/'+id+'/scoreboard');return (j.events||[]).map(e=>normGolf(e,name))}catch(_){return null}}));
 if(all.every(x=>x===null))return;S.golf={at:Date.now(),games:all.filter(Boolean).flat().filter(t=>t.players.length)};paint('golf')}
function normTen(c,ev,tour,draw){const st=c.status.type,pl=x=>({name:(x.athlete&&(x.athlete.displayName||x.athlete.shortName))||'TBD',flag:(x.athlete&&x.athlete.flag&&x.athlete.flag.href)||'',win:!!x.winner,seed:(x.curatedRank&&x.curatedRank.current)||null,
  sets:(x.linescores||[]).map(l=>({v:l.value,tb:l.tiebreak,w:!!l.winner}))});
 const cs=(c.competitors||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0));
 /* ESPN stamps matches without a set time at midnight ET (05:00Z). */
 return{id:String(c.id),tour,event:ev.shortName||ev.name,draw,top:cs.some(x=>x.curatedRank&&x.curatedRank.current<=50)?0:1,date:c.date,timed:c.timeValid!==false&&!/T0[45]:00Z$/.test(c.date||''),state:st.state,detail:st.shortDetail||st.detail||'',round:(c.round&&c.round.displayName)||'',court:(c.venue&&c.venue.court)||'',p:cs.map(pl)}}
async function loadTennis(){const all=await Promise.all(TEN.map(async([id,name])=>{try{const j=await getJ(BASE+'tennis/'+id+'/scoreboard'),out=[];
   for(const ev of j.events||[])for(const g of ev.groupings||[]){const d=(g.grouping&&g.grouping.displayName)||'';if(!/singles/i.test(d))continue;
    for(const c of g.competitions||[])if((c.competitors||[]).length===2&&c.competitors.every(x=>x.athlete&&x.athlete.displayName&&x.athlete.displayName!=='TBD'))out.push(normTen(c,ev,name,d))}
   return out}catch(_){return null}}));
 if(all.every(x=>x===null))return;S.tennis={at:Date.now(),games:all.filter(Boolean).flat()};paint('tennis')}
const LOADX={soccer:loadSoccer,golf:loadGolf,tennis:loadTennis};
const dayLabel=d=>{const k=ymd(d);if(k===ymd(new Date()))return 'Today';if(k===ymd(new Date(Date.now()+864e5)))return 'Tomorrow';return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',...tz})};
const hm=d=>d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',...tz});
const RANK={in:0,pre:1,post:2};
const order=(a,b)=>(RANK[a.state]-RANK[b.state])||(a.state==='post'?b.date.localeCompare(a.date):a.date.localeCompare(b.date));
/* Soccer: live matches, today's matches, then the coming week. full = every match on the board, grouped by league (Lines tab). */
function socGames(full){const s=S.soccer;if(!s)return[];const t=ymd(new Date()),now=Date.now();
 return s.games.filter(g=>{if(g.state==='in')return true;if(g.state==='post')return ymd(new Date(g.date))===t;const dt=new Date(g.date)-now;return dt<(full?10:7)*864e5&&dt>-4*36e5}).sort(order)}
function socLine(g){const o=g.odds;if(!o)return '';const p=[];if(o.home!=null)p.push(esc(g.home.abbr)+' '+fo(o.home));if(o.draw!=null)p.push('Draw '+fo(o.draw));if(o.away!=null)p.push(esc(g.away.abbr)+' '+fo(o.away));
 if(o.ou!=null)p.push('O/U '+o.ou+(o.over!=null&&o.under!=null?' ('+fo(o.over)+' / '+fo(o.under)+')':''));return p.length?'<div class="sc-x">'+p.join(' · ')+'</div>':''}
function socTile(g,withLg){const d=new Date(g.date);let m;
 if(g.state==='in')m='<span class="sc-live"><i></i>LIVE</span><span class="sc-clk">'+esc(g.detail)+'</span>';
 else if(g.state==='post')m='<span class="sc-fin">'+esc(/^ft$|full/i.test(g.detail)?'Full time':g.detail||'Final')+'</span>';
 else if(/postponed|canceled|delayed|abandoned/i.test(g.detail))m='<span class="sc-fin">'+esc(g.detail)+'</span>';
 else m='<span>'+dayLabel(d)+'</span><span>'+hm(d)+' ET</span>';
 /* Soccer lists the home side first. */
 return '<div class="sc-g sc-'+g.state+'" style="--ca:'+g.home.color+';--ch:'+g.away.color+'">'+(withLg?'<div class="sc-x sc-lg">'+esc(g.league)+'</div>':'')+team(g.home,g)+sc(g.home,g)+'<div class="sc-m">'+m+'</div>'+sc(g.away,g)+team(g.away,g)+socLine(g)+'</div>'}
function socBody(full){const s=S.soccer;if(!s)return '<div class="cap">Loading matches…</div>';const gs=socGames(full);
 if(!gs.length)return '<div class="cap">No matches in the main leagues on ESPN\'s board this week.</div>';
 if(full){const by={};gs.forEach(g=>(by[g.league]=by[g.league]||[]).push(g));return SOC.filter(x=>by[x[1]]).map(x=>'<h3 class="sc-sub">'+esc(x[1])+' <span>'+by[x[1]].length+'</span></h3>'+by[x[1]].map(g=>socTile(g,false)).join('')).join('')}
 const t=ymd(new Date()),today=gs.filter(g=>g.state==='in'||ymd(new Date(g.date))===t),next=gs.filter(g=>!today.includes(g)).slice(0,12);
 return (today.length?today.map(g=>socTile(g,true)).join(''):'<div class="cap">No matches in the main leagues today.</div>')+(next.length?'<h3 class="sc-sub">Next up</h3>'+next.map(g=>socTile(g,true)).join(''):'')}
/* Golf: one leaderboard card per tournament; events that ended more than two days ago drop off. */
function golfEvents(){const s=S.golf;if(!s)return[];const now=Date.now(),ti=t=>GOLF.findIndex(x=>x[1]===t.tour);
 return s.games.filter(t=>t.state!=='post'||now-new Date(t.end||t.date)<3*864e5).sort((a,b)=>(RANK[a.state]-RANK[b.state])||(ti(a)-ti(b)))}
const flag=u=>u?'<img class="sc-fl" src="'+u+'" alt="" loading="lazy">':'';
const golfRow=(t,p)=>'<tr><td class="sc-pos">'+esc(p.pos)+'</td><td class="sc-pl">'+flag(p.flag)+esc(p.name)+'</td><td class="sc-tot">'+esc(p.score)+'</td><td>'+esc(t.state==='pre'?'':p.today)+'</td><td>'+esc(t.state==='pre'?'':p.thru)+'</td></tr>';
function golfCard(t,n){const st=t.state==='in'?'<span class="sc-live"><i></i>LIVE</span> Round '+t.round:t.state==='post'?'Final':'Starts '+dayLabel(new Date(t.date));
 const more=t.players.length>n?'<details class="sc-more"><summary>All '+t.players.length+' players</summary><table class="sc-lb"><tbody>'+t.players.slice(n).map(p=>golfRow(t,p)).join('')+'</tbody></table></details>':'';
 const started=t.state!=='pre'||t.players.some(p=>p.score&&p.score!=='E');
 return '<div class="sc-card sc-'+t.state+'"><div class="sc-ch"><div><b>'+esc(t.name)+'</b><small>'+esc(t.tour)+'</small></div><span class="sc-st">'+st+'</span></div>'+
  (started?'<table class="sc-lb"><thead><tr><th>Pos</th><th class="sc-pl">Player</th><th>Total</th><th>Today</th><th>Thru</th></tr></thead><tbody>'+t.players.slice(0,n).map(p=>golfRow(t,p)).join('')+'</tbody></table>'+more
   :'<div class="cap">'+t.players.length+' players in the field. The leaderboard starts with round 1.</div>')+'</div>'}
function golfBody(full){const s=S.golf;if(!s)return '<div class="cap">Loading leaderboards…</div>';const ev=golfEvents();
 if(!ev.length)return '<div class="cap">No tournament on the PGA Tour, LPGA, DP World Tour, Champions or LIV boards this week.</div>';return ev.map(t=>golfCard(t,full?30:10)).join('')}
/* Tennis: singles only. Today tab = live and today's matches; Matches tab = everything on the board, by tournament. */
function tenGames(full){const s=S.tennis;if(!s)return[];const t=ymd(new Date()),now=Date.now();
 /* Within live, upcoming and finished: matches with a ranked player ahead of qualifiers. */
 return s.games.filter(g=>g.state==='in'||(full?(g.state==='pre'||now-new Date(g.date)<2*864e5):ymd(new Date(g.date))===t&&(g.timed||g.state!=='pre'))).sort((a,b)=>(RANK[a.state]-RANK[b.state])||(full?0:a.top-b.top)||order(a,b))}
function tenTile(g,withEv){const d=new Date(g.date);
 const row=p=>'<div class="sc-tp'+(g.state==='post'&&!p.win?' sc-out':'')+'">'+flag(p.flag)+'<b>'+esc(p.name)+'</b>'+(p.seed?'<small>'+p.seed+'</small>':'')+'<span class="sc-sets">'+p.sets.map(x=>'<i class="'+(x.w?'w':'')+'">'+x.v+(x.tb!=null?'<sup>'+x.tb+'</sup>':'')+'</i>').join('')+'</span></div>';
 const st=g.state==='in'?'<span class="sc-live"><i></i>LIVE</span> '+esc(g.detail):g.state==='post'?'Final':g.timed?dayLabel(d)+' · '+hm(d)+' ET':dayLabel(d)+' · time not set';
 return '<div class="sc-card sc-tn sc-'+g.state+'"><div class="sc-ch"><small>'+esc((withEv?g.event+' · ':'')+g.round+(g.court?' · '+g.court:''))+'</small><span class="sc-st">'+st+'</span></div>'+g.p.map(row).join('')+'</div>'}
function tenBody(full){const s=S.tennis;if(!s)return '<div class="cap">Loading matches…</div>';const gs=tenGames(full);
 if(!gs.length)return '<div class="cap">'+(full?'No singles matches on the ATP or WTA boards right now.':'No singles matches on the ATP or WTA boards today. The Matches tab has the rest of the week.')+'</div>';
 if(full){const by={};gs.forEach(g=>{const k=g.tour+' · '+g.event;(by[k]=by[k]||[]).push(g)});return Object.keys(by).map(k=>'<h3 class="sc-sub">'+esc(k)+' <span>'+by[k].length+'</span></h3>'+by[k].map(g=>tenTile(g,false)).join('')).join('')}
 const lim=24;return gs.slice(0,lim).map(g=>tenTile(g,true)).join('')+(gs.length>lim?'<div class="cap">'+(gs.length-lim)+' more matches today are on the Matches tab.</div>':'')}
const BODYX={soccer:socBody,golf:golfBody,tennis:tenBody};
const TITLEX={soccer:["Today's matches",'Matches and lines'],golf:['Leaderboards','Leaderboards'],tennis:["Today's matches",'All matches']};

function body(lg,full){if(BODYX[lg])return BODYX[lg](full);const gs=games(lg),s=S[lg];
 if(!s)return '<div class="cap">Loading scores…</div>';
 if(!gs.length)return `<div class="cap">No ${lg.toUpperCase()} games on ESPN's board right now.</div>`;
 return gs.map(g=>tile(lg,g)).join('')}
function title(lg,full){if(TITLEX[lg])return TITLEX[lg][full?1:0];const s=S[lg];return lg==='nfl'?`This week's matchups${s&&s.week?` <span>Week ${s.week}</span>`:''}`:`Today's games`}
function html(lg,full){if(!URL[lg]&&!EXTRA[lg])return '';if(!S[lg])load(lg);
 return `<section class="sc"><h2 class="sc-h">${title(lg,full)}</h2><div id="sc-${lg}" class="sc-list" data-full="${full?1:''}">${body(lg,full)}</div></section>`}
/* Only the tiles repaint, so open sheets and scroll position stay put. */
function paint(lg){if(opts.onUpdate)try{opts.onUpdate(lg)}catch(_){}
 const el=document.getElementById('sc-'+lg);if(!el)return;const full=!!el.dataset.full;
 /* Keep an opened "all players" list open across repaints. */
 const open=[...el.querySelectorAll('details')].map(d=>d.open);
 el.innerHTML=body(lg,full);el.querySelectorAll('details').forEach((d,i)=>{if(open[i])d.open=true});
 const h=el.previousElementSibling;if(h)h.innerHTML=title(lg,full)}
/* NBA and NFL always poll: 20 s while a game is live or about to start, 5 min otherwise, 2 min when the tab is hidden.
   Soccer, golf and tennis poll only once their tab has been opened (soccer alone is 14 requests a round): every 60 s while
   something there is live, otherwise every 5 minutes. */
const live=lg=>!!S[lg]&&S[lg].games.some(g=>g.state==='in');
function next(){const now=Date.now(),hot=['nba','nfl'].some(lg=>S[lg]&&S[lg].games.some(g=>g.state==='in'||(g.state==='pre'&&new Date(g.date)-now<15*60e3&&new Date(g.date)-now>-60*60e3)));
 return document.hidden?120e3:hot?20e3:Object.keys(EXTRA).some(live)?60e3:300e3}
async function tick(){const now=Date.now(),xs=Object.keys(EXTRA).filter(lg=>S[lg]&&now-S[lg].at>=(live(lg)?55e3:295e3));
 await Promise.all([...Object.keys(URL),...xs].map(load));setTimeout(tick,next())}
function start(o){opts=o||{};tick();document.addEventListener('visibilitychange',()=>{if(!document.hidden)[...Object.keys(URL),...Object.keys(EXTRA).filter(lg=>S[lg])].forEach(load)})}
/* When a sport's board was last read and what it holds; the page banner and titles use it. */
function info(lg){const s=S[lg];if(!s)return null;
 return{at:s.at,live:live(lg),n:(lg==='soccer'?socGames(false):lg==='golf'?golfEvents():lg==='tennis'?tenGames(false):games(lg)).length}}
window.SCORES={start,html,info,has:lg=>!!(URL[lg]||EXTRA[lg]),_norm:norm,_normSoc:normSoc,_normGolf:normGolf,_normTen:normTen};
})();
