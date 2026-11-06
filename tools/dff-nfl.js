/* DailyFantasyFuel NFL projections (DraftKings, all-games slate) -> data/dff_nfl_projections.csv
   Builds the same CSV as DFF's "Download Projections as CSV" button, which assembles it in the browser from the
   player rows on the page. Each run replaces the previous file, then commits and pushes it.
   Usage (repo root):  node tools/dff-nfl.js [--url <slate url>] [--no-push]
   The slate url lives in tools/dff-nfl.json; it changes every week. Scheduled by tools/dff-nfl.cmd (Task Scheduler). */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.join(__dirname,'..');
const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'dff-nfl.json'),'utf8'));
const arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null};
const URL_=arg('url')||cfg.url,OUT=path.join(ROOT,cfg.out),push=!process.argv.includes('--no-push');
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] ${m}`);

/* DFF's NFL column order (from its download handler). */
const HEAD=['first_name','last_name','position','injury_status','week','game_date','slate','team','opp','spread','over_under','implied_team_score','salary','L5_dvp_rank','L5_fppg_avg','L10_fppg_avg','szn_fppg_avg','ppg_projection','value_projection','ownership_projection'];
const ATTR=['fn','ln','pos','inj','week','start_date',null,'team','opp','spread','ou','proj_score','salary','opp_rank','l5_avg','l10_avg','szn_avg','ppg_proj','value_proj','own'];
const csvCell=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
const unent=s=>s.replace(/&amp;/g,'&').replace(/&#0?39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');

function parse(html){
 const slate=(html.match(/window\.slate\s*=\s*'([^']*)'/)||[])[1]||'';
 const rows=[];
 for(const m of html.matchAll(/<tr class="\s*projections-listing\s*"([^>]*)>/g)){
  const a={};for(const x of m[1].matchAll(/data-([a-z0-9_]+)\s*=\s*"([^"]*)"/g))a[x[1]]=unent(x[2]);
  if(a.own)a.own=String(Math.round(parseFloat(a.own)));
  rows.push(ATTR.map(k=>k===null?slate:a[k]));
 }
 return{slate,rows,games:(html.match(/(\d+)\s*GAME SLATE/i)||[])[1]||null};
}
function git(args){return cp.execFileSync('git',args,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}

(async()=>{
 const date=(URL_.match(/(\d{4}-\d{2}-\d{2})/)||[])[1];
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
 if(date&&date<new Date(Date.now()-864e5*2).toLocaleDateString('en-CA',{timeZone:'America/New_York'})){
  log(`Slate in tools/dff-nfl.json is for ${date}, which has passed. Not overwriting. Put this week's all-games slate link in tools/dff-nfl.json.`);process.exit(2)}
 log(`Fetching ${URL_}`);
 const r=await fetch(URL_,{headers:{'User-Agent':'StampedProjections/1.0 (personal use; github.com/marchyyyy/stamped)'}});
 if(!r.ok){log(`HTTP ${r.status}. Keeping the previous file.`);process.exit(1)}
 const p=parse(await r.text());
 /* Never replace good data with a broken page: a real all-games slate has hundreds of players. */
 if(p.rows.length<100){log(`Only ${p.rows.length} players found (slate "${p.slate}"). Keeping the previous file.`);process.exit(1)}
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 fs.writeFileSync(OUT,[HEAD,...p.rows].map(r=>r.map(csvCell).join(',')).join('\n')+'\n');
 const teams=new Set(p.rows.map(x=>x[7])).size;
 log(`Wrote ${path.relative(ROOT,OUT)}: ${p.rows.length} players, ${teams} teams, slate "${p.slate}"${p.games?`, ${p.games} games`:''} (old file replaced).`);
 if(!push)return;
 try{
  git(['pull','-q','--rebase','--autostash']);
  git(['add',cfg.out]);
  if(!git(['status','--porcelain','--',cfg.out])){log('No change since the last pull; nothing to push.');return}
  git(['commit','-q','-m',`DFF NFL projections refresh (${p.rows.length} players, ${today} ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})} ET)`]);
  git(['push','-q','origin','main']);log('Pushed to GitHub.');
 }catch(e){log('Git step failed: '+String(e.stderr||e.message).trim());process.exit(1)}
})().catch(e=>{log('Failed: '+(e&&e.message||e));process.exit(1)});
