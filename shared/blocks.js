// Описание блоков, предметов и кирок. Общий модуль: клиент использует его для эффектов и интерфейса,
// сервер (на этапе мультиплеера) — для проверки добычи, наград и покупок.
import { BLOCK } from './worldgen.js';

// Блок: имя, прочность (сколько "силы" нужно вложить), предмет и количество выпадающих ресурсов, цвет.
export const BLOCK_INFO = {
  [BLOCK.STONE]:   { name: 'Камень',        hardness: 3,        item: 'stone',   drop: 1, color: [0.42, 0.44, 0.48] },
  [BLOCK.COAL]:    { name: 'Угольная руда', hardness: 4,        item: 'coal',    drop: 2, color: [0.17, 0.17, 0.19] },
  [BLOCK.IRON]:    { name: 'Железная руда', hardness: 6,        item: 'iron',    drop: 1, color: [0.66, 0.5, 0.42] },
  [BLOCK.COPPER]:  { name: 'Медная руда',   hardness: 5,        item: 'copper',  drop: 2, color: [0.78, 0.45, 0.27] },
  [BLOCK.CRYSTAL]: { name: 'Кристалл',      hardness: 8,        item: 'crystal', drop: 1, color: [0.25, 0.95, 0.95] },
  // Постройки игроков: ресурсов не дают (стоимость см. shared/building.js)
  [BLOCK.BUILT_STONE]: { name: 'Каменный блок',    hardness: 2, item: null, drop: 0, color: [0.6, 0.62, 0.68] },
  [BLOCK.LANTERN]:     { name: 'Каменный фонарь',  hardness: 1, item: null, drop: 0, color: [1.0, 0.82, 0.4] },
  [BLOCK.SUPPORT]:     { name: 'Деревянная опора', hardness: 2, item: null, drop: 0, color: [0.55, 0.37, 0.2] },
  [BLOCK.BEDROCK]: { name: 'Неразрушимая порода', hardness: Infinity, item: null, drop: 0, color: [0.12, 0.12, 0.14] },
};

// Предметы инвентаря. value — цена продажи (понадобится в магазине кирок).
export const ITEMS = {
  stone:   { name: 'Камень',        color: '#8b909a', value: 1 },
  coal:    { name: 'Уголь',         color: '#33343b', value: 3 },
  iron:    { name: 'Железо',        color: '#c58d78', value: 8 },
  copper:  { name: 'Медь',          color: '#e07a45', value: 6 },
  crystal: { name: 'Кристалл',      color: '#3df0f0', value: 25 },
};

// Кирки: power — урон блоку за удар, speed — ударов в секунду, cost — цена улучшения.
export const PICKAXES = {
  stone:   { id: 'stone',   name: 'Каменная кирка',   power: 1, speed: 1.6, cost: 0 },
  iron:    { id: 'iron',    name: 'Железная кирка',   power: 2, speed: 2.2, cost: 150 },
  crystal: { id: 'crystal', name: 'Кристальная кирка', power: 4, speed: 3.0, cost: 600 },
};
