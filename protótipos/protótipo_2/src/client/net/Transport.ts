import type { ClientMsg, ServerMsg } from '@shared/protocol';

/** How the client talks to the (local or remote) server. */
export interface Transport {
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): void;
  /** Called by the client loop every frame; the local transport advances its in-process server here. */
  update(dt: number): void;
  close(): void;
  /**
   * Test and tool helpers (tools/e2e.mjs, tools/shoot.mjs) that only an in-process server can
   * offer. The game reads them only in debug mode (dev server or ?debug).
   */
  readonly debug?: TransportDebug;
}

export interface TransportDebug {
  /** Moves the local player (server side; the client's prediction follows at the next snapshot). */
  teleport(x: number, z: number): void;
  /** Every wolf of the world: the client itself only hears about the ones near the player. */
  wolves(): { id: number; x: number; z: number; hp: number }[];
  /** Drops the local player dead (the death screen and the respawn). */
  kill(): void;
}
