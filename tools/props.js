/* Upcoming games and player props -> data/nfl_week.json or data/nba_today.json (preview, pending owner approval).
   Sources: ESPN scoreboard (games, team logos, DraftKings spread/total), ESPN game summaries (injuries), ESPN's DraftKings
   prop board (lines; NBA "X or more" bets also carry prices, which give the Over price), ESPN game logs (each player's
   games this season), and data/dff_<sport>_projections.csv (DailyFantasyFuel). Each run replaces the file, then commits.
   Usage (repo root):  node tools/props.js --sport nfl|nba [--no-push]       Run by tools/refresh.js. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.join(__dirname,'..');
const arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null};
const SPORT=(arg('sport')||'nfl').toLowerCase(),push=!process.argv.includes('--no-push');
const UA={'User-Agent':'StampedProjections/1.0 (personal use; github.com/marchyyyy/stamped)'};
const CFG={
 nfl:{out:'data/nfl_week.json',dff:'data/dff_nfl_projections.csv',path:'football/nfl',min:20,
  /* DraftKings main over/under lines (both sides share one line, so the missing side label does not matter). */
  lines:{'Total Passing Yards (incl. overtime)':'pass yds','Total Rushing Yards (incl. overtime)':'rush yds','Total Receiving Yards (incl. overtime)':'rec yds',
   'Total Receptions (incl. overtime)':'receptions','Total Passing Touchdowns (incl. overtime)':'pass TDs'},
  miles:{'Passing Yards Milestones':'pass yds','Rushing Yards Milestones':'rush yds','Receiving Yards Milestones':'rec yds','Receptions Milestones':'receptions','Passing Touchdown Milestones':'pass TDs'},
  log:{passingYards:'pass yds',passingTouchdowns:'pass TDs',interceptions:'INT',rushingYards:'rush yds',rushingAttempts:'carries',rushingTouchdowns:'rush TDs',
   receptions:'receptions',receivingYards:'rec yds',receivingTouchdowns:'rec TDs',receivingTargets:'targets',fumblesLost:'fumbles lost'},
  /* A game in his log with no column for a category (a QB has no receiving columns) means none: count it as 0. */
  zero:['pass yds','pass TDs','INT','rush yds','rush TDs','receptions','rec yds','rec TDs']},
 nba:{out:'data/nba_today.json',dff:'data/dff_nba_projections.csv',path:'basketball/nba',min:10,
  lines:{'Total Points':'points','Total Rebounds':'rebounds','Total Assists':'assists','Total 3-Point Field Goals':'threes','Total Points, Rebounds, and Assists':'PRA'},
  miles:{'Points Milestones':'points','Rebounds Milestones':'rebounds','Assists Milestones':'assists','3-Point Field Goals Milestones':'threes','Points + Assists + Rebounds Milestones':'PRA'},
  log:{points:'points',totalRebounds:'rebounds',assists:'assists','threePointFieldGoalsMade-threePointFieldGoalsAttempted':'threes',steals:'steals',blocks:'blocks',turnovers:'turnovers',minutes:'min'}}}[SPORT];
const SITE=`https://site.api.espn.com/apis/site/v2/sports/${CFG.path}`,CORE=`https://sports.core.api.espn.com/v2/sports/${CFG.path.replace('/','/leagues/')}`;
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] props ${SPORT}: ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u,tries=3){for(let i=0;i<tries;i++){try{const r=await fetch(u.replace(/^http:/,'https:'),{headers:UA});if(r.ok)return r.json();if(r.status===404)return null}catch(e){}await sleep(800*(i+1))}return null}
const et=iso=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour==='24'?'00':p.hour}:${p.minute}`};
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z]/g,'');
const INJ={questionable:'questionable','day-to-day':'questionable',doubtful:'doubtful',out:'out','injured reserve':'out'};
const num=v=>{const n=parseFloat(v);return isNaN(n)?null:n};

function readDFF(){const f=path.join(ROOT,CFG.dff);if(!fs.existsSync(f))return[];const t=fs.readFileSync(f,'utf8').trim().split('\n'),h=t.shift().split(',');
 return t.map(l=>{const c=l.split(',');return Object.fromEntries(h.map((k,i)=>[k,c[i]]))})}
function gamelog(g){
 if(!g||!g.names||!g.seasonTypes||!g.seasonTypes.length)return[];
 const st=g.seasonTypes.find(s=>/regular/i.test(s.displayName))||g.seasonTypes[0],rows={};
 (st.categories||[]).forEach(c=>(c.events||[]).forEach(e=>{rows[e.eventId]=e.stats}));
 return Object.entries(rows).map(([id,stats])=>{const m=(g.events||{})[id]||{},s={};let min=null;
  g.names.forEach((n,i)=>{const k=CFG.log[n];if(k==null)return;const v=num(String(stats[i]).split('-')[0]);if(v==null)return;if(k==='min')min=v;else s[k]=v});
  if(SPORT==='nba'&&s.points!=null&&s.rebounds!=null&&s.assists!=null)s.PRA=s.points+s.rebounds+s.assists;
  (CFG.zero||[]).forEach(k=>{if(s[k]==null)s[k]=0});
  return{d:m.gameDate?et(m.gameDate).slice(0,10):'',vs:`${m.atVs==='@'?'@':'vs'} ${(m.opponent&&m.opponent.abbreviation)||''}`,res:m.gameResult?`${m.gameResult} ${m.score||''}`.trim():'',min,s}})
  .filter(x=>SPORT!=='nba'||x.min>0).sort((a,b)=>a.d<b.d?1:-1);
}
function git(a){return cp.execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}

(async()=>{
 const dff=readDFF(),today=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
 /* --date YYYY-MM-DD --test rebuilds a past day (finished games included, nothing pushed) to check the pipeline. */
 const TEST=process.argv.includes('--test'),dates=arg('date')?[arg('date')]:[...new Set(dff.map(r=>r.game_date))].filter(d=>d&&d>=today).sort();if(!dates.length)dates.push(today);
 const byName={};dff.forEach(r=>{if(r.position!=='DST'){const k=norm(r.first_name+' '+r.last_name);(byName[k]=byName[k]||[]).push(r)}});
 const games=[],players=[],injuries={};let boardItems=0;
 for(const d of dates){const sb=await get(`${SITE}/scoreboard?dates=${d.replace(/-/g,'')}`);
  for(const ev of (sb&&sb.events)||[]){const c=ev.competitions[0],T=x=>{const t=c.competitors.find(k=>k.homeAway===x).team;return{id:t.id,abbr:t.abbreviation,n:t.name||t.shortDisplayName,city:t.location,logo:t.logo}};
   const o=(c.odds||[])[0]||{},mlv=s=>{const x=o.moneyline&&o.moneyline[s];return x?num((x.close&&x.close.odds)||(x.open&&x.open.odds)):null};
   games.push({id:ev.id,when:et(ev.date),status:c.status&&c.status.type&&c.status.type.state,away:T('away'),home:T('home'),details:o.details||null,total:o.overUnder!=null?o.overUnder:null,
    ml:{away:mlv('away'),home:mlv('home')},book:o.provider&&o.provider.name||null,injuries:{away:[],home:[]}})}}
 log(`${games.length} games on ${dates.join(', ')}`);
 /* Team model inputs (owner, 2026-11-06): each team's points scored and allowed per game this season (ESPN), and a DvP
    matchup score: how soft (+1) or tough (-1) this opponent's defense is against the team's actual players, from DFF's
    defense-vs-position ranks, weighted by each player's projected points. */
 const ALIAS={WSH:['WAS'],LAR:['LA','LAR'],GS:['GSW','GS'],NO:['NOP','NO'],SA:['SAS','SA'],NY:['NYK','NY'],UTAH:['UTA','UTAH'],JAX:['JAC','JAX'],BKN:['BKN','BRK'],PHX:['PHX','PHO']};
 const N=SPORT==='nfl'?32:30,mid=(N+1)/2;
 for(const g of games)for(const t of [g.away,g.home]){
  const R=await get(`${SITE}/teams/${t.id}`);await sleep(100);
  const it=((R&&R.team&&R.team.record&&R.team.record.items)||[]).find(x=>x.type==='total'),st=n=>{const s=it&&(it.stats||[]).find(x=>x.name===n);return s?num(s.value):null};
  t.ppg=st('avgPointsFor');t.pa=st('avgPointsAgainst');t.gp=st('gamesPlayed');
  const codes=[t.abbr,...(ALIAS[t.abbr]||[])],rows=dff.filter(r=>codes.includes(r.team)&&!['DST','K'].includes(r.position)&&+r.ppg_projection>0&&r.L5_dvp_rank!=='');
  const w=rows.reduce((a,r)=>a+ +r.ppg_projection,0);
  t.dvp=w?{s:Math.round(rows.reduce((a,r)=>a+ +r.ppg_projection*Math.max(-1,Math.min(1,(+r.L5_dvp_rank-mid)/(mid-1))),0)/w*1000)/1000,n:rows.length}:null}
 for(const g of games){if(g.status==='post'&&!TEST)continue;
  const sum=await get(`${SITE}/summary?event=${g.id}`);await sleep(150);
  /* Injury report by team, with the reason: status, body part (and side/detail when given) and expected return. */
  const real=v=>v&&!/not specified/i.test(v)?v:'';
  ((sum&&sum.injuries)||[]).forEach(t=>{const side=t.team&&t.team.id===g.home.id?'home':t.team&&t.team.id===g.away.id?'away':null;
   (t.injuries||[]).forEach(i=>{const a=i.athlete||{},d=i.details||{},bits=[real(d.side),real(d.type),real(d.detail)].filter(Boolean);
    const why=bits.filter((b,j)=>!bits.some((o,k)=>k!==j&&o.toLowerCase().includes(b.toLowerCase())&&(o.length>b.length||k<j))).join(' ');
    const row={name:a.displayName,pos:a.position&&a.position.abbreviation,status:i.status||'',why,ret:d.returnDate||null};
    if(side)g.injuries[side].push(row);if(a.id)injuries[a.id]={status:(i.status||'').toLowerCase(),detail:[why,d.returnDate?`expected back ${d.returnDate}`:''].filter(Boolean).join(', ')}})});
  const items=[];for(let pg=1;pg<=4;pg++){const p=await get(`${CORE}/events/${g.id}/competitions/${g.id}/odds/100/propBets?lang=en&region=us&limit=1000&page=${pg}`);await sleep(150);if(!p)break;items.push(...(p.items||[]));if(pg>=(p.pageCount||1))break}
  boardItems+=items.length;
  /* The prop's athlete link is season-specific, and only that record carries the player's current team. */
  const lines={},refs={},miles={},pairs={};
  items.forEach(x=>{const ref=String((x.athlete&&x.athlete.$ref)||''),id=(ref.match(/athletes\/(\d+)/)||[])[1];if(!id)return;const tn=x.type&&x.type.name,T=x.current&&x.current.target&&x.current.target.value;
   if(CFG.lines[tn]&&T!=null){(lines[id]=lines[id]||{})[CFG.lines[tn]]=+T;refs[id]=ref;
    /* NBA lines come as an Over/Under pair with prices (NFL: no prices). Kept in board order for pairing below. */
    const pv=x.odds&&x.odds.american&&num(x.odds.american.value);if(pv!=null){const P=((pairs[id]=pairs[id]||{})[CFG.lines[tn]]=pairs[id][CFG.lines[tn]]||{});(P[+T]=P[+T]||[]).push(pv)}}
   /* "X or more" ladder for alt lines. NBA carries prices; NFL lists the same rungs without prices (kept as null). */
   const pr=x.odds&&x.odds.american&&num(x.odds.american.value);if(CFG.miles[tn]&&T!=null)((miles[id]=miles[id]||{})[CFG.miles[tn]]=miles[id][CFG.miles[tn]]||{})[+T]=pr!=null?pr:null});
  /* Main line with both prices: of the priced pairs, the one closest to even. The Over is the pair's first item (914 of
     930 pairs checked against the "X+" price); when the "X+" rung is posted, its price settles which one is the Over. */
  const ip=o=>o>0?100/(o+100):-o/(-o+100),ou={};
  Object.entries(pairs).forEach(([id,S])=>Object.entries(S).forEach(([stat,P])=>{let best=null;
   Object.entries(P).forEach(([T,v])=>{if(v.length!==2)return;let [o,u]=v;const m=miles[id]&&miles[id][stat]&&miles[id][stat][Math.floor(+T)+1];
    if(m!=null&&Math.abs(ip(u)-ip(m))<Math.abs(ip(o)-ip(m)))[o,u]=[u,o];const bal=Math.abs(ip(o)-ip(u));if(!best||bal<best.bal)best={T:+T,o,u,bal}});
   if(best){lines[id][stat]=best.T;(ou[id]=ou[id]||{})[stat]=best}}));
  for(const [aid,L] of Object.entries(lines)){
   const a=await get(refs[aid]);await sleep(120);if(!a)continue;
   const tid=(String((a.team&&a.team.$ref)||'').match(/teams\/(\d+)/)||[])[1]||'',side=tid===g.home.id?'home':tid===g.away.id?'away':null;
   const gl=gamelog(await get(`https://site.web.api.espn.com/apis/common/v3/sports/${CFG.path}/athletes/${aid}/gamelog`));await sleep(120);
   const pos=a.position&&a.position.abbreviation,cand=byName[norm(a.displayName)]||[],d=cand.length>1?cand.find(r=>r.position===pos)||cand[0]:cand[0]||null;
   const me=side?g[side]:null,op=side?g[side==='home'?'away':'home']:null,inj=injuries[aid],M=miles[aid]||{};
   players.push({id:`espn-${SPORT}-${aid}`,espnId:aid,lg:SPORT,name:a.displayName,pos,gameId:g.id,when:g.when,team:me?me.n:'',abbr:me?me.abbr:'',logo:me?me.logo:null,
    opp:op?`${side==='home'?'vs':'@'} ${op.n}`:'',oppAbbr:op?op.abbr:'',
    status:inj?(INJ[inj.status]||'active'):(d&&d.injury_status==='O'?'out':d&&d.injury_status==='Q'?'questionable':'active'),injury:inj||null,
    games:gl,
    /* Prices: the line's own Over/Under pair when posted (NBA); otherwise the Over from the "X or more" bet at the next
       whole number above the line (over 22.5 = 23+). */
    props:Object.entries(L).map(([stat,line])=>{const q=ou[aid]&&ou[aid][stat],op_=q?q.o:M[stat]&&M[stat][Math.floor(line)+1];
     return{stat,line,odds:op_!=null?op_:null,under:q?q.u:null,book:q?'DraftKings (via ESPN)':op_!=null?`DraftKings (${Math.floor(line)+1}+ via ESPN)`:'DraftKings (line via ESPN)',
      alts:Object.entries(M[stat]||{}).map(([t,o])=>({t:+t,odds:o})).sort((a,b)=>a.t-b.t)}}),
    dff:d?{proj:+d.ppg_projection,l5:+d.L5_fppg_avg,l10:+d.L10_fppg_avg,szn:+d.szn_fppg_avg,dvp:d.L5_dvp_rank!==''?+d.L5_dvp_rank:null,salary:+d.salary,value:+d.value_projection,inj:d.injury_status||''}:null,
    sources:[['ESPN game log','ok',`${gl.length} games`],['DraftKings line (via ESPN)','ok',Object.keys(L).join(', ')],...(d?[['DailyFantasyFuel','ok','projection']]:[])]});
  }
  log(`${g.away.abbr} @ ${g.home.abbr}: ${Object.keys(lines).length} players with lines, ${items.length} props on the board`);
 }
 /* Game logs for every other DFF player on these teams, found through ESPN team rosters, so the fantasy breakdown does not
    depend on prop lines being posted. Stored apart from players, so they never enter the prop checks. */
 const have=new Set(players.map(p=>norm(p.name))),want=new Map();
 dff.forEach(r=>{const k=norm(r.first_name+' '+r.last_name);if(r.position!=='DST'&&!have.has(k)&&+r.ppg_projection>0)want.set(k,r)});
 const logs=[];
 if(want.size){const roster=new Map();
  for(const g of games)for(const t of [g.away,g.home]){const R=await get(`${SITE}/teams/${t.id}/roster`);await sleep(120);
   const list=((R&&R.athletes)||[]).flatMap(x=>x.items?x.items:[x]);list.forEach(a=>roster.set(norm(a.displayName),{id:a.id,name:a.displayName,team:t}))}
  for(const [k,r] of want){const a=roster.get(k);if(!a)continue;
   const gl=gamelog(await get(`https://site.web.api.espn.com/apis/common/v3/sports/${CFG.path}/athletes/${a.id}/gamelog`));await sleep(100);
   if(gl.length)logs.push({name:a.name,pos:r.position,abbr:a.team.abbr,games:gl.slice(0,10)})}
  log(`Game logs for ${logs.length} more DFF players (of ${want.size} without prop lines).`)}
 const out={sport:SPORT,generated:new Date().toISOString(),checked:new Date().toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET',
  slate:dff[0]&&dff[0].slate||'',dates,games,players,logs};
 /* No props on any board yet (DraftKings posts NBA props in the morning): publish the games so they still show.
    Props on the board but none read: something broke, so keep the previous file. */
 if(!games.length){log('No games found. Keeping the previous file.');process.exit(1)}
 /* Boards fill in over the morning, so a few players is normal; none read from a board with props means a parse problem. */
 if(boardItems>0&&!players.length){log(`No players read from ${boardItems} props. Keeping the previous file.`);process.exit(1)}
 if(!boardItems)log('No player props posted yet for these games; publishing the games so they show as "No lines yet".');
 if(TEST){const f=path.join(require('node:os').tmpdir(),`props-${SPORT}-test.json`);fs.writeFileSync(f,JSON.stringify(out));log(`Test build: ${games.length} games, ${players.length} players -> ${f}`);return}
 fs.mkdirSync(path.join(ROOT,'data'),{recursive:true});fs.writeFileSync(path.join(ROOT,CFG.out),JSON.stringify(out));
 log(`Wrote ${CFG.out}: ${games.length} games, ${players.length} players, ${players.reduce((a,p)=>a+p.props.length,0)} lines (old file replaced).`);
 if(!push)return;
 try{git(['pull','-q','--rebase','--autostash']);git(['add',CFG.out]);if(!git(['status','--porcelain','--',CFG.out])){log('No change; nothing to push.');return}
  git(['commit','-q','-m',`${SPORT.toUpperCase()} props refresh: ${games.length} games, ${players.length} players (${out.checked})`]);git(['push','-q','origin','main']);log('Pushed to GitHub.')}
 catch(e){log('Git step failed: '+String(e.stderr||e.message).trim());process.exit(1)}
})().catch(e=>{log('Failed: '+(e&&e.message||e));process.exit(1)});
