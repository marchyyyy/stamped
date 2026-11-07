/* Historical games for model tuning -> live/.cache/hist-<sport>.json (local only, gitignored).
   Every completed regular-season game with final score, ESPN game summary (DraftKings pregame line in pickcenter, box
   score) and ESPN's odds history (opening and closing moneylines per provider). Downloads are cached per game.
   Usage (repo root):  node tools/hist.js --sport nfl|nba */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:d};
const SPORT=arg('sport','nfl'),CACHE=path.join(__dirname,'..','live','.cache');
const SP={nfl:{site:'football/nfl',core:'football/leagues/nfl'},nba:{site:'basketball/nba',core:'basketball/leagues/nba'}}[SPORT];
const SITE=`https://site.api.espn.com/apis/site/v2/sports/${SP.site}`,CORE=`https://sports.core.api.espn.com/v2/sports/${SP.core}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* A day's scoreboard is only cached once every game on it is final; one saved mid-slate would hide those results forever. */
const done=j=>!(j&&j.events||[]).some(e=>!(e.status&&e.status.type&&e.status.type.state==='post'));
async function get(u,key){const f=key&&path.join(CACHE,key+'.json');if(f&&fs.existsSync(f))return JSON.parse(fs.readFileSync(f,'utf8'));
 for(let i=0;i<3;i++){try{const r=await fetch(u);if(r.ok){const j=await r.json();if(f&&(!/^sched-/.test(key)||done(j))){fs.mkdirSync(CACHE,{recursive:true});fs.writeFileSync(f,JSON.stringify(j))}await sleep(60);return j}if(r.status===404)return null}catch(e){}await sleep(900*(i+1))}return null}
const num=v=>{const n=parseFloat(v);return isNaN(n)?null:n};
const ymd=d=>d.toISOString().slice(0,10).replace(/-/g,'');
/* Schedule: NFL by season/week, NBA by date across each regular season. */
async function schedule(){const ev=[];
 if(SPORT==='nfl'){for(const season of ['2024','2025','2026'])for(let w=1;w<=18;w++){const s=await get(`${SITE}/scoreboard?dates=${season}&seasontype=2&week=${w}`,`sched-nfl-${season}-${w}`);
  ((s&&s.events)||[]).forEach(e=>ev.push({e,season,week:w}))}}
 else{const ranges=[['2025','2025-10-21','2026-04-12'],['2026','2026-10-20',new Date(Date.now()-864e5).toISOString().slice(0,10)]];
  for(const [season,a,b] of ranges)for(let d=new Date(a+'T12:00:00Z');d<=new Date(b+'T12:00:00Z');d=new Date(d.getTime()+864e5)){
   const s=await get(`${SITE}/scoreboard?dates=${ymd(d)}`,`sched-nba-${ymd(d)}`);((s&&s.events)||[]).forEach(e=>ev.push({e,season,week:null}))}}
 return ev.filter(x=>x.e.status&&x.e.status.type&&x.e.status.type.state==='post'&&(x.e.season?x.e.season.type===2:true))}
(async()=>{
 const ev=await schedule();console.log(`${ev.length} completed games`);const out=[];let i=0;
 for(const {e,season,week} of ev){i++;if(i%50===0)process.stdout.write(`\r${i}/${ev.length}`);
  const c=e.competitions[0],H=c.competitors.find(x=>x.homeAway==='home'),A=c.competitors.find(x=>x.homeAway==='away');
  const sum=await get(`${SITE}/summary?event=${e.id}`,`${SPORT}-${e.id}`);
  const odds=await get(`${CORE}/events/${e.id}/competitions/${e.id}/odds`,`odds-${SPORT}-${e.id}`);
  const pc=((sum&&sum.pickcenter)||[]).find(p=>p.homeTeamOdds&&p.homeTeamOdds.moneyLine!=null);
  const core=((odds&&odds.items)||[]).map(it=>({prov:it.provider&&it.provider.name,
   open:{h:num(it.homeTeamOdds&&it.homeTeamOdds.open&&it.homeTeamOdds.open.moneyLine&&it.homeTeamOdds.open.moneyLine.american),a:num(it.awayTeamOdds&&it.awayTeamOdds.open&&it.awayTeamOdds.open.moneyLine&&it.awayTeamOdds.open.moneyLine.american)},
   close:{h:num(it.homeTeamOdds&&it.homeTeamOdds.close&&it.homeTeamOdds.close.moneyLine&&it.homeTeamOdds.close.moneyLine.american),a:num(it.awayTeamOdds&&it.awayTeamOdds.close&&it.awayTeamOdds.close.moneyLine&&it.awayTeamOdds.close.moneyLine.american)}}));
  out.push({id:e.id,season,week,date:e.date,neutral:!!c.neutralSite,home:{id:H.team.id,abbr:H.team.abbreviation,pts:num(H.score)},away:{id:A.team.id,abbr:A.team.abbreviation,pts:num(A.score)},
   pc:pc?{h:pc.homeTeamOdds.moneyLine,a:pc.awayTeamOdds.moneyLine,spread:pc.spread,prov:pc.provider&&pc.provider.name}:null,core})}
 fs.writeFileSync(path.join(CACHE,`hist-${SPORT}.json`),JSON.stringify(out));console.log(`\nWrote live/.cache/hist-${SPORT}.json: ${out.length} games`);
})().catch(e=>{console.error(e);process.exit(1)});
