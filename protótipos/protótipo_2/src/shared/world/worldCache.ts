import { GAME_WORLD, generateWorld, type WorldData, type WorldOptions } from './worldgen';

let cached: { seed: number; options: WorldOptions; world: WorldData } | null = null;

/**
 * generateWorld(seed, options), memoized for the last call: in local play the in-tab server and
 * the client both need the same world, and generating it takes a few hundred ms. The result is
 * shared between them, so treat it as read-only.
 */
export function worldForSeed(seed: number, options: WorldOptions = GAME_WORLD): WorldData {
  if (cached?.seed !== seed || cached.options !== options) cached = { seed, options, world: generateWorld(seed, options) };
  return cached.world;
}
