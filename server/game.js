// Игровая логика сервера, не зависящая от транспорта: работает с любым объектом io в стиле Socket.IO.
// Сервер проверяет всё: добычу, строительство, наличие ресурсов, покупки и перемещение.
import {
  REACH, SHOP_RANGE, NET_REACH_TOLERANCE,
} from '../shared/constants.js';
import { SIZE_X, SIZE_Y, SIZE_Z } from '../shared/worldgen.js';
import { PICKAXES } from '../shared/blocks.js';
import { BUILD_KINDS, validatePlacement, canAfford, payCost } from '../shared/building.js';
import { sellItem, sellEverything, buyPickaxe, equipPickaxe } from '../shared/economy.js';
import { sanitizeNickname } from './players.js';

const MOVE_TICK_MS = 50;       // как часто рассылаются позиции
const PLACE_COOLDOWN = 0.12;   // секунд между постройками одного игрока
const MAX_MOVE_BASE = 8;       // максимальный скачок позиции + MAX_MOVE_SPEED * dt
const MAX_MOVE_SPEED = 45;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v) => Math.round(v * 1000) / 1000;

export function attachGame(io, { world, players, now = () => Date.now(), log = console.log }) {
  const nowSec = () => now() / 1000;

  io.on('connection', (socket) => {
    let me = null; // игрок появляется после события 'join'

    const sendState = () => socket.emit('state', me.state);

    socket.on('join', (data, cb) => {
      if (me) return;
      const nickname = sanitizeNickname(data && data.nickname);
      me = players.create(nickname, world.pickSpawn());
      me.lastMoveAt = nowSec();
      me.lastHitCheck = nowSec();
      log(`[game] ${me.nickname} (${me.id}) вошёл, игроков: ${players.all().length}`);

      if (typeof cb === 'function') {
        cb({
          ok: true,
          id: me.id,
          spawn: { x: me.x, y: me.y, z: me.z },
          state: me.state,
          changes: world.listChanges(),
          players: players.all().filter((p) => p !== me).map((p) => p.publicInfo()),
        });
      }
      socket.broadcast.emit('playerJoined', me.publicInfo());
    });

    // --- Перемещение ---------------------------------------------------------
    socket.on('move', (d) => {
      if (!me || !d || ![d.x, d.y, d.z, d.yaw, d.pitch].every(isNum)) return;
      const t = nowSec();
      const dt = Math.min(2, Math.max(0, t - me.lastMoveAt));
      const dist = Math.hypot(d.x - me.x, d.y - me.y, d.z - me.z);
      const inWorld = d.x > 0 && d.z > 0 && d.y > 0 && d.x < SIZE_X && d.y < SIZE_Y && d.z < SIZE_Z;
      if (!inWorld || dist > MAX_MOVE_BASE + MAX_MOVE_SPEED * dt) {
        // Подозрительный скачок: возвращаем игрока на последнюю допустимую позицию
        socket.emit('teleport', { x: me.x, y: me.y, z: me.z });
        return;
      }
      me.x = d.x; me.y = d.y; me.z = d.z; me.yaw = d.yaw; me.pitch = d.pitch;
      me.lastMoveAt = t;
      me.moved = true;
    });

    socket.on('respawn', (_d, cb) => {
      if (!me) return;
      const s = world.pickSpawn();
      me.x = s.x; me.y = s.y; me.z = s.z; me.moved = true;
      me.lastMoveAt = nowSec();
      if (typeof cb === 'function') cb(s);
    });

    // --- Добыча --------------------------------------------------------------
    socket.on('hit', (d) => {
      if (!me || !d) return;
      const t = nowSec();
      const pick = PICKAXES[me.state.equipped];
      // Ограничитель частоты: не больше ударов в секунду, чем позволяет кирка (с небольшим запасом)
      me.hitTokens = Math.min(2, me.hitTokens + (t - me.lastHitCheck) * pick.speed * 1.2);
      me.lastHitCheck = t;
      if (me.hitTokens < 1) return;
      me.hitTokens -= 1;

      const r = world.hit(me, d.x, d.y, d.z, pick.power, t);
      if (!r.ok) return;
      if (r.broken) {
        io.emit('block', { x: d.x, y: d.y, z: d.z, type: 0, by: me.id });
        if (r.item) {
          me.state.items[r.item] += r.drop;
          sendState();
        }
      } else {
        io.emit('damage', { x: d.x, y: d.y, z: d.z, dmg: r.dmg, max: r.max, by: me.id });
      }
    });

    // --- Строительство -------------------------------------------------------
    socket.on('place', (d, cb) => {
      const reply = (res) => { if (typeof cb === 'function') cb(res); };
      if (!me || !d) return reply({ ok: false, error: 'Вы не в игре' });
      if (typeof d.kind !== 'string' || !Object.hasOwn(BUILD_KINDS, d.kind)) return reply({ ok: false, error: 'Неизвестный объект' });
      const t = nowSec();
      if (t - me.lastPlaceAt < PLACE_COOLDOWN) return reply({ ok: false, error: 'Слишком быстро' });

      const check = validatePlacement(world, d.x, d.y, d.z, me.eye(), players.all(), NET_REACH_TOLERANCE);
      if (!check.ok) return reply(check);
      if (!canAfford(me.state.items, d.kind)) return reply({ ok: false, error: 'Не хватает ресурсов' });

      me.lastPlaceAt = t;
      payCost(me.state.items, d.kind);
      const block = BUILD_KINDS[d.kind].block;
      world.setBlock(d.x, d.y, d.z, block);
      io.emit('block', { x: d.x, y: d.y, z: d.z, type: block, by: me.id });
      sendState();
      reply({ ok: true });
    });

    // --- Магазин -------------------------------------------------------------
    socket.on('shop', (d, cb) => {
      const reply = (res) => { if (typeof cb === 'function') cb(res); };
      if (!me || !d) return reply({ ok: false, error: 'Вы не в игре' });
      const w = world.workshop;
      if (Math.hypot(me.x - w.x, me.y - w.y, me.z - w.z) > SHOP_RANGE) {
        return reply({ ok: false, error: 'Подойдите к мастерской' });
      }
      let result;
      switch (d.action) {
        case 'buy': result = buyPickaxe(me.state, d.id); break;
        case 'equip': result = equipPickaxe(me.state, d.id); break;
        case 'sell': result = sellItem(me.state, d.id, d.amount); break;
        case 'sellAll': result = sellEverything(me.state); break;
        default: result = { ok: false, error: 'Неизвестное действие' };
      }
      if (result.ok) sendState();
      reply(result);
    });

    socket.on('disconnect', () => {
      if (!me) return;
      players.remove(me.id);
      io.emit('playerLeft', me.id);
      log(`[game] ${me.nickname} (${me.id}) вышел, игроков: ${players.all().length}`);
      me = null;
    });
  });

  // Рассылка позиций пачкой: только тех, кто двигался с прошлого раза
  function tick() {
    const moves = {};
    let any = false;
    for (const p of players.all()) {
      if (!p.moved) continue;
      p.moved = false;
      moves[p.id] = [round(p.x), round(p.y), round(p.z), round(p.yaw), round(p.pitch)];
      any = true;
    }
    if (any) io.emit('moves', moves);
    world.sweepDamage(nowSec());
  }

  const timer = setInterval(tick, MOVE_TICK_MS);
  return { tick, stop: () => clearInterval(timer) };
}
