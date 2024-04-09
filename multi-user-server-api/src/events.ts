import { PeerBase } from './peer-base';
import { User } from './user';

// eslint-disable-next-line no-shadow
export const enum WebSocketEventTypes {
  DEFAULT = 'default-event',
  SET_MUTE_PLAYER = 'set-mute-player',
}

/**
 * Events sent between client and server.
 */
export class WebSocketEvent {
  type: string = WebSocketEventTypes.DEFAULT;
  data: { [key: string]: any } = {};

  constructor(type: string, data: { [key: string]: any }) {
    this.type = type;
    this.data = data;
  }
}

/**
 * Mute event which can be sent to the server. Please note, that this event
 * is executed directly on the cloud framework and then only forwarded to the
 * custom server implementation for doing some additional logic. The mute setting
 * happens in the code running the custom server.
 */
export class MutePlayerEvent extends WebSocketEvent {
  constructor(targetId: string, mute: boolean) {
    super(WebSocketEventTypes.SET_MUTE_PLAYER, { mute, targetId });
  }
}

/**
 * Event for when a user joined.
 *
 * When initially connecting, the transforms are empty.
 * Set custom join data to help us initialize the transforms.
 *
 * Example:
 *
 * The below code is run when connecting from the network-configuration-component.ts used in the client code:
 * ```js
 * connect() {
 *  const customJoinData = {
 *      handTracking: false,
 *      hands: false,
 *  };
 *  console.log("connecting...");
 *
 *  networkManager
 *      .connect(this.roomId, customJoinData, {
 *          host: this.serverHost,
 *          port: this.serverPort,
 *          secure: this.secure,
 *          audio: this.audio,
 *          audioDeviceId: this.inputDeviceId,
 *          debug: this.debug,
 *          path: this.serverPath,
 *      })
 *      .then((serverJoinEvent) => {
 *          ...//register the returned transforms from the server
 *      }).catch((err)=>{
 *      ...// do error handling
 *      });
 * }
 * ```
 *
 * The data property of a JoinEvent instance received on the server in the onUserJoin event handler is equal to the
 * customJoinData provided on the initial client to server connection
 */
export class JoinEvent {
  peer: PeerBase;
  transforms: Float32Array;
  /**
   * Custom join data map.
   */
  data: { [key: string]: any };

  constructor({
    transforms = new Float32Array(),
    data = {},
    peer,
  }: {
    transforms?: Float32Array;
    data: { [key: string]: any };
    peer: PeerBase;
  }) {
    this.peer = peer;
    this.transforms = transforms;
    this.data = data;
  }

  toJSON() {
    return {
      peer: {
        id: this.peer.id,
        user: this.peer.user?.toJSON(),
      },
      data: this.data,
      transforms: this.transforms,
    };
  }
}

/**
 * Event for when a user disconnects.
 */
export class LeaveEvent {
  user: User;

  constructor(user: User) {
    this.user = user;
  }

  toJSON() {
    return {
      user: this.user.toJSON(),
    };
  }
}
