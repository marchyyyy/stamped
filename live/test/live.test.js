/* Run: node --test live/test   (from the repo root) */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),cp=require('node:child_process');
const E=require('../engine.js'),S=require('../espn.js');

const team=(abbr,name,pts,q,box)=>Object.assign({abbr,name,pts,q,fga:0,fta:0,oreb:0,tov:0},box||{});
const game=o=>Object.assign({id:'g1',status:'in',period:2,clock:360,home:team('PHX','Suns',50,[28,22],{fga:38,fta:10,oreb:4,tov:6}),away:team('ORL','Magic',46,[24,22],{fga:40,fta:8,oreb:5,tov:7}),
 pregame:{total:224,homeMargin:2,src:'test'},players:[],fetched:1e6},o||{});

test('game clock: parsing and elapsed minutes',()=>{
 assert.equal(E.parseClock('6:53'),413);assert.equal(E.parseClock('45.2'),45.2);assert.equal(E.parseClock('0.0'),0);
 assert.equal(E.elapsedMin(1,720),0);assert.equal(E.elapsedMin(2,360),18);assert.equal(E.elapsedMin(4,0),48);assert.equal(E.elapsedMin(5,150),50.5);assert.equal(E.elapsedMin(6,300),53);
 assert.equal(E.periodName(5),'OT');assert.equal(E.periodName(6),'OT2');
});

test('quarter transition: a finished quarter shows the actual score in every run',()=>{
 const st=game({period:1,clock:0,home:team('PHX','Suns',28,[28],{fga:22,fta:4,oreb:2,tov:3}),away:team('ORL','Magic',25,[25],{fga:23,fta:3,oreb:3,tov:4})});
 const sim=E.simulate(st,{n:500});
 assert.equal(sim.done('q1'),true);assert.equal(sim.actual('q1',''),53);assert.equal(sim.done('q2'),false);assert.equal(sim.done('h1'),false);
 assert.equal(sim.q('q1',0),53);assert.equal(sim.q('q1',.999),53);
 assert.ok(sim.mean('q2')>40&&sim.mean('q2')<75);
});

test('overtime: tied at the end of Q4 always goes to OT; Q4 excludes OT, 2H and game include it',()=>{
 const st=game({period:4,clock:0,home:team('PHX','Suns',110,[28,27,26,29],{fga:88,fta:20,oreb:10,tov:13}),away:team('ORL','Magic',110,[27,28,27,28],{fga:90,fta:18,oreb:11,tov:12})});
 const sim=E.simulate(st,{n:800});
 assert.equal(sim.otRate(),1);
 assert.equal(sim.q('q4',0),57);assert.equal(sim.q('q4',.999),57);
 assert.ok(sim.q('game',0)>220,'OT adds points to the game total');
 const m=sim.prob('game:m',0);assert.ok(m.push<0.01,'almost no game stays tied after 4 OTs');
 const after=E.simulate(Object.assign({},st,{period:5,clock:120,home:Object.assign({},st.home,{pts:115,q:[28,27,26,29,5]}),away:Object.assign({},st.away,{pts:112,q:[27,28,27,28,2]})}),{n:300});
 assert.equal(after.q('q4',.5),57);assert.ok(after.q('game',0)>=227);
});

test('final game: every market is complete and equals the box score',()=>{
 const st=game({status:'post',period:4,clock:0,home:team('PHX','Suns',112,[30,25,30,27]),away:team('ORL','Magic',104,[24,30,25,25])});
 const sim=E.simulate(st,{n:50});
 ['q1','q2','q3','q4','h1','h2','game'].forEach(k=>assert.equal(sim.done(k),true));
 assert.equal(sim.actual('game',''),216);assert.equal(sim.actual('h1','h'),55);assert.equal(sim.q('game:m',.5),8);
});

test('stale data: frozen clock flags stale after 3 minutes, end-of-period does not',()=>{
 const a=game({fetched:0}),b=game({fetched:200e3});a.stillSince=0;
 assert.equal(E.freshness(a,b,200e3).stale,true);
 const moved=game({clock:340,fetched:200e3});assert.equal(E.freshness(a,moved,200e3).stale,false);
 const eop=game({clock:0,fetched:200e3}),eopPrev=game({clock:0,fetched:0});eopPrev.stillSince=0;assert.equal(E.freshness(eopPrev,eop,200e3).stale,false);
 assert.equal(E.freshness(null,game({fetched:0}),300e3).stale,true,'old fetch is stale');
});

test('conflicting sources block recommendations',()=>{
 const a=game(),b=game({home:Object.assign({},game().home,{pts:52})});
 const rc=E.reconcile(a,b);assert.equal(rc.conflict,true);
 const sim=E.simulate(game({period:3,clock:300}),{n:300});
 const g=E.liveGate(sim,{available:true,total:220.5,overOdds:-110,underOdds:-110,fetched:1e6},{stale:false,conflict:true},1e6);
 assert.equal(g.ok,false);assert.ok(g.why.some(w=>/disagree/.test(w)));
});

test('missing data: no box score, no pregame line, no player history',()=>{
 const R=E.rates(game({pregame:null,home:team('PHX','Suns',50,[28,22]),away:team('ORL','Magic',46,[24,22])}));
 assert.ok(R.flags.some(f=>/league-average total/.test(f)));assert.ok(R.flags.some(f=>/No box score/.test(f)));assert.ok(isFinite(R.pppH)&&isFinite(R.pace));
 const pl={id:'p1',name:'Nobody Known',team:'home',starter:true,min:14,pts:8,reb:3,ast:2,tpm:1,pf:1};
 const pp=E.projectPlayer(pl,game(),{players:[]},{n:400});assert.ok(pp.flags.some(f=>/No recent games/.test(f)));assert.ok(pp.stats.points.mean>=8);
 const known=E.projectPlayer({...pl,name:'Franz Wagner'},game(),{players:[{lg:'nba',name:'Franz Wagner',id:'fw',games:[{min:36,s:{points:24,rebounds:6,assists:5,threes:2}},{min:34,s:{points:20,rebounds:5,assists:6,threes:1}}],props:[{stat:'points',line:22.5}]}]},{n:400});
 assert.equal(known.flags.length,0);assert.ok(known.hist&&known.hist.n===2);
 const fouled=E.projectPlayer({...pl,pf:6},game(),null,{n:200});assert.equal(fouled.remMin,0);assert.equal(fouled.stats.points.mean,8);
 const dnp=E.projectPlayer({...pl,dnp:true,min:0,pts:0},game(),null,{n:100});assert.equal(dnp.stats.points.hi,0);
 const half=game({period:3,clock:720}),usual={players:[{lg:'nba',name:'Bench Guy',id:'b',games:[{min:12,s:{points:4,rebounds:1,assists:1,threes:0}}]}]};
 const big=E.projectPlayer({...pl,name:'Bench Guy',starter:false,min:12,pts:9},half,usual,{n:200});
 assert.ok(big.remMin>5,`a player at his usual minutes by halftime still gets second-half minutes (${big.remMin})`);
});

test('line changes alert once; duplicates are suppressed',()=>{
 const st=game(),seen=new Set(),ctx={now:1,anchor:{}};
 const prev={state:st,market:{total:220.5,homeSpread:-2.5,book:'DK'}},next={state:st,market:{total:222.5,homeSpread:-2.5,book:'DK'}};
 const a1=E.alertsFor(prev,next,ctx,{},seen),a2=E.alertsFor(prev,next,ctx,{},seen);
 assert.equal(a1.filter(a=>a.type==='line').length,1);assert.equal(a2.length,0);
 const off=E.alertsFor(prev,{state:st,market:{total:225.5}},ctx,{line:false},new Set());assert.equal(off.filter(a=>a.type==='line').length,0);
});

test('quarter start/end and projection-move alerts',()=>{
 const seen=new Set(),ctx={now:1,anchor:{}};
 const q1=game({period:1,clock:30}),end=game({period:1,clock:0}),q2=game({period:2,clock:700});
 assert.ok(E.alertsFor({state:q1},{state:end},ctx,{},seen).some(a=>/end of Q1/.test(a.text)));
 assert.ok(E.alertsFor({state:end},{state:q2},ctx,{},seen).some(a=>/Q2 started/.test(a.text)));
 E.alertsFor({state:q2},{state:q2,proj:220},ctx,{},seen);
 assert.equal(E.alertsFor({state:q2},{state:q2,proj:221},ctx,{},seen).filter(a=>a.type==='projection').length,0);
 assert.equal(E.alertsFor({state:q2},{state:q2,proj:224},ctx,{},seen).filter(a=>a.type==='projection').length,1);
});

test('suspended, missing and stale markets never qualify',()=>{
 const sim=E.simulate(game({period:3,clock:300}),{n:500}),q={stale:false,conflict:false};
 assert.deepEqual(E.opportunities(sim,null,q,1e6),[]);
 const sus=E.opportunities(sim,{available:true,suspended:true,total:null,fetched:1e6},q,1e6);assert.ok(sus.every(o=>!o.qualifies));
 assert.ok(E.liveGate(sim,{available:true,suspended:true,fetched:1e6},q,1e6).why.some(w=>/suspended/.test(w)));
 const old={available:true,total:150.5,overOdds:-110,underOdds:-110,fetched:0};
 const st=E.opportunities(sim,old,q,200e3);assert.ok(st.every(o=>!o.qualifies));assert.ok(st[0].gate.why.some(w=>/stale/.test(w)));
 const s2=S.fromOdds({items:[{provider:{name:'DraftKings'}}]},game(),5);assert.equal(s2.available,false);assert.equal(s2.suspended,true);
});

test('existing Stamped rules hold for live picks (−160 kill, +300 too long, 3-point edge)',()=>{
 assert.ok(E.grade({price:-170,edge:.2,ev:.1}).why.some(w=>/−160/.test(w)));
 assert.ok(E.grade({price:300,edge:.2,ev:.5}).why.some(w=>/too long/.test(w)));
 assert.ok(E.grade({price:-110,edge:.02,ev:.01}).why.some(w=>/3\.0-point/.test(w)));
 assert.equal(E.grade({price:-110,edge:.05,ev:.04}).ok,true);
 assert.equal(E.grade({price:-110,edge:.04,ev:.02},{minEdge:.05}).ok,false,'a stricter user filter can only raise the bar');
 assert.equal(E.RULES.kill,-160);assert.equal(E.RULES.tooLong,300);assert.equal(E.RULES.minEdge,.03);
});

test('a big model edge in a clean live spot qualifies, and is still Paper',()=>{
 const st=game({period:3,clock:300,home:team('PHX','Suns',80,[28,22,30],{fga:62,fta:14,oreb:7,tov:9}),away:team('ORL','Magic',74,[24,22,28],{fga:64,fta:12,oreb:8,tov:10})});
 const sim=E.simulate(st,{n:3000}),mean=sim.mean('game'),q={stale:false,conflict:false};
 const at=L=>E.opportunities(sim,{available:true,book:'DK',total:L,overOdds:-110,underOdds:-110,fetched:1e6},q,1e6).find(o=>o.side==='Over');
 let over=null;for(let d=.5;d<15&&!over;d+=.5){const o=at(Math.floor(mean)-d+.5);if(o.edge>.04&&o.edge<.095)over=o}
 assert.ok(over,'found a line with a moderate edge');assert.equal(over.qualifies,true);assert.equal(over.paper,true);assert.ok(over.why.length>=2);assert.equal(over.modelVersion,E.VERSION);
 const huge=at(Math.round(mean)-20.5);assert.equal(huge.qualifies,false,'an edge above 10 points is not trusted');assert.ok(huge.rule.why.some(w=>/too large/.test(w)));
 const late=E.opportunities(E.simulate(Object.assign({},st,{period:4,clock:90}),{n:300}),{available:true,total:100.5,overOdds:-110,underOdds:-110,fetched:1e6},{stale:false,conflict:false},1e6);
 assert.ok(late.every(o=>!o.qualifies),'nothing inside the last 2:00');
});

test('simulation is reproducible for the same state and seed',()=>{
 const a=E.simulate(game(),{n:1000}),b=E.simulate(game(),{n:1000});
 assert.equal(a.mean('game'),b.mean('game'));assert.equal(a.q('q3:h',.9),b.q('q3:h',.9));
 const c=E.simulate(game(),{n:1000,seed:42}),d=E.simulate(game(),{n:1000,seed:42});assert.equal(c.mean('h2'),d.mean('h2'));
 const p1=E.projectPlayer({id:'x',name:'A',team:'home',starter:true,min:20,pts:10,reb:4,ast:3,tpm:1,pf:2},game(),null,{n:500});
 const p2=E.projectPlayer({id:'x',name:'A',team:'home',starter:true,min:20,pts:10,reb:4,ast:3,tpm:1,pf:2},game(),null,{n:500});
 assert.equal(p1.stats.points.mean,p2.stats.points.mean);
});

test('calibration: model probabilities match frequencies from independent runs, and pregame centers on the market',()=>{
 const st=game({period:3,clock:400});
 const A=E.simulate(st,{n:4000,seed:1}),B=E.simulate(st,{n:4000,seed:2});
 [-6,0,6].forEach(d=>{const L=Math.round(A.mean('game'))+d+.5;const pa=A.prob('game',L).over,pb=B.prob('game',L).over;assert.ok(Math.abs(pa-pb)<.035,`L=${L} ${pa} vs ${pb}`)});
 const pre=E.simulate(game({status:'pre',period:0,clock:0,home:team('PHX','Suns',0,[]),away:team('ORL','Magic',0,[])}),{n:4000});
 assert.ok(Math.abs(pre.mean('game')-224)<4,`pregame mean ${pre.mean('game')} vs 224`);
 assert.ok(Math.abs(pre.mean('game:m')-2)<1.5,`pregame margin ${pre.mean('game:m')} vs 2`);
 const sd=(pre.q('game',.9)-pre.q('game',.1))/2.563;assert.ok(sd>10&&sd<22,`pregame total sd ${sd}`);
});

test('pricing: no-vig, EV and fair odds',()=>{
 const [a,b]=E.noVig(-110,-110);assert.ok(Math.abs(a-.5)<1e-9&&Math.abs(b-.5)<1e-9);
 assert.equal(E.fair(.5),-100);assert.equal(E.fair(.6),-150);assert.equal(E.fair(.4),150);
 assert.ok(Math.abs(E.dec(-110)-1.9090909)<1e-6);
});

test('paper trading settles wins, losses and pushes',()=>{
 const fin=game({status:'post',period:4,clock:0,home:team('PHX','Suns',110,[]),away:team('ORL','Magic',100,[])});
 assert.equal(E.settle({market:'Total',side:'Over',line:205.5,price:-110},fin).result,'win');
 assert.equal(E.settle({market:'Total',side:'Under',line:210,price:-110},fin).result,'push');
 assert.equal(E.settle({market:'Spread',side:'Suns',line:-10.5,price:-110},fin).result,'loss');
 assert.equal(E.settle({market:'Spread',side:'Magic',line:10.5,price:-110},fin).result,'win');
 assert.equal(E.settle({market:'Moneyline',side:'Suns',line:null,price:-200},fin).units,.5);
 assert.equal(E.settle({market:'Total',side:'Over',line:1,price:-110},game()),null);
});

test('ESPN adapter: box score, live odds sign and play-by-play without look-ahead',()=>{
 const comp={date:'2026-11-06T02:00Z',status:{period:2,displayClock:'6:00',type:{state:'in',shortDetail:'6:00 - 2nd'}},competitors:[
  {homeAway:'home',score:'30',team:{id:'21',abbreviation:'PHX',name:'Suns'},linescores:[{displayValue:'20'},{displayValue:'10'}]},
  {homeAway:'away',score:'28',team:{id:'19',abbreviation:'ORL',name:'Magic'},linescores:[{displayValue:'18'},{displayValue:'10'}]}]};
 const sum={header:{id:'401',competitions:[comp]},pickcenter:[{provider:{name:'DraftKings'},overUnder:224.5,spread:-1.5,details:'PHX -1.5'}],
  boxscore:{teams:[{team:{id:'21'},statistics:[{name:'fieldGoalsMade-fieldGoalsAttempted',displayValue:'12-25'},{name:'freeThrowsMade-freeThrowsAttempted',displayValue:'3-4'},{name:'offensiveRebounds',displayValue:'3'},{name:'totalTurnovers',displayValue:'4'}]},{team:{id:'19'},statistics:[]}],
   players:[{team:{id:'21'},statistics:[{keys:['minutes','points','threePointFieldGoalsMade-threePointFieldGoalsAttempted','rebounds','assists','fouls'],athletes:[{starter:true,athlete:{id:'7',displayName:'Devin Booker'},stats:['14','11','2-4','2','3','2']}]}]}]},
  plays:[{sequenceNumber:'1',period:{number:1},clock:{displayValue:'11:40'},homeScore:2,awayScore:0,shootingPlay:true,type:{text:'Jump Shot'},team:{id:'21'}},
   {sequenceNumber:'2',period:{number:1},clock:{displayValue:'11:20'},homeScore:2,awayScore:0,shootingPlay:false,type:{text:'Bad Pass\nTurnover'},team:{id:'19'}},
   {sequenceNumber:'3',period:{number:2},clock:{displayValue:'7:00'},homeScore:2,awayScore:3,shootingPlay:true,type:{text:'Jump Shot'},team:{id:'19'}},
   {sequenceNumber:'4',period:{number:2},clock:{displayValue:'5:00'},homeScore:4,awayScore:3,shootingPlay:true,type:{text:'Layup Shot'},team:{id:'21'}}]};
 const s=S.fromSummary(sum,9);
 assert.equal(s.status,'in');assert.equal(s.clock,360);assert.equal(s.home.fga,25);assert.equal(s.home.tov,4);assert.deepEqual(s.home.q,[20,10]);
 assert.equal(s.pregame.total,224.5);assert.equal(s.pregame.homeMargin,1.5);
 assert.equal(s.players[0].name,'Devin Booker');assert.equal(s.players[0].tpm,2);assert.equal(s.players[0].pf,2);
 const mk=S.fromOdds({items:[{provider:{name:'DraftKings - Live Odds'},overUnder:226.5,spread:3.5,details:'ORL -3.5',overOdds:-110,underOdds:-110,homeTeamOdds:{moneyLine:130,spreadOdds:-105},awayTeamOdds:{moneyLine:-150,spreadOdds:-115}}]},s,9);
 assert.equal(mk.available,true);assert.equal(mk.homeSpread,3.5,'away favorite means a positive home spread');assert.equal(mk.homeML,130);
 const cut=S.fromPlays(sum,{period:2,clock:360});
 assert.equal(cut.home.pts,2,'the 5:00 layup is after the cut');assert.equal(cut.away.pts,3);assert.equal(cut.away.tov,1);assert.equal(cut.home.fga,1);assert.deepEqual(cut.home.q,[2,0]);
});

test('existing betting rules in index.html are unchanged since the pre-live rollback point',()=>{
 const root=path.join(__dirname,'..','..');let old;
 try{old=cp.execSync('git show pre-live-v1:index.html',{cwd:root,encoding:'utf8',maxBuffer:1<<26})}catch(e){test.skip?.('rollback tag not available');return}
 const cur=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const block=(s,a,b)=>{s=s.replace(/\r\n/g,'\n');const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i,`markers ${a}`);return s.slice(i,j)};
 [['/* ---------- prop rules ---------- */','/* ---------- state ---------- */'],['function rulesHTML(','/* ---------- alts ---------- */']].forEach(([a,b])=>
  assert.equal(block(cur,a,b),block(old,a,b),`rules block starting ${a} changed`));
});
