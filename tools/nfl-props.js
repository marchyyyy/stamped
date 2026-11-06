/* This week's NFL games and player props -> data/nfl_week.json (preview, pending owner approval).
   Sources: ESPN scoreboard (games, logos, DraftKings spread/total), ESPN game summaries (injuries), ESPN's DraftKings
   prop board (lines only; ESPN does not carry NFL prop prices), ESPN game logs (each player's games this season),
   and data/dff_nfl_projections.csv (DailyFantasyFuel). Each run replaces the file, then commits and pushes it.
   Usage (repo root):  node tools/nfl-props.js [--no-push]     Scheduled by tools/dff-nfl.cmd and tools/nfl-lines.cmd. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.join(__dirname,'..'),OUT='data/nfl_week.json',DFF='data/dff_nfl_projections.csv';
const push=!process.argv.includes('--no-push');
const UA={'User-Agent':'StampedProjections/1.0 (personal use; github.com/marchyyyy/stamped)'};
const SITE='https://site.api.espn.com/apis/site/v2/sports/football/nfl',CORE='https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] nfl-props: ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u,tries=3){for(let i=0;i<tries;i++){try{const r=await fetch(u.replace(/^http:/,'https:'),{headers:UA});if(r.ok)return r.json();if(r.status===404)return null}catch(e){}await sleep(800*(i+1))}return null}
const et=iso=>{const d=new Date(iso),p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour==='24'?'00':p.hour}:${p.minute}`};
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z]/g,'');

/* DraftKings main over/under lines (both sides share one line, so the missing side label does not matter here). */
const PROP={'Total Passing Yards (incl. overtime)':'pass yds','Total Rushing Yards (incl. overtime)':'rush yds','Total Receiving Yards (incl. overtime)':'rec yds',
 'Total Receptions (incl. overtime)':'receptions','Total Passing Touchdowns (incl. overtime)':'pass TDs'};
/* ESPN game-log columns -> Stamped stat names. */
const LOG={passingYards:'pass yds',passingTouchdowns:'pass TDs',interceptions:'INT',rushingYards:'rush yds',rushingAttempts:'carries',rushingTouchdowns:'rush TDs',
 receptions:'receptions',receivingYards:'rec yds',receivingTouchdowns:'rec TDs',receivingTargets:'targets'};
const INJ={questionable:'questionable',doubtful:'doubtful',out:'out','injured reserve':'out'};

function readDFF(){if(!fs.existsSync(path.join(ROOT,DFF)))return[];const t=fs.readFileSync(path.join(ROOT,DFF),'utf8').trim().split('\n'),h=t.shift().split(',');
 return t.map(l=>{const c=l.split(',');return Object.fromEntries(h.map((k,i)=>[k,c[i]]))})}
function gamelog(g){
 if(!g||!g.names||!g.seasonTypes||!g.seasonTypes.length)return[];
 const st=g.seasonTypes[0],rows={};
 (st.categories||[]).forEach(c=>(c.events||[]).forEach(e=>{rows[e.eventId]=e.stats}));
 return Object.entries(rows).map(([id,stats])=>{const m=(g.events||{})[id]||{},s={};
  g.names.forEach((n,i)=>{if(LOG[n]!=null){const v=parseFloat(stats[i]);if(!isNaN(v))s[LOG[n]]=v}});
  return{d:(m.gameDate||'').slice(0,10),vs:`${m.atVs==='@'?'@':'vs'} ${(m.opponent&&m.opponent.abbreviation)||''}`,res:m.gameResult?`${m.gameResult} ${m.score||''}`.trim():'',week:m.week,s}})
  .sort((a,b)=>a.d<b.d?1:-1);
}
function git(a){return cp.execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}

(async()=>{
 const dff=readDFF(),dates=[...new Set(dff.map(r=>r.game_date))].filter(Boolean).sort();
 if(!dates.length){log('No DFF slate on file; nothing to build.');process.exit(1)}
 const byName={};dff.forEach(r=>{if(r.position!=='DST')(byName[norm(r.first_name+' '+r.last_name)]=byName[norm(r.first_name+' '+r.last_name)]||[]).push(r)});
 const games=[],players=[],injuries={};
 for(const d of dates){const sb=await get(`${SITE}/scoreboard?dates=${d.replace(/-/g,'')}`);
  for(const ev of (sb&&sb.events)||[]){const c=ev.competitions[0],T=x=>{const t=c.competitors.find(k=>k.homeAway===x).team;return{id:t.id,abbr:t.abbreviation,n:t.name||t.shortDisplayName,city:t.location,logo:t.logo}};
   const o=(c.odds||[])[0]||{};games.push({id:ev.id,when:et(ev.date),status:c.status&&c.status.type&&c.status.type.state,away:T('away'),home:T('home'),details:o.details||null,total:o.overUnder!=null?o.overUnder:null,book:o.provider&&o.provider.name||null})}}
 log(`${games.length} games on ${dates.join(', ')}`);
 for(const g of games){
  const sum=await get(`${SITE}/summary?event=${g.id}`);await sleep(150);
  ((sum&&sum.injuries)||[]).forEach(t=>(t.injuries||[]).forEach(i=>{const id=i.athlete&&i.athlete.id;if(id)injuries[id]={status:(i.status||'').toLowerCase(),detail:[i.type&&i.type.description,i.details&&i.details.type].filter(Boolean).join(', ')}}));
  const items=[];for(let pg=1;pg<=4;pg++){const p=await get(`${CORE}/events/${g.id}/competitions/${g.id}/odds/100/propBets?lang=en&region=us&limit=1000&page=${pg}`);await sleep(150);if(!p)break;items.push(...(p.items||[]));if(pg>=(p.pageCount||1))break}
  /* The prop's athlete link is season-specific, and only that record carries the player's current team. */
  const lines={},refs={};items.forEach(x=>{const st=PROP[x.type&&x.type.name];if(!st)return;const ref=String(x.athlete&&x.athlete.$ref||''),id=(ref.match(/athletes\/(\d+)/)||[])[1],L=x.current&&x.current.target&&x.current.target.value;
   if(id&&L!=null){(lines[id]=lines[id]||{})[st]=+L;refs[id]=ref}});
  for(const [aid,L] of Object.entries(lines)){
   const a=await get(refs[aid]);await sleep(120);if(!a)continue;
   const tid=(String((a.team&&a.team.$ref)||'').match(/teams\/(\d+)/)||[])[1]||'',side=tid===g.home.id?'home':tid===g.away.id?'away':null;
   const gl=gamelog(await get(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${aid}/gamelog`));await sleep(120);
   const pos=a.position&&a.position.abbreviation,cand=byName[norm(a.displayName)]||[],d=cand.length>1?cand.find(r=>r.position===pos)||cand[0]:cand[0]||null;
   const me=side?g[side]:null,op=side?g[side==='home'?'away':'home']:null,inj=injuries[aid];
   players.push({id:'espn-'+aid,espnId:aid,lg:'nfl',name:a.displayName,pos,gameId:g.id,when:g.when,team:me?me.n:'',abbr:me?me.abbr:'',logo:me?me.logo:null,
    opp:op?`${side==='home'?'vs':'@'} ${op.n}`:'',oppAbbr:op?op.abbr:'',
    status:inj?(INJ[inj.status]||'active'):'active',injury:inj||null,
    games:gl,props:Object.entries(L).map(([stat,line])=>({stat,line,odds:null,book:'DraftKings (line via ESPN)'})),
    dff:d?{proj:+d.ppg_projection,l5:+d.L5_fppg_avg,l10:+d.L10_fppg_avg,szn:+d.szn_fppg_avg,dvp:d.L5_dvp_rank!==''?+d.L5_dvp_rank:null,salary:+d.salary,value:+d.value_projection,inj:d.injury_status||''}:null,
    sources:[['ESPN game log','ok',`${gl.length} games`],['DraftKings line (via ESPN)','ok',Object.keys(L).join(', ')],...(d?[['DailyFantasyFuel','ok','projection']]:[])]});
  }
  log(`${g.away.abbr} @ ${g.home.abbr}: ${Object.keys(lines).length} players with lines, ${items.length} props on the board`);
 }
 const out={generated:new Date().toISOString(),checked:new Date().toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET',
  slate:dff[0]&&dff[0].slate||'',dates,games,players};
 if(players.length<20){log(`Only ${players.length} players with lines. Keeping the previous file.`);process.exit(1)}
 fs.mkdirSync(path.join(ROOT,'data'),{recursive:true});fs.writeFileSync(path.join(ROOT,OUT),JSON.stringify(out));
 log(`Wrote ${OUT}: ${games.length} games, ${players.length} players, ${players.reduce((a,p)=>a+p.props.length,0)} lines (old file replaced).`);
 if(!push)return;
 try{git(['pull','-q','--rebase','--autostash']);git(['add',OUT]);if(!git(['status','--porcelain','--',OUT])){log('No change; nothing to push.');return}
  git(['commit','-q','-m',`NFL week refresh: ${games.length} games, ${players.length} players (${out.checked})`]);git(['push','-q','origin','main']);log('Pushed to GitHub.')}
 catch(e){log('Git step failed: '+String(e.stderr||e.message).trim());process.exit(1)}
})().catch(e=>{log('Failed: '+(e&&e.message||e));process.exit(1)});
