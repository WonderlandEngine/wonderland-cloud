import { Component } from '@wonderlandengine/api';

import { networkManager } from './network-manager.js';
/* Note the '.js' at the end of the import statement. */
import { property } from '@wonderlandengine/api/decorators.js';

/**
 * Network component which is added by {@link NetworkConfigurationComponent}
 * to synchronize object transforms.
 *
 * ```ts
 * myObject3DInstance.addComponent('networked', {
 *   networkId: <networkId from server>,
 *   mode: 'receive' | 'send',
 * })
 * ```
 *
 * This will update the transforms of myObject3DInstance by
 * received server values, or send the updated transforms of the
 * instance to the server.
 */
export class NetworkedComponent extends Component {
  static TypeName = 'networked';

  @property.int(-1)
  networkId: number = -1;

  @property.enum(['receive', 'send'], 'receive')
  mode: string = 'receive';

  start() {
    if (this.networkId < 0) throw new Error('networkId is not configured');
    networkManager.registerNetworkedComponent(this, this.mode == 'send');
  }
}
