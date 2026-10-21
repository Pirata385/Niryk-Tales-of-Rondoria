import './style.css';
import './ui/ui.css';
import { CLOTH_COLORS, EYE_COLORS, HARPIN_COLORS, HUMAN_HAIR_COLORS, SKIN_TONES, type Appearance } from '@shared/appearance';
import { runGame } from './game/GameScene';
import { LocalTransport } from './net/LocalTransport';
import { pickQuality } from './render/quality';
import { Renderer } from './render/Renderer';
import { runLabScene } from './scenes/LabScene';
import { S } from './ui/strings';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);

/** World seed of the offline game (an online server announces its own in the welcome). */
const LOCAL_SEED = 1;

/** Tunic options for ?tunica= (the slice's default is wine). */
const TUNICS: Record<string, string> = {
  verde: CLOTH_COLORS[0],
  marrom: CLOTH_COLORS[1],
  azul: CLOTH_COLORS[2],
  vinho: CLOTH_COLORS[3],
  cinza: CLOTH_COLORS[4],
  ocre: CLOTH_COLORS[5],
};

/**
 * The style slice's hero (no creator yet): tan skin, dark brown short hair, blue eyes and a wine
 * tunic over brown trousers and leather (those two are fixed slot colors in CharacterView).
 */
function sliceHero(): Appearance {
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

async function boot(): Promise<void> {
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const quality = pickQuality(touch, params.get('q'));
  const renderer = new Renderer(canvas, touch, quality.maxPixelRatio);
  if (params.get('scene') === 'lab') return runLabScene(renderer, sliceHero());
  // offline play: the authoritative server runs in this tab (online: a WebSocketTransport here)
  await runGame({ canvas, ui, renderer, touch, quality }, sliceHero(), () => new LocalTransport(LOCAL_SEED));
}

boot().catch(fatal);
