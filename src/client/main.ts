import './style.css';
import { runLabScene } from './scenes/LabScene';
import { runTestScene } from './scenes/TestScene';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

async function boot(): Promise<void> {
  const scene = params.get('scene') ?? 'test';
  if (scene === 'test') await runTestScene(canvas);
  else if (scene === 'lab') await runLabScene(canvas);
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">${String(err?.stack ?? err)}</pre>`);
});
