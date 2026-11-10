// Сервер Deep Mine: раздаёт клиент и Three.js, принимает Socket.IO-подключения.
// Вся игровая логика — в game.js; мир — в world.js; игроки — в players.js.
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { ServerWorld } from './world.js';
import { PlayerManager } from './players.js';
import { attachGame } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

// Three.js отдаём из node_modules, чтобы игра работала без внешнего CDN.
app.use('/vendor/three', express.static(path.join(rootDir, 'node_modules', 'three')));
// Общий код (генерация мира, правила) используется и клиентом, и сервером.
app.use('/shared', express.static(path.join(rootDir, 'shared')));
app.use(express.static(path.join(rootDir, 'client')));

console.log('Генерация мира...');
const world = new ServerWorld();
const players = new PlayerManager();
attachGame(io, { world, players });

httpServer.listen(PORT, () => {
  console.log(`Deep Mine: http://localhost:${PORT}`);
});
