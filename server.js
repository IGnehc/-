const express=require('express');const http=require('http');const{Server}=require('socket.io');const path=require('path');const crypto=require('crypto');
const app=express();app.use(express.static(path.join(__dirname,'public')));const server=http.createServer(app);const io=new Server(server);const rooms=new Map();const lobbyTimers=new Map();const roles=['wolf','wolf','seer','witch','villager','villager'];const label={wolf:'狼人',seer:'预言家',witch:'女巫',villager:'村民'};
const rand=n=>crypto.randomInt(n),pick=a=>a[rand(a.length)],shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){let j=rand(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};const alive=g=>g.players.filter(p=>p.alive);const human=g=>g.players.filter(p=>!p.ai);const log=(g,t)=>{g.log.push(t);if(g.log.length>120)g.log.shift()};const actor=g=>g.players.find(p=>p.id===g.turn);const byId=(g,id)=>g.players.find(p=>p.id===Number(id));const others=(g,p)=>alive(g).filter(x=>x.id!==p.id);const valid=(g,p,id)=>others(g,p).some(x=>x.id===Number(id));
function createRoom(socket,name){let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase()}while(rooms.has(code));let g={code,host:socket.id,players:[],phase:'lobby',day:0,log:[],votes:{},night:{},turn:null,winner:null,started:false,discussion:0};rooms.set(code,g);join(g,socket,name);return g}
function join(g,socket,name){if(g.started||g.players.filter(p=>!p.ai).length>=6)return false;let used=new Set(g.players.map(p=>p.id));let id=[1,2,3,4,5,6].find(x=>!used.has(x));g.players.push({id,name:String(name||'玩家').slice(0,20),socket:socket.id,token:crypto.randomBytes(24).toString('hex'),ai:false,alive:true,role:null,memory:{suspect:{},notes:[],claims:{},votes:[],checks:{},personality:rand(4)}});socket.join(g.code);socket.data.room=g.code;socket.data.player=id;return true}
function restore(g,s,token){
 const p=g.players.find(x=>!x.ai&&x.token===token);
 if(!p)return null;
 if(p.socket&&p.socket!==s.id){const old=io.sockets.sockets.get(p.socket);old?.disconnect(true)}
 p.socket=s.id;s.join(g.code);s.data.room=g.code;s.data.player=p.id;
 const key=g.code+':'+p.id;clearTimeout(lobbyTimers.get(key));lobbyTimers.delete(key);
 if(g.host===null||!g.players.some(x=>x.socket===g.host))g.host=s.id;
 return p;
}
function fill(g){for(let i=1;i<=6;i++)if(!g.players.some(p=>p.id===i))g.players.push({id:i,name:`AI ${i}号`,ai:true,alive:true,role:null,memory:{suspect:{},notes:[],claims:{},votes:[],checks:{},personality:rand(4)}});g.players.sort((a,b)=>a.id-b.id)}
function emit(g){for(const p of g.players.filter(p=>!p.ai&&p.socket)){let s=io.sockets.sockets.get(p.socket);if(!s)continue;s.emit('state',{code:g.code,me:p.id,host:g.host===p.socket,phase:g.phase,day:g.day,players:g.players.map(x=>({id:x.id,name:x.name,ai:x.ai,alive:x.alive,role:x.id===p.id?label[x.role]:g.phase==='ended'?label[x.role]:undefined})),log:g.log.slice(-35),turn:g.turn,winner:g.winner,role:label[p.role],wolfTeammates:p.role==='wolf'?g.players.filter(x=>x.role==='wolf'&&x.id!==p.id).map(x=>({id:x.id,name:x.name,alive:x.alive})):[],witch:p.role==='witch'?{heal:p.heal,poison:p.poison}:null,options:options(g,p),discussion:g.discussion})}}
function options(g,p){if(g.phase==='lobby'||g.phase==='ended'||!p.alive)return [];if(g.turn!==p.id)return [];if(g.phase==='night_wolf')return alive(g).filter(x=>x.role!=='wolf').map(x=>x.id);if(g.phase==='night_seer')return others(g,p).map(x=>x.id);if(g.phase==='night_witch')return [{id:'skip',name:'跳过'},...(p.heal&&g.night.kill?[{id:'heal',name:`救 ${g.night.kill}号`}]:[]),...(p.poison?alive(g).filter(x=>x.id!==g.night.kill).map(x=>({id:`poison:${x.id}`,name:`毒 ${x.id}号`})) :[])];if(g.phase==='speech'||g.phase==='pk_speech')return ['发言'];if(g.phase==='vote')return [...others(g,p).filter(x=>!g.pk||g.pk.includes(x.id)).map(x=>x.id),'skip'];return []}
function start(g){fill(g);let shuffled=shuffle(roles);g.players.forEach((p,i)=>{p.role=shuffled[i];p.alive=true;p.memory={suspect:{},notes:[],claims:{},votes:[],checks:{},personality:rand(4)};p.heal=p.role==='witch';p.poison=p.role==='witch'});g.started=true;g.day=0;log(g,'游戏开始，身份已由服务器随机分配。');beginNight(g)}
function next(g){if(g.phase==='ended')return;let p=actor(g);if(p&&p.ai){setTimeout(()=>{if(g.phase==='ended'||g.turn!==p.id||!p.alive)return;aiMove(g,p)},350)}else emit(g)}
function phase(g,type,ids){g.phase=type;g.queue=[...ids];g.turn=g.queue.shift()??null;if(g.turn===null){setImmediate(()=>{if(g.phase===type&&g.turn===null&&g.phase!=='ended')completePhase(g)})}else next(g)}
function advance(g){g.turn=g.queue.shift()??null;if(g.turn===null)completePhase(g);else next(g)}
function beginNight(g){g.pk=null;g.day++;g.night={wolfVotes:[],kill:null,save:false,poison:null};log(g,`第${g.day}夜降临。`);phase(g,'night_wolf',alive(g).filter(p=>p.role==='wolf').map(p=>p.id))}
function completePhase(g){switch(g.phase){case'night_wolf':{let vs=g.night.wolfVotes;g.night.kill=vs.length?pick([...new Set(vs.filter(v=>vs.filter(x=>x===v).length===Math.max(...vs.map(y=>vs.filter(x=>x===y).length))))]):null;phase(g,'night_seer',alive(g).filter(p=>p.role==='seer').map(p=>p.id));break}case'night_seer':phase(g,'night_witch',alive(g).filter(p=>p.role==='witch').map(p=>p.id));break;case'night_witch':{let deaths=[];if(g.night.kill&&!g.night.save)deaths.push(g.night.kill);if(g.night.poison)deaths.push(g.night.poison);deaths=[...new Set(deaths)];for(let id of deaths)byId(g,id).alive=false;log(g,deaths.length?`天亮了，昨夜死亡：${deaths.join('号、')}号。`:'天亮了，昨夜是平安夜。');if(checkWin(g))return;g.discussion=0;beginSpeech(g);break}case'pk_speech':g.votes={};phase(g,'vote',alive(g).map(p=>p.id));break;case'speech':g.discussion++;if(g.discussion===1){beginSpeech(g)}else{g.votes={};phase(g,'vote',alive(g).map(p=>p.id))}break;case'vote':resolveVote(g);break}}
function beginSpeech(g){log(g,g.discussion===0?'第一轮发言开始。':'补充讨论开始。');phase(g,'speech',alive(g).map(p=>p.id))}
function checkWin(g){let wolves=alive(g).filter(p=>p.role==='wolf').length,good=alive(g).length-wolves;if(wolves===0||wolves>=good){g.winner=wolves===0?'好人阵营':'狼人阵营';g.phase='ended';g.turn=null;log(g,`游戏结束：${g.winner}获胜！`);emit(g);return true}return false}
function resolveVote(g){let tally={};Object.values(g.votes).forEach(v=>{if(v!=='skip')tally[v]=(tally[v]||0)+1});let high=Math.max(0,...Object.values(tally));let tied=Object.keys(tally).filter(k=>tally[k]===high).map(Number);log(g,'投票结果：'+alive(g).map(p=>`${p.id}号→${g.votes[p.id]||'弃票'}`).join('，'));for(const a of g.players.filter(x=>x.ai)){for(const [v,t] of Object.entries(g.votes)){a.memory.votes.push({day:g.day,voter:Number(v),target:t});if(t!=='skip'&&Number(v)!==a.id&&Number(t)!==a.id){a.memory.suspect[Number(t)]=(a.memory.suspect[Number(t)]||0)+0.18}}a.memory.votes=a.memory.votes.slice(-48)}if(!high||tied.length!==1){log(g,`平票或无人得票，${tied.length>1?'进入平票PK讨论，之后重新投票。':'无人出局。'}`);if(tied.length>1){g.pk=tied;g.discussion=1;phase(g,'pk_speech',tied)}else beginNight(g);return}let out=byId(g,tied[0]);out.alive=false;log(g,`${out.id}号被放逐，身份不公开。`);g.pk=null;if(!checkWin(g))beginNight(g)}
function speak(g,p,text){
 text=String(text||'').slice(0,350).trim()||'我暂时没有更多信息。';log(g,`${p.id}号：${text}`);
 const checks=[...text.matchAll(/(?:查验|验了|查了)([1-6])号.{0,12}?(狼人|好人|金水|查杀)/g)];
 for(const x of g.players.filter(x=>x.ai&&x.alive&&x.id!==p.id)){
  const m=x.memory;
  const roleClaim=text.match(/(?:我是|我才是|我真的是)(预言家|女巫|村民|狼人)/);
  if(roleClaim){m.claims[p.id]=roleClaim[1];if(roleClaim[1]==='预言家'&&x.role==='seer')m.suspect[p.id]=(m.suspect[p.id]||0)+5;}
  for(const c of checks){let id=Number(c[1]);m.notes.push(`${p.id}号声称查验${id}号：${c[2]}`);if(x.role==='seer'&&m.checks[id]){let reported=c[2]==='狼人'||c[2]==='查杀'?'wolf':'good';if(m.checks[id]!==reported)m.suspect[p.id]=(m.suspect[p.id]||0)+4}}
  for(const mm of text.matchAll(/([1-6])号/g)){let id=Number(mm[1]);if(id===x.id||id===p.id)continue;let delta=/(怀疑|查杀|是狼|投|不信|矛盾)/.test(text)?0.65:/(金水|好人|相信|保)/.test(text)?-0.35:0;m.suspect[id]=(m.suspect[id]||0)+delta}
  m.notes.push(`${p.id}号：${text.slice(0,110)}`);m.notes=m.notes.slice(-24);
 }
}
function aiScore(g,p,id){
 const m=p.memory,t=byId(g,id);let v=m.suspect[id]||0;
 if(m.checks[id]==='wolf')v+=25;if(m.checks[id]==='good')v-=25;
 if(p.role==='wolf'&&t.role==='wolf')v-=100;
 if(m.claims[id]==='预言家'&&p.role==='seer')v+=5;
 const last=m.votes.filter(x=>x.voter===id).slice(-2);
 for(const vote of last){if(vote.target===p.id)v+=0.7; if(m.checks[vote.target]==='wolf')v-=0.8}
 return v;
}
function aiTarget(g,p,ids){if(!ids.length)return null;const scored=ids.map(id=>({id,score:aiScore(g,p,id)+(rand(100)/100-0.5)*(p.memory.personality===0?3:1.5)}));scored.sort((a,b)=>b.score-a.score);return scored[0].id}
function aiSpeech(g,p){
 const m=p.memory,persona=m.personality;
 const candidates=others(g,p).filter(x=>p.role!=='wolf'||x.role!=='wolf');
 const target=aiTarget(g,p,candidates.map(x=>x.id));
 const checked=Object.entries(m.checks).find(([id,v])=>v==='wolf'&&byId(g,id)?.alive);
 const proven=Object.entries(m.checks).find(([id,v])=>v==='good'&&byId(g,id)?.alive);
 const last=m.votes.filter(x=>x.voter===p.id).at(-1);
 const claims=Object.entries(m.claims).filter(([id,r])=>r==='预言家'&&byId(g,id)?.alive);
 let variants=[];
 if(p.role==='seer'&&checked)variants.push(`我是预言家，我查验${checked[0]}号是狼人。建议今天先出${checked[0]}号。`);
 if(p.role==='seer'&&proven)variants.push(`我有查验信息：${proven[0]}号是好人。请结合票型判断，不要盲目跟票。`);
 if(p.role==='wolf'&&claims.length&&persona===0)variants.push(`我不急着相信跳预言家的说法，${claims[0][0]}号需要解释查验顺序和投票理由。`);
 if(last&&last.target!=='skip'&&byId(g,last.target)?.alive)variants.push(`我上一轮投了${last.target}号，目前没有足够理由改票。希望他回应我的怀疑。`);
 if(target!==null){
  variants.push(`我目前更怀疑${target}号。不是定论，想听他解释自己的站边和投票。`);
  variants.push(`${target}号的发言我还没有完全信服。大家可以对照前几轮的票型。`);
  variants.push(`我倾向先观察${target}号。只凭一句话定狼风险很大，但今天必须形成有效投票。`);
 }
 if(persona===1)variants.push('我暂时不想带节奏。先把已知信息和大家的投票逐个核对。');
 if(persona===2)variants.push(`今天不能一直弃票。${target||'可疑的人'}需要给出更清楚的解释。`);
 if(persona===3)variants.push('我愿意修正判断，但需要具体证据，不能只凭谁说得大声。');
 return pick(variants.length?variants:['我暂时没有可靠信息，继续观察票型。']);
}
function aiMove(g,p){
 const o=options(g,p);let target;
 if(g.phase==='night_wolf'){
  const ids=o.filter(x=>typeof x==='number');
  target=g.night.wolfVotes.length&&ids.includes(g.night.wolfVotes[0])&&rand(4)!==0?g.night.wolfVotes[0]:pick(ids);
 }else if(g.phase==='night_seer'){
  const unseen=o.filter(id=>!p.memory.checks[id]);target=pick(unseen.length?unseen:o);
 }else if(g.phase==='night_witch'){
  const heal=p.heal&&g.night.kill;
  const poisonTargets=alive(g).filter(x=>x.id!==g.night.kill&&x.id!==p.id);
  const suspected=aiTarget(g,p,poisonTargets.map(x=>x.id));
  target=heal&&(g.day<=2||rand(4)===0)?'heal':p.poison&&g.day>1&&suspected!==null&&aiScore(g,p,suspected)>2?`poison:${suspected}`:'skip';
 }else if(g.phase==='vote'){
  const ids=o.filter(x=>typeof x==='number');target=aiTarget(g,p,ids)||'skip';
 }else if(g.phase==='speech'||g.phase==='pk_speech'){
  speak(g,p,aiSpeech(g,p));advance(g);return;
 }
 if(target===undefined||target===null){if(o.includes('skip'))target='skip';else return}
 move(g,p,target);
}
function move(g,p,value){if(g.turn!==p.id||!p.alive)return;let o=options(g,p),ok=o.some(x=>String(typeof x==='object'?x.id:x)===String(value));if(!ok)return;if(g.phase==='night_wolf')g.night.wolfVotes.push(Number(value));if(g.phase==='night_seer'){let t=byId(g,value);p.memory.notes.push(`第${g.day}夜查验${t.id}号：${t.role==='wolf'?'狼人':'好人'}`);p.memory.checks[t.id]=t.role==='wolf'?'wolf':'good';if(!p.ai){let s=io.sockets.sockets.get(p.socket);s?.emit('private',`查验结果：${t.id}号是${t.role==='wolf'?'狼人':'好人'}`)}}if(g.phase==='night_witch'){if(value==='heal'){g.night.save=true;p.heal=false}else if(String(value).startsWith('poison:')){g.night.poison=Number(String(value).split(':')[1]);p.poison=false}}if(g.phase==='vote')g.votes[p.id]=value;advance(g)}
io.on('connection',s=>{
 s.on('create',(payload={},cb)=>{
  if(s.data.room){cb?.({ok:false,error:'你已在一个房间中，请先刷新页面或使用原房间'});return}
  let g=createRoom(s,payload.name);
  cb?.({ok:true,code:g.code,token:g.players[0].token});emit(g)
 });
 s.on('join',(payload={},cb)=>{
  const code=String(payload.code||'').trim().toUpperCase();
  const g=rooms.get(code);
  if(!g){cb?.({ok:false,error:'房间不存在或服务器已重启。请房主重新创建房间，并发送最新房间码。'});return}
  if(payload.token){const p=restore(g,s,String(payload.token));if(p){cb?.({ok:true,code,token:p.token,recovered:true});emit(g);return}}
  if(s.data.room){cb?.({ok:false,error:'你已经加入了一个房间，请勿重复加入。'});return}
  if(g.started){cb?.({ok:false,error:'对局已经开始，暂时不能中途加入。'});return}
  if(g.players.length>=6){cb?.({ok:false,error:'房间已有6名玩家，无法加入。'});return}
  if(!join(g,s,payload.name)){cb?.({ok:false,error:'加入失败，请稍后重试。'});return}
  const p=byId(g,s.data.player);cb?.({ok:true,code,token:p.token});emit(g)
 });
 s.on('start',()=>{let g=rooms.get(s.data.room);if(g&&g.host===s.id&&!g.started){start(g);emit(g)}});
 s.on('action',({value,text}={})=>{let g=rooms.get(s.data.room),p=g&&byId(g,s.data.player);if(!g||!p||p.socket!==s.id||p.ai)return;if((g.phase==='speech'||g.phase==='pk_speech')&&g.turn===p.id&&p.alive){speak(g,p,text);advance(g)}else move(g,p,value)});
 s.on('disconnect',()=>{
  let g=rooms.get(s.data.room);if(!g)return;
  let p=byId(g,s.data.player);if(!p||p.socket!==s.id)return;
  if(!g.started){
   p.socket=null;if(g.host===s.id)g.host=g.players.find(x=>x!==p&&x.socket)?.socket||null;
   const key=g.code+':'+p.id;
   const timer=setTimeout(()=>{
    lobbyTimers.delete(key);
    if(p.socket||g.started)return;
    g.players=g.players.filter(x=>x!==p);
    if(!g.players.length)rooms.delete(g.code);
    else if(!g.host)g.host=g.players.find(x=>x.socket)?.socket||null;
    emit(g)
   },120000);
   lobbyTimers.set(key,timer);emit(g)
  }else{
   // Preserve the original game behaviour: AI takes over a disconnected player.
   p.ai=true;p.socket=null;p.name=`AI接管${p.id}号`;
   if(g.turn===p.id)next(g);emit(g)
  }
 })
});
server.listen(process.env.PORT||3000,()=>console.log('Werewolf server listening on '+(process.env.PORT||3000)));
