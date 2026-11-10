/* Prop checks by game for NFL and NBA (preview, pending owner approval), in Stamped's card style with team logos.
   Reads data/nfl_week.json and data/nba_today.json (tools/props.js: ESPN games, injuries, DraftKings lines via ESPN,
   ESPN game logs and box scores) and re-checks them every 5 minutes. NBA Over lines carry DraftKings' "X or more" price; NFL props
   have no prices on ESPN, so those are leans on the line. */
(function(){
'use strict';
/* Cushion steps and matchup thresholds match Stamped's prop rules for each league. */
const LG={
 nfl:{file:'data/nfl_week.json',tot:32,fav:23,bad:10,label:'This week',
  STEP:{'rush yds':5,'rec yds':5,receptions:1,'pass yds':10,'pass TDs':1},POSN:{QB:'quarterbacks',RB:'running backs',WR:'wide receivers',TE:'tight ends'}},
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
 /* Matchup = the opponent's real stats allowed to his position (props.js, ESPN box scores; owner 2026-11-06: props use real
    stats, fantasy points stay on the Fantasy tab, so DFF's fantasy projection no longer enters the lean). */
 const vs=pr.vs;
 const rank=vs&&vs.rank,grade=rank==null?null:rank>=vs.of-(C.tot-C.fav)?'favorable':rank<=C.bad?'hostile':'neutral';
 const r={p,pr,v,n,avg,over,under,vs,grade,rank,side,str:'',why:'',hits:v.map(x=>side==='Under'?x<L:x>L)};
 if(p.status==='questionable'){r.review='Questionable. No lean until he is cleared to play.';return r}
 /* NBA (owner, 2026-11-10): the last 5 and the matchup are no longer a reason for a lean; graded against the box scores the
    last-5 lean lost to the posted price. A lean now needs a role change tonight (a regular teammate newly out, and in the
    games without him he cleared this line) or late news the line has not moved on (tools/track.js -> data/track_nba.json).
    The last 5 and the matchup stay on the card as information. NFL has no role or news data yet and keeps the old rule. */
 if(p.lg==='nba'){const T=TR.nba,form=`Last ${n}: over ${L} in ${over} (${v.join(', ')}), averaging ${avg.toFixed(1)}.`;r.side=null;r.hits=v.map(x=>x>L);
  if(!T||!p.when||T.date!==p.when.slice(0,10)){r.why=`${form} Role and late-news check not in yet. No lean.`;return r}
  const rp=(T.rp||[]).find(q=>q.aid===p.espnId&&q.stat===pr.stat&&q.line===L),f=((T.props||{})[`${p.espnId}|${pr.stat}`]||{}).flag;
  if(!rp&&!f){r.why=`${form} Recent form alone has not beaten the price, so it is not a lean. No role change or late news on this line tonight.`;return r}
  const sd=r.side=rp?'Over':f.dir;r.hits=v.map(x=>sd==='Under'?x<L:x>L);r.k=sd==='Under'?under:over;r.str='Moderate';r.price=priceFor(p,pr,sd);r.long=!!(r.price&&r.price.odds>=150);
  if(rp){r.role=rp;r.why=`Role: ${rp.with} is out. In ${rp.n} games without him: over ${L} in ${rp.k}, averaging ${rp.avg}.`}
  else{r.news=f;r.why=`Late news: ${f.name} ${f.to==='available'?'was cleared to play':'was ruled '+f.to} (${f.at}) and this line has not moved since.`}
  if(r.long)r.why+=' Longshot price: small stakes only.';
  r.score=(rp?20+rp.k/rp.n:10)+r.k/n/10;return r}
 /* Stamped's rule: nothing is recommended until the matchup is checked. */
 if(rank==null){r.review='Matchup not checked yet: not enough recent games for this defense.';return r}
 if(!side){r.why=`Split: ${over} over and ${under} under ${L} in his last ${n} (${v.join(', ')}), averaging ${avg.toFixed(1)}. Nothing to suggest.`;return r}
 /* The side's price (DraftKings or Kalshi). No price cap: the -160 rule was removed (owner, 2026-11-06). */
 r.price=priceFor(p,pr,side);
 const k=side==='Over'?over:under,against=(grade&&((side==='Over'&&grade==='hostile')||(side==='Under'&&grade==='favorable'))?1:0);
 /* Internal levels (not shown on cards since the owner dropped the Strong/Moderate label, 2026-11-06): disagreement drops a
    4-of-5 lean to a 3-of-5 level and a 3-of-5 lean to no lean; longshots (+150 or longer) cap at the lower level. */
 let lvl=(k>=4?2:1)-against;const long=!!(r.price&&r.price.odds>=150);if(long)lvl=Math.min(lvl,1);
 r.str=lvl>=2?'Strong':lvl===1?'Moderate':'';if(!r.str){r.side=null;r.why=`${side} ${L} in ${k} of ${n}, but the matchup points the other way. No lean.`;return r}
 r.k=k;r.long=long;r.why=`${side} ${L} in ${k} of his last ${n} (${v.join(', ')}), averaging ${avg.toFixed(1)}.${long?' Longshot price: small stakes only.':''}`;
 const agree=((side==='Over'&&grade==='favorable')||(side==='Under'&&grade==='hostile')?1:0);
 r.score=lvl*10+agree*3+k/n+Math.abs(avg-L)/(C.STEP[pr.stat]||1)/10;return r;
}
/* Best alt line for a lean. Overs use DraftKings' "X or more" ladder (NBA rungs are priced; NFL rungs list the line only);
   Unders step one line either way. Pays more: a harder line he still cleared in 4 of 5, not into a tough matchup.
   Safer: an easier line he cleared every time. A priced rung must be under +300 (Stamped rule). */
function alt(r){if(!r||!r.side||r.review)return null;
 /* NBA: only the role pick's own alt (the highest rung he cleared in 3 of 4 games without the teammate); no last-5 alts. */
 if(r.p.lg==='nba'){const a=r.role&&r.role.alt;return a?{kind:'Pays more',side:'Over',line:a.t-.5,rung:`${a.t}+`,k:a.k,n:r.role.n,odds:a.odds,src:'DraftKings'}:null}
 const p=r.pr,v=r.v,n=r.n,st=LG[r.p.lg].STEP[p.stat]||1,need=Math.ceil(.8*n),ok=o=>o==null||(o<300&&o>=-400);
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
 const opp=(r.p.opp||'').replace(/^(vs|@) /,''),V=r.vs,pos=C.POSN[V.pos]||'his position',st=STATW[r.pr.stat]||r.pr.stat,T=V.of;
 const where=r.rank>=T-(C.tot-C.fav)?`${T+1-r.rank===1?'':ord(T+1-r.rank)+'-'}most`:r.rank<=C.bad?`${r.rank===1?'':ord(r.rank)+'-'}fewest`:`${ord(r.rank)} of ${T}`;
 /* Tied to his bet (owner, 2026-11-06): how far this defense sits from average for his position and stat, applied to his
    last-5 average and set against tonight's line, plus his own games against this team. */
 const f=V.lg?V.avg/V.lg:1,pc=Math.round((f-1)*100),adj=r.avg*f,L=r.pr.line,dp=(C.STEP[r.pr.stat]||1)>=5?0:1;
 const vsTxt=Math.abs(pc)<3?`${esc(opp)} are about average at stopping ${st} by ${pos}`:`${esc(opp)} allow ${Math.abs(pc)}% ${pc>0?'more':'fewer'} ${st} than average to ${pos}`;
 /* Players like him (same position, season average near this line) against this defense: the most direct read on the bet. */
 const S=r.pr.sim,sd=r.side||'Over';
 const rd=L>=8?0:1,simTxt=S&&S.n>=3?`${pos[0].toUpperCase()+pos.slice(1)} who usually get ${S.lo.toFixed(rd)}–${S.hi.toFixed(rd)} ${st}, against ${esc(opp)} in its last ${V.n} games: <b>${sd==='Under'?S.under:S.over} of ${S.n}</b> ${sd==='Under'?'stayed under':'went over'} ${L} (${Math.abs(S.diff)<.05?'right at':`${Math.abs(S.diff).toFixed(dp)} ${S.diff>0?'above':'below'}`} their usual). ${esc(opp)}: ${where} ${st} to ${pos}.`:'';
 return `<div class="mline"><span class="pill ${cls}">${lab}${r.side==='Under'?' (Under)':''}</span><span class="cap">${simTxt||`${vsTxt} (${where}, last ${V.n} games). His ${r.avg.toFixed(dp)} average adjusts to about <b>${adj.toFixed(dp)}</b> tonight, ${adj>L?'over':adj<L?'under':'right at'} the ${L} line.`}</span></div>${h2h(r)}`}
/* Big chart sheet: the players like him, game by game against this defense. */
function simHTML(r){const S=r&&r.pr.sim;if(!S||!S.ex.length)return '';const L=r.pr.line,sd=r.side||'Over',hit=v=>sd==='Under'?v<L:v>L;
 return `<div class="panel"><h4>Players like him vs ${esc((r.p.opp||'').replace(/^(vs|@) /,''))}</h4><table class="lv-t"><thead><tr><th>Player</th><th>Date</th><th class="num">${esc(r.pr.stat)}</th><th class="num">His avg</th></tr></thead><tbody>
  ${S.ex.map(x=>`<tr><td>${logo(tlogo(r.p.lg,x.team))}${esc(x.name)}</td><td>${esc(x.d.slice(5).replace('-','/'))}</td><td class="num ${hit(x.v)?'up':'dn'}"><b>${x.v}</b></td><td class="num">${x.avg}</td></tr>`).join('')}</tbody></table>
  <div class="cap">Same position, season average ${S.lo}–${S.hi} (near tonight's ${L}). Green cleared ${sd} ${L}. ${sd==='Under'?S.under:S.over} of ${S.n} did in all.</div></div>`}
/* His games against tonight's opponent, this season and last (newest first, up to 4). */
function h2h(r){const p=r.p,ab=p.oppAbbr;if(!ab)return '';const st=r.pr.stat,L=r.pr.line,sd=r.side||'Over',hit=x=>sd==='Under'?x<L:x>L;
 const G=[...(p.games||[]),...(p.past||[])].filter(g=>g.vs&&g.vs.replace(/^(vs|@) /,'')===ab&&g.s&&g.s[st]!=null).slice(0,4);if(!G.length)return '';
 const k=G.filter(g=>hit(g.s[st])).length;
 return `<div class="cap"><span class="pill p-long">Vs ${esc(ab)}</span> ${G.map(g=>`<b class="${hit(g.s[st])?'up':'dn'}">${g.s[st]}</b>`).join(', ')} · ${sd} ${L} in ${k} of ${G.length}</div>`}
/* Readable stat names for the matchup line. */
const STATW={points:'points',rebounds:'rebounds',assists:'assists',threes:'3-pointers',PRA:'points + rebounds + assists','rush yds':'rushing yards','rec yds':'receiving yards',receptions:'catches','pass yds':'passing yards','pass TDs':'passing TDs'};
function spark(r){const mx=Math.max(...r.v,r.pr.line,1),s=[...r.v].reverse(),h=[...r.hits].reverse();
 return `<span class="spark" role="button" tabindex="0" aria-label="Bigger chart: last 5 games, ${esc(r.pr.stat)}" data-prev-chart="${esc([r.p.lg,r.p.id,r.pr.stat,r.side||''].join('|'))}">${s.map((x,i)=>`<i style="height:${Math.round(Math.max(.12,x/mx)*22)}px;background:var(${h[i]?'--hit':'--miss'})"></i>`).join('')}</span>`}
/* Role tonight and late news (tools/track.js -> data/track_nba.json), in real stats. Role: his games without a regular
   teammate who is out tonight, next to his games with him. Role pick: he cleared tonight's line in most of those games,
   with the best alt rung he still cleared. Late news: a regular teammate's status changed and this line has not moved.
   Since 2026-11-10 the role pick and the late-news flag are the NBA lean (see lean()); both are logged and graded every night. */
const TR={};
function roleLine(r){const T=TR[r.p.lg];if(!T||!r.p.when||T.date!==r.p.when.slice(0,10))return '';
 const R=(T.role||{})[r.p.espnId],e=(T.props||{})[`${r.p.espnId}|${r.pr.stat}`]||{},st=r.pr.stat,L=r.pr.line,w=STATW[st]||st;let h='';
 /* Up to two teammates (most minutes first); the rest are named on the last line. */
 if(R&&R.length)R.slice(0,2).forEach((x,i,A)=>{const more=i===A.length-1&&R.length>2?` Also out: ${R.slice(2).map(y=>esc(y.name)).join(', ')}.`:'';
  if(!x.n)h+=`<div class="cap"><span class="pill p-long">Role</span> First game without ${esc(x.name)} this season (he plays ${x.xmin} min a game). No games to compare yet.${more}</div>`;
  else{const v=x.v[st]||[],k=v.filter(y=>y>L).length,a=x.s[st]||[];
   if(a[0]!=null)h+=`<div class="cap"><span class="pill ${a[0]>a[1]?'p-pick':'p-long'}">Role</span> Without ${esc(x.name)} (${x.n} game${x.n>1?'s':''}): <b>${a[0]}</b> ${esc(w)} in ${x.min[0]} min. With him: ${a[1]} in ${x.min[1]} min. Over ${L} in ${k} of ${v.length} (${v.join(', ')}).${more}</div>`}});
 const rp=(T.rp||[]).find(q=>q.aid===r.p.espnId&&q.stat===st&&q.line===L);
 if(rp)h+=`<div class="cap"><span class="pill p-pick">Role pick</span> Over ${rp.line}${rp.odds!=null?` at <b>${fo(rp.odds)}</b>`:''}: cleared in ${rp.k} of ${rp.n} without ${esc(rp.with)}, averaging ${rp.avg}.${rp.alt?` Alt ${rp.alt.t}+ at <b>${fo(rp.alt.odds)}</b>: cleared in ${rp.alt.k} of ${rp.n}.`:''}</div>`;
 const px=a=>`${a[0]}${a[1]!=null?` (${fo(a[1])})`:''}`,was=(n,to)=>`${esc(n)} ${to==='available'?'was cleared to play':'was ruled '+esc(to)}`;
 if(e.flag)h+=`<div class="cap"><span class="pill p-pick">Late news</span> ${was(e.flag.name,e.flag.to)} (${esc(e.flag.at)}) and this line has not moved since. That points to the ${e.flag.dir}.</div>`;
 else if(e.moved)h+=`<div class="cap"><span class="pill p-long">Line moved</span> From ${px(e.moved.from)} to ${px(e.moved.to)} after ${was(e.moved.name,e.moved.st)} (${esc(e.moved.at)}).</div>`;
 else if(e.open&&e.open[0]!==L)h+=`<div class="cap"><span class="pill p-long">Line moved</span> Opened at ${e.open[0]}, now ${L}.</div>`;
 return h}
/* The graded record (tools/track.js): every night's picks settled against the box scores at the posted prices. */
function recordHTML(lg){const G=TR[lg]&&TR[lg].grades;if(!G||!G.days||!G.days.length)return '';const t=G.total,n=G.days.length;
 const day=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}),u=x=>`${x.u>=0?'+':''}${x.u.toFixed(1)} units`;
 const one=(lab,x)=>x&&x.n?`${lab} <b>${x.w}-${x.l}</b> (${u(x)})`:`${lab} none graded yet`;
 const rows=(G.rows||[]).filter(x=>x.cat!=='lean'),leans=(G.rows||[]).filter(x=>x.cat==='lean');
 const tr=x=>`<tr><td>${esc(x.name)} <span class="cap">${esc(x.abbr)}</span></td><td>${esc(x.side)} ${x.line} ${esc(x.stat)}${x.cat==='lean'?'':` <span class="cap">${x.cat==='news'?'late news':x.cat==='roleAlt'?'role alt':'role'}</span>`}</td><td class="num">${x.odds!=null?fo(x.odds):'—'}</td><td class="num ${x.win?'up':'dn'}"><b>${x.v}</b></td></tr>`;
 const tbl=L=>`<table class="lv-t"><thead><tr><th>Player</th><th>Pick</th><th class="num">Price</th><th class="num">Got</th></tr></thead><tbody>${L.map(tr).join('')}</tbody></table>`;
 return `<div class="cap">Graded record since ${day(G.since)} (${n} night${n>1?'s':''}, every pick settled against the box score at the posted price): ${one('role leans',t.role)} · ${one('role alts',t.roleAlt)} · ${one('late-news leans',t.news)} · ${one('retired last-5 leans (through Nov 9)',t.lean)}. For comparison, every Over on the board went ${t.allOver.w}-${t.allOver.l} and every Under ${t.allUnder.w}-${t.allUnder.l}. Since Nov 10 a lean needs a role change or late news; the sample is small until a few hundred are graded.</div>
 ${G.rows&&G.rows.length?sub(`rec|${lg}`,`Graded picks, ${day(G.rowsDate)} (${G.rows.length})`,(rows.length?tbl(rows):'')+(leans.length?tbl(leans):'')):''}`}
/* inGame: the card sits in its game's section, which already shows the start time and the price source. */
function card(r,inGame){const p=r.p,pill=r.review?'<span class="pill p-long">Under review</span>':r.side?`<span class="pill p-pick">Lean ${r.side}</span>`:'<span class="pill p-stay">No lean</span>';
 const pz=r.price||priceFor(p,r.pr,r.side||'Over'),price=pz?`<span class="odds">${fo(pz.odds)}</span>`:'',pct=fair(p,r.pr,r.side||'Over');
 return `<button class="card" data-prev-p="${esc(p.lg+'|'+p.id)}">
  <div class="row between"><div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="team">${logo(p.logo)}${esc(p.team)} · ${esc(p.pos)}${inGame?` · ${esc(p.opp)}`:''}</div>${inGame?'':`<div class="team">${when(p.when)} · ${esc(p.opp)}</div>`}</div>${pill}</div>
  <div class="row"><span class="prop">${r.side||'Over'} ${r.pr.line} ${esc(r.pr.stat)}</span>${price}${spark(r)}</div>
  ${pct!=null?`<div class="cap"><b>Stamped ${pct}%</b> chance · Vegas says ${fo(pz?pz.odds:r.pr.odds)}</div>`:''}
  <div class="${r.side?'why':'reason'}">${esc(r.review||r.why)}</div>
  ${mline(r)}
  ${roleLine(r)}
  ${(a=>a?`<div class="cap"><span class="pill p-long">Alt</span> ${a.side} ${a.line}${a.rung?` (${a.rung})`:''} ${esc(r.pr.stat)}${a.odds!=null?` at <b>${fo(a.odds)}</b> ${esc(a.src||'')}`:''} · ${a.k} of ${a.n} · ${a.kind.toLowerCase()}${a.odds==null?' · check the alt price':''}</div>`:'')(alt(r))}
  ${p.injury&&p.status!=='active'?`<div class="flag">${esc(p.status[0].toUpperCase()+p.status.slice(1))}${p.injury.detail?`: ${esc(p.injury.detail)}`:''}</div>`:''}
  ${inGame&&pz?'':`<div class="cap">${pz?esc(pz.book):'DraftKings line via ESPN · price not posted'} · Preview</div>`}
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
function gameSec(g,players,lg){const {good,rest}=checks(players),isOpen=open.has(g.id);
 return `<details class="lv-sec nflw-sec" data-prev-sec="${esc(g.id)}" ${isOpen?'open':''}><summary>
  <span class="nflw-h"><span class="nflw-m">${logo(g.away.logo)}<b>${esc(g.away.abbr)}</b><span class="cap">@</span>${logo(g.home.logo)}<b>${esc(g.home.abbr)}</b></span>
  <span class="cap">${when(g.when)}${g.details?` · ${esc(g.details)}`:''}${g.total?` · O/U ${g.total}`:''}</span>${mlTxt(g)?`<span class="cap">${mlTxt(g).slice(3)}</span>`:''}</span>
  <span class="pill ${good.length?'p-pick':'p-stay'}">${good.length?`${good.length} lean${good.length>1?'s':''}`:players.length?'No leans':'No lines yet'}</span></summary>
  <div class="lv-secbody">${isOpen?`${crowd(lg,g)}${injHTML(g)}${good.length?`<div class="list">${good.map(r=>card(r,1)).join('')}</div>`:`<div class="cap">${players.length?"None of this game's lines has enough support yet.":'DraftKings has not posted player props for this game yet.'}</div>`}
   ${rest.length?sub(`${g.id}|rest`,`No lean or under review (${rest.length})`,`<div class="list">${rest.map(r=>card(r,1)).join('')}</div>`):''}`:''}</div></details>`}
/* exclude: names already covered by Stamped's daily data (their own cards keep the full rules). */
function gamesHTML(lg,exclude){const D=S[lg]&&S[lg].data;if(!D)return '';const ex=new Set((exclude||[]).map(s=>s.toLowerCase())),now=Date.now();
 const up=D.games.filter(g=>et(g.when).getTime()>now&&g.status!=='post');if(!up.length)return '';
 return `<div class="list">${up.map(g=>gameSec(g,D.players.filter(p=>p.gameId===g.id&&!ex.has(p.name.toLowerCase())),lg)).join('')}</div>`}
const note=lg=>`Each lean uses his last 5 games and the matchup: what this defense allowed to his position in real stats (ESPN box scores).${lg==='nfl'?" NFL prop prices aren't available, so check the price in your book.":' Prices are DraftKings via ESPN. Stamped % is the fair chance from the price. Tested on 12,339 past NBA props, last-5 leans won 52.5% and lost about 5% at the posted prices, so treat them as practice.'}`;
/* Before Stamped's daily picks are out: every upcoming game for the league. */
function weekHTML(lg){const h=gamesHTML(lg,[]);if(!h)return '';
 return `<div class="cap">${LG[lg].label}'s prop checks by game, updated ${esc(S[lg].data.checked)}. Preview: stamps still post under the usual rules. ${note(lg)}</div>${recordHTML(lg)}<h2 class="sec">${LG[lg].label}</h2>${h}`}
/* With Stamped's daily picks out: players its data does not cover. */
function moreHTML(lg,exclude,link){const h=gamesHTML(lg,exclude);
 /* link: the Today tab points to Props instead of repeating every game section. */
 if(h&&link)return `<button class="card" data-mode="props"><div class="row between"><span class="prop">Player props</span><span class="pill p-long">Props →</span></div><div class="cap">Leans for every player on the slate, game by game, are on the Props tab.</div></button>`;
 return h?`<h2 class="sec">More props · Preview</h2><div class="cap">Players outside today's Stamped data, updated ${esc(S[lg].data.checked)}. Not stamped. ${note(lg)}</div>${recordHTML(lg)}${h}`:''}
/* Alts tab: each lean's best alt line (same pick as on its card), harder-paying first, then safer. Tap a row for his log. */
function altsHTML(lg){const D=S[lg]&&S[lg].data;if(!D)return '';const ids=new Set(upcoming(lg).map(g=>g.id));if(!ids.size)return '';
 const R=checks(D.players.filter(p=>ids.has(p.gameId)&&p.status!=='out'&&p.status!=='doubtful')).good.map(r=>({r,a:alt(r)})).filter(x=>x.a);
 const row=({r,a})=>{const pct=a.odds!=null?Math.round(100*Math.min(.97,Math.max(.03,ip(a.odds)-.035-(lg==='nba'?.01:0)))):null,mz=r.price||priceFor(r.p,r.pr,r.side);
  return `<button class="card" data-prev-p="${esc(r.p.lg+'|'+r.p.id)}"><div class="row between"><div style="min-width:0"><div class="pname">${esc(r.p.name)}</div><div class="team">${logo(r.p.logo)}${esc(r.p.team)} · ${esc(r.p.opp)} · ${when(r.p.when)}</div></div><span class="pill ${a.kind==='Safer'?'p-pick':'p-long'}">${a.kind}</span></div>
  <div class="row"><span class="prop">${a.side} ${a.line}${a.rung?` (${a.rung})`:''} ${esc(r.pr.stat)}</span>${a.odds!=null?`<span class="odds">${fo(a.odds)}</span>`:''}${spark(r)}</div>
  <div class="cap">Cleared it in <b>${a.k} of ${a.n}</b>${pct!=null?` · Stamped ${pct}%`:' · check the alt price in your book'} · main line ${r.side} ${r.pr.line}${mz?` at ${fo(mz.odds)}`:''}</div></button>`};
 const up=R.filter(x=>x.a.kind!=='Safer').sort((x,y)=>y.a.k/y.a.n-x.a.k/x.a.n||y.r.score-x.r.score),sf=R.filter(x=>x.a.kind==='Safer').sort((x,y)=>y.r.score-x.r.score);
 const sec=(t,a)=>a.length?`<h2 class="sec">${t} (${a.length})</h2><div class="list">${a.map(row).join('')}</div>`:'';
 return `<div class="slate"><h1>${lg.toUpperCase()} alts</h1>${R.length?`<p>${R.length} alt line${R.length>1?'s':''}</p>`:''}</div>
 <div class="cap">One alt per lean, from DraftKings' ladder and Kalshi, updated ${esc(D.checked)}. Pays more: a harder line he still cleared in 4 of 5, never into a tough matchup. Safer: an easier line he cleared every time; it pays less. No price shown: check your book. Streaks are history; Stamped % is the fair chance from the price.</div>
 ${R.length?sec('Pays more',up)+sec('Safer',sf):'<div class="empty"><h3>No alts yet</h3>No lean has an alt line its last 5 games support. The Cheatsheet lists alt rungs hit in every game.</div>'}`}

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
 if(!two)return `<h2 class="sec">${lg.toUpperCase()} parlays · Preview</h2><div class="empty"><h3>Not enough legs yet</h3>Parlays need leans from different games that hit in at least 4 of their last 5. Lines are still posting.</div>`;
 return `<h2 class="sec">${lg.toUpperCase()} parlays · Preview</h2><div class="cap">Built from ${LG[lg].label.toLowerCase()}'s best-supported leans, updated ${esc(D.checked)}. Every leg must clear Stamped's rules on its own; parlays multiply risk, so stakes should stay small.</div>
  <div class="list">${show('2-leg',two)}${show('3-leg',three)}${show('4-leg',four)}</div>`}

/* Cheatsheet (replaces Parlays for NFL and NBA, owner 2026-11-06): lines on the upcoming slate that hit in every game shown.
   Recent form = the Over hit in every game this season (5+ games); the count runs back into last season while the streak
   holds. Versus opponent = hit in every game against tonight's opponent, this season and last (2+ games). Alternate lines =
   the highest "X or more" rung he reached in every game this season, if priced no shorter than -400. Unders only = the Under at the posted line, like
   recent form. Streaks are history: the NBA prop test found past hit rates add nothing beyond the price, so every row
   also shows the price and Stamped % (fair chance from the price) when one is posted. */
const SLAB={points:'Points',rebounds:'Rebounds',assists:'Assists',threes:'3-Pointers',PRA:'Pts+Reb+Ast','rec yds':'Rec Yards','rush yds':'Rush Yards','pass yds':'Pass Yards',receptions:'Receptions','pass TDs':'Pass TDs'};
const short=n=>{const w=String(n).split(' ');return w.length>1?`${w[0][0]}. ${w.slice(1).join(' ')}`:n};
const streak=(v,f)=>{let k=0;for(const x of v){if(!f(x))break;k++}return k};
function cheatRows(lg){const D=S[lg]&&S[lg].data;if(!D)return null;const ids=new Set(upcoming(lg).map(g=>g.id)),R={form:[],opp:[],alt:[],under:[]};
 D.players.filter(p=>ids.has(p.gameId)&&p.status!=='out'&&p.status!=='doubtful').forEach(p=>(p.props||[]).forEach(pr=>{
  const st=pr.stat,cur=(p.games||[]).filter(g=>g.s&&g.s[st]!=null),all=cur.concat((p.past||[]).filter(g=>g.s&&g.s[st]!=null)),L=pr.line,n=cur.length;
  const vals=a=>a.map(g=>g.s[st]),base={p,pr,lab:SLAB[st]||st};
  if(n>=5){const ko=streak(vals(all),x=>x>L);if(ko>=n)R.form.push({...base,side:'Over',L,k:ko,n:ko});
   const ku=streak(vals(all),x=>x<L);if(ku>=n)R.under.push({...base,side:'Under',L,k:ku,n:ku});
   /* Highest rung reached in every game this season (other than the one that equals the posted Over). */
   const lo=Math.min(...vals(cur)),rung=(pr.alts||[]).filter(a=>a.t<=lo&&a.t!==Math.floor(L)+1&&(a.odds==null||a.odds>=-400)).sort((a,b)=>b.t-a.t)[0];
   const rz=rung&&priceFor(p,pr,"Over",rung.t-.5);if(rung&&!(rz&&rz.odds<-400)){const k=streak(vals(all),x=>x>=rung.t);R.alt.push({...base,side:'Over',L:rung.t-.5,rung:rung.t,k,n:k})}}
  const op=p.oppAbbr,vs=all.filter(g=>op&&new RegExp(`(^|\\s)${op}$`).test(g.vs||'')),hv=vals(vs);
  if(hv.length>=2){const side=hv.every(x=>x>L)?'Over':hv.every(x=>x<L)?'Under':null;if(side)R.opp.push({...base,side,L,k:hv.length,n:hv.length})}}));
 Object.values(R).forEach(a=>a.sort((x,y)=>y.k-x.k||x.p.name.localeCompare(y.p.name)));return R}
function cheatRow(r){const pz=priceFor(r.p,r.pr,r.side,r.L),pct=r.L===r.pr.line?fair(r.p,r.pr,r.side):pz?Math.round(100*Math.min(.97,Math.max(.03,ip(pz.odds)-.035-(r.p.lg==='nba'?.01:0)))):null;
 const what=r.rung!=null?`${r.rung}+ ${r.lab}`:`${r.side} ${r.L} ${r.lab}`;
 return `<button class="cs-row" data-prev-p="${esc(r.p.lg+'|'+r.p.id)}">${logo(r.p.logo)}<span class="cs-what"><b>${esc(short(r.p.name))}:</b> ${esc(what)}
  <small>${esc(r.p.opp)} · ${when(r.p.when)}${pz?` · ${fo(pz.odds)}${/draftkings/i.test(pz.src||'')?'':' '+esc(pz.src)}`:''}${pct!=null?` · Stamped ${pct}%`:''}</small></span><span class="cs-k">${r.k}/${r.n}</span></button>`}
function cheatHTML(lg){const R=cheatRows(lg);if(!R)return '<div class="empty"><h3>Loading</h3>Prop lines are loading.</div>';const D=S[lg].data,MAX=8;
 const box=(icon,title,sub,a)=>`<div class="cs-box"><div class="cs-h"><span aria-hidden="true">${icon}</span><b>${title}</b></div>${a.length?a.slice(0,MAX).map(cheatRow).join(''):`<div class="cap cs-none">${sub}</div>`}</div>`;
 return `<div class="slate"><h1>${lg.toUpperCase()} Cheatsheet</h1></div><div class="cap">Lines that hit in 100% of the games shown, updated ${esc(D.checked)}. Streaks are history, not a promise: the price (DraftKings unless marked) and the Stamped % show the fair chance. Tap a row for his game log.</div>
 <div class="cs">${box('⚡','100% Recent Form','No Over has hit in every game this season yet.',R.form)}
 ${box('🛡','100% Versus Opponent','No line has hit in every game against this opponent (2+ games).',R.opp)}
 ${box('⑂','100% Alternate Lines','No alt rung reached in every game this season.',R.alt)}
 ${box('⬇','100% Unders Only','No Under has hit in every game this season yet.',R.under)}</div>`}
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

/* "What other bettors are doing": Kalshi traders' chance of each team winning over time, one line per team, from
   data/kalshi_<sport>_games.json (tools/kalshi.js --games, refreshed every 15 minutes when games are near). */
const KG={};let CR='ALL';
const hex=c=>/^[0-9a-f]{6}$/i.test(c||'')?'#'+c:null;
/* Team colors, lightened when too dark to see on the dark theme. */
function vis(c,fb){c=hex(c);if(!c)return fb;const n=parseInt(c.slice(1),16),r=n>>16,g=n>>8&255,b=n&255,L=(.299*r+.587*g+.114*b)/255;
 if(L>=.3)return c;const m=x=>Math.round(x+(255-x)*.45);return `rgb(${m(r)},${m(g)},${m(b)})`}
function crowdHTML(lg,g){const D=KG[lg];if(!D)return '';const G=Object.values(D.games).find(x=>x.names[0]===g.away.n&&x.names[1]===g.home.n);
 if(!G||!G.away||!G.home||!G.away.h||!G.home.h)return '';
 const span={'1D':24,'1W':168,ALL:1e9}[CR],ser=s=>{const h=G[s].h,pts=h.v.map((v,i)=>[h.t0+i*36e5,v]);return pts.slice(-Math.min(pts.length,span))};
 const A=ser('away'),H=ser('home');if(A.length<2||H.length<2)return '';
 const all=A.concat(H).map(x=>x[1]),lo=Math.max(0,Math.min(...all)-5),hi=Math.min(100,Math.max(...all)+5),t0=Math.min(A[0][0],H[0][0]),t1=Math.max(A[A.length-1][0],H[H.length-1][0]);
 const W=300,Ht=130,x=t=>8+(t-t0)/Math.max(1,t1-t0)*(W-70),y=v=>8+(hi-v)/Math.max(1,hi-lo)*(Ht-16);
 const path=P=>P.map((p,i)=>i?`H${x(p[0]).toFixed(1)}V${y(p[1]).toFixed(1)}`:`M${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join('');
 /* Now: the middle of the quote when it is tight, otherwise the last hourly value. */
 const nowP=s=>{const q=G[s],P=s==='away'?A:H;return q.yb!=null&&q.ya!=null&&q.ya-q.yb<=.1?Math.round((q.yb+q.ya)*50):P[P.length-1][1]};
 /* Two close colors (e.g. two reds): the home team uses its alternate color, or a theme color if that is close too. */
 const dist=(p,q)=>{p=hex(p);q=hex(q);if(!p||!q)return 999;const P=parseInt(p.slice(1),16),Q=parseInt(q.slice(1),16);return Math.hypot((P>>16)-(Q>>16),(P>>8&255)-(Q>>8&255),(P&255)-(Q&255))};
 const ca=vis(g.away.color,'var(--accent)'),hc=dist(g.away.color,g.home.color)>=120?g.home.color:dist(g.away.color,g.home.alt)>=120?g.home.alt:null,ch=hc?vis(hc,'var(--warn)'):(ca==='var(--accent)'?'var(--warn)':'var(--accent)');
 const lab=(s,c,P)=>{const v=nowP(s),yy=y(P[P.length-1][1]);return `<text x="${W-56}" y="${(yy-4).toFixed(1)}" fill="${c}" font-size="10" font-weight="700">${esc(g[s].abbr||g[s].n)}</text><text x="${W-56}" y="${(yy+12).toFixed(1)}" fill="${c}" font-size="16" font-weight="800">${v}%</text>`};
 const grid=[25,50,75].filter(v=>v>lo&&v<hi).map(v=>`<line x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-dasharray="2 4"/>`).join('');
 const vol=(G.away.vol||0)+(G.home.vol||0),v24=(G.away.vol24||0)+(G.home.vol24||0),k=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?Math.round(n/1e3)+'k':String(Math.round(n));
 /* Spans, not buttons: the chart also sits inside game cards, which are buttons themselves. */
 const btn=r=>`<span class="kc-r" role="button" tabindex="0" data-kc-range="${r}" aria-pressed="${CR===r}">${r==='ALL'?'All':r}</span>`;
 return `<div class="kc"><div class="row between"><b>What other bettors are doing</b><span class="kc-rs">${btn('1D')}${btn('1W')}${btn('ALL')}</span></div>
  <svg viewBox="0 0 ${W} ${Ht}" class="kc-svg" role="img" aria-label="${esc(g.away.n)} ${nowP('away')}%, ${esc(g.home.n)} ${nowP('home')}% on Kalshi">${grid}
   <path d="${path(A)}" fill="none" stroke="${ca}" stroke-width="2"/><path d="${path(H)}" fill="none" stroke="${ch}" stroke-width="2"/>
   <circle cx="${x(A[A.length-1][0]).toFixed(1)}" cy="${y(A[A.length-1][1]).toFixed(1)}" r="3" fill="${ca}"/><circle cx="${x(H[H.length-1][0]).toFixed(1)}" cy="${y(H[H.length-1][1]).toFixed(1)}" r="3" fill="${ch}"/>
   ${lab('away',ca,A)}${lab('home',ch,H)}</svg>
  <div class="cap">Kalshi traders' win chance by the hour · ${k(vol)} traded${v24?`, ${k(v24)} in 24 h`:''} · ${esc(D.checked)}</div></div>`}
/* Wrapped so the range buttons can redraw every chart on screen. */
const GL={};
function crowd(lg,g){const h=crowdHTML(lg,g);if(!h)return '';const id=String(g.id);GL[id]=g;return `<div data-kc-for="${esc(lg+'|'+id)}">${h}</div>`}
/* Tap a card's mini chart: the bet's own stat over his last 5 games, big, with the opponent, date and final score. */
const tlogo=(lg,ab)=>ab?`https://a.espncdn.com/i/teamlogos/${lg}/500/${String(ab).toLowerCase()}.png`:'';
function chartSheetHTML(key){const [lg,id,stat,side]=key.split('|'),D=S[lg]&&S[lg].data,p=D&&D.players.find(x=>x.id===id),pr=p&&p.props.find(x=>x.stat===stat);if(!pr)return '';
 const G=(p.games||[]).filter(g=>g.s&&g.s[stat]!=null).slice(0,5).reverse(),L=pr.line,sd=side||'Over',hit=x=>sd==='Under'?x<L:x>L;if(!G.length)return '';
 const W=340,H=210,top=26,bot=H-8,mx=Math.max(...G.map(g=>g.s[stat]),L)*1.15||1,y=v=>bot-(v/mx)*(bot-top),PW=W-36,bw=PW/G.length,b=Math.min(46,bw*.62);
 const bars=G.map((g,i)=>{const v=g.s[stat],x=bw*i+(bw-b)/2,yy=y(v),c=hit(v)?'var(--hit)':'var(--miss)';
  return `<rect x="${x.toFixed(1)}" y="${Math.min(yy,bot-2).toFixed(1)}" width="${b.toFixed(1)}" height="${Math.max(2,bot-yy).toFixed(1)}" rx="4" fill="${c}"/><text x="${(x+b/2).toFixed(1)}" y="${(Math.min(yy,bot-2)-7).toFixed(1)}" text-anchor="middle" class="pc-v">${v}</text>`}).join('');
 const ly=y(L).toFixed(1),k=G.filter(g=>hit(g.s[stat])).length,avg=G.reduce((a,g)=>a+g.s[stat],0)/G.length,r=lean(p,pr);
 return `<div class="grab"></div>
 <div class="shead"><div style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="team">${logo(p.logo)}${esc(p.team)} · ${esc(p.pos)} · ${esc(p.opp)}</div></div><button class="x" id="close" aria-label="Close">×</button></div>
 <div class="panel"><div class="row between"><h4>${sd} ${L} ${esc(STATW[stat]||stat)} · last ${G.length}</h4><b class="pc-k">${k}/${G.length}</b></div>
  <svg viewBox="0 0 ${W} ${H}" class="pc-svg" role="img" aria-label="${esc(stat)} in his last ${G.length} games: ${G.map(g=>g.s[stat]).join(', ')}; line ${L}">
   ${bars}<line x1="0" x2="${PW}" y1="${ly}" y2="${ly}" class="pc-line"/><text x="${PW+4}" y="${(+ly+4).toFixed(1)}" class="pc-l">${L}</text></svg>
  <div class="pc-x" style="grid-template-columns:repeat(${G.length},1fr);margin-right:${(36/W*100).toFixed(1)}%">${G.map(g=>{const ab=g.vs.replace(/^(vs|@) /,'');return `<div><img src="${esc(tlogo(lg,ab))}" alt="" width="22" height="22" loading="lazy"><b>${esc(g.vs)}</b><span>${esc(g.d.slice(5).replace('-','/'))}</span><span class="${/^W/.test(g.res)?'up':/^L/.test(g.res)?'dn':''}">${esc(g.res||'')}</span>${g.min!=null?`<span>${g.min} min</span>`:''}</div>`}).join('')}</div>
  <div class="cap">${sd} ${L} in ${k} of ${G.length}, averaging ${avg.toFixed(1)}. Green cleared the ${sd}, red did not. Dashed line = tonight's line.</div>
  ${r?mline(r):''}</div>${simHTML(r)}
 <button class="card" data-prev-back="${esc(lg+'|'+id)}"><span class="prop">All his props and game log →</span></button>`}
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
  ['nfl','nba'].forEach(lg=>loadJ(`data/kalshi_${lg}_games.json`,KG,lg));loadJ('data/team_signals_nba.json',TS,'nba');loadJ('data/practice_nba_teams.json',PL,'nba');loadJ('data/track_nba.json',TR,'nba')};all();setInterval(all,5*60e3);
 /* Opening a game fills in its cards (they are only built for open games, which keeps the page light). */
 document.addEventListener('toggle',e=>{const s=e.target&&e.target.dataset&&e.target.dataset.prevSec;if(!s||open.has(s)===e.target.open)return;
  if(e.target.open)open.add(s);else open.delete(s);if(e.target.open&&onChange)onChange()},true);
 /* Chart range buttons work in the page and in the game sheet. */
 document.addEventListener('click',e=>{const b=e.target.closest('[data-kc-range]');if(!b)return;e.stopPropagation();CR=b.dataset.kcRange;document.querySelectorAll('[data-kc-for]').forEach(el=>{const [lg,id]=el.dataset.kcFor.split('|');const g=GL[id];if(g)el.innerHTML=crowdHTML(lg,g)})},true);
 /* Mini chart -> big chart sheet (inside a card, which is a button itself, so caught first); its link -> all his props. */
 document.addEventListener('click',e=>{const t=e.target.closest('[data-prev-chart],[data-prev-back]');if(!t||!h.showSheet)return;
  const html=t.dataset.prevChart?chartSheetHTML(t.dataset.prevChart):sheetHTML(t.dataset.prevBack);if(!html)return;e.stopPropagation();e.preventDefault();
  document.getElementById('sheet').innerHTML=html;h.showSheet()},true);
 document.getElementById('main').addEventListener('click',e=>{const c=e.target.closest('[data-prev-p]');if(c&&h.showSheet){document.getElementById('sheet').innerHTML=sheetHTML(c.dataset.prevP);h.showSheet()}})}
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z]/g,'');
/* A player's ESPN game log from this week's file, by name (used by the fantasy preview board). */
function player(lg,name){const D=S[lg]&&S[lg].data;if(!D)return null;const k=norm(name);return D.players.find(p=>norm(p.name)===k)||(D.logs||[]).find(p=>norm(p.name)===k)||null}
window.PREV={start,load,weekHTML,moreHTML,altsHTML,parlaysHTML,cheatHTML,teamsHTML,injuriesHTML,next,player,teamEKG,crowd,teamRating,teamSignal,teamSignalChecked,practiceHTML,checked:lg=>S[lg]&&S[lg].data&&S[lg].data.checked||'',ready:lg=>!!(S[lg]&&S[lg].data),_lean:lean,_checks:checks,_role:roleLine,_record:recordHTML,_track:TR};
})();
