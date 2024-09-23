import {
  Component,
  WonderlandEngine,
  Object3D,
  Mesh,
  Material,
} from '@wonderlandengine/api';
// eslint-disable-next-line import/no-unresolved
import { networkManager } from './network-manager.js';
// eslint-disable-next-line import/no-unresolved
import { NetworkedComponent } from './networked-component.js';
/* Note the '.js' at the end of the import statement. */
// eslint-disable-next-line import/no-unresolved
import { property } from '@wonderlandengine/api/decorators.js';

interface Object3DReference {
  [key: string]: {
    object: Object3D;
    id: number;
  };
}

export interface WonderlandWebsocketEvent {
  type: string;
  data: any;
}

/**
 * {NetworkConfigurationComponent}
 * BaseClass for the connection to the remote custom server.
 */
export class NetworkConfigurationComponent extends Component {
  static TypeName = 'network-configuration';
  remoteUsers: Map<string, Object3DReference> = new Map<
    string,
    Object3DReference
  >();
  connecting: boolean = false;
  inputDeviceId?: string;
  @property.object()
  playerObject: Object3D | null = null;
  @property.mesh()
  playerMesh: Mesh | null = null;
  @property.material()
  playerMaterial: Material | null = null;
  @property.string('localhost')
  serverHost: string = 'localhost';
  @property.int(443)
  serverPort: number = 443;
  @property.string('')
  serverPath: string = '';
  @property.bool(true)
  secure: boolean = true;
  @property.bool(false)
  audio: boolean = false;
  @property.bool(false)
  debug: boolean = false;
  /**
   * Special property to skip sending server start signal,
   * this is only usable for local server development, as
   * otherwise there is no guarantee that your server will run
   */
  @property.bool(false)
  skipServerStart: boolean = false;
  static onRegister(engine: WonderlandEngine) {
    engine.registerComponent(NetworkedComponent);
  }

  init() {
    this.inputDeviceId = '';
  }

  start() {
    if (!this.playerObject) throw new Error('Missing playerObject param');
    if (!this.playerMesh) throw new Error('Missing playerMesh param');
    if (!this.playerMaterial) throw new Error('Missing playerMaterial param');
    this.connect();
  }

  /**
   * Function which triggers a connection initiation by calling the connect
   * function of the networkManager singleton instance.
   */
  connect() {
    const customJoinData = {
      handTracking: false,
      hands: false,
    };
    if (this.connecting) {
      console.error('cannot connect multiple times!');
      return;
    } else {
      this.connecting = true;
    }
    console.log('connecting...', {
      host: this.serverHost,
      port: this.serverPort,
      secure: this.secure,
      audio: this.audio,
      audioDeviceId: this.inputDeviceId,
      debug: this.debug,
      path: this.serverPath,
    });

    networkManager
      .connect(customJoinData, {
        host: this.serverHost,
        port: this.serverPort,
        secure: this.secure,
        audio: this.audio,
        audioDeviceId: this.inputDeviceId,
        debug: this.debug,
        path: this.serverPath,
        skipServerStart: this.skipServerStart
      })
      .then(this.onSuccessfulConnection.bind(this))
      .catch((e) => {
        console.error(e);
        /* No more updates for now. */
        this.active = false;
        this.connecting = false;
        /* Automatically reconnect -- for debugging the server */
        setTimeout(this.connect.bind(this), 1000);
      });

  }

  /**
   * Will be called once a successful connection could be made to the
   * custom user server implementation. The joinEvent will contain the networkIds
   * with the user owned objects. For example, if you onUserJoin function looks
   * like this:
   *
   * ```ts
   *
   *   onUserJoin(e: JoinEvent) {
   *     // custom join data, send in the connect function above
   *     const customJoinData = e.data;
   *
   *     e.transforms = new Float32Array(8 * 1);
   *     // Initialize dual quaternions
   *     for (let i = 0; i < 1; ++i) {
   *       e.transforms[i * 8 + 3] = 1;
   *     }
   *
   *     const user = super.onUserJoin(e);
   *
   *     return user:
   *   }
   * ```
   *
   * The returned user.objects will contain the networkId for your newly created
   * transforms array.
   * @param joinEvent {number[]}
   */
  onSuccessfulConnection(joinEvent: number[]) {
    try {
      /* We are mis-using postRender here to ensure all
       * networked-component updates have been called */
      this.engine.scene.onPostRender.push(
        networkManager.update.bind(networkManager)
      );

      networkManager.onEvent.add(this.onEvent.bind(this));
      this.playerObject &&
        this.playerObject.addComponent('networked', {
          networkId: joinEvent[0],
          mode: 'send',
        });

      /* Start updating! */
      this.active = true;
      if(networkManager.client){
        this.engine.onXRSessionStart.add(networkManager.client?.onXRSessionStart);
      }

    } catch (e) {
      console.log('Error while trying to join:', e);
    }
  }

  /**
   * Handler function, to handle custom sent events from the custom server
   * implementation. Contains default implementations for the user-joined and
   * user-leave events, which will help you with the default functionality  implementation.
   * Usually you would overwrite this function on the extending class of your
   * network manager instance and call this method with `super.onEvent(e)`and then
   * implement additional logic.
   *
   * For example:
   *
   * ```ts
   * onEvent(e: WonderlandWebsocketEvent) {
   *   super.onEvent(e);
   *   switch(e.type){
   *     case: 'custom-event':
   *       //do your custom event handling here
   *       break;
   *     default:
   *       break;
   *   }
   * }
   * ```
   * @param e
   */
  onEvent(e: WonderlandWebsocketEvent) {
    switch (e.type) {
      case 'user-joined':
        console.log('Spawning', e);
        const head = this.engine.scene.addObject();
        head.addComponent('mesh', {
          mesh: this.playerMesh,
          material: this.playerMaterial,
        });
        /*
          adds a networked component to the head object.
          the translations of this component are later updated,
          which will also update the parent component.
        */
        head.addComponent('networked', {
          networkId: e.data.networkIds[0],
          mode: 'receive',
        });

        const userObjects = {
          head: {
            object: head,
            id: e.data.networkIds[0],
          },
        };
        if (typeof e.data.id === 'undefined') {
          console.error(
            'Please provide a user id in your user-joined event by setting the id property in your data object, otherwise removing disconnected users will not work!'
          );
        } else {
          if (this.remoteUsers.has(e.data.id)) {
            console.error(
              'Joined multiple users with same id, this can lead to unwanted behaviour'
            );
          }
          this.remoteUsers.set(e.data.id, userObjects);
        }
        break;
      case 'user-left':
        console.log('Player left:', e);
        const remoteUser = this.remoteUsers.get(e.data.id);
        if (remoteUser) {
          console.log('removed player', remoteUser);
          Object.values(remoteUser).forEach(({ object, id }) => {
            networkManager.removeObject(id);
            object.destroy();
            console.log('removed object', object, id);
          });
        }
        break;
      default:
        if (this.debug) console.log('Unknown event:', e);
    }
  }
}
