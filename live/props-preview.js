/* Prop checks by game for NFL and NBA (preview, pending owner approval), in Stamped's card style with team logos.
   Reads data/nfl_week.json and data/nba_today.json (tools/props.js: ESPN games, injuries, DraftKings lines via ESPN,
   ESPN game logs, DFF) and re-checks them every 5 minutes. NBA Over lines carry DraftKings' "X or more" price; NFL props
   have no prices on ESPN, so those are leans on the line. */
(function(){
'use strict';
/* Cushion steps and matchup thresholds match Stamped's prop rules for each league. */
const LG={
 nfl:{file:'data/nfl_week.json',tot:32,fav:23,bad:10,label:'This week',
  STEP:{'rush yds':5,'rec yds':5,receptions:1,'pass yds':10,'pass TDs':1},POSN:{QB:'quarterbacks',RB:'running backs',WR:'receivers',TE:'tight ends'}},
 nba:{file:'data/nba_today.json',tot:30,fav:21,bad:10,label:'Tonight',
  STEP:{points:2,rebounds:1,assists:1,threes:1,PRA:3},POSN:{PG:'point guards',SG:'shooting guards',SF:'small forwards',PF:'power forwards',C:'centers',G:'guards',F:'forwards'}}};
const S={nfl:{data:null,sig:null},nba:{data:null,sig:null}},open=new Set();let onChange=null;
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const et=w=>new Date(w+':00-05:00');
const when=w=>et(w).toLocaleString('en-US',{weekday:'short',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET';
const fo=o=>o>0?'+'+o:String(o);
const logo=u=>u?`<img class="tlogo" src="${esc(u)}" alt="" width="20" height="20" loading="lazy">`:'';
const ord=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0])};

/* Kalshi prices (data/kalshi_<sport>.json). A contract pays $1; buying at the ask plus Kalshi's taker fee
   (about 7% x p x (1-p)) gives the cost, converted to American odds. Quotes wider than 5 cents are ignored as too thin. */
const K={};
const kAm=ask=>{const p=Math.min(.99,ask+.07*ask*(1-ask));return p>=.5?Math.round(-100*p/(1-p)):Math.round(100*(1-p)/p)};
function kQuote(lg,name,stat,T,side){const P=K[lg]&&K[lg].props[`${norm(name)}|${stat}`],q=P&&P[T];if(!q)return null;
 const ask=side==='Under'?q.na:q.ya,bid=side==='Under'?q.nb:q.yb;if(ask==null||bid==null||ask-bid>.05||ask<.03||ask>.97)return null;
 return{odds:kAm(ask),cents:Math.round(ask*100),src:'Kalshi'}}
/* Price for a side of a line: DraftKings via ESPN when posted (NBA main lines carry both sides; Over alts come from the
   "X or more" ladder), otherwise Kalshi (Over = Yes, Under = No on "line+" ). */
function priceFor(p,pr,side,L){L=L==null?pr.line:L;const T=Math.floor(L)+1;
 if(side==='Over'&&L===pr.line&&pr.odds!=null)return{odds:pr.odds,src:'DraftKings',book:pr.book};
 if(side==='Under'&&L===pr.line&&pr.under!=null)return{odds:pr.under,src:'DraftKings',book:pr.book};
 if(side==='Over'){const a=(pr.alts||[]).find(x=>x.t===T&&x.odds!=null);if(a)return{odds:a.odds,src:'DraftKings',book:`DraftKings (${T}+ via ESPN)`}}
 const k=kQuote(p.lg,p.name,pr.stat,T,side);return k?Object.assign(k,{book:`Kalshi ${side==='Under'?'No':'Yes'} on ${T}+ at ${k.cents}¢ incl. fee`}):null}
/* Stamped % for a prop: the market's fair chance, because nothing tested beats it (tools/tune-props.js, 20,279 past NBA
   props: last 5, last 10, season average, minutes, teammates out, opponent by position, back-to-backs and home/away added
   nothing to the posted price). Fair = the Over/Under pair with the book's cut removed; with one side only, that price less
   the typical cut (3.5 points); Kalshi uses the middle of its Yes quotes. NBA Overs land about 1 point less often than the
   fair price says, so they get 1 point off. NFL props have no prices, so no Stamped %. */
const ip=o=>o>0?100/(o+100):-o/(-o+100);
function fair(p,pr,side){let po=null;
 if(pr.odds!=null&&pr.under!=null)po=ip(pr.odds)/(ip(pr.odds)+ip(pr.under));
 else{const P=K[p.lg]&&K[p.lg].props[`${norm(p.name)}|${pr.stat}`],q=P&&P[Math.floor(pr.line)+1];
  if(q&&q.yb!=null&&q.ya!=null&&q.ya-q.yb<=.05)po=(q.yb+q.ya)/2;
  else if(side==='Over'&&pr.odds!=null)po=ip(pr.odds)-.035;
  else if(side==='Under'&&pr.under!=null)po=1-(ip(pr.under)-.035)}
 if(po==null)return null;if(p.lg==='nba')po-=.01;po=Math.min(.97,Math.max(.03,po));return Math.round(100*(side==='Under'?1-po:po))}
function lean(p,pr){const C=LG[p.lg];
 if(p.status==='out'||p.status==='doubtful')return null;
 const smp=(p.games||[]).filter(g=>g.s&&g.s[pr.stat]!=null).slice(0,5),n=smp.length;if(n<3)return null;
 const v=smp.map(g=>g.s[pr.stat]),avg=v.reduce((a,b)=>a+b,0)/n,L=pr.line,half=(C.STEP[pr.stat]||1)*.5;
 const over=v.filter(x=>x>L).length,under=v.filter(x=>x<L).length;
 let side=null;if(over/n>=.6&&avg-L>=half)side='Over';else if(under/n>=.6&&L-avg>=half)side='Under';
 const d=p.dff,ratio=d&&(d.l5||d.szn)?d.proj/(d.l5||d.szn):null,dffSide=ratio==null?null:ratio>=1.05?'Over':ratio<=.95?'Under':null;
 const rank=d&&d.dvp,grade=rank==null?null:rank>=C.fav?'favorable':rank<=C.bad?'hostile':'neutral';
 const r={p,pr,v,n,avg,over,under,ratio,dffSide,grade,rank,side,str:'',why:'',hits:v.map(x=>side==='Under'?x<L:x>L)};
 if(p.status==='questionable'){r.review='Questionable. No lean until he is cleared to play.';return r}
 /* Stamped's rule: nothing is recommended until the matchup is checked. DFF supplies it, so games off the DFF slate wait. */
 if(rank==null){r.review='Matchup not checked yet: this game is not on the DailyFantasyFuel slate.';return r}
 if(!side){r.why=`Split: ${over} over and ${under} under ${L} in his last ${n} (${v.join(', ')}), averaging ${avg.toFixed(1)}. Nothing to suggest.`;return r}
 /* The side's price (DraftKings or Kalshi). No price cap: the -160 rule was removed (owner, 2026-11-06). */
 r.price=priceFor(p,pr,side);
 const k=side==='Over'?over:under,against=(grade&&((side==='Over'&&grade==='hostile')||(side==='Under'&&grade==='favorable'))?1:0)+(dffSide&&dffSide!==side?1:0);
 /* Internal levels (not shown on cards since the owner dropped the Strong/Moderate label, 2026-11-06): disagreement drops a
    4-of-5 lean to a 3-of-5 level and a 3-of-5 lean to no lean; longshots (+150 or longer) cap at the lower level. */
 let lvl=(k>=4?2:1)-against;const long=!!(r.price&&r.price.odds>=150);if(long)lvl=Math.min(lvl,1);
 r.str=lvl>=2?'Strong':lvl===1?'Moderate':'';if(!r.str){r.side=null;r.why=`${side} ${L} in ${k} of ${n}, but the matchup${dffSide&&dffSide!==side?' and DFF':''} point the other way. No lean.`;return r}
 r.k=k;r.long=long;r.why=`${side} ${L} in ${k} of his last ${n} (${v.join(', ')}), averaging ${avg.toFixed(1)}.${long?' Longshot price: small stakes only.':''}`;
 const agree=(dffSide===side?1:0)+((side==='Over'&&grade==='favorable')||(side==='Under'&&grade==='hostile')?1:0);
 r.score=lvl*10+agree*3+k/n+Math.abs(avg-L)/(C.STEP[pr.stat]||1)/10;return r;
}
/* Best alt line for a lean. Overs use DraftKings' "X or more" ladder (NBA rungs are priced; NFL rungs list the line only);
   Unders step one line either way. Pays more: a harder line he still cleared in 4 of 5, not into a tough matchup.
   Safer: an easier line he cleared every time. A priced rung must be under +300 (Stamped rule). */
function alt(r){if(!r||!r.side||r.review)return null;const p=r.pr,v=r.v,n=r.n,st=LG[r.p.lg].STEP[p.stat]||1,need=Math.ceil(.8*n),ok=o=>o==null||o<300;
 const helps=r.side==='Over'?r.grade!=='hostile':r.grade!=='favorable';let up=null,safe=null;
 if(r.side==='Over'){const kl=K[r.p.lg]&&K[r.p.lg].props[`${norm(r.p.name)}|${p.stat}`]||{};
  /* Rungs from DraftKings' ladder and Kalshi's; each priced by DraftKings when it has a price, otherwise Kalshi. */
  const ts=[...new Set([...(p.alts||[]).map(a=>a.t),...Object.keys(kl).map(Number)])];
  const lad=ts.filter(t=>t!==Math.floor(p.line)+1).map(t=>{const pz=priceFor(r.p,p,'Over',t-.5);return{t,odds:pz?pz.odds:null,src:pz&&pz.src}}).filter(a=>ok(a.odds)),hit=t=>v.filter(x=>x>=t).length;
  if(helps)up=lad.filter(a=>a.t>p.line+.5&&hit(a.t)>=need).sort((a,b)=>b.t-a.t)[0];
  safe=lad.filter(a=>a.t<p.line&&hit(a.t)===n).sort((a,b)=>b.t-a.t)[0];
  const mk=(a,kind)=>a&&{kind,side:'Over',line:a.t-.5,rung:`${a.t}+`,k:hit(a.t),n,odds:a.odds,src:a.src};up=mk(up,'Pays more');safe=mk(safe,'Safer')}
 else{const hit=L=>v.filter(x=>x<L).length,dn=+(p.line-st).toFixed(1),upL=+(p.line+st).toFixed(1),pz=L=>priceFor(r.p,p,'Under',L);
  if(helps&&dn>0&&hit(dn)>=need){const z=pz(dn);if(ok(z&&z.odds))up={kind:'Pays more',side:'Under',line:dn,k:hit(dn),n,odds:z?z.odds:null,src:z&&z.src}}
  if(hit(upL)===n){const z=pz(upL);if(ok(z&&z.odds))safe={kind:'Safer',side:'Under',line:upL,k:n,n,odds:z?z.odds:null,src:z&&z.src}}}
 return r.str==='Strong'?(up||safe):(safe||up)}
const leansFor=players=>{const out=[];players.forEach(p=>(p.props||[]).forEach(pr=>{const r=lean(p,pr);if(r)out.push(r)}));return out};
function mline(r){if(r.grade==null)return '';const C=LG[r.p.lg],g=r.side==='Under'?(r.grade==='favorable'?'hostile':r.grade==='hostile'?'favorable':r.grade):r.grade;
 const lab=g==='favorable'?'Matchup helps':g==='hostile'?'Tough matchup':'Average matchup',cls=g==='favorable'?'p-pick':g==='hostile'?'p-stay':'p-long';
 const opp=(r.p.opp||'').replace(/^(vs|@) /,''),pos=C.POSN[r.p.pos]||'his position',T=C.tot;
 const desc=r.rank>=C.fav?`${opp} allow the ${T+1-r.rank===1?'':ord(T+1-r.rank)+'-'}most fantasy points to ${pos}`:r.rank<=C.bad?`${opp} allow the ${r.rank===1?'':ord(r.rank)+'-'}fewest fantasy points to ${pos}`:`${opp} are about average against ${pos} (${ord(r.rank)} of ${T})`;
 return `<div class="mline"><span class="pill ${cls}">${lab}${r.side==='Under'?' (Under)':''}</span><span class="cap">${esc(desc)}, last 5 (DFF).</span></div>`}
function dffLine(r){const d=r.p.dff;if(!d)return '';const t=r.ratio>=1.05?'above':r.ratio<=.95?'below':'in line with';
 return `<div class="cap"><span class="pill p-long">DFF</span> Projects ${d.proj.toFixed(1)} DK pts, ${t} his recent ${(d.l5||d.szn).toFixed(1)}${r.side&&r.dffSide?(r.dffSide===r.side?' · agrees':' · disagrees'):''}</div>`}
function spark(r){const mx=Math.max(...r.v,r.pr.line,1),s=[...r.v].reverse(),h=[...r.hits].reverse();
 return `<span class="spark" aria-hidden="true">${s.map((x,i)=>`<i style="height:${Math.round(Math.max(.12,x/mx)*22)}px;background:var(${h[i]?'--hit':'--miss'})"></i>`).join('')}</span>`}
function card(r){const p=r.p,pill=r.review?'<span class="pill p-long">Under review</span>':r.side?`<span class="pill p-pick">Lean ${r.side}</span>`:'<span class="pill p-stay">No lean</span>';
 const pz=r.price||priceFor(p,r.pr,r.side||'Over'),price=pz?`<span class="odds">${fo(pz.odds)}</span>`:'',pct=fair(p,r.pr,r.side||'Over');
 return `<button class="card" data-prev-p="${esc(p.lg+'|'+p.id)}">
  <div class="row between"><div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="team">${logo(p.logo)}${esc(p.team)} · ${esc(p.pos)}</div><div class="team">${when(p.when)} · ${esc(p.opp)}</div></div>${pill}</div>
  <div class="row"><span class="prop">${r.side||'Over'} ${r.pr.line} ${esc(r.pr.stat)}</span>${price}${spark(r)}</div>
  ${pct!=null?`<div class="cap"><b>Stamped ${pct}%</b> chance of ${r.side||'Over'} ${r.pr.line} · Vegas says ${fo(pz?pz.odds:r.pr.odds)}</div>`:''}
  <div class="${r.side?'why':'reason'}">${esc(r.review||r.why)}</div>
  ${mline(r)}${dffLine(r)}
  ${(a=>a?`<div class="cap"><span class="pill p-long">Alt</span> ${a.side} ${a.line}${a.rung?` (${a.rung})`:''} ${esc(r.pr.stat)}${a.odds!=null?` at <b>${fo(a.odds)}</b> ${esc(a.src||'')}`:''} · ${a.k} of ${a.n} · ${a.kind.toLowerCase()}${a.odds==null?' · check the alt price':''}</div>`:'')(alt(r))}
  ${p.injury&&p.status!=='active'?`<div class="flag">${esc(p.status[0].toUpperCase()+p.status.slice(1))}${p.injury.detail?`: ${esc(p.injury.detail)}`:''}</div>`:''}
  <div class="cap">${pz?esc(pz.book):'DraftKings line via ESPN · price not posted'} · Preview</div>
 </button>`}
/* Prop checks grouped by game: one collapsible section per game, leans strongest first. Open sections stay open across refreshes. */
function checks(players){const all=leansFor(players);return{good:all.filter(r=>r.side&&!r.review).sort((a,b)=>b.score-a.score),rest:all.filter(r=>!r.side||r.review)}}
/* Collapsible inner section that stays open across refreshes (key must be unique). */
const sub=(key,title,inner)=>`<details class="lv-sec" data-prev-sec="${esc(key)}" ${open.has(key)?'open':''}><summary>${title}</summary><div class="lv-secbody">${open.has(key)?inner:''}</div></details>`;
/* Injury report by team with the reason (ESPN), refreshed with every run. */
function injHTML(g){const I=g.injuries;if(!I)return '';
 return ['away','home'].map(s=>{const L=I[s]||[],t=g[s];
  return sub(`${g.id}|inj|${s}`,`${logo(t.logo)}${esc(t.n)} injuries (${L.length})`,L.length?L.map(x=>`<div class="lv-dffrow"><div class="row between"><span><b>${esc(x.name)}</b> <span class="cap">${esc(x.pos||'')}</span></span><span class="${/out|reserve/i.test(x.status)?'dn':'wn'}">${esc(x.status)}</span></div>${x.why||x.ret?`<div class="cap">${esc(x.why||'Reason not given')}${x.ret?` · expected back ${esc(x.ret.slice(5).replace('-','/'))}`:''}</div>`:''}</div>`).join(''):'<div class="cap">No injuries reported.</div>')}).join('')}
const mlTxt=g=>g.ml&&(g.ml.away!=null||g.ml.home!=null)?` · ML ${esc(g.away.abbr)} ${g.ml.away!=null?fo(g.ml.away):'—'} / ${esc(g.home.abbr)} ${g.ml.home!=null?fo(g.ml.home):'—'}`:'';
function gameSec(g,players){const {good,rest}=checks(players),isOpen=open.has(g.id);
 return `<details class="lv-sec nflw-sec" data-prev-sec="${esc(g.id)}" ${isOpen?'open':''}><summary>
  <span class="nflw-h"><span class="nflw-m">${logo(g.away.logo)}<b>${esc(g.away.abbr)}</b><span class="cap">@</span>${logo(g.home.logo)}<b>${esc(g.home.abbr)}</b></span>
  <span class="cap">${when(g.when)}${g.details?` · ${esc(g.details)}`:''}${g.total?` · O/U ${g.total}`:''}</span>${mlTxt(g)?`<span class="cap">${mlTxt(g).slice(3)}</span>`:''}</span>
  <span class="pill ${good.length?'p-pick':'p-stay'}">${good.length?`${good.length} lean${good.length>1?'s':''}`:players.length?'No leans':'No lines yet'}</span></summary>
  <div class="lv-secbody">${isOpen?`${injHTML(g)}${good.length?`<div class="list">${good.map(card).join('')}</div>`:`<div class="cap">${players.length?"None of this game's lines has enough support yet.":'DraftKings has not posted player props for this game yet.'}</div>`}
   ${rest.length?sub(`${g.id}|rest`,`No lean or under review (${rest.length})`,`<div class="list">${rest.map(card).join('')}</div>`):''}`:''}</div></details>`}
/* exclude: names already covered by Stamped's daily data (their own cards keep the full rules). */
function gamesHTML(lg,exclude){const D=S[lg]&&S[lg].data;if(!D)return '';const ex=new Set((exclude||[]).map(s=>s.toLowerCase())),now=Date.now();
 const up=D.games.filter(g=>et(g.when).getTime()>now&&g.status!=='post');if(!up.length)return '';
 return `<div class="list">${up.map(g=>gameSec(g,D.players.filter(p=>p.gameId===g.id&&!ex.has(p.name.toLowerCase())))).join('')}</div>`}
const note=lg=>`Each lean uses his last 5 games, the matchup and DailyFantasyFuel's projection.${lg==='nfl'?" NFL prop prices aren't available, so check the price in your book.":' Prices are DraftKings via ESPN. Stamped % is the fair chance from the price. Tested on 12,339 past NBA props, last-5 leans won 52.5% and lost about 5% at the posted prices, so treat them as practice.'}`;
/* Before Stamped's daily picks are out: every upcoming game for the league. */
function weekHTML(lg){const h=gamesHTML(lg,[]);if(!h)return '';
 return `<div class="cap">${LG[lg].label}'s prop checks by game, updated ${esc(S[lg].data.checked)}. Preview: stamps still post under the usual rules. ${note(lg)}</div><h2 class="sec">${LG[lg].label}</h2>${h}`}
/* With Stamped's daily picks out: players its data does not cover. */
function moreHTML(lg,exclude){const h=gamesHTML(lg,exclude);return h?`<h2 class="sec">More props · Preview</h2><div class="cap">Players outside today's Stamped data, updated ${esc(S[lg].data.checked)}. Not stamped. ${note(lg)}</div>${h}`:''}

/* Parlays from the strongest leans: one leg per game and per player, each leg in its safest form (an easier alt he cleared
   every time when there is one), every leg cleared in at least 4 of 5.
   Combined price only when every leg is priced. */
const dec=o=>o>0?1+o/100:1+100/-o,am=d=>d>=2?Math.round((d-1)*100):Math.round(-100/(d-1));
function legOf(r){const a=alt(r),use=a&&a.kind==='Safer'?a:null,k=use?use.k:r.k,odds=use?use.odds:(r.price?r.price.odds:null);
 if(!k||k<Math.ceil(.8*r.n))return null;
 return{r,side:use?use.side:r.side,line:use?use.line:r.pr.line,rung:use&&use.rung,k,n:r.n,odds,score:k/r.n*10+r.score}}
function parlaysHTML(lg){const D=S[lg]&&S[lg].data;if(!D)return '';const now=Date.now(),games=D.games.filter(g=>et(g.when).getTime()>now&&g.status!=='post');
 const legs=checks(D.players.filter(p=>games.some(g=>g.id===p.gameId))).good.map(legOf).filter(Boolean).sort((a,b)=>b.score-a.score);
 const pick=size=>{const out=[],gs=new Set(),ps=new Set();for(const l of legs){if(gs.has(l.r.p.gameId)||ps.has(l.r.p.id))continue;out.push(l);gs.add(l.r.p.gameId);ps.add(l.r.p.id);if(out.length===size)break}return out.length===size?out:null};
 const show=(title,L)=>{if(!L)return '';const priced=L.every(l=>l.odds!=null),price=priced?am(L.reduce((a,l)=>a*dec(l.odds),1)):null;
  return `<div class="card"><div class="row between"><div class="pname">${title}</div><span class="pill p-long">Preview</span></div>
   ${L.map(l=>`<div class="row between lv-leg"><span>${logo(l.r.p.logo)}<b>${esc(l.r.p.name)}</b> <span class="cap">${l.side} ${l.line}${l.rung?` (${l.rung})`:''} ${esc(l.r.pr.stat)}</span></span><span class="cap">${l.k}/${l.n}${l.odds!=null?` · ${fo(l.odds)}`:''}</span></div>`).join('')}
   <div class="cap">${priced?`DraftKings legs price to about <b>${fo(price)}</b> together; confirm the parlay price in your book.`:'Some legs have no posted price, so check the parlay price in your book.'} Each leg is from a different game.</div></div>`};
 const two=pick(2),three=pick(3),four=pick(4);
 if(!two)return `<h2 class="sec">${lg.toUpperCase()} parlays · Preview</h2><div class="empty"><h3>Not enough strong legs yet</h3>Parlays need leans from different games that hit in at least 4 of their last 5. Lines are still posting.</div>`;
 return `<h2 class="sec">${lg.toUpperCase()} parlays · Preview</h2><div class="cap">Built from ${LG[lg].label.toLowerCase()}'s strongest leans, updated ${esc(D.checked)}. Every leg must clear Stamped's rules on its own; parlays multiply risk, so stakes should stay small.</div>
  <div class="list">${show('2-leg',two)}${show('3-leg',three)}${show('4-leg',four)}</div>`}

/* Upcoming games for a league, so screens that only know about today can say what is coming instead of "no games". */
function upcoming(lg){const D=S[lg]&&S[lg].data;if(!D)return[];const now=Date.now();return D.games.filter(g=>et(g.when).getTime()>now&&g.status!=='post').sort((a,b)=>a.when<b.when?-1:1)}
function next(lg){const up=upcoming(lg);if(!up.length)return null;
 const days=[...new Set(up.map(g=>et(g.when).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'America/New_York'})))];
 return{n:up.length,first:up[0],when:when(up[0].when),label:days.length>1?`${days[0]} – ${days[days.length-1]}`:days[0]}}
/* Teams view before game day: each game with spread, total, moneylines and injury counts. */
function teamsHTML(lg){const up=upcoming(lg);if(!up.length)return '';
 return `<div class="list">${up.map(g=>{const I=g.injuries||{away:[],home:[]},ml=s=>g.ml&&g.ml[s]!=null?fo(g.ml[s]):'—';
  return `<div class="card lv-row"><div class="row between"><span class="nflw-m">${logo(g.away.logo)}<b>${esc(g.away.abbr)}</b><span class="cap">@</span>${logo(g.home.logo)}<b>${esc(g.home.abbr)}</b></span><span class="cap">${when(g.when)}</span></div>
   <div class="row between"><span class="cap">${esc(g.away.n)} <b>${ml('away')}</b> · ${esc(g.home.n)} <b>${ml('home')}</b></span><span class="cap">${g.details?esc(g.details):''}${g.total?` · O/U ${g.total}`:''}</span></div>
   <div class="cap">Injuries: ${esc(g.away.abbr)} ${I.away.length} · ${esc(g.home.abbr)} ${I.home.length}${g.book?` · odds ${esc(g.book)} via ESPN`:''}</div></div>`}).join('')}</div>
  <div class="cap">Moneylines, spreads and totals update with every refresh. Team picks are stamped on game day.</div>`}
/* Injuries view before game day: each upcoming game's injury report by team. */
function injuriesHTML(lg){const up=upcoming(lg);if(!up.length)return '';
 return `<p class="cap">Injury reports by team from ESPN, updated ${esc(S[lg].data.checked)}.</p><div class="list">${up.map(g=>`<div class="inj"><div class="row between"><span class="nflw-m">${logo(g.away.logo)}<b>${esc(g.away.abbr)}</b><span class="cap">@</span>${logo(g.home.logo)}<b>${esc(g.home.abbr)}</b></span><span class="cap">${when(g.when)}</span></div>${injHTML(g)}</div>`).join('')}</div>`}

/* Heartbeat line under a team pick: Kalshi's market chance for the picked side over the last ~3 days (hourly),
   with Stamped's model chance as the dashed line. Green when the market is moving toward the pick, red when away. */
function ekgHTML(pts,dash){const W=300,H=46,ys=[...pts.map(x=>x[1]),dash].filter(x=>x!=null),lo=Math.max(0,Math.min(...ys)-.03),hi=Math.min(1,Math.max(...ys)+.03),Y=p=>(H-5-(p-lo)/((hi-lo)||1)*(H-10)).toFixed(1);
 let d;if(pts.length<2)d=`M0 ${Y(pts[0][1])} H${W}`;else{const dx=W/(pts.length-1);d=`M0 ${Y(pts[0][1])}`;pts.slice(1).forEach((x,i)=>{const x0=i*dx;d+=` H${(x0+dx*.7).toFixed(1)} L${(x0+dx).toFixed(1)} ${Y(x[1])}`})}
 const ch=pts.length>1?pts[pts.length-1][1]-pts[0][1]:0,dir=ch>.005?'up':ch<-.005?'dn':'flat',hrs=pts.length>1?Math.round((pts[pts.length-1][0]-pts[0][0])/3600e3):0;
 return{dir,ch,hrs,svg:`<div class="lv-ekg ${dir}"><div class="lv-ekg-plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${dash!=null?`<line x1="0" x2="${W}" y1="${Y(dash)}" y2="${Y(dash)}" class="lv-ekg-book"/>`:''}<path d="${d}" class="lv-ekg-line"/></svg><span class="lv-ekg-dot" style="top:${(Y(pts[pts.length-1][1])/H*100).toFixed(1)}%"></span></div>`}}
/* Team model inputs for a daily-data game (matched by team names): points scored/allowed per game and the DvP matchup
   score, plus the league-average points per game across this file's teams. */
function teamRating(lg,g){const D=S[lg]&&S[lg].data;if(!D)return null;
 const G=D.games.find(x=>x.away.n===g.away.n&&x.home.n===g.home.n);if(!G||G.away.ppg==null||G.home.ppg==null||G.away.pa==null||G.home.pa==null)return null;
 const all=[...new Map(D.games.flatMap(x=>[x.away,x.home]).filter(t=>t.ppg!=null).map(t=>[t.abbr,t])).values()],lgAvg=all.reduce((a,t)=>a+t.ppg,0)/all.length;
 return{away:G.away,home:G.home,lg:lgAvg}}
/* NBA team practice picks (tools/tune.js --today): today's signals and the running practice log. */
const TS={},PL={};
function teamSignal(lg,g){const D=TS[lg];return D?D.games.find(x=>x.away.n===g.away.n&&x.home.n===g.home.n)||null:null}
const teamSignalChecked=lg=>TS[lg]&&TS[lg].checked||'latest';
function practiceHTML(lg){const L=PL[lg];if(!L||!L.summary)return '';const s=L.summary,l=s.settled-s.wins;
 return `<div class="cap">Practice record since ${s.since?new Date(s.since).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'today'}: ${s.settled?`<b>${s.wins}-${l}</b>, ${s.units>=0?'+':''}${s.units.toFixed(2)} units at the opening price, line moved our way ${(s.clv*100).toFixed(1)} pts on average`:'no picks settled yet'} · ${s.picks} logged. It needs a few hundred picks before it counts as proven.</div>`}
function teamEKG(lg,g,r){const D=K[lg];if(!D||!r||!r.M)return '';
 /* Follows the pick's side (or the market favorite). Dashed line: the practice model's chance on a practice pick,
    otherwise the posted market chance. */
 const sd=r.side||(r.M.pH>=r.M.pA?'home':'away');
 const G=Object.values(D.games).find(x=>x.names[0]===g.away.n&&x.names[1]===g.home.n);if(!G||!G[sd]||G[sd].yb==null||G[sd].ya==null)return '';
 const sigl=r.status==='practice'&&teamSignal(lg,g),P=r.mk||r.M;
 const q=G[sd],pts=(q.hist&&q.hist.length?q.hist:[[Date.now(),(q.yb+q.ya)/2]]).slice(-72),model=sigl?(sd==='home'?sigl.model:1-sigl.model):(sd==='home'?P.pH:P.pA),t=g[sd];
 const e=ekgHTML(pts,model),now=Math.round(((q.yb+q.ya)/2)*100);
 return `${e.svg}<div class="lv-ekg-cap"><span>${e.dir==='flat'?`Steady ${e.hrs?`for ${e.hrs} h`:''}`:`${e.dir==='up'?'▲':'▼'} ${Math.abs(Math.round(e.ch*100))||'<1'}% in ${e.hrs} h`}</span><span>- - - ${sigl?'Model':'Stamped'} ${Math.round(model*100)}%</span></div>
  <div class="cap">Kalshi market: ${esc(t.n)} ${now}% to win now (${q.yb!=null?Math.round(q.yb*100):'—'}–${q.ya!=null?Math.round(q.ya*100):'—'}¢, ≈ ${q.ya!=null?fo(kAm(q.ya)):'—'} incl. fee) · ${esc(D.checked)}</div></div>`}

function sheetHTML(key){const [lg,id]=key.split('|'),D=S[lg]&&S[lg].data,p=D&&D.players.find(x=>x.id===id);if(!p)return '';const stats=[...new Set(p.props.map(x=>x.stat))];
 return `<div class="grab"></div>
 <div class="shead"><div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="team">${logo(p.logo)}${esc(p.team)} · ${esc(p.pos)} · ${when(p.when)} · ${esc(p.opp)}</div></div><button class="x" id="close" aria-label="Close">×</button></div>
 <div class="list">${p.props.map(pr=>lean(p,pr)).filter(Boolean).map(card).join('')}</div>
 <div class="panel"><h4>This season</h4><table class="lv-t"><thead><tr><th>Game</th>${lg==='nba'?'<th class="num">min</th>':''}${stats.map(s=>`<th class="num">${esc(s)}</th>`).join('')}</tr></thead><tbody>
  ${p.games.slice(0,10).map(g=>`<tr><td>${esc(g.d.slice(5))} ${esc(g.vs)} <span class="cap">${esc(g.res)}</span></td>${lg==='nba'?`<td class="num">${g.min!=null?g.min:'—'}</td>`:''}${stats.map(s=>`<td class="num">${g.s[s]!=null?g.s[s]:'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
 <div class="panel"><h4>Sources</h4><div class="srcs">${p.sources.map(s=>`<div>${esc(s[0])}: ${esc(s[2])}</div>`).join('')}<div>Updated ${esc(D.checked)}</div></div></div>`}

function load(lg){return fetch(LG[lg].file+'?v='+Date.now()).then(r=>r.ok?r.json():null).then(d=>{if(d&&d.generated!==S[lg].sig){S[lg].data=d;S[lg].sig=d.generated;if(onChange)onChange(lg)}}).catch(()=>{})}
function loadK(lg){return fetch(`data/kalshi_${lg}.json?v=`+Date.now()).then(r=>r.ok?r.json():null).then(d=>{if(d&&(!K[lg]||K[lg].generated!==d.generated)){K[lg]=d;if(onChange)onChange(lg)}}).catch(()=>{})}
function loadJ(file,box,lg){return fetch(`${file}?v=`+Date.now()).then(r=>r.ok?r.json():null).then(d=>{const sig=d&&(d.generated||d.updated);if(d&&(!box[lg]||(box[lg].generated||box[lg].updated)!==sig)){box[lg]=d;if(onChange)onChange(lg)}}).catch(()=>{})}
function start(h){h=h||{};onChange=h.onChange;const all=()=>{Object.keys(LG).forEach(load);['nfl','nba','soccer'].forEach(loadK);
  loadJ('data/team_signals_nba.json',TS,'nba');loadJ('data/practice_nba_teams.json',PL,'nba')};all();setInterval(all,5*60e3);
 /* Opening a game fills in its cards (they are only built for open games, which keeps the page light). */
 document.addEventListener('toggle',e=>{const s=e.target&&e.target.dataset&&e.target.dataset.prevSec;if(!s||open.has(s)===e.target.open)return;
  if(e.target.open)open.add(s);else open.delete(s);if(e.target.open&&onChange)onChange()},true);
 document.getElementById('main').addEventListener('click',e=>{const c=e.target.closest('[data-prev-p]');if(c&&h.showSheet){document.getElementById('sheet').innerHTML=sheetHTML(c.dataset.prevP);h.showSheet()}})}
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z]/g,'');
/* A player's ESPN game log from this week's file, by name (used by the fantasy preview board). */
function player(lg,name){const D=S[lg]&&S[lg].data;if(!D)return null;const k=norm(name);return D.players.find(p=>norm(p.name)===k)||(D.logs||[]).find(p=>norm(p.name)===k)||null}
window.PREV={start,load,weekHTML,moreHTML,parlaysHTML,teamsHTML,injuriesHTML,next,player,teamEKG,teamRating,teamSignal,teamSignalChecked,practiceHTML,ready:lg=>!!(S[lg]&&S[lg].data),_lean:lean,_checks:checks};
})();
