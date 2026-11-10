/* Player stats for the search box (owner, 2026-11-10: any NBA or NFL player searched shows his stats).
   Reads data/players/ (tools/players.js: every regular-season game from ESPN box scores, NBA 2025-26 on, NFL 2024 on).
   The index (who can be searched) loads on the first keystroke; a player's game logs load when his sheet opens, one small
   file per season. Real stats only: no fantasy points, no picks. */
(function(){
'use strict';
const LGS=['nba','nfl'],IDX={},FILES={};let showSheet=null,cur=null;const more=new Set();
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
/* Search text: no accents, no dots or apostrophes (T.J. = tj, De'Aaron = deaaron), hyphens as spaces. */
const plain=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ.'’]/g,'').replace(/-/g,' ');
const day=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const seasonName=(lg,s)=>lg==='nba'?`${s}-${String(+s+1).slice(2)}`:s;
const avg=(a,d=1)=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(d):'—',sum=a=>a.reduce((x,y)=>x+y,0);
function loadIdx(lg){if(!IDX[lg])IDX[lg]={d:null,p:fetch(`data/players/${lg}.json?v=${day()}`).then(r=>r.ok?r.json():null).then(d=>{if(d){d.keys=d.players.map(p=>plain(p[1]+' '+p[2]));IDX[lg].d=d}return d}).catch(()=>null)};return IDX[lg].p}
const warm=()=>Promise.all(LGS.map(loadIdx));
/* Every word typed must be in his name or team; players who played most recently come first (index order). */
function search(t,limit){const w=plain(t).split(/\s+/).filter(Boolean),out=[];if(!w.length)return out;
 for(const lg of LGS){const D=IDX[lg]&&IDX[lg].d;if(!D)continue;let n=0;
  for(let i=0;i<D.players.length&&n<limit;i++)if(w.every(x=>D.keys[i].includes(x))){const p=D.players[i];out.push({lg,id:p[0],name:p[1],abbr:p[2],pos:p[3]});n++}}
 return out.slice(0,limit)}
/* Finished seasons are cached for good; the current season's files follow the index's "through" date. */
function loadSeason(lg,season,id){const D=IDX[lg].d,k=`${lg}/${season}-${+id%D.buckets}`;
 if(!FILES[k])FILES[k]=fetch(`data/players/${k}.json?v=${season===D.current?D.through:'1'}`).then(r=>r.ok?r.json():{}).catch(()=>({}));
 return FILES[k].then(o=>o[id]||[])}

const md=d=>d.slice(5).replace('-','/');
/* Tables sized for a phone: every column fits a 390px screen without sideways scrolling. The first column carries two
   lines (game, then result). groups is an optional row of group names above the column names: [[label, columns], ...]. */
const table=(head,rows,groups)=>`<div class="pl-w"><table class="pl-t"><thead>${groups?`<tr class="pl-g"><th></th>${groups.map(([l,n])=>`<th colspan="${n}">${l}</th>`).join('')}</tr>`:''}<tr>${head.map((h,i)=>`<th${i?' class="num"':''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>`<td${i?' class="num"':''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const game=g=>`${md(g[0])} ${esc(g[1])}<small>${esc(g[2])}</small>`;
const tiles=T=>`<div class="pl-tiles">${T.map(([v,l])=>`<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
const games=n=>`${n} game${n===1?'':'s'}`;
/* NBA row: [date, opp, result, min, pts, reb, ast, 3pm, stl, blk, to, fgm, fga, started] */
function nbaHTML(S){const col=(G,i)=>G.map(g=>g[i]),fg=G=>sum(col(G,12))?(100*sum(col(G,11))/sum(col(G,12))).toFixed(1)+'%':'—',[s0,G0]=S[0];
 const top=`<div class="panel"><h4>${esc(s0)} per game · ${games(G0.length)}</h4>${tiles([[avg(col(G0,4)),'PTS'],[avg(col(G0,5)),'REB'],[avg(col(G0,6)),'AST'],[avg(col(G0,7)),'3PM']])}${tiles([[avg(col(G0,3)),'MIN'],[avg(col(G0,8)),'STL'],[avg(col(G0,9)),'BLK'],[fg(G0),'FG']])}</div>`;
 const by=S.length>1?`<div class="panel"><h4>By season, per game</h4>${table(['Season','GP','MIN','PTS','REB','AST','3PM'],S.map(([s,G])=>[esc(s),G.length,avg(col(G,3)),`<b>${avg(col(G,4))}</b>`,avg(col(G,5)),avg(col(G,6)),avg(col(G,7))]))}</div>`:'';
 return top+by+S.map(([s,G])=>log(s,G,['Game','MIN','PTS','REB','AST','3PM','STL','BLK'],g=>[game(g),g[3],`<b>${g[4]}</b>`,g[5],g[6],g[7],g[8],g[9]])).join('')}
/* NFL row: [date, opp, result, {p:[cmp,att,yds,td,int], r:[car,yds,td], c:[rec,yds,td,tgt], k:[fgm,fga,xpm,xpa], d:[tackles,sacks,int]}]
   Per group: column names, a row's cells (also used for season totals), the headline tiles, and what counts as playing. */
const r1=x=>Math.round(x*10)/10,per=(x,n)=>n?(x/n).toFixed(1):'—';
const NFL={p:{name:'Passing',h:['C/A','YDS','TD','INT'],v:x=>[`${x[0]}/${x[1]}`,`<b>${x[2]}</b>`,x[3],x[4]],use:x=>x[1]>0,t:(x,n)=>[[x[2],'PASS YDS'],[x[3],'PASS TD'],[x[4],'INT'],[per(x[2],n),'YDS / GAME']]},
 r:{name:'Rushing',h:['CAR','YDS','TD'],v:x=>[x[0],`<b>${x[1]}</b>`,x[2]],use:x=>x[0]>0,t:(x,n)=>[[x[1],'RUSH YDS'],[x[2],'RUSH TD'],[x[0],'CARRIES'],[per(x[1],n),'YDS / GAME']]},
 c:{name:'Receiving',h:['REC','TGT','YDS','TD'],v:x=>[x[0],x[3],`<b>${x[1]}</b>`,x[2]],use:x=>x[0]>0||x[3]>0,t:(x,n)=>[[x[0],'CATCHES'],[x[1],'REC YDS'],[x[2],'REC TD'],[per(x[1],n),'YDS / GAME']]},
 k:{name:'Kicking',h:['FG','XP'],v:x=>[`${x[0]}/${x[1]}`,`${x[2]}/${x[3]}`],use:x=>x[1]>0||x[3]>0,t:x=>[[`${x[0]}/${x[1]}`,'FIELD GOALS'],[`${x[2]}/${x[3]}`,'EXTRA PTS']]},
 d:{name:'Defense',h:['TKL','SACK','INT'],v:x=>[x[0],r1(x[1]),x[2]],use:x=>x[0]>0||x[1]>0||x[2]>0,t:(x,n)=>[[x[0],'TACKLES'],[r1(x[1]),'SACKS'],[x[2],'INT'],[per(x[0],n),'TKL / GAME']]}};
function nflHTML(S){const all=S.flatMap(([,G])=>G),[s0,G0]=S[0];
 /* Only what he actually does: a group shows when it has numbers in at least one game in five. */
 const groups=Object.keys(NFL).filter(k=>{const n=all.filter(g=>g[3][k]&&NFL[k].use(g[3][k])).length;return n>0&&n>=all.length*.2});if(!groups.length)groups.push(...Object.keys(NFL).filter(k=>all.some(g=>g[3][k])));
 const tot=(G,k)=>G.map(g=>g[3][k]).filter(Boolean).reduce((a,x)=>a.map((y,i)=>y+(x[i]||0)),[0,0,0,0,0]);
 const head=groups.flatMap(k=>NFL[k].h),band=groups.length>1?groups.map(k=>[NFL[k].name,NFL[k].h.length]):null;
 const top=`<div class="panel"><h4>${esc(s0)} totals · ${games(G0.length)}</h4>${groups.slice(0,2).map(k=>tiles(NFL[k].t(tot(G0,k),G0.length))).join('')}</div>`;
 const by=S.length>1?`<div class="panel"><h4>By season, totals</h4>${table(['Season','GP',...head],S.map(([s,G])=>[esc(s),G.length,...groups.flatMap(k=>NFL[k].v(tot(G,k)))]),band&&[['',1],...band])}</div>`:'';
 return top+by+S.map(([s,G])=>log(s,G,['Game',...head],g=>[game(g),...groups.flatMap(k=>g[3][k]?NFL[k].v(g[3][k]):NFL[k].h.map(()=>'—'))],band)).join('')}
/* One season's game log: the last 10 games, with a button for the rest. */
function log(s,G,head,row,band){const all=more.has(s),L=all?G:G.slice(0,10);
 return `<div class="panel"><h4>${esc(s)} game log · ${games(G.length)}</h4>${table(head,L.map(row),band)}${G.length>10?`<button class="card" data-pl-more="${esc(s)}"><div class="cap">${all?'Show the last 10 only':`Show all ${G.length} games`}</div></button>`:''}</div>`}
function sheetHTML(p,S){const lg=p.lg,D=IDX[lg].d,tonight=window.PREV&&PREV.player&&(x=>x&&x.props&&x.props.length&&x.when&&Date.parse(x.when+':00-05:00')>Date.now()?x:null)(PREV.player(lg,p.name));
 /* The props link shows only while his game has not started (the week's file keeps finished games). */
 return `<div class="shead" data-pl-sheet><div style="min-width:0;display:flex;gap:10px;align-items:center"><img src="https://a.espncdn.com/i/headshots/${lg}/players/full/${esc(p.id)}.png" alt="" width="56" height="41" style="border-radius:8px;object-fit:cover" onerror="this.remove()">
   <div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="team">${esc(p.abbr)}${p.pos?` · ${esc(p.pos)}`:''} · ${lg.toUpperCase()}</div></div></div><button class="x" id="close" aria-label="Close">×</button></div>
  ${tonight?`<button class="card" data-prev-back="${esc(lg+'|'+tonight.id)}"><div class="row between"><span class="prop">His props for the next game</span><span class="pill p-long">Open →</span></div><div class="cap">Lines, prices and checks for ${esc(tonight.opp||'his game')}.</div></button>`:''}
  ${S===null?'<div class="panel"><div class="cap">Loading his games…</div></div>':!S.length?'<div class="panel"><div class="cap">No games found for him.</div></div>':lg==='nba'?nbaHTML(S):nflHTML(S)}
  <div class="panel"><h4>Sources</h4><div class="srcs"><div>ESPN box scores, regular season, ${D.seasons.map(s=>seasonName(lg,s)).join(', ')}</div><div>Through ${esc(D.through)}</div></div></div>`}
/* first: opening his sheet. Later redraws (games loaded, show all) only happen while his sheet is still the one open. */
function draw(first){const el=document.getElementById('sheet');if(cur&&(first||el.querySelector('[data-pl-sheet]')))el.innerHTML=sheetHTML(cur.p,cur.S)}
function open(lg,id){const D=IDX[lg]&&IDX[lg].d;if(!D)return;const r=D.players.find(p=>p[0]===String(id));if(!r)return;
 const p={lg,id:r[0],name:r[1],abbr:r[2],pos:r[3]};cur={p,S:null};more.clear();draw(true);if(showSheet)showSheet();
 const seasons=[...r[4]].sort().reverse();
 Promise.all(seasons.map(s=>loadSeason(lg,s,p.id))).then(L=>{if(!cur||cur.p.id!==p.id||cur.p.lg!==lg)return;cur.S=seasons.map((s,i)=>[seasonName(lg,s),L[i]]).filter(x=>x[1].length);draw()})}
function start(h){showSheet=h&&h.showSheet;
 document.addEventListener('click',e=>{const b=e.target.closest('[data-pl-more]');if(!b||!cur)return;e.stopPropagation();const s=b.dataset.plMore;if(more.has(s))more.delete(s);else more.add(s);draw()},true)}
window.PLAYERS={start,warm,search,open};
})();
