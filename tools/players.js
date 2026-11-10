/* Player stats for search -> data/players/ (owner, 2026-11-10: any NBA or NFL player searched on the site shows his stats).
   Built from the box scores tools/hist.js already downloads (live/.cache/<sport>-<gameId>.json): every regular-season game
   of every season in the history (NBA 2025-26 on, NFL 2024 on), one row per player per game.
     data/players/<sport>.json                 index: who can be searched (id, name, team, position, seasons played)
     data/players/<sport>/<season>-<b>.json    game logs for one season, split in 16 files by athlete id (b = id % 16)
   Finished seasons never change, so only the current season's files are rewritten.
   Usage (repo root):  node tools/players.js --sport nba|nfl [--no-push]      Run by tools/refresh.js after tools/hist.js. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.join(__dirname,'..'),CACHE=path.join(ROOT,'live','.cache'),B=16;
const arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null};
const SPORT=(arg('sport')||'nba').toLowerCase(),push=!process.argv.includes('--no-push');
const SITE=`https://site.api.espn.com/apis/site/v2/sports/${SPORT==='nba'?'basketball/nba':'football/nfl'}`;
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] players ${SPORT}: ${m}`);
const etDay=iso=>new Date(iso).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const readJ=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){return d}};
function git(a){return cp.execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
const n=v=>{const x=parseFloat(v);return isNaN(x)?0:x},pair=v=>String(v||'').split(/[-\/]/).map(n);
/* Row layouts (kept as arrays to keep the files small; live/players.js names the columns the same way).
   NBA: [date, opp, result, min, pts, reb, ast, 3pm, stl, blk, to, fgm, fga, started]
   NFL: [date, opp, result, {p:[cmp,att,yds,td,int], r:[car,yds,td], c:[rec,yds,td,tgt], k:[fgm,fga,xpm,xpa], d:[tackles,sacks,int]}] */
function rowsNBA(t,base){const st=t.statistics&&t.statistics[0];if(!st)return[];const K=st.keys||[];
 return (st.athletes||[]).map(a=>{const v=k=>(a.stats||[])[K.indexOf(k)],min=n(v('minutes'));if(!(min>0))return null;const fg=pair(v('fieldGoalsMade-fieldGoalsAttempted'));
  return{id:a.athlete.id,name:a.athlete.displayName,pos:a.athlete.position&&a.athlete.position.abbreviation||'',
   row:[...base,min,n(v('points')),n(v('rebounds')),n(v('assists')),pair(v('threePointFieldGoalsMade-threePointFieldGoalsAttempted'))[0],n(v('steals')),n(v('blocks')),n(v('turnovers')),fg[0],fg[1]||0,a.starter?1:0]}}).filter(Boolean)}
function rowsNFL(t,base){const P={};
 (t.statistics||[]).forEach(c=>{const K=c.keys||[];(c.athletes||[]).forEach(a=>{const v=k=>(a.stats||[])[K.indexOf(k)],q=P[a.athlete.id]=P[a.athlete.id]||{id:a.athlete.id,name:a.athlete.displayName,s:{}};
  if(c.name==='passing'){const ca=pair(v('completions/passingAttempts'));q.s.p=[ca[0],ca[1]||0,n(v('passingYards')),n(v('passingTouchdowns')),n(v('interceptions'))]}
  else if(c.name==='rushing')q.s.r=[n(v('rushingAttempts')),n(v('rushingYards')),n(v('rushingTouchdowns'))];
  else if(c.name==='receiving')q.s.c=[n(v('receptions')),n(v('receivingYards')),n(v('receivingTouchdowns')),n(v('receivingTargets'))];
  else if(c.name==='kicking'){const fg=pair(v('fieldGoalsMade/fieldGoalAttempts')),xp=pair(v('extraPointsMade/extraPointAttempts'));q.s.k=[fg[0],fg[1]||0,xp[0],xp[1]||0]}
  else if(c.name==='defensive')q.s.d=[n(v('totalTackles')),n(v('sacks')),0];
  else if(c.name==='interceptions'){q.s.d=q.s.d||[0,0,0];q.s.d[2]=n(v('interceptions'))}})});
 /* Team totals come through with a negative id; only real players are kept. */
 return Object.values(P).filter(q=>+q.id>0&&Object.keys(q.s).length).map(q=>({id:q.id,name:q.name,pos:'',row:[...base,q.s]}))}
/* NFL box scores carry no position, so each player's comes from the team rosters (current players); the rest are read
   off what they do: passers QB, kickers K, more carries than targets RB, other pass catchers WR, defenders DEF. */
async function nflPositions(){const pos={};const T=await fetch(`${SITE}/teams`).then(r=>r.json()).catch(()=>null);
 for(const id of ((T&&T.sports&&T.sports[0].leagues[0].teams)||[]).map(x=>x.team.id)){const R=await fetch(`${SITE}/teams/${id}/roster`).then(r=>r.ok?r.json():null).catch(()=>null);
  ((R&&R.athletes)||[]).flatMap(x=>x.items?x.items:[x]).forEach(a=>{if(a.position&&a.position.abbreviation)pos[a.id]=a.position.abbreviation});await new Promise(r=>setTimeout(r,80))}
 return pos}
const guess=G=>{let p=0,r=0,c=0,k=0,d=0;G.forEach(g=>{const s=g[3];if(s.p)p+=s.p[1];if(s.r)r+=s.r[0];if(s.c)c+=s.c[3]||s.c[0];if(s.k)k+=s.k[1]+s.k[3];if(s.d)d+=s.d[0]});
 return p>=10&&p>r&&p>c?'QB':k>0&&k>=r+c?'K':d>r+c?'DEF':r>c?'RB':c>0?'WR':''};

(async()=>{
 const H=readJ(path.join(CACHE,`hist-${SPORT}.json`),null),games=H&&(Array.isArray(H)?H:H.games);
 if(!games||!games.length){log(`No history (live/.cache/hist-${SPORT}.json). Run tools/hist.js --sport ${SPORT} first.`);process.exit(1)}
 /* Nothing new since the last build (same number of finished games): leave the files alone. --force rebuilds anyway. */
 const idxF=path.join(ROOT,'data','players',`${SPORT}.json`),old=readJ(idxF,null);
 if(old&&old.games===games.length&&!process.argv.includes('--force')){log(`No new games since the last build (${games.length}). Skipped.`);return}
 const seasons={},who={};let miss=0;
 for(const g of games){const s=readJ(path.join(CACHE,`${SPORT}-${g.id}.json`),null),T=s&&s.boxscore&&s.boxscore.players;if(!T||T.length!==2){miss++;continue}
  const d=etDay(g.date);
  T.forEach((t,i)=>{const ab=t.team.abbreviation,opp=T[1-i].team.abbreviation,home=t.team.id===g.home.id,mine=home?g.home.pts:g.away.pts,theirs=home?g.away.pts:g.home.pts;
   const base=[d,`${home?'vs':'@'} ${opp}`,mine!=null&&theirs!=null?`${mine>theirs?'W':mine<theirs?'L':'T'} ${mine}-${theirs}`:''];
   (SPORT==='nba'?rowsNBA(t,base):rowsNFL(t,base)).forEach(x=>{((seasons[g.season]=seasons[g.season]||{})[x.id]=seasons[g.season][x.id]||[]).push(x.row);
    const w=who[x.id]=who[x.id]||{name:x.name,pos:x.pos,abbr:ab,last:d,seasons:new Set()};w.seasons.add(g.season);if(d>=w.last){w.last=d;w.abbr=ab;w.name=x.name;if(x.pos)w.pos=x.pos}})})}
 if(SPORT==='nfl'){const pos=await nflPositions();Object.entries(who).forEach(([id,w])=>{w.pos=pos[id]||guess(Object.values(seasons).flatMap(S=>S[id]||[]))})}
 const dir=path.join(ROOT,'data','players',SPORT);fs.mkdirSync(dir,{recursive:true});const list=Object.keys(seasons).sort(),cur=list[list.length-1];let wrote=0;
 for(const season of list){const files=Array.from({length:B},()=>({}));
  Object.entries(seasons[season]).forEach(([id,G])=>{files[+id%B][id]=G.sort((a,b)=>a[0]<b[0]?1:-1)});
  files.forEach((o,b)=>{const f=path.join(dir,`${season}-${b}.json`),txt=JSON.stringify(o);if(readJ(f,null)===null||fs.readFileSync(f,'utf8')!==txt){fs.writeFileSync(f,txt);wrote++}})}
 /* Index, newest players first so the search lists current ones on top. */
 const players=Object.entries(who).sort((a,b)=>a[1].last<b[1].last?1:a[1].last>b[1].last?-1:a[1].name<b[1].name?-1:1).map(([id,w])=>[id,w.name,w.abbr,w.pos,[...w.seasons].sort()]);
 const through=games.map(g=>etDay(g.date)).sort().pop();
 fs.writeFileSync(idxF,JSON.stringify({sport:SPORT,generated:new Date().toISOString(),through,games:games.length,buckets:B,seasons:list,current:cur,players}));
 log(`${players.length} players, ${games.length-miss} games (${list.join(', ')}), through ${through}; ${wrote} season files rewritten${miss?`; ${miss} games without a cached box score`:''}.`);
 if(!push)return;
 try{git(['pull','-q','--rebase','--autostash']);git(['add','data/players']);if(!git(['status','--porcelain','--','data/players'])){log('No change; nothing to push.');return}
  git(['commit','-q','-m',`${SPORT.toUpperCase()} player stats for search: ${players.length} players through ${through}`]);git(['push','-q','origin','main']);log('Pushed to GitHub.')}
 catch(e){log('Git step failed: '+String(e.stderr||e.message).trim());process.exit(1)}
})().catch(e=>{log('Failed: '+(e&&e.stack||e));process.exit(1)});
