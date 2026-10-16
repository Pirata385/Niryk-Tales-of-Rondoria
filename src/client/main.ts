import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import './style.css';
import './ui/ui.css';
import type { Appearance } from '@shared/appearance';
import { runGame, type AppContext } from './game/GameScene';
import { PixelPipeline } from './render/PixelPipeline';
import { runLabScene } from './scenes/LabScene';
import { runTestScene } from './scenes/TestScene';
import { loadSavedCharacter, runCreator } from './ui/Creator';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);

async function boot(): Promise<void> {
  const scene = params.get('scene');
  if (scene === 'test') return runTestScene(canvas);
  if (scene === 'lab') return runLabScene(canvas);

  const ctx: AppContext = { canvas, pipeline: new PixelPipeline(canvas), ui };
  let dispose: (() => void) | null = null;

  const toCreator = async () => {
    dispose?.();
    dispose = await runCreator(ctx, (a) => void toGame(a));
  };
  const toGame = async (a: Appearance) => {
    dispose?.();
    dispose = await runGame(ctx, a, () => void toCreator());
  };

  const saved = loadSavedCharacter();
  if (saved && scene !== 'creator') await toGame(saved);
  else await toCreator();
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">${String(err?.stack ?? err)}</pre>`);
});
