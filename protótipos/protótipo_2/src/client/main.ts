import './style.css';
import './ui/ui.css';
import { CLOTH_COLORS, EYE_COLORS, HARPIN_COLORS, HUMAN_HAIR_COLORS, SKIN_TONES, defaultAppearance, type Appearance, type Gender, type Race } from '@shared/appearance';
import { runGame, type AppContext, type TransportFactory } from './game/GameScene';
import { LocalTransport } from './net/LocalTransport';
import { pickQuality } from './render/quality';
import { Renderer } from './render/Renderer';
import { runLabScene } from './scenes/LabScene';
import { loadSavedCharacter, runCreator } from './ui/Creator';
import { S } from './ui/strings';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);

/** World seed of the offline game (an online server announces its own in the welcome). */
const LOCAL_SEED = 1;
/** Offline play: the authoritative server runs in this tab. Online: a WebSocketTransport here. */
const makeTransport: TransportFactory = () => new LocalTransport(LOCAL_SEED);

/** Tunic options for ?tunica= (the default hero's is wine). */
const TUNICS: Record<string, string> = {
  verde: CLOTH_COLORS[0],
  marrom: CLOTH_COLORS[1],
  azul: CLOTH_COLORS[2],
  vinho: CLOTH_COLORS[3],
  cinza: CLOTH_COLORS[4],
  ocre: CLOTH_COLORS[5],
};

/**
 * The hero of `?play` (straight into the world, for the tools) and of the lab scene when no
 * character was saved: tan skin, dark brown short hair, blue eyes and a wine tunic.
 */
function defaultHero(): Appearance {
  // ?corpo=harpin_f (tools): that body's default look instead
  const body = /^(human|harpin)_(m|f)$/.exec(params.get('corpo') ?? '');
  if (body) {
    const a = defaultAppearance(body[1] as Race, body[2] as Gender);
    const tunic = TUNICS[params.get('tunica') ?? ''];
    return { ...a, name: S.defaultName, ...(tunic ? { clothColor: tunic } : {}) };
  }
  return {
    name: S.defaultName,
    race: 'human',
    gender: 'm',
    skin: SKIN_TONES[2],
    hairStyle: 'curto',
    hairColor: HUMAN_HAIR_COLORS[1],
    plumeColor: HARPIN_COLORS.branco,
    eyeColor: EYE_COLORS[0],
    clothColor: TUNICS[params.get('tunica') ?? ''] ?? TUNICS.vinho,
  };
}

function fatal(err: unknown): void {
  console.error(err);
  const e = err as { stack?: string } | null;
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = String(e?.stack ?? err);
  document.body.append(pre);
}

/**
 * Routes: the character creator first (or straight into the world with a saved character);
 * `?scene=creator` always opens the creator, `?play` enters the world at once with the saved
 * character or the default hero, `?scene=lab` is the character close-up.
 */
async function boot(): Promise<void> {
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const quality = pickQuality(touch, params.get('q'));
  const renderer = new Renderer(canvas, touch, quality.maxPixelRatio);
  const scene = params.get('scene');
  const saved = loadSavedCharacter();
  const forced = params.has('tunica') || params.has('corpo');
  if (scene === 'lab') return runLabScene(renderer, forced ? defaultHero() : (saved ?? defaultHero()));

  const ctx: AppContext = { canvas, ui, renderer, touch, quality };
  let dispose: (() => void) | null = null;
  const toCreator = async () => {
    dispose?.();
    dispose = null;
    dispose = await runCreator(ctx, (a) => void toGame(a).catch(fatal));
  };
  const toGame = async (a: Appearance) => {
    dispose?.();
    dispose = null;
    dispose = await runGame(ctx, a, makeTransport, () => void toCreator().catch(fatal));
  };
  if (params.has('play')) await toGame(forced ? defaultHero() : (saved ?? defaultHero()));
  else if (saved && scene !== 'creator') await toGame(saved);
  else await toCreator();
}

boot().catch(fatal);
