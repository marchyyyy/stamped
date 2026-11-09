/* DailyFantasyFuel projections (DraftKings, all-games slate) -> data/dff_<sport>_projections.csv
   Builds the same CSV as DFF's "Download Projections as CSV" button, which assembles it in the browser from the
   player rows on the page. Each run replaces the previous file, then commits and pushes it.
   Usage (repo root):  node tools/dff.js [--sport nfl|nba] [--url <slate url>] [--no-push]
   The last slate link is kept in tools/dff-<sport>.json; each run looks up the current one itself. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.join(__dirname,'..');
const arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null};
const SPORT=(arg('sport')||'nfl').toLowerCase(),CFG=path.join(__dirname,`dff-${SPORT}.json`);
const cfg=fs.existsSync(CFG)?JSON.parse(fs.readFileSync(CFG,'utf8')):{url:null,out:`data/dff_${SPORT}_projections.csv`};
let URL_=arg('url')||cfg.url;const OUT=path.join(ROOT,cfg.out),push=!process.argv.includes('--no-push');
const UA={'User-Agent':'StampedProjections/1.0 (personal use; github.com/marchyyyy/stamped)'};
const ymdET=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] dff ${SPORT}: ${m}`);

/* DFF's column order per sport (from its download handler). null = the slate name. */
const COLS={
 nfl:{head:['first_name','last_name','position','injury_status','week','game_date','slate','team','opp','spread','over_under','implied_team_score','salary','L5_dvp_rank','L5_fppg_avg','L10_fppg_avg','szn_fppg_avg','ppg_projection','value_projection','ownership_projection'],
      attr:['fn','ln','pos','inj','week','start_date',null,'team','opp','spread','ou','proj_score','salary','opp_rank','l5_avg','l10_avg','szn_avg','ppg_proj','value_proj','own'],min:100},
 nba:{head:['first_name','last_name','position','position_alt','injury_status','game_date','slate','team','opp','spread','over_under','implied_team_score','salary','L5_dvp_rank','L5_fppg_avg','L10_fppg_avg','szn_fppg_avg','ppg_projection','value_projection','ownership_projection'],
      attr:['fn','ln','pos','pos_alt','inj','start_date',null,'team','opp','spread','ou','proj_score','salary','opp_rank','l5_avg','l10_avg','szn_avg','ppg_proj','value_proj','own'],min:30}};
const C=COLS[SPORT];if(!C){log('Unknown sport.');process.exit(1)}

/* Finds the current all-games DraftKings slate from the slate list DFF's own page loads (owner approved, 2026-11-06).
   Picks the non-showdown slate with the most games starting today or later, then adds players from teams missing from it. NFL Mondays start from Sunday, because the
   Sun-Mon slate (dated Sunday) is the one that still has tonight's game. */
async function findSlate(){
 const list=async d=>{const r=await fetch(`https://www.dailyfantasyfuel.com/data/slates/recent/${SPORT.toUpperCase()}/draftkings?date=${d}&url=`,{headers:UA});return r.ok?r.json():null};
 const today=ymdET(Date.now()),monday=SPORT==='nfl'&&new Date(today+'T12:00:00Z').getUTCDay()===1,from=monday?ymdET(Date.now()-864e5):today,first=await list(today);if(!first)return null;
 const days=[...new Set([from,today,...(first.dates||[]).map(x=>x.start_date)])].filter(d=>d>=from).sort().slice(0,4);
 for(const d of days){const L=d===today?first:await list(d);
  const ok=((L&&L.slates)||[]).filter(s=>!s.showdown_flag&&s.game_count>1).sort((a,b)=>b.game_count-a.game_count),best=ok[0],u=x=>`https://www.dailyfantasyfuel.com/${SPORT}/projections/draftkings/${d}?slate=${x.url}`;
  /* Some days DraftKings has no all-games slate (Nov 8 NBA: Early 2 + Main 5). The other classic slates fill in teams the biggest one misses. */
  if(best)return{url:u(best),date:d,name:best.slate_type||'Main',games:best.game_count,extra:ok.slice(1).map(u)}}
 return null}
const csvCell=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
/* DFF writes apostrophes as &#x27; (De'Aaron Fox, Ja'Kobe Walter); undecoded, those names never matched ESPN's. */
const unent=s=>s.replace(/&amp;/g,'&').replace(/&#x([0-9a-f]+);/gi,(m,h)=>String.fromCharCode(parseInt(h,16))).replace(/&#0?39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
function parse(html){
 const slate=(html.match(/window\.slate\s*=\s*'([^']*)'/)||[])[1]||'';
 const rows=[];
 for(const m of html.matchAll(/<tr class="\s*projections-listing\s*"([^>]*)>/g)){
  const a={};for(const x of m[1].matchAll(/data-([a-z0-9_]+)\s*=\s*"([^"]*)"/g))a[x[1]]=unent(x[2]);
  if(a.own)a.own=String(Math.round(parseFloat(a.own)));
  rows.push(C.attr.map(k=>k===null?slate:a[k]));
 }
 return{slate,rows,games:(html.match(/(\d+)\s*GAME SLATE/i)||[])[1]||null};
}
function git(args){return cp.execFileSync('git',args,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}

(async()=>{
 let extra=[];
 if(!arg('url')){try{const s=await findSlate();
  if(s){extra=s.extra;if(s.url!==cfg.url){cfg.url=s.url;fs.writeFileSync(CFG,JSON.stringify(cfg,null,1)+'\n')}URL_=s.url;log(`Slate found: ${s.name}, ${s.games} games, ${s.date}.`)}
  else log('No all-games slate found in the slate list; using the saved link.')}
  catch(e){log('Slate lookup failed ('+(e.message||e)+'); using the saved link.')}}
 if(!URL_){log('No slate link. Nothing to do.');process.exit(2)}
 const date=(URL_.match(/(\d{4}-\d{2}-\d{2})/)||[])[1],today=ymdET(Date.now());
 if(date&&date<ymdET(Date.now()-864e5*2)){log(`Saved slate is for ${date}, which has passed. Not overwriting.`);process.exit(2)}
 log(`Fetching ${URL_}`);
 const r=await fetch(URL_,{headers:UA});
 if(!r.ok){log(`HTTP ${r.status}. Keeping the previous file.`);process.exit(1)}
 const p=parse(await r.text());
 /* Never replace good data with a broken page. */
 if(p.rows.length<C.min){log(`Only ${p.rows.length} players found (slate "${p.slate}"). Keeping the previous file.`);process.exit(1)}
 const ti=C.head.indexOf('team'),have=new Set(p.rows.map(x=>x[ti]));
 for(const u of extra){try{const x=await fetch(u,{headers:UA});if(!x.ok)continue;
  const q=parse(await x.text()),add=q.rows.filter(r=>!have.has(r[ti]));if(!add.length)continue;
  const n=new Set(add.map(r=>r[ti]));n.forEach(t=>have.add(t));p.rows.push(...add);log(`Added ${add.length} players, ${n.size} teams from slate "${q.slate}".`)}
  catch(e){log('Extra slate failed ('+(e.message||e)+'); skipped.')}}
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 fs.writeFileSync(OUT,[C.head,...p.rows].map(r=>r.map(csvCell).join(',')).join('\n')+'\n');
 const teams=new Set(p.rows.map(x=>x[C.head.indexOf('team')])).size;
 log(`Wrote ${path.relative(ROOT,OUT)}: ${p.rows.length} players, ${teams} teams, slate "${p.slate||'Main'}"${p.games?`, ${p.games} games`:''} (old file replaced).`);
 if(!push)return;
 const files=[cfg.out,path.relative(ROOT,CFG).replace(/\\/g,'/')];
 try{
  git(['pull','-q','--rebase','--autostash']);git(['add',...files]);
  if(!git(['status','--porcelain','--',...files])){log('No change since the last pull; nothing to push.');return}
  git(['commit','-q','-m',`DFF ${SPORT.toUpperCase()} projections refresh (${p.rows.length} players, ${today} ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})} ET)`]);
  git(['push','-q','origin','main']);log('Pushed to GitHub.');
 }catch(e){log('Git step failed: '+String(e.stderr||e.message).trim());process.exit(1)}
})().catch(e=>{log('Failed: '+(e&&e.message||e));process.exit(1)});
