// Клиентский мир: хранит блоки и строит оптимизированную геометрию по чанкам.
// Рисуются только видимые грани (face culling), у каждой вершины своя "тень" (ambient occlusion),
// поэтому блочная геометрия выглядит аккуратно. Изменение блока перестраивает только его чанк.
import * as THREE from 'three';
import {
  SIZE_X, SIZE_Y, SIZE_Z, BLOCK, blockIndex, inBounds, generateWorld, findSpawn,
} from '/shared/worldgen.js';
import { BLOCK_INFO } from '/shared/blocks.js';

const CHUNK = 16;
const CHUNKS_X = Math.ceil(SIZE_X / CHUNK);
const CHUNKS_Y = Math.ceil(SIZE_Y / CHUNK);
const CHUNKS_Z = Math.ceil(SIZE_Z / CHUNK);

// Грани: нормаль n и касательные u, v (u × v = n, значит обход против часовой снаружи)
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], shade: 0.82 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.82 },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], shade: 1.0 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.55 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.7 },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], shade: 0.7 },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_LEVELS = [0.45, 0.65, 0.82, 1.0];

// Небольшая вариация цвета, чтобы стены не выглядели плоскими
function variation(x, y, z) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return 0.9 + ((h >>> 0) % 1000) / 1000 * 0.2;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.data = generateWorld();
    this.spawn = findSpawn(this.data);
    this.chunks = new Map(); // ключ чанка -> { solid, glow }
    this.lanterns = new Map(); // ключ "x,y,z" -> позиция фонаря (для источников света)
    this.dirty = new Set();

    this.solidMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });

    for (let cy = 0; cy < CHUNKS_Y; cy++)
      for (let cz = 0; cz < CHUNKS_Z; cz++)
        for (let cx = 0; cx < CHUNKS_X; cx++) this.dirty.add(this.chunkKey(cx, cy, cz));
    this.rebuildDirty();
  }

  chunkKey(cx, cy, cz) { return (cy * CHUNKS_Z + cz) * CHUNKS_X + cx; }

  getBlock(x, y, z) {
    if (!inBounds(x, y, z)) return BLOCK.BEDROCK; // за границами мира — стена
    return this.data[blockIndex(x, y, z)];
  }

  isSolid(x, y, z) { return this.getBlock(x, y, z) !== BLOCK.AIR; }

  /**
   * Луч через воксели (алгоритм Амановидеса-Ву). Возвращает первый твёрдый блок на пути:
   * { x, y, z, nx, ny, nz, dist }, где (nx,ny,nz) — нормаль грани, в которую попал луч.
   * Нормаль нужна строительству: блок ставится в клетку (x+nx, y+ny, z+nz).
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const dX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const dY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const dZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tX = dx > 0 ? (x + 1 - ox) * dX : dx < 0 ? (ox - x) * dX : Infinity;
    let tY = dy > 0 ? (y + 1 - oy) * dY : dy < 0 ? (oy - y) * dY : Infinity;
    let tZ = dz > 0 ? (z + 1 - oz) * dZ : dz < 0 ? (oz - z) * dZ : Infinity;
    let t = 0, nx = 0, ny = 0, nz = 0;
    while (t <= maxDist) {
      if (this.isSolid(x, y, z)) return { x, y, z, nx, ny, nz, dist: t };
      if (tX < tY && tX < tZ) { x += stepX; t = tX; tX += dX; nx = -stepX; ny = 0; nz = 0; }
      else if (tY < tZ) { y += stepY; t = tY; tY += dY; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; t = tZ; tZ += dZ; nx = 0; ny = 0; nz = -stepZ; }
    }
    return null;
  }

  /** Меняет блок и помечает затронутые чанки для перестройки. */
  setBlock(x, y, z, type) {
    if (!inBounds(x, y, z)) return false;
    const old = this.data[blockIndex(x, y, z)];
    this.data[blockIndex(x, y, z)] = type;
    if (type === BLOCK.LANTERN) this.lanterns.set(`${x},${y},${z}`, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    else if (old === BLOCK.LANTERN) this.lanterns.delete(`${x},${y},${z}`);
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), cz = Math.floor(z / CHUNK);
    this.dirty.add(this.chunkKey(cx, cy, cz));
    // Блок на границе чанка влияет и на соседний чанк
    const lx = x - cx * CHUNK, ly = y - cy * CHUNK, lz = z - cz * CHUNK;
    if (lx === 0 && cx > 0) this.dirty.add(this.chunkKey(cx - 1, cy, cz));
    if (lx === CHUNK - 1 && cx < CHUNKS_X - 1) this.dirty.add(this.chunkKey(cx + 1, cy, cz));
    if (ly === 0 && cy > 0) this.dirty.add(this.chunkKey(cx, cy - 1, cz));
    if (ly === CHUNK - 1 && cy < CHUNKS_Y - 1) this.dirty.add(this.chunkKey(cx, cy + 1, cz));
    if (lz === 0 && cz > 0) this.dirty.add(this.chunkKey(cx, cy, cz - 1));
    if (lz === CHUNK - 1 && cz < CHUNKS_Z - 1) this.dirty.add(this.chunkKey(cx, cy, cz + 1));
    return true;
  }

  /** Сбрасывает мир к исходному (при повторном подключении к серверу). */
  regenerate() {
    this.data = generateWorld();
    this.lanterns.clear();
    for (let cy = 0; cy < CHUNKS_Y; cy++)
      for (let cz = 0; cz < CHUNKS_Z; cz++)
        for (let cx = 0; cx < CHUNKS_X; cx++) this.dirty.add(this.chunkKey(cx, cy, cz));
  }

  /** Применяет список изменений от сервера: [[x, y, z, type], ...]. */
  applyChanges(changes) {
    for (const [x, y, z, type] of changes) this.setBlock(x, y, z, type);
  }

  /** Перестраивает только изменённые чанки. */
  rebuildDirty() {
    for (const key of this.dirty) {
      const cx = key % CHUNKS_X;
      const cz = Math.floor(key / CHUNKS_X) % CHUNKS_Z;
      const cy = Math.floor(key / (CHUNKS_X * CHUNKS_Z));
      this.buildChunk(key, cx, cy, cz);
    }
    this.dirty.clear();
  }

  buildChunk(key, cx, cy, cz) {
    const solid = { pos: [], nor: [], col: [], idx: [] };
    const glow = { pos: [], nor: [], col: [], idx: [] };
    const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;

    for (let y = y0; y < Math.min(y0 + CHUNK, SIZE_Y); y++) {
      for (let z = z0; z < Math.min(z0 + CHUNK, SIZE_Z); z++) {
        for (let x = x0; x < Math.min(x0 + CHUNK, SIZE_X); x++) {
          const type = this.data[blockIndex(x, y, z)];
          if (type === BLOCK.AIR) continue;
          const isGlow = type === BLOCK.CRYSTAL || type === BLOCK.LANTERN;
          const buf = isGlow ? glow : solid;
          const base = BLOCK_INFO[type].color;
          const vary = variation(x, y, z);

          for (const f of FACES) {
            const [nx, ny, nz] = f.n;
            // Грань видна, только если с этой стороны воздух
            if (this.getBlock(x + nx, y + ny, z + nz) !== BLOCK.AIR) continue;

            const [ux, uy, uz] = f.u, [vx, vy, vz] = f.v;
            const cxm = x + 0.5 + nx * 0.5, cym = y + 0.5 + ny * 0.5, czm = z + 0.5 + nz * 0.5;
            const ao = [];
            const start = buf.pos.length / 3;

            for (const [su, sv] of CORNERS) {
              buf.pos.push(
                cxm + su * 0.5 * ux + sv * 0.5 * vx,
                cym + su * 0.5 * uy + sv * 0.5 * vy,
                czm + su * 0.5 * uz + sv * 0.5 * vz,
              );
              buf.nor.push(nx, ny, nz);

              // Ambient occlusion по трём соседям угла
              const ax = x + nx, ay = y + ny, az = z + nz;
              const s1 = this.isSolid(ax + su * ux, ay + su * uy, az + su * uz) ? 1 : 0;
              const s2 = this.isSolid(ax + sv * vx, ay + sv * vy, az + sv * vz) ? 1 : 0;
              const c = this.isSolid(ax + su * ux + sv * vx, ay + su * uy + sv * vy, az + su * uz + sv * vz) ? 1 : 0;
              const level = (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
              ao.push(level);

              const k = isGlow ? 1 : f.shade * AO_LEVELS[level] * vary;
              buf.col.push(base[0] * k, base[1] * k, base[2] * k);
            }

            // Выбираем диагональ так, чтобы не было артефактов градиента AO
            if (ao[0] + ao[2] >= ao[1] + ao[3]) {
              buf.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
            } else {
              buf.idx.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
            }
          }
        }
      }
    }

    // Убираем старые меши чанка
    const old = this.chunks.get(key);
    if (old) {
      for (const mesh of [old.solid, old.glow]) {
        if (!mesh) continue;
        this.scene.remove(mesh);
        mesh.geometry.dispose();
      }
    }
    this.chunks.set(key, {
      solid: this.makeMesh(solid, this.solidMaterial),
      glow: this.makeMesh(glow, this.glowMaterial),
    });
  }

  makeMesh(buf, material) {
    if (buf.idx.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    geo.setIndex(buf.idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    this.scene.add(mesh);
    return mesh;
  }
}
