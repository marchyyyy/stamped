/* Refresh controller for Stamped's NFL and NBA preview data. Run by Task Scheduler through tools/run.cmd.
     node tools/refresh.js --sport nba|nfl   full refresh: DFF projections, then games, injuries, lines, prices and checks
     node tools/refresh.js --props           3-hour refresh for both sports: games, injuries, lines and prices (DFF untouched)
     node tools/refresh.js --pregame         every 15 min: any game starting in about an hour gets a full refresh of its
                                             sport, once per start time (owner rule: freshest info 1 hour before each game)
   Log: %LOCALAPPDATA%\Stamped\refresh.log (written by run.cmd). */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),os=require('node:os');
const ROOT=path.join(__dirname,'..'),arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null},has=k=>process.argv.includes('--'+k);
const STATE=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'Stamped','pregame.json');
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] refresh: ${m}`);
const SPORTS={nba:'basketball/nba',nfl:'football/nfl'};
const run=args=>{log('node '+args.join(' '));const r=cp.spawnSync(process.execPath,args,{cwd:ROOT,stdio:'inherit'});return r.status===0};
const full=s=>{const a=run(['tools/dff.js','--sport',s]),b=run(['tools/props.js','--sport',s]);return a&&b};
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
}

(async()=>{
 if(arg('sport'))full(arg('sport'));
 else if(has('props'))Object.keys(SPORTS).forEach(s=>run(['tools/props.js','--sport',s]));
 else if(has('pregame'))await pregame();
 else log('Nothing to do. Use --sport nba|nfl, --props or --pregame.');
})().catch(e=>{log('Failed: '+(e&&e.message||e));process.exit(1)});
