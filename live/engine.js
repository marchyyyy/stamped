/* NBA Live Intelligence: projection model, Monte Carlo simulation, market pricing and live selection rules.
   Pure functions only (no DOM, no network) so the browser, the tests and the backtester run the same code. */
(function(root){
'use strict';
const VERSION='live-1.2.0';

/* Model constants. kRate, rubber and blowPace were chosen by `node live/backtest.js --tune --split 20261028` on 68 games
   before Oct 28, 2026 and checked on 65 later games (held-out loss 0.438 -> 0.422 vs the hand-set values). The rest are priors. */
const NBA={
 qMin:12,otMin:5,maxOT:4,
 ppp:1.15,            // league points per possession, used to turn a pregame total into a pace
 total:228,           // league-average total, only when no pregame line exists (flagged)
 kPace:10,            // minutes of pregame pace the live pace is blended with
 kRate:192,           // minutes of pregame scoring rate the live scoring rate is blended with (shooting regression)
 rubber:.006,         // per point of lead, the leader's points per possession drop by this share (comebacks, starters resting)
 blowPace:.88,        // pace multiplier in Q4 blowouts (clock-draining possessions)
 maxEdge:.10,         // a live edge this large against a liquid market is treated as missing information, not value
 ft:.78,              // free-throw rate on intentional fouls
 blowout:18,          // Q4 margin that brings in bench units
 lateSec:60           // last-minute intentional fouling window
};
const PRIOR_PM={points:.48,rebounds:.19,assists:.11,threes:.05}; // per-minute rotation-player prior, only when a player has no history (flagged)

/* ---------- clock ---------- */
const periodLen=p=>(p<=4?NBA.qMin:NBA.otMin)*60;
function parseClock(s){if(s==null)return 0;if(typeof s==='number')return s;const m=String(s).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);return m?(+(m[1]||0))*60+ +m[2]:0}
function elapsedMin(period,clockSec){if(!period)return 0;const p=period<=4?(period-1)*NBA.qMin:48+(period-5)*NBA.otMin;return p+(periodLen(period)-clockSec)/60}
function remainingRegMin(st){return Math.max(0,48-elapsedMin(st.period,st.clock))}
const periodName=p=>p<=4?'Q'+p:p===5?'OT':'OT'+(p-4);

/* ---------- rng ---------- */
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function poisson(l,r){if(l<=0)return 0;if(l>30){const z=Math.sqrt(-2*Math.log(r()||1e-12))*Math.cos(2*Math.PI*r());return Math.max(0,Math.round(l+z*Math.sqrt(l)))}let k=0,p=1;const L=Math.exp(-l);do{k++;p*=r()}while(p>L);return k-1}
const seedOf=st=>hashStr([st.id,st.period,Math.round(st.clock),st.home.pts,st.away.pts,VERSION].join('|'));

/* ---------- odds ---------- */
const imp=o=>o<0?-o/(-o+100):100/(o+100);
const dec=o=>o>0?1+o/100:1+100/-o;
const fair=p=>p<=0||p>=1?null:p>=.5?Math.round(-100*p/(1-p)):Math.round(100*(1-p)/p);
function noVig(a,b){if(a==null||b==null)return null;const x=imp(a),y=imp(b);return[x/(x+y),y/(x+y)]}

/* ---------- state ---------- */
/* Normalized game state (built by live/espn.js from the live box score, or by the backtester from play-by-play):
   {id,status:'pre'|'in'|'post',period,clock,home:{abbr,name,pts,q:[],fga,fta,oreb,tov},away:{...},pregame:{total,homeMargin,src}|null,players:[]} */
const possOf=t=>(t.fga||0)-(t.oreb||0)+(t.tov||0)+.44*(t.fta||0);
function baseline(st,C){
 C=C||NBA;const pg=st.pregame||{},flags=[];
 let T=pg.total,M=pg.homeMargin;
 if(T==null){T=C.total;flags.push('No pregame total found; using the league-average total.')}
 if(M==null){M=0;flags.push('No pregame spread found; treating the teams as even.')}
 return{T,M,flags,src:pg.src||null};
}
/* Late fouling, overtime and the lead effect add points and pull margins in on their own. The pregame line already
   prices those in, so each team's starting rate is scaled until a pregame simulation lands on the line's total and margin. */
const CAL={};
function calibrate(T,M,C){
 const k=[T,M,C.kPace,C.rubber,C.lateSec,C.blowout,C.blowPace,C.ft,C.ppp].join('|');if(CAL[k])return CAL[k];
 const z=()=>({abbr:'',name:'',pts:0,q:[],fga:0,fta:0,oreb:0,tov:0}),st={id:'cal',status:'pre',period:0,clock:0,home:z(),away:z(),pregame:{total:T,homeMargin:M}};
 let m={h:1,a:1};
 for(let i=0;i<3;i++){const s=simulate(st,{n:2500,seed:7919+i,params:C,cal:m});m={h:m.h*(T+M)/2/s.mean('game:h'),a:m.a*(T-M)/2/s.mean('game:a')}}
 return CAL[k]=m;
}
function rates(st,C,cal){
 C=C||NBA;const b=baseline(st,C),e=st.status==='pre'?0:elapsedMin(st.period,st.clock),flags=[...b.flags];
 const m=cal||calibrate(b.T,b.M,C),pace0=b.T/2/C.ppp,ppp0h=(b.T+b.M)/2/pace0*m.h,ppp0a=(b.T-b.M)/2/pace0*m.a;
 let posH=possOf(st.home),posA=possOf(st.away);
 if(e>0&&posH+posA<=0){posH=posA=pace0*e/48;flags.push('No box score yet; pace held at the pregame estimate.')}
 const pace=e>0?((posH+posA)/2*48+pace0*C.kPace)/(e+C.kPace):pace0;
 /* Mean scoring comes from points per minute, which is measured directly. Possession counts only set the pace (how the
    points arrive), so a miscounted possession cannot inflate the projection. */
 const ppm0h=ppp0h*pace0/48,ppm0a=ppp0a*pace0/48,wRate=e/(e+C.kRate);
 const ppmH=e>0?(st.home.pts+ppm0h*C.kRate)/(e+C.kRate):ppm0h,ppmA=e>0?(st.away.pts+ppm0a*C.kRate)/(e+C.kRate):ppm0a;
 const pppH=ppmH*48/pace,pppA=ppmA*48/pace;
 return{e,pace,pace0,pppH,pppA,ppp0h,ppp0a,ppm0:ppm0h+ppm0a,obsPpm:e>0?(st.home.pts+st.away.pts)/e:null,ppm:ppmH+ppmA,wRate,
  obsPace:e>0?(posH+posA)/2/e*48:null,obsPppH:posH?st.home.pts/posH:null,obsPppA:posA?st.away.pts/posA:null,
  wPace:e/(e+C.kPace),base:b,flags};
}
function samplePts(p,r){const f=Math.max(0,(p-.03)/1.14),p3=.14*f,p2=.36*f,u=r();return u<p3?3:u<p3+p2?2:u<p3+p2+.03?1:0}

/* ---------- Monte Carlo ---------- */
function simulate(st,opt){
 opt=opt||{};const C=opt.params?Object.assign({},NBA,opt.params):NBA,n=opt.n||4000,R=rates(st,C,opt.cal),r=mulberry32(opt.seed!=null?opt.seed:seedOf(st));
 const qH=[0,1,2,3].map(()=>new Int16Array(n)),qA=[0,1,2,3].map(()=>new Int16Array(n)),otH=new Int16Array(n),otA=new Int16Array(n),ot=new Uint8Array(n);
 const q0h=[0,0,0,0],q0a=[0,0,0,0];let o0h=0,o0a=0;
 (st.home.q||[]).forEach((v,i)=>i<4?q0h[i]=v:o0h+=v);(st.away.q||[]).forEach((v,i)=>i<4?q0a[i]=v:o0a+=v);
 for(let i=0;i<n;i++){
  const qh=q0h.slice(),qa=q0a.slice();let oh=o0h,oa=o0a,h=st.home.pts,a=st.away.pts;
  let per=st.status==='pre'?1:st.period,clk=st.status==='pre'?periodLen(1):st.clock,off=r()<.5?0:1;
  if(st.status!=='post')for(;;){
   if(clk<=0){if(per>=4&&h!==a)break;if(per>=4+C.maxOT)break;per++;clk=periodLen(per);off=r()<.5?0:1;continue}
   const lead=h-a,mg=Math.abs(lead),late=per>=4&&clk<=C.lateSec,blow=per>=4&&mg>=C.blowout,trail=lead>0?1:lead<0?0:-1;
   let pts,dur;
   if(late&&mg>=3&&mg<=10&&off!==trail){dur=2+r()*4;pts=(r()<C.ft?1:0)+(r()<C.ft?1:0)}
   else{dur=1440/(R.pace*(blow?C.blowPace:1))*(.4+1.2*r());if(late&&off===trail&&mg>=3)dur=Math.min(dur,8);
    const own=Math.max(-20,Math.min(20,off===0?lead:-lead));
    pts=samplePts((off===0?R.pppH:R.pppA)*(blow?.96:1)*(1-C.rubber*own),r)}
   if(dur>clk){if(r()>clk/dur)pts=0;dur=clk}
   clk-=dur;
   if(off===0){h+=pts;if(per<=4)qh[per-1]+=pts;else oh+=pts}else{a+=pts;if(per<=4)qa[per-1]+=pts;else oa+=pts}
   off^=1;
  }
  for(let k=0;k<4;k++){qH[k][i]=qh[k];qA[k][i]=qa[k]}otH[i]=oh;otA[i]=oa;ot[i]=per>4?1:0;
 }
 return makeSim(st,R,{n,qH,qA,otH,otA,ot});
}
/* Market keys. Q4 excludes overtime; second half and full game include it (standard settlement). */
const MKEYS=['q1','q2','q3','q4','h1','h2','game'];
const PARTS={q1:[0],q2:[1],q3:[2],q4:[3],h1:[0,1],h2:[2,3,'ot'],game:[0,1,2,3,'ot']};
function makeSim(st,R,raw){
 const cache={},n=raw.n;
 const side=(k,s)=>{const id=k+':'+s;if(cache[id])return cache[id];const Q=s==='h'?raw.qH:raw.qA,O=s==='h'?raw.otH:raw.otA,v=new Float64Array(n);
  PARTS[k].forEach(p=>{const src=p==='ot'?O:Q[p];for(let i=0;i<n;i++)v[i]+=src[i]});return cache[id]=v};
 const vals=key=>{if(cache[key+'#'])return cache[key+'#'];const[k,s]=key.split(':');let v;
  if(s==='h'||s==='a')v=side(k,s);else if(s==='m'){const h=side(k,'h'),a=side(k,'a');v=new Float64Array(n);for(let i=0;i<n;i++)v[i]=h[i]-a[i]}
  else{const h=side(k,'h'),a=side(k,'a');v=new Float64Array(n);for(let i=0;i<n;i++)v[i]=h[i]+a[i]}
  return cache[key+'#']=Float64Array.from(v).sort()};
 const lb=(a,x)=>{let lo=0,hi=a.length;while(lo<hi){const m=lo+hi>>1;if(a[m]<x)lo=m+1;else hi=m}return lo};
 const ub=(a,x)=>{let lo=0,hi=a.length;while(lo<hi){const m=lo+hi>>1;if(a[m]<=x)lo=m+1;else hi=m}return lo};
 /* key: 'game' (total), 'game:h' / 'game:a' (team total), 'game:m' (home margin); same for q1..q4,h1,h2 */
 const prob=(key,line)=>{const a=vals(key);const over=(n-ub(a,line))/n,push=(ub(a,line)-lb(a,line))/n;return{over,under:1-over-push,push}};
 const q=(key,p)=>{const a=vals(key);return a[Math.min(n-1,Math.max(0,Math.floor(p*n)))]};
 const mean=key=>{const a=vals(key);let s=0;for(let i=0;i<n;i++)s+=a[i];return s/n};
 const summary=key=>({mean:mean(key),lo:q(key,.1),hi:q(key,.9)});
 const fin=p=>st.status==='post'||(st.status==='in'&&(p<st.period||(p===st.period&&st.clock<=0)));
 const done=k=>k==='h2'||k==='game'?st.status==='post':PARTS[k].every(p=>fin(p+1));
 const actual=(k,s)=>{const t=x=>PARTS[k].reduce((a,p)=>a+(p==='ot'?(x.q||[]).slice(4).reduce((u,v)=>u+v,0):((x.q||[])[p]||0)),0);
  return s==='h'?t(st.home):s==='a'?t(st.away):t(st.home)+t(st.away)};
 const otRate=()=>{let c=0;for(let i=0;i<n;i++)c+=raw.ot[i];return c/n};
 return{n,rates:R,state:st,prob,q,mean,summary,done,actual,otRate,vals,version:VERSION};
}

/* ---------- players ---------- */
const FOUL_TROUBLE=[0,2,3,4,5]; // fouls that count as trouble in Q1..Q4
function playerHistory(name,data){
 const p=data&&data.players&&data.players.find(x=>x.lg==='nba'&&x.name===name);if(!p)return null;
 const g=(p.games||[]).filter(x=>x.min!=null&&x.min>0).slice(0,5);if(!g.length)return null;
 const min=g.reduce((a,x)=>a+x.min,0),per={};
 ['points','rebounds','assists','threes'].forEach(s=>{const k=g.filter(x=>x.s&&x.s[s]!=null);if(k.length)per[s]=k.reduce((a,x)=>a+x.s[s],0)/k.reduce((a,x)=>a+x.min,0)});
 return{id:p.id,avgMin:min/g.length,per,n:g.length,props:(p.props||[]).filter(x=>['points','rebounds','assists','threes','PRA'].includes(x.stat))};
}
function projectPlayer(pl,st,data,opt){
 opt=opt||{};const e=st.status==='pre'?0:elapsedMin(st.period,st.clock),flags=[],hist=playerHistory(pl.name,data);
 const remGame=st.status==='post'?0:Math.max(0,elapsedMin(Math.max(4,st.period),0)-e);
 let exp;
 /* Expected minutes blend his usual minutes with tonight's minute pace, so a bigger role tonight (a teammate hurt, foul trouble on others) carries forward. */
 const prior=hist?hist.avgMin:pl.starter?32:18;if(!hist)flags.push('No recent games on file; minutes and rates use a league prior.');
 exp=e>0?(pl.min*48+prior*24)/(e+24):prior;
 let rem=Math.max(0,Math.min(exp-pl.min,remGame*.92));
 const mg=Math.abs(st.home.pts-st.away.pts);
 if(pl.pf>=6){rem=0;flags.push('Fouled out.')}
 else if(st.period<=4&&pl.pf>=FOUL_TROUBLE[st.period]){rem*=.75;flags.push(`Foul trouble: ${pl.pf} fouls in ${periodName(st.period)}.`)}
 if(st.period>=4&&mg>=20&&pl.starter){rem*=.6;flags.push('Blowout: starters likely sit late.')}
 else if(st.period===3&&mg>=25&&pl.starter)rem*=.8;
 if(pl.dnp||pl.out){rem=0;flags.push('Not playing.')}
 if(pl.injuryNote)flags.push(pl.injuryNote);
 const K=24,cur={points:pl.pts,rebounds:pl.reb,assists:pl.ast,threes:pl.tpm};
 const rate=s=>{const prior=hist&&hist.per[s]!=null?hist.per[s]:PRIOR_PM[s];return(cur[s]+prior*K)/(pl.min+K)};
 const n=opt.n||3000,r=mulberry32(hashStr(pl.id+'|'+seedOf(st)));
 const out={points:new Float64Array(n),rebounds:new Float64Array(n),assists:new Float64Array(n),threes:new Float64Array(n),PRA:new Float64Array(n)};
 const rt={points:rate('points'),rebounds:rate('rebounds'),assists:rate('assists'),threes:rate('threes')};
 for(let i=0;i<n;i++){
  const m=rem>0?Math.max(0,rem+(Math.sqrt(-2*Math.log(r()||1e-12))*Math.cos(2*Math.PI*r()))*Math.min(3,rem*.25)):0;
  const lp=rt.points*m;out.points[i]=cur.points+2*poisson(lp*.42,r)+poisson(lp*.16,r);
  out.rebounds[i]=cur.rebounds+poisson(rt.rebounds*m,r);out.assists[i]=cur.assists+poisson(rt.assists*m,r);out.threes[i]=cur.threes+poisson(rt.threes*m,r);
  out.PRA[i]=out.points[i]+out.rebounds[i]+out.assists[i];
 }
 Object.values(out).forEach(a=>a.sort());
 const stat=s=>{const a=out[s];let sum=0;for(let i=0;i<n;i++)sum+=a[i];return{mean:sum/n,lo:a[Math.floor(.1*n)],hi:a[Math.floor(.9*n)],now:s==='PRA'?cur.points+cur.rebounds+cur.assists:cur[s]}};
 const probOver=(s,line)=>{const a=out[s];let c=0;for(let i=0;i<n;i++)if(a[i]>line)c++;return c/n};
 return{id:pl.id,name:pl.name,team:pl.team,min:pl.min,pf:pl.pf,expMin:Math.round(pl.min+rem),remMin:rem,hist,flags,stats:['points','rebounds','assists','threes','PRA'].reduce((o,s)=>(o[s]=stat(s),o),{}),probOver};
}

/* ---------- confidence & selection ---------- */
function confidence(sim,q){
 const st=sim.state,e=sim.rates.e,why=[];
 if(q.stale)why.push('data is stale');if(q.conflict)why.push('sources disagree');if(sim.rates.base.flags.length)why.push('no pregame baseline');
 if(why.length)return{level:'Low',why};
 if(st.status==='pre'||e<6)return{level:'Low',why:['too early in the game']};
 return e>=24?{level:'High',why:[]}:{level:'Medium',why:[]};
}
/* Existing Stamped rules are applied unchanged (−160 kill, +300 too long, 3-point edge over no-vig).
   Live-only rules are added on top; every live pick is Paper until the backtest and paper trading validate the model. */
const RULES={kill:-160,tooLong:300,minEdge:.03,
 live:{maxOddsAgeSec:90,noPickLastSec:120,needConfidence:['Medium','High']}};
function grade(c,cfg){
 const why=[];
 if(c.price==null)return{ok:false,why:['No price.']};
 if(c.price<RULES.kill)why.push(`${c.price} is worse than −160, priced too steep (existing rule).`);
 if(c.price>=RULES.tooLong)why.push(`+${c.price} is too long a shot (existing rule).`);
 if(c.edge<Math.max(RULES.minEdge,(cfg&&cfg.minEdge)||0))why.push(`Edge ${(c.edge*100).toFixed(1)} pts is under the ${Math.max(3,((cfg&&cfg.minEdge)||0)*100).toFixed(1)}-point minimum (existing rule).`);
 if(c.ev<=0)why.push('Negative expected value.');
 if(c.edge!=null&&Math.abs(c.edge)>NBA.maxEdge)why.push(`Edge ${(c.edge*100).toFixed(1)} pts is too large to trust against a live market; the book likely knows something the model does not (injury, lineup, foul-out) (live rule).`);
 return{ok:!why.length,why};
}
function liveGate(sim,mkt,q,now){
 const st=sim.state,why=[];
 if(st.status!=='in')why.push(st.status==='post'?'Game is final.':'Game has not started; live picks only.');
 if(!mkt)why.push('No live market posted.');
 else{if(mkt.suspended)why.push('Market suspended or off the board.');
  if(mkt.fetched==null||(now-mkt.fetched)/1000>RULES.live.maxOddsAgeSec)why.push('Odds are stale (over 90 s old).')}
 if(q.stale)why.push('Game feed is stale.');if(q.conflict)why.push('Score sources disagree.');
 if(st.period>=4&&st.clock<RULES.live.noPickLastSec&&st.status==='in')why.push('Inside the last 2:00; prices move faster than this page updates.');
 const cf=confidence(sim,q);if(!RULES.live.needConfidence.includes(cf.level))why.push(`Model confidence is ${cf.level} (${cf.why.join(', ')||'early'}).`);
 return{ok:!why.length,why,confidence:cf};
}
const pctTxt=p=>(p*100).toFixed(1)+'%';
function priceSide(sim,key,line,price,otherPrice,kind){
 /* kind: 'over'|'under' for totals; 'home'|'away' for spreads (line = that side's spread) and moneylines (line = null) */
 let pW,pP;
 if(kind==='over'||kind==='under'){const pr=sim.prob(key,line);pW=kind==='over'?pr.over:pr.under;pP=pr.push}
 else if(line==null){const pr=sim.prob(key+':m',0);pW=kind==='home'?pr.over:pr.under;pP=0}
 else{const pr=sim.prob(key+':m',kind==='home'?-line:line);pW=kind==='home'?pr.over:pr.under;pP=pr.push}
 const pL=1-pW-pP,ev=price!=null?pW*(dec(price)-1)-pL:null;
 const nv=otherPrice!=null&&price!=null?noVig(price,otherPrice)[0]:price!=null?imp(price):null;
 const pFair=pW/(pW+pL||1);
 return{p:pW,push:pP,ev,novig:nv,edge:nv!=null?pFair-nv:null,fair:fair(pFair)};
}
function opportunities(sim,mkt,q,now,cfg){
 const out=[],st=sim.state;if(!mkt)return out;const gate=liveGate(sim,mkt,q,now);
 const cands=[];
 if(mkt.total!=null){[['over',mkt.overOdds,mkt.underOdds],['under',mkt.underOdds,mkt.overOdds]].forEach(([k,p,o])=>cands.push({market:'Total',key:'game',side:k==='over'?'Over':'Under',line:mkt.total,price:p,...priceSide(sim,'game',mkt.total,p,o,k)}))}
 if(mkt.homeSpread!=null){cands.push({market:'Spread',key:'game',side:st.home.name,line:mkt.homeSpread,price:mkt.homeSpreadOdds,...priceSide(sim,'game',mkt.homeSpread,mkt.homeSpreadOdds,mkt.awaySpreadOdds,'home')});
  cands.push({market:'Spread',key:'game',side:st.away.name,line:-mkt.homeSpread,price:mkt.awaySpreadOdds,...priceSide(sim,'game',-mkt.homeSpread,mkt.awaySpreadOdds,mkt.homeSpreadOdds,'away')})}
 if(mkt.homeML!=null&&mkt.awayML!=null){cands.push({market:'Moneyline',key:'game',side:st.home.name,line:null,price:mkt.homeML,...priceSide(sim,'game',null,mkt.homeML,mkt.awayML,'home')});
  cands.push({market:'Moneyline',key:'game',side:st.away.name,line:null,price:mkt.awayML,...priceSide(sim,'game',null,mkt.awayML,mkt.homeML,'away')})}
 cands.forEach(c=>{const g=grade(c,cfg);c.rule=g;c.gate=gate;c.confidence=gate.confidence.level;c.qualifies=g.ok&&gate.ok;c.book=mkt.book;c.paper=true;
  c.id=[st.id,c.market,c.side,c.line].join('|');c.modelVersion=VERSION;c.why=explain(sim,c);out.push(c)});
 return out.sort((a,b)=>(b.qualifies-a.qualifies)||((b.ev||-9)-(a.ev||-9)));
}
function explain(sim,c){
 const R=sim.rates,s=sim.summary('game'),m=sim.summary('game:m'),w=[];
 if(c.market==='Total')w.push(`Projected total ${s.mean.toFixed(1)} (80% range ${s.lo}–${s.hi}) vs the ${c.line} line.`);
 else w.push(`Projected ${sim.state.home.name} margin ${m.mean>=0?'+':''}${m.mean.toFixed(1)} (80% range ${m.lo}–${m.hi}).`);
 if(R.obsPace!=null)w.push(`Pace ${R.obsPace.toFixed(1)} possessions so far vs ${R.pace0.toFixed(1)} expected pregame; the model uses ${R.pace.toFixed(1)}.`);
 if(R.obsPpm!=null)w.push(`Scoring ${R.obsPpm.toFixed(2)} points a minute so far vs ${R.ppm0.toFixed(2)} expected pregame; the model uses ${R.ppm.toFixed(2)} for the rest (${Math.round(R.wRate*100)}% live, the rest pregame, to allow for shooting regression).`);
 w.push(`Model ${pctTxt(c.p)} vs ${c.novig!=null?pctTxt(c.novig)+' no-vig':'book'}; fair price ${c.fair>0?'+':''}${c.fair}.`);
 if(sim.otRate()>.04&&c.market!=='Moneyline')w.push(`Overtime chance ${pctTxt(sim.otRate())}.`);
 return w;
}

/* ---------- data quality ---------- */
/* Stale: the game is in progress but neither the clock nor the score has moved for staleSec of wall time (timeouts and reviews can do this too). */
function freshness(prev,next,now,staleSec){
 staleSec=staleSec||180;const age=next.fetched!=null?(now-next.fetched)/1000:null;
 const same=prev&&prev.status==='in'&&next.status==='in'&&prev.period===next.period&&prev.clock===next.clock&&prev.home.pts===next.home.pts&&prev.away.pts===next.away.pts&&!(next.clock<=0);
 const since=same?(prev.stillSince||prev.fetched):next.fetched;
 const stale=!!((age!=null&&age>staleSec)||(same&&(now-since)/1000>staleSec));
 return{stale,since,age,why:stale?(age>staleSec?`Last update ${Math.round(age)} s ago.`:`Clock and score unchanged for ${Math.round((now-since)/1000)} s (timeout, review, or a stalled feed).`):''};
}
/* Two feeds for one game (scoreboard vs summary). Disagreement blocks picks until they match. */
function reconcile(a,b){
 if(!a||!b)return{conflict:false,why:''};
 const d=[];if(a.home.pts!==b.home.pts||a.away.pts!==b.away.pts)d.push(`score ${a.away.pts}-${a.home.pts} vs ${b.away.pts}-${b.home.pts}`);
 if(a.period!==b.period)d.push(`period ${a.period} vs ${b.period}`);
 return{conflict:d.length>0,why:d.length?'Scoreboard and box score disagree: '+d.join('; ')+'.':''};
}

/* ---------- alerts ---------- */
const ALERT_DEFAULTS={quarter:true,projection:true,projDelta:3,line:true,lineDelta:1,opportunity:true,player:true};
function alertsFor(prev,next,ctx,cfg,seen){
 cfg=Object.assign({},ALERT_DEFAULTS,cfg||{});const out=[],st=next.state,id=st.id,nm=`${st.away.abbr} @ ${st.home.abbr}`;
 const push=(key,type,text)=>{if(seen.has(key))return;seen.add(key);out.push({key,type,game:id,text,at:ctx.now})};
 if(cfg.quarter&&prev&&prev.state){const p=prev.state;
  if(st.status==='in'&&(p.period!==st.period||p.status!=='in'))push(`${id}|start|${st.period}`,'quarter',`${nm}: ${periodName(st.period)} started. ${st.away.abbr} ${st.away.pts}, ${st.home.abbr} ${st.home.pts}.`);
  const endedP=st.clock<=0&&st.status==='in'?st.period:st.status==='post'?st.period:null;
  if(endedP)push(`${id}|end|${endedP}`,'quarter',`${nm}: end of ${periodName(endedP)}${st.status==='post'?' (final)':''}. ${st.away.abbr} ${st.away.pts}, ${st.home.abbr} ${st.home.pts}.`)}
 if(cfg.projection&&next.proj!=null){const a=ctx.anchor[id];
  if(a==null)ctx.anchor[id]=next.proj;else if(Math.abs(next.proj-a)>=cfg.projDelta){push(`${id}|proj|${Math.round(next.proj*2)/2}|${st.period}|${Math.round(st.clock/60)}`,'projection',`${nm}: projected total moved ${a.toFixed(1)} → ${next.proj.toFixed(1)}.`);ctx.anchor[id]=next.proj}}
 if(cfg.line&&prev&&prev.market&&next.market){const a=prev.market,b=next.market;
  if(a.total!=null&&b.total!=null&&Math.abs(b.total-a.total)>=cfg.lineDelta)push(`${id}|tot|${b.total}`,'line',`${nm}: live total ${a.total} → ${b.total} (${b.book}).`);
  if(a.homeSpread!=null&&b.homeSpread!=null&&Math.abs(b.homeSpread-a.homeSpread)>=cfg.lineDelta)push(`${id}|spr|${b.homeSpread}`,'line',`${nm}: ${st.home.abbr} spread ${a.homeSpread} → ${b.homeSpread}.`);
  if(!a.suspended&&b.suspended)push(`${id}|susp|${st.period}|${Math.round(st.clock)}`,'line',`${nm}: live market suspended.`)}
 if(cfg.opportunity)(next.opps||[]).filter(o=>o.qualifies).forEach(o=>push(`${id}|opp|${o.market}|${o.side}|${o.line}`,'opportunity',`${nm}: Paper pick ${o.side} ${o.line!=null?o.line:''} ${o.market} at ${o.price>0?'+':''}${o.price}, edge ${(o.edge*100).toFixed(1)} pts.`));
 if(cfg.player){(st.players||[]).forEach(pl=>{
  if(pl.pf>=6)push(`${id}|fo|${pl.id}`,'player',`${nm}: ${pl.name} fouled out.`);
  else if(st.period<=4&&pl.pf>=FOUL_TROUBLE[st.period]&&pl.starter)push(`${id}|ft|${pl.id}|${pl.pf}`,'player',`${nm}: ${pl.name} in foul trouble (${pl.pf} fouls, ${periodName(st.period)}).`);
  if(pl.injuryNote)push(`${id}|inj|${pl.id}`,'player',`${nm}: ${pl.name}: ${pl.injuryNote}`)})}
 return out;
}

/* ---------- paper trading ---------- */
function settle(rec,st){
 if(st.status!=='post')return null;const h=st.home.pts,a=st.away.pts,m=h-a,t=h+a;let res;
 if(rec.market==='Total')res=t===rec.line?'push':(rec.side==='Over')===(t>rec.line)?'win':'loss';
 else if(rec.market==='Spread'){const isH=rec.side===st.home.name,v=(isH?m:-m)+rec.line;res=v===0?'push':v>0?'win':'loss'}
 else{const isH=rec.side===st.home.name;res=(isH?m>0:m<0)?'win':'loss'}
 return{result:res,units:res==='win'?dec(rec.price)-1:res==='push'?0:-1};
}

const api={VERSION,NBA,RULES,ALERT_DEFAULTS,MKEYS,parseClock,elapsedMin,remainingRegMin,periodName,periodLen,mulberry32,hashStr,imp,dec,fair,noVig,
 possOf,baseline,rates,simulate,projectPlayer,playerHistory,confidence,grade,liveGate,priceSide,opportunities,freshness,reconcile,alertsFor,settle};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LiveEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
