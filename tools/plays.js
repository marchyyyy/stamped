/* Stamped plays -> data/plays_nba.json (owner, 2026-11-15, rule 8): "give the number that you think, after we run our data, is
   doable ... it also has to be in the negative 200 and up ... plays most likely to hit ... I know there won't be many."
   A play needs two things: a price of -200 or longer, and a source that beat the price when tested.
     plays     NBA team model against the opening line, 5+ point edge (tools/tune.js), when today's price is -200 or longer.
               Test (walk-forward, 2025-27, opening prices, -200 or longer): 185-179, +3.5% on 364 picks; first half of the file
               +9.8%, second half -6.6%; the line moved our way 2.5 points on average. Promising, not proven.
     near      the same model's picks priced shorter than -200 (heavy favourites): shown, not counted as plays.
     practice  the closest thing in player props to what was asked: the legs most likely to hit at the price cap (cost 58% to
               66.7%, about -140 to -200), Under side only (Kalshi No, or the DraftKings Under), where our own number agrees,
               one per team, six a day at most. Test, Nov 6-14 (dfs-review\stamped-study\plays_test.js, 14,209 legs priced
               -200 to +150): nothing beat the price. Overs lost most (DraftKings "X+" ladders -13.7% a bet, main Overs -9.4%,
               Kalshi Yes -6.4%); Under-style legs lost least (DraftKings Under -3.0%, Kalshi No -2.8%); our game-log number
               added nothing to the price. So these are practice, graded every night at the price first shown.
     numbers   the Stamped number for every posted prop: each of his last 25 games rescaled to tonight's expected minutes
               (0.6 x last-5 average + 0.4 x last-10), newer games weighted more. Shown on the cards as information.
   Late-news prop leans (tools/track.js, rule 3) stay where they are and join the plays list on the page when priced -200 or longer.
     node tools/plays.js [--no-push]        after tools/props.js, tools/kalshi.js and tools/tune.js --today (tools/refresh.js)
   Local state (what was shown, at what price) lives in live/.cache/plays-nba.json; the graded record is in the published file. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.join(__dirname,'..'),OUT='data/plays_nba.json',STATE=path.join(ROOT,'live','.cache','plays-nba.json');
const push=!process.argv.includes('--no-push');
const UA={'User-Agent':'StampedProjections/1.0 (personal use; github.com/marchyyyy/stamped)'};
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] plays nba: ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rd=f=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,f),'utf8'))}catch(e){return null}};
const imp=o=>o>0?100/(o+100):-o/(-o+100),fee=p=>Math.min(.99,p+.07*p*(1-p)),am=c=>c>=.5?Math.round(-100*c/(1-c)):Math.round(100*(1-c)/c);
const start=w=>Date.parse(w+':00-05:00'),etDay=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const stamp=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET';
/* Same key as tools/kalshi.js and the page: no accents, no Jr./III, letters only. */
const nk=n=>String(n||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/(jr|sr|ii|iii|iv|v).?/g,'').replace(/[^a-z]/g,'');
const CAP=-200,LO=.58,HI=2/3+.0005,MAXP=6;
const WORD={points:'points',rebounds:'rebounds',assists:'assists',threes:'threes',PRA:'points + rebounds + assists'};

/* The Stamped number. */
const Phi=z=>{const t=1/(1+.2316419*Math.abs(z)),d=.3989423*Math.exp(-z*z/2),p=d*t*(.3193815+t*(-.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return z>0?1-p:p};
function model(p,stat){const g=[...(p.games||[]),...(p.past||[])].filter(x=>x.min>=5&&x.s&&x.s[stat]!=null).slice(0,25);if(g.length<5)return null;
 const mins=g.map(x=>x.min),a=(arr,n)=>{const s=arr.slice(0,n);return s.reduce((q,x)=>q+x,0)/s.length},m=.6*a(mins,5)+.4*a(mins,10);
 const xs=g.map((x,i)=>({v:x.s[stat]/x.min*m,w:Math.pow(.93,i)})),W=xs.reduce((q,x)=>q+x.w,0),mu=xs.reduce((q,x)=>q+x.w*x.v,0)/W;
 const sd=Math.max(Math.sqrt(xs.reduce((q,x)=>q+x.w*(x.v-mu)**2,0)/W),Math.sqrt(Math.max(mu,.5))*.8),neff=W*W/xs.reduce((q,x)=>q+x.w*x.w,0);
 return{mu,m,n:g.length,pGE:T=>{const emp=xs.reduce((q,x)=>q+(x.v>=T-.25?x.w:0),0)/W,nor=1-Phi((T-.5-mu)/sd);return (neff*emp+5*nor)/(neff+5)}}}

async function get(u){for(let i=0;i<3;i++){try{const r=await fetch(u,{headers:UA});if(r.ok)return r.json();if(r.status===404)return null}catch(e){}await sleep(700*(i+1))}return null}
function git(a){return cp.execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
/* Final box score of a game: every player's line and the winner; null until the game is final. */
async function final(id){const f=path.join(ROOT,'live','.cache',`nba-${id}.json`);let s=null;try{s=JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){}
 const done=x=>{const c=x&&x.header&&x.header.competitions&&x.header.competitions[0];return c&&c.status&&c.status.type&&c.status.type.completed?c:null};
 if(!done(s)){s=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`);await sleep(120)}
 const c=done(s);if(!c)return null;const box={};
 ((s.boxscore&&s.boxscore.players)||[]).forEach(T=>{const st=T.statistics&&T.statistics[0];if(!st)return;const K=st.keys||[];
  (st.athletes||[]).forEach(a=>{const v=k=>parseFloat(String((a.stats||[])[K.indexOf(k)]||'').split('-')[0]),m=v('minutes');if(!(m>0))return;
   const pts=v('points'),reb=v('rebounds'),ast=v('assists');box[a.athlete.id]={points:pts,rebounds:reb,assists:ast,threes:v('threePointFieldGoalsMade-threePointFieldGoalsAttempted'),PRA:pts+reb+ast}})});
 const w=c.competitors.find(x=>x.winner);return{box,winner:w?w.homeAway:null}}

(async()=>{
 const D=rd('data/nba_today.json');if(!D){log('data/nba_today.json is missing; nothing written.');process.exit(1)}
 const K=(rd('data/kalshi_nba.json')||{}).props||{},TS=(rd('data/team_signals_nba.json')||{}).games||[];
 const now=Date.now(),today=etDay(now),G=Object.fromEntries(D.games.map(g=>[g.id,g])),pre=g=>g&&g.status==='pre'&&start(g.when)>now;
 let st={days:{}};try{st=JSON.parse(fs.readFileSync(STATE,'utf8'))}catch(e){}
 const day=st.days[today]=st.days[today]||{recs:{}},keep=(k,r)=>{if(!day.recs[k])day.recs[k]={...r,t:now};return day.recs[k]};

 /* 1. Team model against the opening line. */
 const plays=[],near=[];
 for(const s of TS){const g=G[s.id];if(!s.pick||!pre(g))continue;const h=s.side==='home',t=h?g.home:g.away,o=h?g.away:g.home,price=(s.now&&(h?s.now.h:s.now.a))??(h?s.open.h:s.open.a),open=h?s.open.h:s.open.a;
  if(price==null)continue;const mk=s.now&&s.now.p!=null?(h?s.now.p:1-s.now.p):(h?s.open.p:1-s.open.p),md=h?s.model:1-s.model;
  const r={kind:'team',key:'team|'+s.id,gid:s.id,when:g.when,team:t.n,abbr:t.abbr,logo:t.logo,opp:o.n,oppAbbr:o.abbr,home:h,label:`${t.n} to win`,price,open,book:s.book||g.book||'DraftKings',
   pct:Math.round(md*100),mkt:Math.round(mk*100),edge:+(s.edge*100).toFixed(1),missing:[...((s.missing&&s.missing.home)||[]),...((s.missing&&s.missing.away)||[])].slice(0,4)};
  if(price>=CAP)plays.push({...r,price:keep(r.key,{kind:'team',gid:s.id,side:s.side,label:r.label,team:t.n,abbr:t.abbr,price,when:g.when}).price,now:price});else near.push(r)}

 /* 2. Stamped numbers, and the practice list. The game-log number cannot see a role change, so the practice list leaves out
    any team with a regular out or a status change today (first build, 2026-11-15: it offered Unders on Reed Sheppard the
    night he became a starter and on LeBron James in his first game back), anyone who has not played in the last 6 days, and
    any leg where our chance is 15+ points above the market's (the market knows something the game log does not). */
 const TR=rd('data/track_nba.json')||{},moved=new Set((TR.news||[]).map(x=>x.abbr));
 for(const s of TS){const g=G[s.id];if(!g||!s.missing)continue;if((s.missing.home||[]).length)moved.add(g.home.abbr);if((s.missing.away||[]).length)moved.add(g.away.abbr)}
 for(const g of D.games)for(const sd of ['home','away'])if(((g.injuries&&g.injuries[sd])||[]).some(x=>/day|quest|doubt/i.test(x.status)))moved.add(g[sd].abbr);
 const numbers={},cand=[];
 for(const p of D.players){const g=G[p.gameId];
  for(const q of p.props||[]){const M=model(p,q.stat);if(!M)continue;numbers[p.espnId+'|'+q.stat]={n:+M.mu.toFixed(1),p:Math.round(100*M.pGE(Math.floor(q.line)+1))};
   /* Threes are left out: Kalshi No on threes lost 12% a bet in both halves of the test (236 and 295 legs). */
   if(q.stat==='threes')continue;
   if(!pre(g)||/out|doubt|quest|day/i.test(p.status||'')||moved.has(p.abbr))continue;
   const lastG=(p.games||[])[0];if(!lastG||now-Date.parse(lastG.d+'T12:00:00Z')>6.5*864e5||(p.games||[]).length<6)continue;
   const base={kind:'cap',aid:p.espnId,pid:p.id,name:p.name,abbr:p.abbr,logo:p.logo,opp:p.opp,gid:p.gameId,when:p.when,stat:q.stat,num:+M.mu.toFixed(1),mins:Math.round(M.m)};
   const add=(T,cost,mid,book,how)=>{if(!(cost>=LO&&cost<=HI))return;const pm=1-M.pGE(T),mk=mid??cost-.02;if(pm<cost||pm-mk>.15)return;/* our number has to agree, and not run far ahead of the market */
    cand.push({...base,T,line:T-.5,cost:+cost.toFixed(4),price:am(cost),mkt:Math.round(100*(mid??cost-.02)),our:Math.round(100*pm),book,how,label:`Under ${T-.5} ${q.stat}`})};
   if(q.under!=null&&q.odds!=null){const f=imp(q.under)/(imp(q.under)+imp(q.odds));add(Math.floor(q.line)+1,imp(q.under),f,'DraftKings','DraftKings Under (via ESPN)')}
   const kq=K[nk(p.name)+'|'+q.stat];if(kq)for(const [T,x] of Object.entries(kq)){if(x.na==null||x.nb==null||x.na-x.nb>.05||!(x.vol>0))continue;
    add(+T,fee(x.na),(x.na+x.nb)/2,'Kalshi',`Kalshi No on ${T}+ at ${Math.round(fee(x.na)*100)}¢ with the fee`)}}}
 /* Already shown today stays (same price, so the record is honest); then the most likely by the market's own number, one per team. */
 const stNow=Object.fromEntries(D.players.map(p=>[p.espnId,p.status||'']));
 const shown=Object.entries(day.recs).filter(([k,r])=>r.kind==='cap'&&pre(G[r.gid])&&!/out|doubt/i.test(stNow[r.aid]||'')).map(([k,r])=>({...r,key:k})),teams=new Set(shown.map(r=>r.abbr)),practice=[...shown];
 cand.sort((a,b)=>b.mkt-a.mkt||b.our-a.our);
 for(const c of cand){if(practice.length>=MAXP)break;if(teams.has(c.abbr))continue;teams.add(c.abbr);const key=`cap|${c.aid}|${c.stat}|${c.T}`;practice.push({...keep(key,c),key})}
 practice.sort((a,b)=>a.when<b.when?-1:a.when>b.when?1:b.mkt-a.mkt);

 /* 3. Grade finished days. A player who did not play is void, like the books. */
 const fin={};
 for(const [d,x] of Object.entries(st.days)){if(x.done)continue;const ids=[...new Set(Object.values(x.recs).map(r=>r.gid))];if(!ids.length){if(d<today)x.done=1;continue}
  if(Math.max(...Object.values(x.recs).map(r=>start(r.when)))>now-2.2*36e5)continue;let all=true;
  for(const id of ids){if(fin[id]===undefined)fin[id]=await final(id);if(!fin[id])all=false}
  if(!all)continue;
  for(const r of Object.values(x.recs)){const F=fin[r.gid];if(r.kind==='team'){r.res=F.winner?(F.winner===r.side?'W':'L'):'V'}else{const b=F.box[r.aid];r.v=b?b[r.stat]:null;r.res=b?(b[r.stat]<r.T?'W':'L'):'V'}
   const c=r.kind==='team'?imp(r.price):r.cost;r.u=r.res==='W'?+(1/c-1).toFixed(3):r.res==='L'?-1:0}
  x.done=1;log(`Graded ${d}: ${Object.values(x.recs).map(r=>r.res).join('')}.`)}
 const cat=k=>{const o={n:0,w:0,l:0,u:0};for(const x of Object.values(st.days))if(x.done)for(const r of Object.values(x.recs))if(r.kind===k&&r.res&&r.res!=='V'){o.n++;r.res==='W'?o.w++:o.l++;o.u+=r.u}o.u=+o.u.toFixed(2);return o};
 const gd=Object.keys(st.days).filter(d=>st.days[d].done&&Object.keys(st.days[d].recs).length).sort(),last=gd[gd.length-1];
 const record={since:Object.keys(st.days).sort()[0],nights:gd.length,team:cat('team'),practice:cat('cap'),
  last:last?{d:last,rows:Object.values(st.days[last].recs).map(r=>({kind:r.kind,label:r.label,name:r.name||r.team,abbr:r.abbr,price:r.price,res:r.res,v:r.v??null,u:r.u}))}:null};
 Object.keys(st.days).sort().slice(0,-60).forEach(d=>delete st.days[d]);
 fs.mkdirSync(path.dirname(STATE),{recursive:true});fs.writeFileSync(STATE,JSON.stringify(st));

 const out={sport:'nba',generated:new Date().toISOString(),checked:stamp(now),date:today,rule:8,cap:CAP,plays,near,practice,numbers,record,
  test:{team:'Team model against the opening line, 5+ point edge, price -200 or longer: 185-179, +3.5% a bet on 364 past picks (first half +9.8%, second half -6.6%); the line moved our way 2.5 points on average.',
   practice:'Nov 6-14, 14,209 prop legs priced -200 to +150: nothing beat the price. Under-style legs lost about 3% a bet (DraftKings Under -3.0%, Kalshi No -2.8%); Overs lost 6% to 14%.',
   numbers:'Our game-log number added nothing to the posted price in that test, so it is shown as information.'}};
 fs.writeFileSync(path.join(ROOT,OUT),JSON.stringify(out));
 log(`Wrote ${OUT}: ${plays.length} play${plays.length===1?'':'s'}, ${near.length} shorter than ${CAP}, ${practice.length} practice, ${Object.keys(numbers).length} numbers.`);
 if(!push)return;
 try{git(['pull','-q','--rebase','--autostash']);git(['add',OUT]);if(!git(['status','--porcelain','--',OUT])){log('No change; nothing to push.');return}
  git(['commit','-q','-m',`NBA plays: ${plays.length} at ${CAP} or longer, ${practice.length} practice (${out.checked})`]);git(['push','-q','origin','main']);log('Pushed to GitHub.')}
 catch(e){log('Push failed: '+String(e.stderr||e.message).trim().split('\n').pop())}
})().catch(e=>{log('Failed: '+(e&&e.stack||e));process.exit(1)});
