import { TICK_DT } from '@shared/constants';
import type { ClientMsg, ServerMsg } from '@shared/protocol';
import { worldForSeed } from '@shared/world/worldCache';
import type { WorldData } from '@shared/world/worldgen';
import { GameServer } from '@server/GameServer';
import type { Transport, TransportDebug } from './Transport';

const CLIENT_ID = 'local';

/**
 * Runs the authoritative GameServer in this tab, at its fixed tick rate. Messages are cloned in
 * both directions so client and server never share objects (exactly like a network would).
 * Swap for a WebSocketTransport to play online — nothing else changes.
 */
export class LocalTransport implements Transport {
  private readonly server: GameServer;
  private listeners: ((msg: ServerMsg) => void)[] = [];
  private accumulator = 0;

  readonly debug: TransportDebug = {
    teleport: (x, z) => this.server.debugTeleport(CLIENT_ID, x, z),
    wolves: () => this.server.debugWolves().map((w) => ({ id: w.id, x: w.x, z: w.z, hp: Math.ceil(w.hp) })),
  };

  /** The world is memoized per seed, so the client building the same one does not generate it twice. */
  constructor(seed: number, world: WorldData = worldForSeed(seed)) {
    this.server = new GameServer(
      seed,
      (_client, msg) => {
        const copy = structuredClone(msg);
        for (const l of this.listeners) l(copy);
      },
      world,
    );
  }

  send(msg: ClientMsg): void {
    this.server.receive(CLIENT_ID, structuredClone(msg));
  }

  onMessage(cb: (msg: ServerMsg) => void): void {
    this.listeners.push(cb);
  }

  update(dt: number): void {
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      this.server.tick(TICK_DT);
    }
  }

  close(): void {
    this.server.leave(CLIENT_ID);
    this.listeners = [];
  }
}
