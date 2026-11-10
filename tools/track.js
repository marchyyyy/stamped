/* NBA prop tracking -> data/track_nba.json: line history, late injury news, role splits and a nightly graded record.
   Why (owner, 2026-11-10): the last-5 lean lost to the posted price in the backtest, and on the Nov 9 slate the big games
   came from players whose role grew that night (a regular teammate out) and from news that landed after lines were up.
   This file adds what the lean cannot see, in real stats, and grades everything so the record on the site is the real one.
     node tools/track.js                 after tools/props.js: snapshot today's lines and injuries, role splits, grade finished days
     node tools/track.js --tick          every 15 minutes: games starting within 4 hours get a light check (injury report, prop board)
                                         (--hours N widens that window, for testing)
     node tools/track.js --backfill f    grade a saved nba_today.json (leans and all-lines baseline only; no line history)
     [--no-push]
   Local state (snapshots, frozen picks) lives in live/.cache/track-nba.json; the graded record lives in the published file.
   Role picks and late-news flags are practice: logged and graded here, never stamped. The lean rule itself is untouched and
   is read straight from live/props-preview.js, so the record grades exactly what the cards show. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm'),{board}=require('./board.js');
const ROOT=path.join(__dirname,'..'),OUT='data/track_nba.json',STATE=path.join(ROOT,'live','.cache','track-nba.json');
const has=k=>process.argv.includes('--'+k),arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null};
const TICK=has('tick'),BACK=arg('backfill'),push=!has('no-push');
const UA={'User-Agent':'StampedProjections/1.0 (personal use; github.com/marchyyyy/stamped)'};
const SITE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba',CORE='https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] track nba: ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u,tries=3){for(let i=0;i<tries;i++){try{const r=await fetch(u.replace(/^http:/,'https:'),{headers:UA});if(r.ok)return r.json();if(r.status===404)return null}catch(e){}await sleep(800*(i+1))}return null}
const etDay=iso=>new Date(iso).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const start=w=>Date.parse(w+':00-05:00'),ip=o=>o>0?100/(o+100):-o/(-o+100),r1=x=>Math.round(x*10)/10;
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const STEP={points:2,rebounds:1,assists:1,threes:1,PRA:3};
/* Injury status as a level: 0 not listed, 1 questionable / day-to-day, 2 doubtful, 3 out. */
const lvl=s=>/out|reserve|suspen/i.test(s||'')?3:/doubt/i.test(s||'')?2:/question|day|probab/i.test(s||'')?1:0;
const LV=['available','questionable','doubtful','out'];
const stamp=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET';

/* The site's own lean rule, loaded from the page script (it only touches the page inside start(), which is not called). */
function siteLean(){const w={};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'live','props-preview.js'),'utf8'),{window:w,document:{},console});
 if(!w.PREV||!w.PREV._lean)throw new Error('lean rule not found in live/props-preview.js');return w.PREV._lean}
function git(a){return cp.execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
const readJ=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){return d}};

/* A player's season: the ET dates he played and his minutes (ESPN game log), to tell a regular from a reserve and to
   split a teammate's games into with and without him. */
async function season(id){const g=await get(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/gamelog`);await sleep(100);
 if(!g||!g.names||!g.seasonTypes)return{dates:[],min:0,gp:0};
 /* This season only ("2026-27 Regular Season"): a player who has not played yet this season must not fall back to last season's log. */
 const d=new Date(),yr=d.getMonth()>=7?d.getFullYear()+1:d.getFullYear(),tag=`${yr-1}-${String(yr).slice(2)}`;
 const st=g.seasonTypes.find(s=>s.displayName.includes(tag)&&/regular season/i.test(s.displayName)&&!/play.?in/i.test(s.displayName)),mi=g.names.indexOf('minutes'),rows={};
 ((st&&st.categories)||[]).forEach(c=>(c.events||[]).forEach(e=>{rows[e.eventId]=e.stats}));
 const G=Object.entries(rows).map(([id,s])=>({d:(g.events[id]||{}).gameDate?etDay(g.events[id].gameDate):'',min:parseFloat(s[mi])||0})).filter(x=>x.d&&x.min>0);
 return{dates:G.map(x=>x.d).sort(),min:r1(avg(G.map(x=>x.min))),gp:G.length}}
/* Today's injury report for a game, by team: {abbr:{athleteId:{n,s}}}. */
async function report(g){const sum=await get(`${SITE}/summary?event=${g.id}`);await sleep(120);const I={[g.away.abbr]:{},[g.home.abbr]:{}};
 ((sum&&sum.injuries)||[]).forEach(t=>{const ab=t.team&&t.team.id===g.home.id?g.home.abbr:t.team&&t.team.id===g.away.id?g.away.abbr:null;if(!ab)return;
  (t.injuries||[]).forEach(i=>{const a=i.athlete||{};if(a.id)I[ab][a.id]={n:a.displayName,s:i.status||''}})});return I}

/* Role split: his games without a regular teammate who is out tonight, next to his games with him. */
function roleFor(p,outs){const res=[];for(const x of outs){if(x.id===p.espnId)continue;const set=new Set(x.dates),G=(p.games||[]).filter(g=>g.d&&g.s);
  const first=x.dates[0],wo=G.filter(g=>!set.has(g.d)&&g.d>first),w=G.filter(g=>set.has(g.d));if(!w.length)continue;
  /* missed: his team's most recent games in a row without the teammate (0 = tonight is the first). */
  let missed=0;for(const g of G){if(set.has(g.d))break;missed++}
  const stats=p.props.map(q=>q.stat),s={};stats.forEach(k=>{s[k]=[wo.length?r1(avg(wo.map(g=>g.s[k]||0))):null,r1(avg(w.map(g=>g.s[k]||0)))]});
  res.push({name:x.name,st:LV[x.lv],xmin:x.min,missed,n:wo.length,wn:w.length,min:[wo.length?r1(avg(wo.map(g=>g.min||0))):null,r1(avg(w.map(g=>g.min||0)))],s,
   v:Object.fromEntries(stats.map(k=>[k,wo.slice(0,8).map(g=>g.s[k]||0)]))})}
 /* The teammate who matters most first: most minutes of his own. */
 return res.sort((a,b)=>b.xmin-a.xmin)}
/* Role pick (practice): a regular teammate went out in the last 3 games, and in the games without him this player cleared
   tonight's line most of the time with room to spare. The alt is the highest rung of DraftKings' ladder he still cleared
   in three of every four of those games, priced under +300. */
function rolePick(p,pr,R){const x=(R||[]).find(r=>r.missed<=3&&r.n>=2);if(!x)return null;const v=x.v[pr.stat]||[],n=v.length,L=pr.line;if(n<2)return null;
 const k=v.filter(y=>y>L).length,a=avg(v);if(k/n<.6||a-L<(STEP[pr.stat]||1)*.5)return null;if(x.min[0]!=null&&x.min[0]<x.min[1])return null;
 const need=Math.ceil(.75*n),alt=(pr.alts||[]).filter(r=>r.t>Math.floor(L)+1&&r.odds!=null&&r.odds<300&&v.filter(y=>y>=r.t).length>=need&&a>=r.t).sort((x1,y1)=>y1.t-x1.t)[0];
 return{side:'Over',line:L,odds:pr.odds,k,n,avg:r1(a),with:x.name,alt:alt?{t:alt.t,odds:alt.odds,k:v.filter(y=>y>=alt.t).length}:null}}

/* Grade a day's frozen picks against the box scores. Each category is logged at the posted price, 1 unit a pick. */
const CATS=['lean','leanOver','leanUnder','role','roleAlt','news','allOver','allUnder'];
const pay=o=>o>0?o/100:100/-o;
async function grade(day){const gids=[...new Set(Object.values(day.picks).map(p=>p.gid))],box={};
 for(const gid of gids){const s=await get(`${SITE}/summary?event=${gid}`);await sleep(150);const c=s&&s.header&&s.header.competitions&&s.header.competitions[0];
  if(!c||!c.status||!c.status.type||!c.status.type.completed)return null;
  ((s.boxscore&&s.boxscore.players)||[]).forEach(t=>{const st=t.statistics&&t.statistics[0];if(!st)return;const K=st.keys||[];
   (st.athletes||[]).forEach(a=>{const v=k=>parseFloat(String((a.stats||[])[K.indexOf(k)]||'').split('-')[0]),m=v('minutes');if(!(m>0))return;
    const pts=v('points'),reb=v('rebounds'),ast=v('assists');box[a.athlete.id]={points:pts,rebounds:reb,assists:ast,threes:v('threePointFieldGoalsMade-threePointFieldGoalsAttempted'),PRA:pts+reb+ast}})})}
 const C=Object.fromEntries(CATS.map(c=>[c,{n:0,w:0,l:0,u:0}])),rows=[];
 const add=(c,win,odds)=>{const o=C[c];o.n++;if(win){o.w++;if(odds!=null)o.u+=pay(odds)}else{o.l++;if(odds!=null)o.u-=1}};
 for(const p of Object.values(day.picks)){const b=box[p.aid];if(!b||b[p.stat]==null||b[p.stat]===p.line)continue;const v=b[p.stat],over=v>p.line;
  if(p.o!=null)add('allOver',over,p.o);if(p.u!=null)add('allUnder',!over,p.u);
  const row=(cat,side,line,odds,win)=>rows.push({name:p.name,abbr:p.abbr,stat:p.stat,cat,side,line,odds,v,win});
  if(p.lean){const win=p.lean==='Over'?over:!over;add('lean',win,p.lp);add(p.lean==='Over'?'leanOver':'leanUnder',win,p.lp);row('lean',p.lean,p.line,p.lp,win)}
  if(p.role){add('role',over,p.o);row('role','Over',p.line,p.o,over);if(p.ralt){const w=v>=p.ralt.t;add('roleAlt',w,p.ralt.odds);row('roleAlt','Over',p.ralt.t-.5,p.ralt.odds,w)}}
  if(p.news){const win=p.news==='Over'?over:!over,od=p.news==='Over'?p.o:p.u;add('news',win,od);row('news',p.news,p.line,od,win)}}
 Object.values(C).forEach(o=>{o.u=Math.round(o.u*100)/100});return{cats:C,rows}}

(async()=>{
 const D=readJ(BACK||path.join(ROOT,'data','nba_today.json'),null);if(!D||!D.games){log('No NBA data file. Nothing to do.');return}
 const now=Date.now(),date=(D.dates&&D.dates[0])||etDay(now),lean=siteLean();
 const ST=BACK?{days:{}}:readJ(STATE,{days:{}}),day=ST.days[date]=ST.days[date]||{snaps:[],picks:{},news:[],sea:{}};
 const pub=readJ(path.join(ROOT,OUT),{}),grades=pub.grades?JSON.parse(JSON.stringify(pub.grades)):{since:null,days:[]};
 /* A backfill grades only games that had not started when the file was saved (in-game lines are a different market). */
 const games=D.games.filter(g=>BACK?g.status==='pre':(g.status!=='post'&&start(g.when)>now)),near=games.filter(g=>start(g.when)<now+(+arg('hours')||4)*36e5);
 if(TICK&&!near.length){log('No game starts within 4 hours. Skipped.');return}
 const live=TICK?near:games,liveIds=new Set(live.map(g=>g.id));
 /* 1. Snapshot: every posted line with both prices, and each team's injury report. The full run reads the lines props.js
       just wrote; the tick reads the board itself (lines and prices only, no game logs). */
 const L={},I={};
 if(!BACK){
  for(const g of live)Object.assign(I,await report(g));
  if(TICK){for(const g of live){const B=await board(get,sleep,CORE,board.NBA,g.id);
    Object.entries(B.lines).forEach(([aid,S])=>Object.entries(S).forEach(([stat,line])=>{const q=B.ou[aid]&&B.ou[aid][stat],m=B.miles[aid]&&B.miles[aid][stat]&&B.miles[aid][stat][Math.floor(line)+1];
     L[`${aid}|${stat}`]=[line,q?q.o:m!=null?m:null,q?q.u:null]}))}}
  else D.players.filter(p=>liveIds.has(p.gameId)).forEach(p=>p.props.forEach(q=>{L[`${p.espnId}|${q.stat}`]=[q.line,q.odds,q.under]}));
  /* 2. News: a status that changed since the last snapshot that covered the team (any day, so an old injury is not news). */
  const prevFor=ab=>{const days=Object.keys(ST.days).sort().reverse();for(const d of days){const S=ST.days[d].snaps;for(let i=S.length-1;i>=0;i--)if(S[i].I&&S[i].I[ab])return S[i].I[ab]}return null};
  for(const [ab,cur] of Object.entries(I)){const prev=prevFor(ab);if(!prev)continue;
   for(const id of new Set([...Object.keys(prev),...Object.keys(cur)])){const a=lvl(prev[id]&&prev[id].s),b=lvl(cur[id]&&cur[id].s);
    const kind=b>=2&&a<=1?'out':a>=1&&b===0?'cleared':null;if(!kind)continue;
    const sea=day.sea[id]=day.sea[id]||await season(id);if(sea.gp<3||sea.min<20)continue;
    day.news.push({t:now,abbr:ab,id,name:(cur[id]||prev[id]).n,from:LV[a],to:LV[b],kind,min:sea.min});log(`News: ${(cur[id]||prev[id]).n} (${ab}) ${LV[a]} -> ${LV[b]}`)}}
  day.snaps.push({t:now,src:TICK?'tick':'full',L,I})}
 /* 3. Role splits for players whose regular teammate is out or doubtful tonight (full run: needs the game logs). */
 let role=pub.date===date&&pub.role||{};
 if(!TICK&&!BACK){role={};const outs={};
  for(const [ab,T] of Object.entries(I))for(const [id,x] of Object.entries(T)){if(lvl(x.s)<2)continue;const sea=day.sea[id]=day.sea[id]||await season(id);
   if(sea.gp>=3&&sea.min>=20)(outs[ab]=outs[ab]||[]).push({id,name:x.n,lv:lvl(x.s),dates:sea.dates,min:sea.min})}
  D.players.filter(p=>liveIds.has(p.gameId)&&outs[p.abbr]).forEach(p=>{const R=roleFor(p,outs[p.abbr]);if(R.length)role[p.espnId]=R});
  log(`Role splits for ${Object.keys(role).length} players (${Object.values(outs).flat().map(x=>x.name).join(', ')||'no regulars out'}).`)}
 /* 4. Per line: where it opened, and what it did after the latest news about a regular teammate. A line that has not
       moved since that news is the practice flag: Over when the teammate went out, Under when he was cleared. */
 const props={},firstSeen=k=>{for(const s of day.snaps)if(s.L[k])return[...s.L[k],s.t];return null},latest=k=>{for(let i=day.snaps.length-1;i>=0;i--)if(day.snaps[i].L[k])return day.snaps[i].L[k];return null};
 const before=(k,t)=>{let v=null;for(const s of day.snaps){if(s.t>=t)break;if(s.L[k])v=s.L[k]}return v};
 const byAid=Object.fromEntries(D.players.map(p=>[p.espnId,p]));
 if(!BACK)for(const k of new Set(day.snaps.flatMap(s=>Object.keys(s.L)))){const [aid]=k.split('|'),p=byAid[aid];if(!p)continue;const o=firstSeen(k),c=latest(k),e={open:o};
  const ev=day.news.filter(n=>n.abbr===p.abbr&&n.id!==aid).sort((a,b)=>b.t-a.t)[0];
  if(ev){const b=before(k,ev.t);if(b&&c){const same=b[0]===c[0]&&(b[1]==null||c[1]==null||Math.abs(ip(b[1])-ip(c[1]))<.025);
    /* The flag is kept to scoring lines (points, PRA): a missing regular frees shots for everyone; other stats depend on who he is. */
    if(same){if(/^(points|PRA)$/.test(k.split('|')[1]))e.flag={dir:ev.kind==='out'?'Over':'Under',name:ev.name,to:ev.to,at:stamp(ev.t)}}else e.moved={from:[b[0],b[1]],to:[c[0],c[1]],name:ev.name,st:ev.to,at:stamp(ev.t)}}}
  props[k]=e}
 /* 5. Picks, frozen at tip-off: every line with its prices, the site's lean, the role pick and the news flag. */
 const rp=[];
 D.players.filter(p=>liveIds.has(p.gameId)).forEach(p=>p.props.forEach(q0=>{const k=`${p.espnId}|${q0.stat}`,c=BACK?null:latest(k),q=c?Object.assign({},q0,{line:c[0],odds:c[1],under:c[2]}):q0;
  const r=lean(p,q),side=r&&r.side&&!r.review?r.side:null,R=rolePick(p,q,role[p.espnId]),f=props[k]&&props[k].flag;
  day.picks[k]={aid:p.espnId,name:p.name,abbr:p.abbr,gid:p.gameId,when:p.when,stat:q.stat,line:q.line,o:q.odds,u:q.under,lean:side,lp:side&&r.price?r.price.odds:null,
   role:!!R,ralt:R&&R.alt?{t:R.alt.t,odds:R.alt.odds}:null,news:f?f.dir:null};
  if(R)rp.push(Object.assign({aid:p.espnId,name:p.name,abbr:p.abbr,stat:q.stat},R))}));
 /* 6. Grade every earlier day (and a backfilled one) whose games are all final, then keep 4 days of local history. */
 for(const d of Object.keys(ST.days).sort()){const X=ST.days[d];if(X.graded||(d>=etDay(now)&&!BACK)||!Object.keys(X.picks).length)continue;
  const G=await grade(X);if(!G){log(`${d}: games not final yet.`);continue}
  X.graded=true;grades.days=grades.days.filter(y=>y.d!==d).concat({d,cats:G.cats}).sort((a,b)=>a.d<b.d?-1:1);grades.since=grades.days[0].d;
  const lastD=grades.days[grades.days.length-1].d;if(d===lastD){grades.rows=G.rows;grades.rowsDate=d}
  log(`${d} graded: leans ${G.cats.lean.w}-${G.cats.lean.l} (${G.cats.lean.u>=0?'+':''}${G.cats.lean.u}u), role ${G.cats.role.w}-${G.cats.role.l}, news ${G.cats.news.w}-${G.cats.news.l}, all Overs ${G.cats.allOver.w}-${G.cats.allOver.l}.`)}
 grades.total=Object.fromEntries(CATS.map(c=>[c,grades.days.reduce((a,y)=>{const o=y.cats[c]||{n:0,w:0,l:0,u:0};return{n:a.n+o.n,w:a.w+o.w,l:a.l+o.l,u:Math.round((a.u+o.u)*100)/100}},{n:0,w:0,l:0,u:0})]));
 if(!BACK){Object.keys(ST.days).sort().slice(0,-4).forEach(d=>delete ST.days[d]);fs.mkdirSync(path.dirname(STATE),{recursive:true});fs.writeFileSync(STATE,JSON.stringify(ST))}
 /* 7. Publish. A backfill only adds to the record; today's role, news and line history stay as they were. */
 const body=BACK?{date:pub.date,role:pub.role||{},props:pub.props||{},news:pub.news||[],rp:pub.rp||[],grades}
  :{date,role,props,news:day.news.map(n=>({abbr:n.abbr,name:n.name,from:n.from,to:n.to,kind:n.kind,at:stamp(n.t)})),rp,grades};
 const sig=o=>JSON.stringify({a:o.date,b:o.role,c:o.props,d:o.news,e:o.rp,f:o.grades});
 if(pub.generated&&sig(pub)===sig(body)){log('Nothing changed.');return}
 const out=Object.assign({sport:'nba',generated:new Date().toISOString(),checked:stamp(now)},body);
 fs.writeFileSync(path.join(ROOT,OUT),JSON.stringify(out));
 log(`Wrote ${OUT}: ${Object.keys(body.role).length} role splits, ${body.rp.length} role picks, ${body.news.length} news items, ${Object.values(body.props).filter(x=>x.flag).length} unmoved-line flags, ${grades.days.length} graded days.`);
 if(!push)return;
 try{git(['pull','-q','--rebase','--autostash']);git(['add',OUT]);if(!git(['status','--porcelain','--',OUT])){log('No change; nothing to push.');return}
  git(['commit','-q','-m',`NBA prop tracking: ${body.rp.length} role picks, ${body.news.length} news, ${grades.days.length} graded days (${out.checked})`]);git(['push','-q','origin','main']);log('Pushed to GitHub.')}
 catch(e){log('Git step failed: '+String(e.stderr||e.message).trim());process.exit(1)}
})().catch(e=>{log('Failed: '+(e&&e.stack||e));process.exit(1)});
