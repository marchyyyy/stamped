/* DailyFantasyFuel projections for the Fantasy section, NFL and NBA (preview, pending owner approval).
   Reads data/dff_<sport>_projections.csv, refreshed by tools/refresh.js. DFF projects DraftKings scoring. */
(function(){
'use strict';
const SPORTS=['nfl','nba'],S={};SPORTS.forEach(s=>S[s]={rows:[],by:{},loaded:false});
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z]/g,'');
function parseCSV(t){const out=[];let row=[],cell='',q=false;
 for(let i=0;i<t.length;i++){const c=t[i];
  if(q){if(c==='"'&&t[i+1]==='"'){cell+='"';i++}else if(c==='"')q=false;else cell+=c}
  else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell);out.push(row);row=[];cell=''}else if(c!=='\r')cell+=c}
 if(cell||row.length){row.push(cell);out.push(row)}
 const h=out.shift()||[];return out.filter(r=>r.length===h.length).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])))}
function loadOne(sp){return fetch(`data/dff_${sp}_projections.csv?v=`+Date.now()).then(r=>r.ok?r.text():'').then(t=>{const X=S[sp];
 X.rows=parseCSV(t).map(r=>Object.assign(r,{proj:+r.ppg_projection,salary:+r.salary,value:+r.value_projection,name:`${r.first_name} ${r.last_name}`}));
 X.by={};X.rows.forEach(r=>{(X.by[norm(r.name)]=X.by[norm(r.name)]||[]).push(r)});X.loaded=true}).catch(()=>{S[sp].loaded=true})}
const load=()=>Promise.all(SPORTS.map(loadOne));
/* Name match; when two players share a name, the position breaks the tie. */
function find(name,pos,sp){const X=S[sp||'nfl'];if(!X)return null;const c=X.by[norm(name)]||[];return c.length>1&&pos?c.find(r=>r.position===pos)||c[0]:c[0]||null}
const money=n=>'$'+n.toLocaleString('en-US');
const INJ={Q:'Questionable',GTD:'Game-time decision',D:'Doubtful',O:'Out',IR:'Injured reserve'};
/* One line on a fantasy card. Line check only with DraftKings scoring, since DFF projects DraftKings points. */
function fanLine(p,F,sys){const X=S[p.lg];if(!X||!X.loaded)return '';const r=find(p.name,p.pos,p.lg);if(!r)return '';
 let chk='';if(sys==='dk'&&F&&F.prop){const d=r.proj-F.prop.line;chk=Math.abs(d)<1?` · about even with the ${F.prop.line} line`:` · ${d>0?'agrees with the Over':'leans Under'} on ${F.prop.line} (${d>0?'+':''}${d.toFixed(1)})`}
 return `<div class="row lv-dff"><span class="pill p-long">DFF</span><span class="cap">Projects <b>${r.proj.toFixed(1)}</b> DK pts · ${money(r.salary)} · ${r.value.toFixed(2)}x value${INJ[r.injury_status]?` · ${INJ[r.injury_status]}`:''}${chk}</span></div>`}
/* Before game day (NFL): this week's DFF board, so the projections are visible ahead of the slate. */
function previewHTML(sp){const X=S[sp||'nfl'];if(!X.rows.length)return '';const R=[...X.rows].sort((a,b)=>b.proj-a.proj),dates=[...new Set(R.map(r=>r.game_date))].sort();
 /* Under each name: where his DraftKings points came from in his last 5 ESPN box scores (real games, DraftKings scoring like DFF). */
 const src=r=>{const p=window.PREV&&PREV.player(sp,r.name),b=p&&window.fanParts&&fanParts(sp,'dk',p.games);return b?fanPartsHTML(b,` last ${b.n} → DFF projects <b>${r.proj.toFixed(1)}</b>`):''};
 const row=r=>`<div class="lv-dffrow"><div class="row between"><span><b>${r.name}</b> <span class="cap">${r.position} · ${r.team} · opp ${r.opp}${INJ[r.injury_status]?` · ${r.injury_status}`:''}</span></span><span class="mv">${r.proj.toFixed(1)} · ${money(r.salary)}</span></div>${src(r)}</div>`;
 const POS=[...new Set(R.map(r=>r.position))];
 return `<div class="inj"><div class="row between"><b>${sp==='nba'?'Tonight':'This week'} · DFF projections</b><span class="pill p-long">Preview</span></div>
  <div class="cap">DraftKings points, ${R[0].slate||'main'} slate (${dates.join(', ')}), ${R.length} players. Not picks. Under each name: his real averages over his last 5 games (ESPN box scores) and the DraftKings points they add up to, next to DFF's projection.</div>
  ${R.slice(0,10).map(row).join('')}
  ${POS.map(ps=>{const L=R.filter(r=>r.position===ps);return `<details class="lv-sec"><summary>${ps} (${L.length})</summary><div class="lv-secbody">${L.map(row).join('')}</div></details>`}).join('')}</div>`}
window.DFF={load,find,fanLine,previewHTML,state:S};
})();
