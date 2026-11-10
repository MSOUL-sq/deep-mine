// Точка входа клиента: сцена, освещение, игровой цикл, меню, подключение к серверу и связка модулей.
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Inventory } from './inventory.js';
import { Mining } from './mining.js';
import { Building } from './building.js';
import { Multiplayer } from './multiplayer.js';
import { ResourceBar, MoneyBadge, ShopUI, BuildMenu, toast } from './ui.js';
import { PickaxeView } from './pickaxe.js';
import { Workshop } from './workshop.js';
import { LanternLights } from './lanterns.js';
import { unlockAudio, sound } from './audio.js';
import { findWorkshopSpot, BLOCK } from '/shared/worldgen.js';

const canvas = document.getElementById('game');
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const info = document.getElementById('info');
const nicknameInput = document.getElementById('nickname');
const graphicsSelect = document.getElementById('graphics');
const playButton = document.getElementById('play');
const menuError = document.getElementById('menu-error');
const promptEl = document.getElementById('prompt');

// --- Сцена -----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03080c);
scene.fog = new THREE.FogExp2(0x03080c, 0.04);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 150);
scene.add(camera);

// Мягкий общий свет + факел игрока (свет следует за камерой)
scene.add(new THREE.AmbientLight(0x6f9fb0, 0.9));
const torch = new THREE.PointLight(0xffd9a0, 45, 45, 2);
camera.add(torch);

// --- Игровые системы -------------------------------------------------------
const world = new World(scene);
const inventory = new Inventory();
const player = new Player(camera, world);
const net = new Multiplayer(scene, world, inventory);
const mining = new Mining(scene, camera, world, player, net);
const building = new Building(scene, camera, world, player, inventory, net, () => net.remotePositions());
const lanternLights = new LanternLights(scene, world);
const workshop = new Workshop(scene, findWorkshopSpot(world.data));
const pickaxeView = new PickaxeView(camera);

new ResourceBar(document.getElementById('resources'), inventory);
new MoneyBadge(document.getElementById('money'), inventory);
new BuildMenu(document.getElementById('build-menu'), building, inventory);
const shop = new ShopUI(inventory, net);

// Кирка в руке всегда соответствует выбранной (её присылает сервер)
function syncPickaxe() {
  mining.setPickaxe(inventory.equipped);
  pickaxeView.setModel(inventory.equipped);
}
inventory.onUpdate(syncPickaxe);
syncPickaxe();
mining.onSwing = (interval) => pickaxeView.swing(interval);
inventory.onChange((id, count, delta) => { if (delta > 0) sound.pickup(); });

// --- Графика ---------------------------------------------------------------
const GRAPHICS = {
  low: { pixelRatio: 0.6, fog: 0.055 },
  medium: { pixelRatio: 1, fog: 0.04 },
  high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fog: 0.03 },
};

function applyGraphics(level) {
  const g = GRAPHICS[level] || GRAPHICS.medium;
  renderer.setPixelRatio(g.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  scene.fog.density = g.fog;
  localStorage.setItem('deepmine.graphics', level);
}

graphicsSelect.value = localStorage.getItem('deepmine.graphics') || 'medium';
applyGraphics(graphicsSelect.value);
graphicsSelect.addEventListener('change', () => applyGraphics(graphicsSelect.value));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

// --- Сеть: события от сервера ----------------------------------------------
// Громкость и эффекты чужих действий убывают с расстоянием
const volumeAt = (x, y, z) => Math.max(0, 1 - camera.position.distanceTo(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5)) / 25);

net.onBlock = (x, y, z, type) => {
  const prev = world.getBlock(x, y, z);
  const vol = volumeAt(x, y, z);
  if (type === BLOCK.AIR) mining.showBreak(x, y, z, prev, vol);
  else if (vol > 0.05) sound.place(vol);
  world.setBlock(x, y, z, type);
};
net.onDamage = (x, y, z, dmg, max, by) => {
  mining.setDamage(x, y, z, dmg, max);
  if (by !== net.id) mining.showRemoteHit(x, y, z, volumeAt(x, y, z));
};
net.onTeleport = (p) => player.spawnAt(p); // сервер вернул нас на допустимую позицию

let falling = false;
player.onFall = () => {
  if (falling) return;
  falling = true;
  net.respawn().then((s) => { player.spawnAt(s || player.spawnPoint); falling = false; });
};

net.onDisconnect = () => {
  inGame = false;
  shop.close();
  building.setActive(false);
  mining.holding = false;
  document.exitPointerLock();
  hud.classList.add('hidden');
  menu.classList.remove('hidden');
  nicknameInput.disabled = false;
  playButton.textContent = 'Подключиться';
  showMenuError('Соединение с сервером потеряно');
};

// --- Меню, подключение и Pointer Lock --------------------------------------
nicknameInput.value = localStorage.getItem('deepmine.nickname') || '';
let nickname = '';
let inGame = false;

function showMenuError(text) {
  menuError.textContent = text;
  menuError.classList.toggle('hidden', !text);
}

async function startGame() {
  unlockAudio();
  showMenuError('');
  if (!net.connected) {
    nickname = nicknameInput.value.trim() || `Шахтёр${Math.floor(Math.random() * 900 + 100)}`;
    localStorage.setItem('deepmine.nickname', nickname);
    playButton.disabled = true;
    playButton.textContent = 'Подключение...';
    try {
      const res = await net.connect(nickname);
      player.spawnPoint = res.spawn;
      player.spawnAt(res.spawn);
      nicknameInput.disabled = true;
    } catch (err) {
      showMenuError(err.message);
      playButton.textContent = 'Играть';
      return;
    } finally {
      playButton.disabled = false;
    }
  }
  inGame = true;
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  canvas.requestPointerLock?.();
}

playButton.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

function showPauseMenu() {
  menu.classList.remove('hidden');
  hud.classList.add('hidden');
  playButton.textContent = 'Продолжить';
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  player.enabled = locked;
  if (!locked) mining.holding = false;
  if (!locked && inGame && !shop.isOpen) showPauseMenu(); // Esc или потеря фокуса
});

// Если браузер не вернул курсор (например, после закрытия магазина) — показываем меню с "Продолжить"
document.addEventListener('pointerlockerror', () => {
  if (inGame && !shop.isOpen && !player.enabled) showPauseMenu();
});

// --- Мастерская ---------------------------------------------------------------
function openShop() {
  shop.open();
  mining.holding = false;
  document.exitPointerLock();
}
function closeShop() {
  shop.close();
  canvas.requestPointerLock?.();
}
document.getElementById('shop-close').addEventListener('click', closeShop);

// --- Клавиатура и мышь -------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (!inGame || e.repeat) return;
  if (shop.isOpen) {
    if (e.code === 'KeyE' || e.code === 'Escape') closeShop();
    return;
  }
  if (!player.enabled) return;
  if (e.code === 'KeyE' && workshop.isNear(player.pos)) openShop();
  else if (e.code === 'KeyB') building.toggle();
  else if (building.active && e.code.startsWith('Digit')) building.selectIndex(Number(e.code.slice(5)) - 1);
});

canvas.addEventListener('mousedown', (e) => {
  if (!player.enabled) return;
  if (e.button === 0) mining.holding = true;
  else if (e.button === 2) building.place(toast);
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mining.holding = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => {
  if (player.enabled && building.active) building.cycle(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

// --- Игровой цикл ----------------------------------------------------------
const clock = new THREE.Clock();
let fpsTimer = 0, fpsFrames = 0, fps = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = clock.getDelta();

  player.update(dt);
  net.update(dt, player);
  mining.update(dt);
  building.update(dt);
  pickaxeView.update(dt, player.enabled && (player.vel.x !== 0 || player.vel.z !== 0));
  lanternLights.update(dt, camera.position);
  promptEl.classList.toggle('hidden', !(player.enabled && workshop.isNear(player.pos)));
  world.rebuildDirty();
  renderer.render(scene, camera);

  fpsFrames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fps = Math.round(fpsFrames / fpsTimer);
    fpsFrames = 0;
    fpsTimer = 0;
    info.textContent =
      `${nickname}  |  ${fps} FPS  |  Игроков: ${net.playerCount}  |  X ${player.pos.x.toFixed(1)}  Y ${player.pos.y.toFixed(1)}  Z ${player.pos.z.toFixed(1)}`;
  }
}
frame();

window.addEventListener('error', (e) => console.error('[Deep Mine] ошибка:', e.message));
