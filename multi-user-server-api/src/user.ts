import { WebSocketEvent } from './events';
import { PeerBase } from './peer-base';

/**
 * User connection instance.
 */
export class User {
  id = 0;
  /** The object ids which owned by the user */
  objects: number[];

  /**
   * Queue containing websocket events to send.
   * The events are sent in FIFO order on every server update.
   */
  eventQueue: WebSocketEvent[] = [];
  /** Timestamp of the last received message */
  lastMessageTimestamp = 0;
  /** Peer connection of this user */
  peer: PeerBase;
  /** Internal storage for current listener position */
  listenerTransforms: Float32Array;

  /**
   * User constructor, called by {@link MultiUserServer#addUser()}.
   *
   * @param id User id
   * @param objects Initial objects owned by user
   * @param peer Peer owned by the user
   */
  constructor(id: number, objects: number[], peer: PeerBase) {
    this.id = id;
    this.objects = objects;
    this.peer = peer;
    this.listenerTransforms = new Float32Array(8);
  }

  toJSON() {
    return {
      id: this.id,
      objects: this.objects,
      eventQueue: this.eventQueue,
      lastMessageTimestamp: this.lastMessageTimestamp,
      peer: {
        id: this.peer.id,
      },
    };
  }
}
