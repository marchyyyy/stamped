/* Live scoreboard tiles for the Today tab (owner, 2026-11-07: Linemate-style matchups, red live dot, scores as they happen).
   NBA shows today's games, NFL this week's (finals from earlier days drop off). Source: ESPN site scoreboard (CORS *), polled in the browser; never writes data.json. */
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
async function load(lg){
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
function body(lg){const gs=games(lg),s=S[lg];
 if(!s)return '<div class="cap">Loading scores…</div>';
 if(!gs.length)return `<div class="cap">No ${lg.toUpperCase()} games on ESPN's board right now.</div>`;
 return gs.map(g=>tile(lg,g)).join('')}
function title(lg){const s=S[lg];return lg==='nfl'?`This week's matchups${s&&s.week?` <span>Week ${s.week}</span>`:''}`:`Today's games`}
function html(lg){if(!URL[lg])return '';if(!S[lg])load(lg);
 return `<section class="sc"><h2 class="sc-h">${title(lg)}</h2><div id="sc-${lg}" class="sc-list">${body(lg)}</div></section>`}
/* Only the tiles repaint, so open sheets and scroll position stay put. */
function paint(lg){const el=document.getElementById('sc-'+lg);if(!el)return;el.innerHTML=body(lg);
 const h=el.previousElementSibling;if(h)h.innerHTML=title(lg)}
/* 20 s while a game is live or about to start, 5 min otherwise, 2 min when the tab is hidden. */
function next(){const now=Date.now(),hot=Object.values(S).some(s=>s.games.some(g=>g.state==='in'||(g.state==='pre'&&new Date(g.date)-now<15*60e3&&new Date(g.date)-now>-60*60e3)));
 return document.hidden?120e3:hot?20e3:300e3}
async function tick(){await Promise.all(Object.keys(URL).map(load));setTimeout(tick,next())}
function start(o){opts=o||{};tick();document.addEventListener('visibilitychange',()=>{if(!document.hidden)Object.keys(URL).forEach(load)})}
window.SCORES={start,html,_norm:norm};
})();
