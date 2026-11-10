/* Refresh controller for Stamped's NFL and NBA preview data. Run by Task Scheduler through tools/run.cmd.
     node tools/refresh.js --sport nba|nfl   full refresh: DFF projections, then games, injuries, lines, prices and checks
     node tools/refresh.js --props           3-hour refresh for both sports: games, injuries, lines and prices (DFF untouched)
     node tools/refresh.js --pregame         every 15 min: any game starting in about an hour gets a full refresh of its
                                             sport, once per start time (owner rule: freshest info 1 hour before each game);
                                             also refreshes the Kalshi game chart for sports with games within 36 hours
   Log: %LOCALAPPDATA%\Stamped\refresh.log (written by run.cmd). */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),os=require('node:os');
const ROOT=path.join(__dirname,'..'),arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null},has=k=>process.argv.includes('--'+k);
const STATE=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'Stamped','pregame.json');
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] refresh: ${m}`);
const SPORTS={nba:'basketball/nba',nfl:'football/nfl'};
const run=args=>{log('node '+args.join(' '));const r=cp.spawnSync(process.execPath,args,{cwd:ROOT,stdio:'inherit'});return r.status===0};
/* Kalshi runs after the props builder, which it reads to match games. Soccer has no props builder, so it rides along. */
const kalshi=s=>run(['tools/kalshi.js','--sport',s])&&(s==='soccer'||run(['tools/kalshi.js','--sport',s,'--games']));
/* "What other bettors are doing" chart (Kalshi game prices, small file): every 15-minute check refreshes it for a sport
   with a game starting in the next 36 hours or started in the last 4 (the 3-hour and full refreshes cover the rest). */
function chartTick(now){for(const s of Object.keys(SPORTS)){let D;try{D=JSON.parse(fs.readFileSync(path.join(ROOT,s==='nfl'?'data/nfl_week.json':'data/nba_today.json'),'utf8'))}catch(e){continue}
 const near=(D.games||[]).some(g=>{const t=Date.parse(g.when+':00-05:00');return g.status!=='post'&&t<now+36*36e5&&t>now-4*36e5});
 if(near)run(['tools/kalshi.js','--sport',s,'--games'])}}
/* NBA team practice picks: refresh the game history (new results), then rebuild today's signals and grade the log. */
const practice=s=>{if(s!=='nba')return true;return run(['tools/hist.js','--sport',s])&&run(['tools/tune.js','--sport',s,'--today'])};
/* NBA prop tracking (tools/track.js): after every props build, snapshot the lines and injury report, rebuild the role
   splits and grade finished nights; on the 15-minute check, a light pass (--tick) for games starting within 4 hours. */
const track=(s,tick)=>s!=='nba'||run(['tools/track.js',...(tick?['--tick']:[])]);
/* Player stats for search (tools/players.js): the game history first (NBA's is refreshed by practice above), then the
   stat files; both skip quickly when no new game has finished. */
const players=s=>(s==='nba'||run(['tools/hist.js','--sport',s]))&&run(['tools/players.js','--sport',s]);
const full=s=>{const a=run(['tools/dff.js','--sport',s]),b=run(['tools/props.js','--sport',s]),c=kalshi(s),d=practice(s);track(s);players(s);if(s==='nfl'||s==='nba')kalshi('soccer');return a&&b&&c&&d};
const ymd=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:'America/New_York'}).replace(/-/g,'');

async function pregame(){
 /* Window 45-75 minutes ahead: with a 15-minute check, every start time is caught once, 60-75 minutes before it. */
 /* --now <ISO> --dry replays the check at another time without refreshing or saving anything (for testing the schedule). */
 const dry=has('dry'),now=arg('now')?Date.parse(arg('now')):Date.now();
 /* Two refreshes per start time (owner: enough time before each game to look with confidence): about 3 hours before,
    for a full early read, and about 1 hour before, for final injuries, lines and prices. */
 const WIN=[['3h',165,195],['1h',45,75]];
 let st={};try{if(!dry)st=JSON.parse(fs.readFileSync(STATE,'utf8'))}catch(e){}
 Object.keys(st).forEach(k=>{if(st[k]<now-2*864e5)delete st[k]});
 for(const [s,p] of Object.entries(SPORTS)){
  const sb=await fetch(`https://site.api.espn.com/apis/site/v2/sports/${p}/scoreboard?dates=${ymd(now)}`).then(r=>r.ok?r.json():null).catch(()=>null);
  const pre=((sb&&sb.events)||[]).filter(e=>e.status&&e.status.type&&e.status.type.state==='pre').map(e=>Date.parse(e.date));
  const due=[];for(const [w,a,b] of WIN)[...new Set(pre)].filter(t=>t>now+a*60e3&&t<=now+b*60e3&&!st[`${s}|${w}|${t}`]).forEach(t=>due.push([w,t]));
  if(!due.length)continue;
  log(`${s.toUpperCase()}: ${due.map(([w,t])=>`${new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})} ET (${w} before)`).join(', ')}. Full refresh.`);
  if(dry)continue;full(s);due.forEach(([w,t])=>st[`${s}|${w}|${t}`]=t);
 }
 if(dry)return;fs.mkdirSync(path.dirname(STATE),{recursive:true});fs.writeFileSync(STATE,JSON.stringify(st));
 chartTick(now);track('nba',true);
}

(async()=>{
 if(arg('sport'))full(arg('sport'));
 else if(has('props')){Object.keys(SPORTS).forEach(s=>{run(['tools/props.js','--sport',s]);kalshi(s);practice(s);track(s);players(s)});kalshi('soccer')}
 else if(has('pregame'))await pregame();
 else log('Nothing to do. Use --sport nba|nfl, --props or --pregame.');
})().catch(e=>{log('Failed: '+(e&&e.message||e));process.exit(1)});
