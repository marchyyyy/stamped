/* Kalshi prices -> data/kalshi_<sport>.json (Kalshi's public market-data API; no key, no scraping).
   Games: each team's Yes bid/ask to win, plus about 3 days of hourly price history (for the heartbeat line under team bets).
   Props (NFL, NBA): every player's "X or more" market, both sides: Yes = Over, No = Under.
   --games: game markets only, with the whole history since the market opened (up to 14 days, hourly), for the
   "What other bettors are doing" chart -> data/kalshi_<sport>_games.json (small; refreshed every 15 minutes near games).
   Usage (repo root):  node tools/kalshi.js --sport nfl|nba|soccer [--games] [--no-push]      Run by tools/refresh.js. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.join(__dirname,'..'),API='https://api.elections.kalshi.com/trade-api/v2';
const arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null},push=!process.argv.includes('--no-push');
const GAMES_ONLY=process.argv.includes('--games');
const SPORT=(arg('sport')||'nfl').toLowerCase(),OUT=GAMES_ONLY?`data/kalshi_${SPORT}_games.json`:`data/kalshi_${SPORT}.json`;
const log=m=>console.log(`[${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET] kalshi ${SPORT}: ${m}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u,tries=3){for(let i=0;i<tries;i++){try{const r=await fetch(u);if(r.ok)return r.json();if(r.status===404)return null;if(r.status===429)await sleep(2000)}catch(e){}await sleep(700*(i+1))}return null}
async function markets(series){const out=[];let cursor='';for(let i=0;i<20;i++){const j=await get(`${API}/markets?series_ticker=${series}&status=open&limit=1000${cursor?`&cursor=${cursor}`:''}`);await sleep(150);if(!j)break;out.push(...(j.markets||[]));cursor=j.cursor;if(!cursor)break}return out}
const num=v=>{const n=parseFloat(v);return isNaN(n)?null:n};
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z]/g,'');
const quote=m=>({yb:num(m.yes_bid_dollars),ya:num(m.yes_ask_dollars),nb:num(m.no_bid_dollars),na:num(m.no_ask_dollars),vol:num(m.volume_fp)});
const MON={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const evDate=t=>{const m=String(t).match(/-(\d{2})([A-Z]{3})(\d{2})/);return m?`20${m[1]}-${MON[m[2]]}-${m[3]}`:null};
/* ESPN abbreviation -> codes Kalshi may use. */
const ALIAS={WSH:['WAS'],LAR:['LA','LAR'],GS:['GSW'],NO:['NOP','NO'],SA:['SAS'],NY:['NYK'],UTAH:['UTA'],JAX:['JAC','JAX'],BKN:['BKN','BRK'],PHX:['PHX','PHO']};
const codes=a=>[a,...(ALIAS[a]||[])];
const GAME={nfl:['KXNFLGAME'],nba:['KXNBAGAME'],soccer:['KXEPLGAME','KXUCLGAME','KXLALIGAGAME','KXSERIEAGAME','KXBUNDESLIGAGAME','KXLIGUE1GAME','KXMLSGAME','KXUELGAME']}[SPORT];
const PROPS={nfl:{KXNFLRECYDS:'rec yds',KXNFLRSHYDS:'rush yds',KXNFLPASSYDS:'pass yds',KXNFLREC:'receptions',KXNFLPASSTDS:'pass TDs'},
 nba:{KXNBAPTS:'points',KXNBAREB:'rebounds',KXNBAAST:'assists',KXNBA3PT:'threes',KXNBAPRA:'PRA'},soccer:{}}[SPORT];
function git(a){return cp.execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
async function history(series,ticker,from){const now=Math.floor(Date.now()/1000),start=from?Math.max(Math.floor(from/1000),now-14*86400):now-3*86400;
 const j=await get(`${API}/series/${series}/markets/${ticker}/candlesticks?start_ts=${start}&end_ts=${now}&period_interval=60`);await sleep(120);
 /* Each hour: the last trade when there was one, else the middle of the quote when it is tight (10 cents or less).
    Early markets often quote 56-86 cents with no trades; those hours are skipped rather than drawn as 71%. */
 return ((j&&j.candlesticks)||[]).map(c=>{const t=num(c.price&&c.price.close_dollars),b=num(c.yes_bid&&c.yes_bid.close_dollars),a=num(c.yes_ask&&c.yes_ask.close_dollars);
  const p=t!=null?t:b!=null&&a!=null&&a-b<=.1?(a+b)/2:null;return p!=null?[c.end_period_ts*1000,Math.round(p*1000)/1000]:null}).filter(Boolean)}
/* Compact chart history: start time, then whole cents per hour (gaps carry the last value). */
function compact(h){if(!h.length)return null;const t0=h[0][0],v=[];let j=0,last=Math.round(h[0][1]*100);
 for(let t=t0;t<=h[h.length-1][0];t+=36e5){while(j<h.length&&h[j][0]<=t){last=Math.round(h[j][1]*100);j++}v.push(last)}return{t0,v}}

(async()=>{
 /* Our games: ESPN games for NFL/NBA (from the props builder), the daily data's games for soccer. */
 const ours=SPORT==='soccer'
  ?((JSON.parse(fs.readFileSync(path.join(ROOT,'data.json'),'utf8')).games)||[]).filter(g=>g.lg==='soccer').map(g=>({id:g.id,date:g.when.slice(0,10),away:{n:g.away.n},home:{n:g.home.n}}))
  :((JSON.parse(fs.readFileSync(path.join(ROOT,SPORT==='nfl'?'data/nfl_week.json':'data/nba_today.json'),'utf8')).games)||[]).map(g=>({id:g.id,date:g.when.slice(0,10),away:g.away,home:g.home}));
 const out={sport:SPORT,generated:new Date().toISOString(),checked:new Date().toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET',games:{},props:{}};
 for(const series of GAME){const ms=await markets(series);if(!ms.length)continue;
  const byEv={};ms.forEach(m=>(byEv[m.event_ticker]=byEv[m.event_ticker]||[]).push(m));
  for(const [ev,list] of Object.entries(byEv)){const d=evDate(ev);
   for(const g of ours){if(g.date!==d&&SPORT!=='soccer')continue;
    /* A market belongs to a team when its ticker ends with the team's code, or (soccer, and as a fallback) its name matches. */
    const side=m=>{const suf=m.ticker.split('-').pop(),sub=norm(m.yes_sub_title||m.title);
     for(const s of ['away','home']){const t=g[s];if(t.abbr&&codes(t.abbr).includes(suf))return s}
     for(const s of ['away','home']){const t=g[s],n=norm(t.n),c=norm(t.city);if((n&&sub.includes(n))||(c&&sub.startsWith(c)&&!list.some(o=>o!==m&&norm(o.yes_sub_title).startsWith(c))))return s}
     return /tie|draw/i.test(m.yes_sub_title||'')?'draw':null};
    const hit={};list.forEach(m=>{const s=side(m);if(s)hit[s]=m});
    if(!hit.away||!hit.home)continue;
    const G=out.games[g.id]={names:[g.away.n,g.home.n],series,event:ev};
    for(const s of ['away','home','draw'])if(hit[s]){G[s]=quote(hit[s]);
     if(GAMES_ONLY){G[s].h=compact(await history(series,hit[s].ticker,Date.parse(hit[s].open_time)||null));G[s].vol24=num(hit[s].volume_24h_fp)}
     else G[s].hist=await history(series,hit[s].ticker)}
    break}}}
 log(`${Object.keys(out.games).length} of ${ours.length} games matched.`);
 if(GAMES_ONLY){delete out.props;return save(out)}
 /* Props: "Name: 30+ points" -> props[name|stat][30] = both sides' quotes. Only upcoming dates. */
 const dates=new Set(ours.map(g=>g.date));let n=0;
 for(const [series,stat] of Object.entries(PROPS)){const ms=await markets(series);
  ms.forEach(m=>{const x=String(m.title||'').match(/^(.+?):\s*(\d+(?:\.\d+)?)\+/);if(!x)return;const d=evDate(m.event_ticker);if(d&&!dates.has(d))return;
   const k=`${norm(x[1])}|${stat}`;(out.props[k]=out.props[k]||{})[+x[2]]=quote(m);n++})}
 log(`${n} prop markets for ${Object.keys(out.props).length} player-stats.`);
 save(out);
})().catch(e=>{log('Failed: '+(e&&e.message||e));process.exit(1)});
function save(out){
 fs.mkdirSync(path.join(ROOT,'data'),{recursive:true});fs.writeFileSync(path.join(ROOT,OUT),JSON.stringify(out));log(`Wrote ${OUT}.`);
 if(!push)return;
 try{git(['pull','-q','--rebase','--autostash']);git(['add',OUT]);if(!git(['status','--porcelain','--',OUT])){log('No change; nothing to push.');return}
  git(['commit','-q','-m',`Kalshi ${SPORT.toUpperCase()} ${GAMES_ONLY?'game chart':'prices'} (${out.checked})`]);git(['push','-q','origin','main']);log('Pushed to GitHub.')}
 catch(e){log('Git step failed: '+String(e.stderr||e.message).trim());process.exit(1)}}
