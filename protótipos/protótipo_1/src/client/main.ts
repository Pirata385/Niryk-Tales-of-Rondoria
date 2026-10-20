import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import './style.css';
import './ui/ui.css';
import type { Appearance } from '@shared/appearance';
import { runGame, type AppContext, type TransportFactory } from './game/GameScene';
import { LocalTransport } from './net/LocalTransport';
import { PixelPipeline } from './render/PixelPipeline';
import { runLabScene } from './scenes/LabScene';
import { runTestScene } from './scenes/TestScene';
import { loadSavedCharacter, runCreator } from './ui/Creator';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);

/** World seed of the offline game (an online server announces its own in the welcome). */
const LOCAL_SEED = 1;
/** Offline play: the authoritative server runs in this tab. Online: a WebSocketTransport here. */
const makeTransport: TransportFactory = () => new LocalTransport(LOCAL_SEED);

function fatal(err: unknown): void {
  console.error(err);
  const e = err as { stack?: string } | null;
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = String(e?.stack ?? err);
  document.body.append(pre);
}

async function boot(): Promise<void> {
  const scene = params.get('scene');
  if (scene === 'test') return runTestScene(canvas);
  if (scene === 'lab') return runLabScene(canvas);

  const ctx: AppContext = { canvas, pipeline: new PixelPipeline(canvas), ui };
  let dispose: (() => void) | null = null;

  const toCreator = async () => {
    dispose?.();
    dispose = null;
    dispose = await runCreator(ctx, (a) => toGame(a).catch(fatal));
  };
  const toGame = async (a: Appearance) => {
    dispose?.();
    dispose = null;
    dispose = await runGame(ctx, a, makeTransport, () => toCreator().catch(fatal));
  };

  const saved = loadSavedCharacter();
  if (saved && scene !== 'creator') await toGame(saved);
  else await toCreator();
}

boot().catch(fatal);
