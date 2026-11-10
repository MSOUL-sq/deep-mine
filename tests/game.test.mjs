// Тест серверной логики на поддельных сокетах (без Socket.IO): добыча, стройка, магазин, античит, синхронизация.
// Запуск: npm test
import { EventEmitter } from 'node:events';
import { ServerWorld } from '../server/world.js';
import { PlayerManager } from '../server/players.js';
import { attachGame } from '../server/game.js';
import { BLOCK } from '../shared/worldgen.js';

// --- поддельный Socket.IO ---
class FakeSocket extends EventEmitter {
  constructor(io){ super(); this.io=io; this.got=[]; }
  // сервер -> клиент
  emit(ev, ...a){ if(['join','move','hit','place','shop','respawn','disconnect'].includes(ev)&&this._client===undefined){} return super.emit(ev,...a); }
}
const io = new EventEmitter(); const sockets=[];
io.emit = (ev, data)=>{ sockets.forEach(s=>s.inbox.push([ev,data])); };
function connect(){
  const s = new EventEmitter(); s.inbox=[];
  s.emit = (ev,data)=>{ s.inbox.push([ev,data]); };       // сервер шлёт клиенту
  s.broadcast = { emit:(ev,data)=>sockets.filter(o=>o!==s).forEach(o=>o.inbox.push([ev,data])) };
  s.client = (ev,data,cb)=>EventEmitter.prototype.emit.call(s,ev,data,cb); // клиент шлёт серверу
  sockets.push(s); EventEmitter.prototype.emit.call(io,'connection',s); return s;
}
const world=new ServerWorld(); const players=new PlayerManager();
let clock=1000; const game=attachGame(io,{world,players,now:()=>clock,log:()=>{}});
game.stop();
const ev=(s,name)=>s.inbox.filter(([e])=>e===name).map(([,d])=>d);
let fails=0; const ok=(c,m)=>{ console.log((c?'✓ ':'✗ ')+m); if(!c) fails++; };

const a=connect(), b=connect(); let ra,rb;
a.client('join',{nickname:'<b>Alice</b>'},r=>ra=r); b.client('join',{nickname:'Bob'},r=>rb=r);
ok(ra.ok&&rb.ok&&ra.id!==rb.id,'уникальные ID: '+ra.id+' '+rb.id);
ok(ra.players.length===0&&rb.players.length===1,'Bob видит Alice в welcome');
ok(ev(a,'playerJoined').length===1,'Alice получила playerJoined о Bob');
ok(!/[<>]/.test(rb.players[0].nickname),'ник очищен: '+rb.players[0].nickname);

// найдём открытый блок камня рядом с игроком A
const pa=players.get(ra.id);
let tgt=null;
outer: for(let r=1;r<=4;r++) for(let dx=-r;dx<=r;dx++) for(let dy=-1;dy<=3;dy++) for(let dz=-r;dz<=r;dz++){
  const x=Math.floor(pa.x)+dx,y=Math.floor(pa.y)+dy,z=Math.floor(pa.z)+dz;
  if(world.getBlock(x,y,z)===BLOCK.STONE&&world.isExposed(x,y,z)){tgt={x,y,z};break outer;}
}
ok(!!tgt,'нашёл камень рядом '+JSON.stringify(tgt));
// 3 удара каменной киркой (power 1, hardness 3)
for(let i=0;i<3;i++){ clock+=700; a.client('hit',tgt); }
ok(ev(a,'damage').length===2,'2 события damage');
ok(ev(b,'block').some(e=>e.type===0&&e.x===tgt.x),'Bob получил block AIR');
ok(world.getBlock(tgt.x,tgt.y,tgt.z)===BLOCK.AIR,'блок сломан на сервере');
ok(pa.state.items.stone===1,'Alice получила 1 камень');
ok(ev(a,'state').length===1,'Alice получила state');
// спам ударов
const t2={...tgt}; let broken=0;
for(let i=0;i<20;i++) a.client('hit',{x:tgt.x+1,y:tgt.y,z:tgt.z}); // без смены clock
ok(true,'спам обработан без падения');
// дальний блок и закопанный блок
a.client('hit',{x:90,y:20,z:90}); a.client('hit',{x:'1',y:2,z:3}); a.client('hit',null); a.client('hit',{x:1.5,y:2,z:3});
const home={x:pa.x,y:pa.y,z:pa.z}; pa.x=1.5;pa.y=10;pa.z=48.5; const before=world.getBlock(0,10,48);
for(let i=0;i<10;i++){clock+=700;a.client('hit',{x:0,y:10,z:48});}
ok(before===BLOCK.BEDROCK&&world.getBlock(0,10,48)===BLOCK.BEDROCK,'bedrock оболочки неразрушим');
pa.x=home.x;pa.y=home.y;pa.z=home.z; pa.state.items.stone=0; pa.state.items.coal=0;
// строительство без ресурсов
let r1; clock+=500;
const cell={x:tgt.x,y:tgt.y,z:tgt.z}; // только что освобождённая клетка, рядом камень
a.client('place',{...cell,kind:'stone_block'},r=>r1=r);
ok(!r1.ok&&r1.error==='Не хватает ресурсов','без ресурсов: '+r1.error);
pa.state.items.stone=5; pa.state.items.coal=3; pa.state.items.copper=1; clock+=500;
a.client('place',{...cell,kind:'stone_block'},r=>r1=r);
ok(r1.ok,'постройка успешна: '+JSON.stringify(r1));
ok(world.getBlock(cell.x,cell.y,cell.z)===BLOCK.BUILT_STONE&&pa.state.items.stone===3,'блок стоит, списано 2 камня');
ok(ev(b,'block').some(e=>e.type===BLOCK.BUILT_STONE),'Bob видит постройку');
clock+=500; a.client('place',{...cell,kind:'stone_block'},r=>r1=r);
ok(!r1.ok&&r1.error==='Место занято','занято: '+r1.error);
clock+=500; a.client('place',{x:cell.x,y:cell.y,z:cell.z,kind:'__proto__'},r=>r1=r); ok(!r1.ok,'левый kind отклонён');
clock+=500; a.client('place',{x:80,y:20,z:80,kind:'stone_block'},r=>r1=r); ok(!r1.ok,'далеко/без опоры: '+r1.error);
// нельзя строить внутри игрока: поставим Bob на клетку рядом с A
const pb=players.get(rb.id);
// найдём воздушную клетку с опорой рядом с A, поставим Bob внутрь
let free=null;
for(let dx=-3;dx<=3&&!free;dx++)for(let dz=-3;dz<=3&&!free;dz++){const x=Math.floor(pa.x)+dx,y=Math.floor(pa.y),z=Math.floor(pa.z)+dz;
  if(world.getBlock(x,y,z)===0&&world.getBlock(x,y-1,z)!==0&&(dx||dz)){free={x,y,z};}}
pb.x=free.x+0.5;pb.y=free.y;pb.z=free.z+0.5;
clock+=500; a.client('place',{...free,kind:'stone_block'},r=>r1=r);
ok(!r1.ok&&r1.error==='Игрок мешает','не внутри игрока: '+r1.error);
// фонарь и опора
pb.x+=10; // убрать Bob
// магазин: далеко от мастерской
let s1; pa.state.money=1000;
const w=world.workshop; const oldx=pa.x; pa.x=w.x+30; a.client('shop',{action:'buy',id:'iron'},r=>s1=r);
ok(!s1.ok&&s1.error.includes('мастерск'),'магазин далеко: '+s1.error);
pa.x=w.x+1;pa.y=w.y;pa.z=w.z;
a.client('shop',{action:'buy',id:'iron'},r=>s1=r); ok(s1.ok&&pa.state.equipped==='iron'&&pa.state.money===850,'покупка железной кирки');
a.client('shop',{action:'buy',id:'crystal'},r=>s1=r); ok(s1.ok&&pa.state.money===250,'покупка кристальной');
a.client('shop',{action:'buy',id:'iron'},r=>s1=r); ok(!s1.ok,'повторная покупка отклонена');
a.client('shop',{action:'sell',id:'stone',amount:-5},r=>s1=r); ok(!s1.ok,'отриц. продажа отклонена');
a.client('shop',{action:'sell',id:'__proto__',amount:1},r=>s1=r); ok(!s1.ok,'proto-продажа отклонена');
a.client('shop',{action:'sellAll'},r=>s1=r); ok(s1.ok&&pa.state.items.stone===0,'продать всё: +'+s1.gain);
a.client('shop',{action:'hack'},r=>s1=r); ok(!s1.ok,'неизвестное действие');
// движение
pa.lastMoveAt=clock/1000; clock+=50;
a.client('move',{x:pa.x+0.3,y:pa.y,z:pa.z,yaw:1,pitch:0.2});
a.client('move',{x:pa.x+500,y:pa.y,z:pa.z,yaw:1,pitch:0.2});
ok(ev(a,'teleport').length===1,'телепорт-чит отклонён');
a.client('move',{x:NaN,y:1,z:1,yaw:0,pitch:0}); a.client('move',{x:1,y:1});
game.tick(); const mv=ev(b,'moves'); ok(mv.length>=1&&mv[mv.length-1][ra.id],'позиции разосланы');
// новый игрок видит изменения мира
const c=connect(); let rc; c.client('join',{},r=>rc=r);
ok(rc.changes.some(([x,y,z,t])=>x===cell.x&&y===cell.y&&z===cell.z&&t===BLOCK.BUILT_STONE),'новый игрок получает постройку ('+rc.changes.length+' изм.)');
ok(rc.players.length===2,'новый игрок видит 2 других');
// выход
EventEmitter.prototype.emit.call(b,'disconnect');
ok(ev(a,'playerLeft').includes(rb.id),'playerLeft разослан');
console.log(fails?`\nПРОВАЛЕНО: ${fails}`:'\nВсе проверки пройдены'); process.exit(fails?1:0);
