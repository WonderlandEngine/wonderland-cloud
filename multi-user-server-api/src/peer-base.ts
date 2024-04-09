import { Blob } from 'node:buffer';
import { User } from './user';

/**
 * Internal data of a peer connection.
 */
export interface PeerBase {
  id: string;
  wsClient: { send(data: string): void };

  sendMessageViaDatachannel(
    message: string | Blob | ArrayBuffer | ArrayBufferView
  ): boolean;

  // eslint-disable-next-line no-use-before-define
  user?: User;
}
