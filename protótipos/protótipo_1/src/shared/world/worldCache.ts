import { generateWorld, type WorldData } from './worldgen';

let cached: { seed: number; world: WorldData } | null = null;

/**
 * generateWorld(seed), memoized for the last seed: in local play the in-tab server and the client
 * both need the world of the same seed, and generating it takes a few hundred ms. The result is
 * shared between them, so treat it as read-only.
 */
export function worldForSeed(seed: number): WorldData {
  if (cached?.seed !== seed) cached = { seed, world: generateWorld(seed) };
  return cached.world;
}
