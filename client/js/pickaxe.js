// Модели кирок в руке (три отдельных low-poly модели из простых форм) и анимация удара.
import * as THREE from 'three';

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, fog: false, ...extra });
const glow = (color) => new THREE.MeshBasicMaterial({ color, fog: false });

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

// Острый наконечник: четырёхгранный конус, направленный вдоль оси z (sign = +1 вперёд, -1 назад)
function tip(radius, length, material, z, sign) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 4), material);
  m.rotation.x = sign * Math.PI / 2;
  m.position.set(0, 0, z + sign * length / 2);
  return m;
}

// Одна сторона головы кирки: изогнутое "плечо" с острием. sign = ±1 — направление по оси z.
function arm(sign, length, thick, headMat, tipMat, droop) {
  const g = new THREE.Group();
  const inner = box(thick, thick, length * 0.55, headMat, 0, 0, sign * length * 0.275);
  const outer = new THREE.Group();
  outer.position.set(0, 0, sign * length * 0.55);
  outer.rotation.x = -sign * droop; // концы плеч слегка загибаются вниз
  outer.add(box(thick * 0.8, thick * 0.8, length * 0.45, headMat, 0, 0, sign * length * 0.225));
  outer.add(tip(thick * 0.55, thick * 1.6, tipMat, sign * length * 0.45, sign));
  g.add(inner, outer);
  return g;
}

function handle(material, length = 0.55) {
  return box(0.04, length, 0.04, material, 0, length / 2, 0);
}

function buildStone() {
  const g = new THREE.Group();
  const wood = mat(0x7a5233), rock = mat(0x8b909a), dark = mat(0x5f646d), rope = mat(0xb89968);
  g.add(handle(wood));
  g.add(box(0.075, 0.075, 0.075, rock, 0, 0.56, 0));
  g.add(arm(1, 0.3, 0.06, rock, dark, 0.3), arm(-1, 0.3, 0.06, rock, dark, 0.3));
  g.add(box(0.055, 0.03, 0.055, rope, 0, 0.5, 0), box(0.055, 0.03, 0.055, rope, 0, 0.46, 0));
  return g;
}

function buildIron() {
  const g = new THREE.Group();
  const wood = mat(0x6b4426), steel = mat(0xcdd5dc), edge = mat(0xf0f4f7), band = mat(0x4a5560);
  g.add(handle(wood, 0.6));
  g.add(box(0.09, 0.09, 0.09, band, 0, 0.62, 0));
  g.add(arm(1, 0.42, 0.07, steel, edge, 0.38), arm(-1, 0.42, 0.07, steel, edge, 0.38));
  g.add(box(0.06, 0.04, 0.06, band, 0, 0.1, 0), box(0.06, 0.03, 0.06, band, 0, 0.53, 0));
  return g;
}

function buildCrystal() {
  const g = new THREE.Group();
  const body = mat(0x24343e), crystal = glow(0x3df0f0), bright = glow(0xb6ffff);
  g.add(handle(body, 0.6));
  g.add(box(0.012, 0.4, 0.045, crystal, 0, 0.3, 0)); // светящаяся вставка в рукояти
  g.add(box(0.1, 0.1, 0.1, body, 0, 0.62, 0));
  // Голова — "осколки" кристалла
  g.add(arm(1, 0.46, 0.075, crystal, bright, 0.42), arm(-1, 0.46, 0.075, crystal, bright, 0.42));
  const shard = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), bright);
  shard.position.set(0, 0.74, 0);
  g.add(shard);
  return g;
}

export class PickaxeView {
  constructor(camera) {
    this.root = new THREE.Group();
    this.models = { stone: buildStone(), iron: buildIron(), crystal: buildCrystal() };
    for (const m of Object.values(this.models)) { m.visible = false; this.root.add(m); }
    this.root.position.set(0.34, -0.42, -0.6);
    camera.add(this.root);

    this.swingTime = 1;      // 0..1 — прогресс текущего удара (1 = покой)
    this.swingDuration = 0.2;
    this.bobTime = 0;
    this.current = null;
  }

  /** Показывает модель нужной кирки. */
  setModel(id) {
    this.current = id;
    for (const [key, m] of Object.entries(this.models)) m.visible = key === id;
  }

  /** Запускает анимацию удара; duration — не дольше интервала между ударами. */
  swing(duration) {
    this.swingDuration = Math.min(0.24, duration * 0.9);
    this.swingTime = 0;
  }

  update(dt, moving) {
    this.bobTime += dt * (moving ? 9 : 2);
    const bob = Math.sin(this.bobTime) * (moving ? 0.012 : 0.004);

    let swing = 0;
    if (this.swingTime < 1) {
      this.swingTime = Math.min(1, this.swingTime + dt / this.swingDuration);
      swing = Math.sin(Math.PI * this.swingTime); // вниз и обратно
    }
    this.root.position.y = -0.42 + bob;
    // Базовый наклон вперёд и в сторону центра, при ударе голова уходит вперёд-вниз
    this.root.rotation.set(-0.3 - swing * 1.0, 0.1, 0.28 - swing * 0.15);
    this.root.position.z = -0.6 - swing * 0.1;
  }
}
