// Серверный мир: единственный источник правды о блоках.
// Мир генерируется по seed (так же, как у клиентов), а по сети ходят только изменения.
import {
  SIZE_X, SIZE_Y, SIZE_Z, BLOCK, blockIndex, inBounds, generateWorld, findSpawn, findWorkshopSpot,
} from '../shared/worldgen.js';
import { BLOCK_INFO } from '../shared/blocks.js';
import { REACH, NET_REACH_TOLERANCE, DAMAGE_FORGET_TIME } from '../shared/constants.js';

export class ServerWorld {
  constructor() {
    this.base = generateWorld();         // исходный мир без изменений
    this.data = this.base.slice();       // текущее состояние
    this.changes = new Map();            // индекс блока -> тип (только отличия от base)
    this.damage = new Map();             // индекс блока -> { dmg, time } накопленный урон
    this.spawn = findSpawn(this.base);
    this.workshop = findWorkshopSpot(this.base);
  }

  getBlock(x, y, z) {
    if (!inBounds(x, y, z)) return BLOCK.BEDROCK;
    return this.data[blockIndex(x, y, z)];
  }

  /** Меняет блок и запоминает изменение (для рассылки новым игрокам и будущих сохранений). */
  setBlock(x, y, z, type) {
    const idx = blockIndex(x, y, z);
    this.data[idx] = type;
    if (this.base[idx] === type) this.changes.delete(idx);
    else this.changes.set(idx, type);
    this.damage.delete(idx);
  }

  /** Список изменений в виде [[x, y, z, type], ...]. */
  listChanges() {
    const out = [];
    for (const [idx, type] of this.changes) {
      const x = idx % SIZE_X;
      const z = Math.floor(idx / SIZE_X) % SIZE_Z;
      const y = Math.floor(idx / (SIZE_X * SIZE_Z));
      out.push([x, y, z, type]);
    }
    return out;
  }

  /** Открыт ли блок хотя бы с одной стороны (закопанные блоки копать нельзя). */
  isExposed(x, y, z) {
    return this.getBlock(x + 1, y, z) === BLOCK.AIR || this.getBlock(x - 1, y, z) === BLOCK.AIR ||
           this.getBlock(x, y + 1, z) === BLOCK.AIR || this.getBlock(x, y - 1, z) === BLOCK.AIR ||
           this.getBlock(x, y, z + 1) === BLOCK.AIR || this.getBlock(x, y, z - 1) === BLOCK.AIR;
  }

  /**
   * Удар киркой. Проверяет координаты, дальность, тип и доступность блока.
   * Возвращает { ok: false } либо { ok: true, broken, dmg, max, type, item, drop }.
   */
  hit(player, x, y, z, power, timeSec) {
    if (![x, y, z].every(Number.isInteger) || !inBounds(x, y, z)) return { ok: false };
    const type = this.getBlock(x, y, z);
    const info = BLOCK_INFO[type];
    if (!info || !Number.isFinite(info.hardness)) return { ok: false }; // воздух или неразрушимое

    const eye = player.eye();
    const dist = Math.hypot(x + 0.5 - eye.x, y + 0.5 - eye.y, z + 0.5 - eye.z);
    if (dist > REACH + 0.9 + NET_REACH_TOLERANCE) return { ok: false };
    if (!this.isExposed(x, y, z)) return { ok: false };

    const idx = blockIndex(x, y, z);
    let entry = this.damage.get(idx);
    if (!entry || timeSec - entry.time > DAMAGE_FORGET_TIME) entry = { dmg: 0, time: timeSec };
    entry.dmg += power;
    entry.time = timeSec;

    if (entry.dmg >= info.hardness) {
      this.setBlock(x, y, z, BLOCK.AIR);
      return { ok: true, broken: true, type, item: info.item, drop: info.drop };
    }
    this.damage.set(idx, entry);
    return { ok: true, broken: false, dmg: entry.dmg, max: info.hardness };
  }

  /** Подчищает давно забытые повреждения. */
  sweepDamage(timeSec) {
    for (const [idx, e] of this.damage) if (timeSec - e.time > DAMAGE_FORGET_TIME) this.damage.delete(idx);
  }

  /** Точка появления: рядом с центром каверны, чтобы игроки не стояли друг в друге. */
  pickSpawn() {
    const base = this.spawn;
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(base.x) + Math.floor(Math.random() * 7) - 3;
      const z = Math.floor(base.z) + Math.floor(Math.random() * 7) - 3;
      const y = base.y;
      if (this.getBlock(x, y - 1, z) !== BLOCK.AIR && this.getBlock(x, y, z) === BLOCK.AIR &&
          this.getBlock(x, y + 1, z) === BLOCK.AIR) {
        return { x: x + 0.5, y, z: z + 0.5 };
      }
    }
    return { ...base };
  }
}
