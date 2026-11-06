/* DailyFantasyFuel NFL projections for the Fantasy section (preview, pending owner approval).
   Reads data/dff_nfl_projections.csv, refreshed on the schedule in tools/dff-nfl.cmd. DFF projects DraftKings scoring. */
(function(){
'use strict';
const S={rows:[],by:{},loaded:false,at:null};
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z]/g,'');
function parseCSV(t){const out=[];let row=[],cell='',q=false;
 for(let i=0;i<t.length;i++){const c=t[i];
  if(q){if(c==='"'&&t[i+1]==='"'){cell+='"';i++}else if(c==='"')q=false;else cell+=c}
  else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell);out.push(row);row=[];cell=''}else if(c!=='\r')cell+=c}
 if(cell||row.length){row.push(cell);out.push(row)}
 const h=out.shift()||[];return out.filter(r=>r.length===h.length).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])))}
function load(){return fetch('data/dff_nfl_projections.csv?v='+Date.now()).then(r=>r.ok?r.text():'').then(t=>{
 S.rows=parseCSV(t).map(r=>Object.assign(r,{proj:+r.ppg_projection,salary:+r.salary,value:+r.value_projection,name:`${r.first_name} ${r.last_name}`}));
 S.by={};S.rows.forEach(r=>{(S.by[norm(r.name)]=S.by[norm(r.name)]||[]).push(r)});S.loaded=true;S.at=Date.now()}).catch(()=>{S.loaded=true})}
/* Name match; when two players share a name, the position breaks the tie. */
function find(name,pos){const c=S.by[norm(name)]||[];return c.length>1&&pos?c.find(r=>r.position===pos)||c[0]:c[0]||null}
const money=n=>'$'+n.toLocaleString('en-US');
const INJ={Q:'Questionable',D:'Doubtful',O:'Out',IR:'Injured reserve'};
/* One line on a fantasy card. Line check only with DraftKings scoring, since DFF projects DraftKings points. */
function fanLine(p,F,sys){if(p.lg!=='nfl'||!S.loaded)return '';const r=find(p.name,p.pos);if(!r)return '';
 let chk='';if(sys==='dk'&&F&&F.prop){const d=r.proj-F.prop.line;chk=Math.abs(d)<1?` · about even with the ${F.prop.line} line`:` · ${d>0?'agrees with the Over':'leans Under'} on ${F.prop.line} (${d>0?'+':''}${d.toFixed(1)})`}
 return `<div class="row lv-dff"><span class="pill p-long">DFF</span><span class="cap">Projects <b>${r.proj.toFixed(1)}</b> DK pts · ${money(r.salary)} · ${r.value.toFixed(2)}x value${INJ[r.injury_status]?` · ${INJ[r.injury_status]}`:''}${chk}</span></div>`}
/* Before game day: this week's DFF board, so the projections are visible ahead of the slate. */
function previewHTML(){if(!S.rows.length)return '';const R=[...S.rows].sort((a,b)=>b.proj-a.proj),dates=[...new Set(R.map(r=>r.game_date))].sort();
 const row=r=>`<div class="row between lv-dffrow"><span><b>${r.name}</b> <span class="cap">${r.position} · ${r.team} · opp ${r.opp}${INJ[r.injury_status]?` · ${r.injury_status}`:''}</span></span><span class="mv">${r.proj.toFixed(1)} · ${money(r.salary)}</span></div>`;
 const POS=['QB','RB','WR','TE','DST'];
 return `<div class="inj"><div class="row between"><b>This week · DFF projections</b><span class="pill p-long">Preview</span></div>
  <div class="cap">DraftKings points, ${R[0].slate} slate (${dates.join(', ')}), ${R.length} players. Not picks.</div>
  ${R.slice(0,10).map(row).join('')}
  ${POS.map(ps=>{const L=R.filter(r=>r.position===ps);return L.length?`<details class="lv-sec"><summary>${ps} (${L.length})</summary><div class="lv-secbody">${L.map(row).join('')}</div></details>`:''}).join('')}</div>`}
window.DFF={load,find,fanLine,previewHTML,state:S};
})();
