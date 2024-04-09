import { WonderlandClient, WonderlandClientOptions } from '../client.js';
import { WonderlandWebsocketEvent } from './network-configuration-component.js';
import { NetworkedComponent } from './networked-component.js';

import { Emitter } from '@wonderlandengine/api';

/**
 * Global Registry for NetworkedComponents.
 */

/**
 * Utility class for handling the management of all connected network components.
 * Each component, that should be send or updated over the network, needs to be
 * registered via the {@link NetworkManager.registerNetworkedComponent} method.
 * If the component is destroyed or not used anymore, for example a player,
 * who left the server, you should call the  {@link NetworkManager.removeObject}
 * method.
 */
export class NetworkManager {
  onEvent = new Emitter<[WonderlandWebsocketEvent]>();
  readComponents = new Map();
  writeComponents = new Map();

  lastMessageTimestamp = 0;
  client?: WonderlandClient;

  /** Register a networked component. Called in start() of NetworkedComponent */
  registerNetworkedComponent(c: NetworkedComponent, write: boolean) {
    console.log('registered', write ? 'write' : 'read', 'comp', c.networkId);
    if (write) {
      this.writeComponents.set(c.networkId, c);
    } else {
      this.readComponents.set(c.networkId, c);
    }
  }

  get selfPlayerId(): string | undefined{
    return this.client ? this.client.id : undefined;
  }


  /**
   * Connect to a server and room
   *
   * TODO Split to allow listing rooms first
   *
   * @param {object} joinData Extra data to send while joining
   * @param {Partial<WonderlandClientOptions>} options Wonderlandclient options
   */
  async connect(
    joinData: { [key: string]: any },
    options: Partial<WonderlandClientOptions> = {}
  ) {
    if (!this.client) this.client = new WonderlandClient(options);
    return this.client.connectAndJoinRoom(joinData);
  }

  /** Send and receive data, called by NetworkConfigurationComponent */
  update() {
    if (!this.client) return;
    /* Process events in the client's queue */
    for (const e of this.client.eventQueue) {
      this.onEvent.notify(e);
    }
    this.client.eventQueue.length = 0;

    this._updateSend();
    this._updateReceive();
  }

  /**
   * Set the mute status of a player and send this to the custom server implementation.
   * @param targetId {string} peer id of the player, which you get from the server when receiving a user joined event
   * @param mute {boolean} if the player should be muted or not
   */
  setMutePlayer(targetId: string, mute: boolean) {
    this.client?.sendViaWs({
      // todo use the multi user server api enums for this once publicly released
      type: 'set-mute-player',
      data: {
        targetId,
        mute,
      },
    });
  }

  /**
   * Internal method to update the sending components, by iteration over the
   * write components array, packaging all objects with their networkIds, and
   * then adding each transforms to the array and send them to the server
   */
  _updateSend() {
    /* Send player owned objects in a package */
    const count = this.writeComponents.size;
    const buffer = new ArrayBuffer(count * (8 * 4 + 4) + 4);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);

    u32[0] = Date.now();

    const idsOffset = 1;
    const transformsOffset = 1 + count;
    let i = 0;
    for (const [networkId, c] of this.writeComponents) {
      u32[idsOffset + i] = networkId;
      f32.set(c.object.transformWorld, transformsOffset + 8 * i);
      ++i;
    }
    this.client && this.client.send(buffer);
  }

  /**
   * Internal method to update the reading components, by iteration over the
   * received data array and taking the newest data chunk, then updating
   * each readComponent which matches the network id with it's current transforms
   */
  _updateReceive() {
    if (!this.client) return;
    /* Receive all data */
    let newestMessage = null;
    let newestTimestamp = this.lastMessageTimestamp;
    for (const d of this.client.receivedData) {
      const u32 = new Uint32Array(d);
      /* Discard messages that are older than the last processed
       * message */
      if (u32[0] < newestTimestamp) continue;
      newestTimestamp = u32[0];
      newestMessage = d;
    }
    this.client.receivedData.length = 0;

    if (!newestMessage) return;
    this.lastMessageTimestamp = newestTimestamp;

    const f32 = new Float32Array(newestMessage);
    const u32 = new Uint32Array(newestMessage);

    /* No transformations with this message */
    if (u32.length <= 9) return;

    const count = (u32.length - 1) / 8;
    for (let i = 0; i < count; ++i) {
      const c = this.readComponents.get(i);
      if (!c) continue;

      const t = f32.subarray(1 + i * 8, 1 + i * 8 + 8);
      c.object.transformWorld = t;
    }
  }

  /**
   * Remove a network component object from the internal storage
   * @param id {number} ID of the networked object
   */
  removeObject(id: number) {
    this.readComponents.delete(id);
    this.writeComponents.delete(id);
  }
}

export const networkManager = new NetworkManager();
