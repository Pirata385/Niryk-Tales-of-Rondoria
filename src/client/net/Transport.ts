import type { ClientMsg, ServerMsg } from '@shared/protocol';
import { TICK_DT } from '@shared/constants';
import { GameServer } from '@server/GameServer';

/** How the client talks to the (local or remote) server. */
export interface Transport {
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): void;
  /** Called by the client loop; the local transport advances the in-process server here. */
  update(dt: number): void;
  close(): void;
}

/**
 * Runs the authoritative GameServer in this tab, at its fixed tick rate. Messages are cloned in
 * both directions so client and server never share objects (exactly like a network would).
 * Swap for a WebSocketTransport to play online — nothing else changes.
 */
export class LocalTransport implements Transport {
  readonly server: GameServer;
  private listeners: ((msg: ServerMsg) => void)[] = [];
  private accumulator = 0;
  private readonly clientId = 'local';

  constructor(seed: number) {
    this.server = new GameServer(seed, (_client, msg) => {
      const copy = structuredClone(msg);
      for (const l of this.listeners) l(copy);
    });
  }

  send(msg: ClientMsg): void {
    this.server.receive(this.clientId, structuredClone(msg));
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
    this.server.leave(this.clientId);
    this.listeners = [];
  }
}
