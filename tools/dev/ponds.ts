import { generateWorld } from '../../src/shared/world/worldgen';
const w = generateWorld(1);
console.log(JSON.stringify(w.ponds), 'dens', JSON.stringify(w.dens.map((d) => [Math.round(d.x), Math.round(d.z)])));
