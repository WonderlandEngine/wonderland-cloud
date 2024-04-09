import { User } from './user';
import { JoinEvent, LeaveEvent, WebSocketEvent } from './events';
import { PeerBase } from './peer-base';
import EventEmitter from 'events';
import { v4 } from 'uuid';

/* Server permission */
const Server = 0xffffffff;

// eslint-disable-next-line no-shadow
export const enum ServerCommandName {
  MUTE_PLAYER = 0,
  DISCONNECT_PLAYER = 1,
}

export interface ServerCommand {
  name: ServerCommandName;
  data: {
    [key: string]: any;
  };
}

export interface ServerCommandWithId extends ServerCommand {
  id: string;
}

interface ServerCommandWithTimeout extends ServerCommandWithId {
  timeout: NodeJS.Timeout;
  callback: (error?: string) => void;
}

export interface MutePlayerCommand extends ServerCommandWithId {
  name: ServerCommandName.MUTE_PLAYER;
  data: {
    playerId: string;
    mute: boolean;
  };
}

export interface DisconnectPlayerCommand extends ServerCommandWithId {
  name: ServerCommandName.DISCONNECT_PLAYER;
  data: {
    playerId: string;
  };
}

export class MultiUserServer extends EventEmitter {
  /** Contains object transforms of all networked objects */
  transforms = new Float32Array();
  /** Contains write permission flags */
  writePermissions = new Uint32Array();

  /** Contains the object ids and any other data belonging to each user */
  users = new Map<number, User>();

  /** Next networkId, equivalent to .length of properties */
  nextNetworkId = 0;

  /** Next userId, equivalent to .length of users */
  nextUserId = 0;

  /** Unused networkIds less than nextNetworkId */
  unusedNetworkIds: number[] = [];

  /** Unused userIds less than nextUserId */
  unusedUserIds: number[] = [];

  /**
   * Number of server updates required per second
   *
   * Default `30`.
   *
   * Needs to be set in the constructor, later changes will not affect the update rate
   */
  updatesPerSecond = 30;

  /**
   * Enable timing out server update iterations if they take too long to compute,
   * defaults to false. If set to true, update iterations will silently timeout
   * and not being processed.
   *
   * Needs to be set in the constructor, later changes will not affect the update timeout behaviour.
   */
  enableUpdateTimeout = false;

  updateInterval: ReturnType<typeof setInterval> | undefined;

  serverName = 'DefaultImplementation';

  serverCommandsQueue: { [key: string]: ServerCommandWithTimeout } = {};

  async updateWithTimeout() {
    const maxUpdateDuration = 1000 / this.updatesPerSecond;
    let resolver: (value: void) => void,
      rejector: (reason: any) => void,
      timedOut = false;
    new Promise<void>(async (resolve, reject) => {
      resolver = resolve;
      rejector = reject;
      try {
        this.update();
        return resolve();
      } catch (error) {
        return reject(error);
      } finally {
        if (!timedOut) {
          clearTimeout(timeout);
        }
      }
    }).catch((error) => {
      console.error('Failed to run server update', error);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      return rejector(
        new Error(
          `update took longer than max update duration of ${maxUpdateDuration}ms, check your update function`
        )
      );
    }, maxUpdateDuration);
  }

  createUpdateInterval() {
    this.updateInterval = setInterval(
      this.enableUpdateTimeout
        ? this.updateWithTimeout.bind(this)
        : this.update.bind(this),
      1000 / this.updatesPerSecond
    );
  }

  sendServerCommandResult(id: string, error?: string) {
    const storedServerCommand = this.serverCommandsQueue[id];
    if (storedServerCommand) {
      storedServerCommand.callback(error);
    } else {
      console.warn(
        'received result for a timeout/non existing server command',
        {
          id,
          error,
        }
      );
    }
  }

  #emitAndEnqueueServerCommand(serverCommand: {
    name: ServerCommandName;
    data: { [key: string]: any };
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const serverCommandWithId: ServerCommandWithId = {
        ...serverCommand,
        id: v4(),
      };
      const serverCommandWithTimeout: ServerCommandWithTimeout = {
        ...serverCommandWithId,
        timeout: setTimeout(() => {
          delete this.serverCommandsQueue[serverCommandWithTimeout.id];
          return reject('Command timed out after 5000ms');
        }, 5000),
        callback: (error?: string) => {
          clearTimeout(serverCommandWithTimeout.timeout);
          delete this.serverCommandsQueue[serverCommandWithTimeout.id];
          if (error) {
            return reject(error);
          }
          return resolve();
        },
      };
      this.serverCommandsQueue[serverCommandWithTimeout.id] =
        serverCommandWithTimeout;
      this.emit('serverCommand', serverCommandWithId);
    });
  }

  /**
   * Call this function if you want to disconnect a player from your server.
   * This will close the underlying websocket and WebRTC connection and then
   * trigger the onUserLeave callback, so you don't need to handle this case
   * different from your normal user leave flow.
   * @param playerId {string} peer id of the client to disconnect
   */
  disconnectPlayer(playerId: string) {
    return this.#emitAndEnqueueServerCommand({
      name: ServerCommandName.DISCONNECT_PLAYER,
      data: {
        playerId,
      },
    });
  }

  /**
   * Call this function if you want to mute/unmute a player for all other players on
   * your server.
   * @param playerId {string} peer id of the client to disconnect
   * @param mute {boolean} toggle mute on/off
   */
  mutePlayer(playerId: string, mute: boolean) {
    return this.#emitAndEnqueueServerCommand({
      name: ServerCommandName.MUTE_PLAYER,
      data: {
        playerId,
        mute,
      },
    });
  }

  /**
   * Called when a user wants to join. This function should handle the creation of transforms and
   * forwarding them to the instance's addUser event. Below is an example code:
   *
   * ```ts
   * onUserJoin(e:JoinEvent){
   *   let objectCount = 1;
   *   // we have 2 objects, one for the head, and the other one for the body
   *   if (e.data.body) {
   *     objectCount +=1;
   *   }
   *    e.transforms = new Float32Array(8 * objectCount);
   *    for (let i = 0; i < objectCount; ++i) {
   *       e.transforms[i * 8 + 3] = 1;
   *     }
   *
   *    const user = super.onUserJoin(e);
   *    console.log('Joined:', e.peer.id);
   *     // let all other users know that a player joined
   *    const otherUsers = Array.from(this.users.values()).filter(
   *       (u) => u.id != user.id
   *     );
   *
   *     this.sendEvent(
   *       'user-joined',
   *       { networkIds: user.objects, id: user.id },
   *       otherUsers
   *     );
   *     // set id of the user to the internal used id,
   *     this.sendEvent('set-id', { id: user.id }, [user]);
   *
   *     // now send a user joined event for each already connected user we want to
   *     // track
   *      for (const u of this.users.values()) {
   *       if (u.id == user.id) continue;
   *       this.sendEvent('user-joined', { networkIds: u.objects, id: u.id }, [
   *         user,
   *       ]);
   *     }
   *
   *     return user;
   * }
   * ```
   *
   * On the client side, the event handler for the `user-joined` event would look like this
   *
   * ```js
   * onEvent(e) {
   *         switch (e.type) {
   *             case 'user-joined':
   *                 console.log('Spawning', e);
   *
   *                 // here we add 2 new objects to the scene with our
   *                 // previously defined player mesh and player body meshes and materials
   *                 const head = this.engine.scene.addObject();
   *                 head.addComponent('mesh', {
   *                     mesh: this.playerMesh,
   *                     material: this.playerMaterial,
   *                 });
   *                 head.addComponent('networked', {
   *                     networkId: e.data.networkIds[0],
   *                     mode: 'receive',
   *                 });
   *
   *                 const body = this.engine.scene.addObject();
   *                 body.addComponent('mesh', {
   *                     mesh: this.playerBodyMesh,
   *                     material: this.playerBodyMaterial,
   *                 });
   *                 body.addComponent('networked', {
   *                     networkId: e.data.networkIds[0],
   *                     mode: 'receive',
   *                 });
   *
   *                 const userObjects = {
   *                     head: {
   *                         object: head,
   *                         id: e.data.networkIds[0],
   *                     },
   *                     body: {
   *                       object: body,
   *                       id: e.data.networkIds[1]
   *                     }
   *                 };
   *                 // to be able to delete the objects later
   *                 // we need to keep a reference to them
   *                 this.remoteUsers.set(e.data.id, userObjects);
   *                 break;
   *             case 'user-left':
   *                 console.log('Player left:', e);
   *                 const remoteUser = this.remoteUsers.get(e.data.id);
   *                 Object.values(remoteUser).forEach(({object, id}) => {
   *                     networkManager.removeObject(id);
   *                     object.destroy();
   *                 });
   *                 break;
   *             default:
   *                 console.log('Unknown event:', e);
   *         }
   *     }
   * ```
   *
   * @param {JoinEvent} e Information about the user that is joining
   * @returns {User} A new user or `null` if user is not allowed to join
   */
  onUserJoin(e: JoinEvent) {
    return this.addUser(e.transforms, e.peer);
  }

  /**
   * Called when a user left. Here you should clean up any resource. Usually you
   * should also notify the remaining players that the user has left. For general
   * clean up, you can use this class's onUserLeave function via supre,
   * which calls `{@link MultiUserServer.removeUser} function and deletes the user
   * and his tracked objects from the internal storage.
   * `FOr example:
   *
   * ```ts
   * onUserLeave(e: LeaveEvent){
   *    const id = e.user.id;
   *     const networkIds = e.user.objects;
   *     super.onUserLeave(e);
   *     this.sendEvent(
   *       'user-left',
   *       { networkIds, id },
   *       Array.from(this.users.values())
   *     );
   * }
   * ```
   * On the client side you would need to implement an event listener for the
   * `user-leave` event and remove all the object which belong to the user from
   * the network manager and also from the scene
   * @param {LeaveEvent} e Information about the user that left
   */
  onUserLeave(e: LeaveEvent) {
    this.removeUser(e.user);
  }

  /**
   * Called when a custom event was sent from the client via websockets
   * to the server. Here the custom game logic and event handling should be implemented
   * by the custom server. For example in this case, if the client sends
   * a custom {@link WebSocketEvent} with the type `send-message` and the
   * data: `{message: 'example message}`, this message will be broadcasted
   * to the clients
   *
   * ```ts
   *
   * onWsMessageEvent(e: WebSocketEvent, peer: PeerBase) {
   *   switch (e.type) {
   *     case 'send-message':
   *       this.sendEvent(
   *         'receive-message',
   *         { userId: peer.user?.id, message: e.data.message },
   *         // send event to all users except myself
   *         this.getOtherUsers(peer.user?.id as number)
   *       );
   *       break;
   *   }
   * }
   * ````
   *
   * @param {WebSocketEvent} e The event
   * @param {PeerBase} peer The peer from whom the event was sent
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onWsMessageEvent(e: WebSocketEvent, peer: PeerBase) {}

  /**
   * Send a custom event
   *
   * @param {string} type Name of the event
   * @param {object} data Custom data to send with the event
   * @param {User[]} users Which users to send the event to. Leave empty to send to all users.
   */
  sendEvent(
    type: string,
    data: { [key: string]: any },
    users: User[] = this.users.values() as unknown as User[]
  ) {
    const e = new WebSocketEvent(type, data);
    for (const u of users) {
      u.eventQueue.push(e);
    }
  }

  /**
   * Called when data is received from one user via the RTCDataChannel. This function
   * is usually not touched, as the logic remains the same for every server.
   * If the timestamp from the message is higher that the user's lastMessageTimestamp,
   * we set the internal transforms with the user mask, which are the first 4 bytes of
   * the provided ArrayBuffer, reserved for the U32 timestamp, then it's always 4 bytes * number of
   * objects, which hold the object id and 8 * 4 * count bytes for the object's transforms
   * represented by dual quaternion, where the first 4 are the rotation and the
   * second 4 are the translation.
   *
   * For example, with a ArrayBuffer holding 2 objects, We will call S = TimeStampBytes,
   * I1 = objectId 1 bytes, I2 = objectId 2 bytes, T1 = translation of object 1 and
   * T2 = translations of object 2, the array buffer content would look like this:
   * [SSSS.I1I1I1I1.I2I2I2I2.T1T1T1T1.T1T1T1T1.T1T1T1T1.T1T1T1T1.T1T1T1T1.
   * T1T1T1T1.T1T1T1T1.T1T1T1T1.T2T2T2T2.T2T2T2T2.T2T2T2T2.T2T2T2T2.T2T2T2T2
   * T2T2T2T2.T2T2T2T2.T2T2T2T2]
   *
   * @param user {User}
   * @param data {ArrayBuffer}
   */
  onRTCData(user: User, data: ArrayBuffer) {
    const count = (data.byteLength - 4) / (8 * 4 + 4);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);
    /* Discard outdated messages */
    if (user.lastMessageTimestamp > u32[0]) return;
    this.setTransforms(
      1 << user.id,
      // TODO sometimes we use number[] sometimes we use random array representations, need to find out what
      // the best approach is for this
      u32.subarray(1, 1 + count) as unknown as number[],
      f32.subarray(1 + count, 1 + count + count * 8)
    );
    user.lastMessageTimestamp = u32[0];
  }

  /**
   * Function which will be called whenever a player starts or stops speaking
   * You are free to add your own logic, for example sending an event to the clients
   * and display a speaking identifier there.
   * @param peer {PeerBase}
   * @param isSpeaking {boolean}
   */
  onPlayerSpeakChange(peer: PeerBase, isSpeaking: boolean) {}

  /**
   * Called at update rate to update the server world
   * sends queued events via Websockets to each user and also sends
   * the current transforms to each user via RTCDataChannel. Also, we set the
   * audio position for each user, if audio is enabled and an audio buffer exists
   * on the user object.
   *
   * Usually you should not modify this function, but rather call it in your
   * deriving class via super:
   *
   * ```ts
   * update(){
   *   super.update();
   *   // you can add your custom logic which needs to run every server update
   *   // here
   * }
   * ```
   */
  update() {
    const timestamp = Date.now();

    /* Send out event queues via websocket */
    for (const u of this.users.values() as unknown as User[]) {
      for (const e of u.eventQueue) {
        u.peer.wsClient.send(JSON.stringify(e));
      }
      u.eventQueue.length = 0;
    }

    /* Prepare common update for all users to send via webrtc */
    const count = this.nextNetworkId;
    if (count == 0) return;

    const buffer = new ArrayBuffer(count * (8 * 4) + 4);
    const u32 = new Uint32Array(buffer);
    const f32 = new Float32Array(buffer);

    u32[0] = timestamp;
    f32.set(this.transforms, 1);
    for (const u of this.users.values()) {
      try {
        u.peer.sendMessageViaDatachannel(buffer);
      } catch (err) {
        throw err;
      }
    }
  }

  /**
   * Get an array with all users except the one with the id provided in the parameter.
   * Useful, if you want to
   * @param userId {number}
   */
  getOtherUsers(userId: number): User[] {
    return Array.from(this.users.values()).filter((u) => u.id != userId);
  }

  /**
   * Add a user with initial transforms of his owned objects
   *
   * @param {Float32Array} transforms Initial transforms for user owned objects
   * @param {PeerBase} peer Peer connection of this user
   * @returns {User} user internal user representation class
   */
  addUser(transforms: Float32Array, peer: PeerBase) {
    if (this.unusedUserIds.length) {
      const id = this.unusedUserIds[this.unusedUserIds.length - 1];
      --this.unusedUserIds.length;
      return this.#addUserWithId(id, peer, transforms);
    }
    const id = this.nextUserId++;
    return this.#addUserWithId(id, peer, transforms);
  }

  /**
   * Private method to add a user to the internal user storage. You shouldn't
   * touch this one.
   * @param id {number} user counter
   * @param peer {PeerBase} peer object
   * @param transforms {Float32Array} user transforms
   * @private
   */
  #addUserWithId(id: number, peer: PeerBase, transforms: Float32Array) {
    const u = new User(id, this.addObjects(transforms, 1 << id), peer);
    this.users.set(id, u);
    if (this.users.size === 1) {
      this.createUpdateInterval();
    }
    return u;
  }

  /**
   * Remove a user and all his objects from the internal storage. If we have zero users
   * connected, stop update interval to save server resources.
   * @param user {User} user object we want to remove
   */
  removeUser(user: User) {
    this.unusedUserIds.push(user.id);
    this.removeObjects(user.objects);

    this.users.delete(user.id);
    if (this.users.size === 0) {
      clearInterval(this.updateInterval);
    }
  }

  /**
   * Add networked objects to internal objects storage and set the write permission
   * for these objects accordingly.
   *
   * @param {Float32Array[]} transforms Initial transform of the object
   * @param {number} writePermission Mask of which users are allowed to write the transforms of the objects
   * @returns {number[]} The networkIds for the new objects
   */
  addObjects(transforms: Float32Array, writePermission: number) {
    const count = transforms.length / 8;
    /* Reuse old network ids for cache efficiency */
    const unusedCount = this.unusedNetworkIds.length;
    const reusableCount = Math.min(count, unusedCount);
    const ids = this.unusedNetworkIds.slice(unusedCount - reusableCount);
    this.unusedNetworkIds.length -= reusableCount;

    /* If we need more ids than we were able to reuse,
     * add some new ones */
    const newIdsCount = count - ids.length;

    /* Painfully resize transforms typed array */
    const oldTransforms = this.transforms;
    this.transforms = new Float32Array(oldTransforms.length + newIdsCount * 8);
    this.transforms.set(oldTransforms);

    /* Painfully resize writePermissions typed array */
    const oldWritePermissions = this.writePermissions;
    this.writePermissions = new Uint32Array(
      oldWritePermissions.length + newIdsCount
    );
    this.writePermissions.set(oldWritePermissions);

    /* Set write permissions to existing objects ids */
    for (const o of ids) {
      this.writePermissions[o] = writePermission;
    }

    while (ids.length < count) {
      const o = this.nextNetworkId++;
      ids.push(o);
      this.writePermissions[o] = writePermission;
    }

    this.setTransforms(Server, ids, transforms);

    return ids;
  }

  /** Remove networked objects */
  removeObjects(objectIds: number[]) {
    for (const o of objectIds) {
      /* Disable writing to this object */
      this.writePermissions[o] = 0;
      this.unusedNetworkIds.push(o);
    }
  }

  /**
   * Handle a request by `user` to set `objectIds` transforms to `transforms`.
   *
   * @param {number} userMask Permission mask of the user setting the transforms, `Server` for full authority.
   * @param {Uint32Array} objectIds NetworkIds of the objects to set
   * @param {Float32Array} transforms Transformations to set
   */
  setTransforms(
    userMask: number,
    objectIds: number[],
    transforms: Float32Array
  ) {
    for (let i = 0; i < objectIds.length; ++i) {
      const o = objectIds[i];
      /* Check that user is allowed to write this transform */
      if ((this.writePermissions[o] & userMask) == 0) continue;

      this.#setTransform(o, transforms, i * 8);
    }
  }

  /**
   * Internal function to set a single object's transform.
   *
   * **Warning:** This function does not check write permissions.
   *
   * @param {number} o Object index
   * @param {Float32Array} transform A src array for the transform
   * @param {number} srcOffset Where to start reading in `transform`
   */
  #setTransform(o: number, transform: Float32Array, srcOffset: number) {
    const e = o * 8 + 8;
    for (let d = o * 8, s = srcOffset; d < e; ++d, ++s) {
      this.transforms[d] = transform[s];
    }
  }

  /**
   * Internal function to check if the child class is a MultiUserServer. This function will
   * exist on the Child Classes => we know the server is a valid child of the MultiUserServer
   * class
   */
  _isMultiUserServer() {
    return true;
  }
}
