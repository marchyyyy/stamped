/* ESPN adapter for NBA Live Intelligence.
   Normalizers are pure (shared with the backtester); LiveFeed does the polling with rate limiting, retries, backoff and dedup.
   Sources: ESPN scoreboard + game summary (score, clock, box score, play-by-play, pregame line) and ESPN's DraftKings live odds feed. */
(function(root){
'use strict';
const E=typeof module!=='undefined'&&module.exports?require('./engine.js'):root.LiveEngine;
const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const CORE='https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const URLS={
 scoreboard:d=>`${BASE}/scoreboard${d?`?dates=${d}`:''}`,
 summary:id=>`${BASE}/summary?event=${id}`,
 odds:id=>`${CORE}/events/${id}/competitions/${id}/odds`
};
const num=v=>v==null||v===''?null:+v;
const made=s=>{const m=String(s||'').match(/^(\d+)-(\d+)$/);return m?[+m[1],+m[2]]:[0,0]};
const stateOf=t=>t&&t.state==='in'?'in':t&&t.state==='post'?'post':'pre';

function teamOf(c){return{id:c.team&&c.team.id,abbr:c.team&&c.team.abbreviation,name:c.team&&(c.team.name||c.team.shortDisplayName),pts:num(c.score)||0,
 q:(c.linescores||[]).map(x=>num(x.value!=null?x.value:x.displayValue)||0),fga:0,fta:0,oreb:0,tov:0}}

/* Scoreboard event -> light state (no box score). */
function fromScoreboard(ev,fetched){
 const c=ev.competitions[0],st=c.status||ev.status,h=c.competitors.find(x=>x.homeAway==='home'),a=c.competitors.find(x=>x.homeAway==='away');
 return{id:String(ev.id),name:ev.shortName,start:ev.date,status:stateOf(st.type),detail:st.type.shortDetail||st.type.detail,period:st.period||0,clock:E.parseClock(st.displayClock!=null?st.displayClock:st.clock),
  home:teamOf(h),away:teamOf(a),fetched,src:'scoreboard'};
}

/* Pregame line: ESPN pickcenter (DraftKings pregame). The live provider is never used as a baseline. */
function pregameOf(sum){
 const pc=(sum.pickcenter||[]).find(x=>!/live/i.test((x.provider&&x.provider.name)||''));if(!pc||pc.overUnder==null)return null;
 return{total:+pc.overUnder,homeMargin:pc.spread!=null?-pc.spread:null,src:`${(pc.provider&&pc.provider.name)||'Book'} pregame (${pc.details||''}, O/U ${pc.overUnder})`};
}

/* Game summary -> full state with box score and players. */
function fromSummary(sum,fetched){
 const comp=sum.header.competitions[0],st=comp.status,h=comp.competitors.find(x=>x.homeAway==='home'),a=comp.competitors.find(x=>x.homeAway==='away');
 const home=teamOf(h),away=teamOf(a),side={[home.id]:home,[away.id]:away};
 ((sum.boxscore&&sum.boxscore.teams)||[]).forEach(t=>{const T=side[t.team.id];if(!T)return;const S={};(t.statistics||[]).forEach(x=>S[x.name]=x.displayValue);
  T.fga=made(S['fieldGoalsMade-fieldGoalsAttempted'])[1];T.fta=made(S['freeThrowsMade-freeThrowsAttempted'])[1];T.oreb=num(S.offensiveRebounds)||0;
  T.tov=num(S.totalTurnovers!=null?S.totalTurnovers:S.turnovers)||0;T.fouls=num(S.fouls)});
 const plays=sum.plays||[],last=plays[plays.length-1]||null;
 const injText={};plays.forEach(p=>{if(/injur/i.test(p.text||'')&&p.participants)p.participants.forEach(x=>injText[x.athlete&&x.athlete.id]=p.text)});
 const out=new Set();(sum.injuries||[]).forEach(t=>(t.injuries||[]).forEach(i=>{if(/out/i.test(i.status||''))out.add(i.athlete&&i.athlete.id)}));
 const players=[];
 ((sum.boxscore&&sum.boxscore.players)||[]).forEach(t=>{const sd=t.team.id===home.id?'home':'away';(t.statistics||[]).forEach(g=>{const K=g.keys||[];
  (g.athletes||[]).forEach(x=>{const s={};K.forEach((k,i)=>s[k]=x.stats&&x.stats[i]);const id=x.athlete.id;
   players.push({id:String(id),name:x.athlete.displayName,pos:x.athlete.position&&x.athlete.position.abbreviation,team:sd,starter:!!x.starter,dnp:!!x.didNotPlay,ejected:!!x.ejected,
    out:out.has(id),min:num(s.minutes)||0,pts:num(s.points)||0,reb:num(s.rebounds)||0,ast:num(s.assists)||0,tpm:made(s['threePointFieldGoalsMade-threePointFieldGoalsAttempted'])[0],
    pf:num(s.fouls)||0,injuryNote:injText[id]||null})})})});
 return{id:String(sum.header.id),name:`${away.abbr} @ ${home.abbr}`,start:comp.date,status:stateOf(st.type),detail:st.type.shortDetail||st.type.detail,period:st.period||0,clock:E.parseClock(st.displayClock),
  home,away,players,pregame:pregameOf(sum),lastSeq:last?+last.sequenceNumber:0,lastWall:last&&last.wallclock?Date.parse(last.wallclock):null,fetched,src:'summary'};
}

/* ESPN core odds -> DraftKings live market. Missing provider or missing prices = not available (never filled in). */
function fromOdds(o,st,fetched){
 const it=(o&&o.items||[]).find(x=>/live/i.test((x.provider&&x.provider.name)||''));
 if(!it)return{available:false,suspended:true,why:'No live market posted.',fetched};
 const H=it.homeTeamOdds||{},A=it.awayTeamOdds||{};
 let hs=num(it.spread);
 const d=String(it.details||'').match(/^(\S+)\s+([-+]?\d+(?:\.\d+)?)/);
 if(d&&st){const v=Math.abs(+d[2]);hs=d[1]===st.home.abbr?-v:d[1]===st.away.abbr?v:hs}
 const m={available:true,book:'DraftKings (live)',total:num(it.overUnder),overOdds:num(it.overOdds),underOdds:num(it.underOdds),
  homeSpread:hs,homeSpreadOdds:num(H.spreadOdds),awaySpreadOdds:num(A.spreadOdds),homeML:num(H.moneyLine),awayML:num(A.moneyLine),fetched};
 m.suspended=m.total==null&&m.homeSpread==null&&m.homeML==null;if(m.suspended)m.why='Live market listed with no prices (suspended).';
 return m;
}

/* Play-by-play replay for the backtester: state using only plays strictly before the cut (no look-ahead). */
function fromPlays(sum,cut){
 const comp=sum.header.competitions[0],h=comp.competitors.find(x=>x.homeAway==='home'),a=comp.competitors.find(x=>x.homeAway==='away');
 const mk=c=>({id:c.team.id,abbr:c.team.abbreviation,name:c.team.name||c.team.shortDisplayName,pts:0,q:[],fga:0,fta:0,oreb:0,tov:0});
 const home=mk(h),away=mk(a),T={[home.id]:home,[away.id]:away};
 const before=p=>{const per=p.period.number,c=E.parseClock(p.clock&&p.clock.displayValue);return per<cut.period||(per===cut.period&&c>cut.clock)};
 let ph=0,pa=0,lastP=1;
 for(const p of sum.plays||[]){if(!before(p))break;const per=p.period.number;lastP=per;
  const dh=p.homeScore-ph,da=p.awayScore-pa;home.q[per-1]=(home.q[per-1]||0)+dh;away.q[per-1]=(away.q[per-1]||0)+da;ph=p.homeScore;pa=p.awayScore;
  const t=p.team&&T[p.team.id];if(!t)continue;const ty=(p.type&&p.type.text)||'';
  if(/free throw/i.test(ty))t.fta++;else if(p.shootingPlay)t.fga++;
  if(/^offensive rebound/i.test(ty)&&!/team rebound/i.test(p.text||''))t.oreb++; // box-score OREB excludes team rebounds
  if(/turnover/i.test(ty)||/turnover/i.test(p.text||''))t.tov++}
 for(let i=0;i<cut.period;i++){home.q[i]=home.q[i]||0;away.q[i]=away.q[i]||0}
 home.pts=ph;away.pts=pa;
 return{id:String(sum.header.id),status:'in',period:cut.period,clock:cut.clock,home,away,players:[],pregame:pregameOf(sum),fetched:0};
}
function finalOf(sum){const s=fromSummary(sum,0);return s.status==='post'?s:null}

/* ---------- polling ---------- */
class LiveFeed{
 constructor(o){this.fetch=o.fetch||((...a)=>fetch(...a));this.now=o.now||(()=>Date.now());this.onUpdate=o.onUpdate||(()=>{});this.onStatus=o.onStatus||(()=>{});
  this.games={};this.board=null;this.timers=[];this.queue=[];this.active=0;this.maxActive=3;this.minGap=350;this.lastStart=0;this.backoff={};this.running=false;
  this.every={scoreboard:30e3,summary:20e3,odds:30e3,hidden:60e3}}
 start(){if(this.running)return;this.running=true;this.tick()}
 stop(){this.running=false;this.timers.forEach(clearTimeout);this.timers=[]}
 hidden(){try{return typeof document!=='undefined'&&document.hidden}catch(e){return false}}
 later(fn,ms){const t=setTimeout(()=>{this.timers=this.timers.filter(x=>x!==t);fn()},ms);this.timers.push(t)}
 /* Rate limit: at most maxActive requests in flight and minGap ms between starts. Retries twice, then backs off per URL up to 5 min. */
 get(url){return new Promise((res,rej)=>{this.queue.push({url,res,rej,tries:0});this.pump()})}
 pump(){if(!this.queue.length||this.active>=this.maxActive)return;const wait=this.lastStart+this.minGap-this.now();if(wait>0){this.later(()=>this.pump(),wait);return}
  const j=this.queue.shift(),b=this.backoff[j.url];if(b&&b.until>this.now()){j.rej(new Error('backing off'));this.pump();return}
  this.active++;this.lastStart=this.now();
  /* Cache-bust with a query param: fetch cache options make browsers send a CORS preflight, which ESPN rejects (403). */
  this.fetch(j.url+(j.url.includes('?')?'&':'?')+'_='+this.now()).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(d=>{delete this.backoff[j.url];j.res(d)})
   .catch(e=>{if(j.tries<2){j.tries++;this.later(()=>{this.queue.unshift(j);this.pump()},j.tries*1500)}else{const prev=this.backoff[j.url];const ms=Math.min(300e3,prev?prev.ms*2:20e3);this.backoff[j.url]={ms,until:this.now()+ms};j.rej(e)}})
   .finally(()=>{this.active--;this.pump()});this.pump()}
 async tick(){if(!this.running)return;
  try{const sb=await this.get(URLS.scoreboard()),t=this.now();this.board=(sb.events||[]).map(e=>fromScoreboard(e,t));this.onStatus({ok:true,at:t});
   this.board.forEach(b=>{const g=this.games[b.id]||(this.games[b.id]={id:b.id});g.board=b;
    const soon=b.status==='pre'&&Date.parse(b.start)-t<15*60e3,live=b.status==='in',justFinal=b.status==='post'&&g.summary&&g.summary.status!=='post';
    if((live||soon||justFinal||!g.summary)&&!g.loopOn)this.loop(g)});
   this.onUpdate(this)}
  catch(e){this.onStatus({ok:false,at:this.now(),error:String(e.message||e)})}
  this.later(()=>this.tick(),this.hidden()?this.every.hidden:this.every.scoreboard)}
 async loop(g){g.loopOn=true;
  const once=async()=>{if(!this.running){g.loopOn=false;return}
   try{const d=await this.get(URLS.summary(g.id)),t=this.now(),s=fromSummary(d,t),p=g.summary;
    const dup=p&&p.lastSeq===s.lastSeq&&p.status===s.status&&p.clock===s.clock&&p.home.pts===s.home.pts&&p.away.pts===s.away.pts;
    const fr=E.freshness(p,s,t);s.stillSince=fr.since;g.fresh=fr;g.prevSummary=p||null;g.summary=s;g.dup=dup;g.raw=d}
   catch(e){g.error=String(e.message||e)}
   if(g.summary&&g.summary.status==='in'||(g.board&&g.board.status==='in')){try{const o=await this.get(URLS.odds(g.id)),t=this.now();g.prevMarket=g.market||null;g.market=fromOdds(o,g.summary||g.board,t)}catch(e){g.market=g.market?Object.assign({},g.market,{stale:true}):null;g.oddsError=String(e.message||e)}}
   g.updated=this.now();this.onUpdate(this,g);
   const st=g.summary&&g.summary.status;if(st==='post'||(st==='pre'&&g.board&&Date.parse(g.board.start)-this.now()>15*60e3)){g.loopOn=false;return}
   this.later(once,this.hidden()?this.every.hidden:this.every.summary)};
  once()}
}

const api={URLS,fromScoreboard,fromSummary,fromOdds,fromPlays,finalOf,pregameOf,LiveFeed};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LiveESPN=api;
})(typeof globalThis!=='undefined'?globalThis:this);
