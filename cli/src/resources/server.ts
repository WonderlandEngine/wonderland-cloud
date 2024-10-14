import { asyncTimeout, debugMessage, logMessage } from '../utils';
import { getAndValidateAuthToken } from '../cli_config';
import ws from 'ws';
import process from 'process';
import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';
import merge from 'lodash.merge';
import { SUBSCRIPTION_TYPE, SubscriptionClient } from './subscriptions';
import { EventEmitter } from 'events';

export interface ServerConfig {
  WORK_DIR: string;
  SERVER_URL: string;
  COMMANDER_URL?: string;
  IS_LOCAL_SERVER?: boolean;
  WLE_CREDENTIALS_LOCATION?: string;
  WLE_CREDENTIALS?: string;
}

const defaultConfig: Partial<ServerConfig> = {
  WORK_DIR: process.env.WORK_DIR || process.cwd(),
  SERVER_URL: process.env.SERVER_URL,
  COMMANDER_URL: process.env.COMMANDER_URL || 'https://cloud.wonderland.dev',
  IS_LOCAL_SERVER: process.env.IS_LOCAL_SERVER === 'true',
  WLE_CREDENTIALS_LOCATION: path.join(
    process.env.AUTH_JSON_LOCATION ||
    path.join(process.cwd(), 'wle-apitoken.json'),
  ),
};


export interface CloudServer {
  maxPlayers: number;
  userName: string;
  fileName: string;
  packageName: string;
  cli: boolean;
  cliPort: number;
  hrtfAudio: boolean;
  port: number;
  // md5 hash of user email
  userHash: string;
  type: SUBSCRIPTION_TYPE;
  serverName: string;
  isDeployed: boolean;
  host: string;
}

export class ServerClient extends EventEmitter {
  wsClient?: ws;
  fileChangePromise?: Promise<any>;
  authToken: string;
  workDirectory: string;
  customPackageJson: any;
  serverUrl = '';
  wsUrl = '';
  packedPackageName: string;
  connectionId = '';
  serverName = '';
  pingInterval?: NodeJS.Timer;
  config: Partial<ServerConfig>;
  wsConFinData: {
    promise?: Promise<unknown>;
    rejector?: (error: unknown) => void;
    resolver?: ({ code, reason }: { code: number; reason: string }) => void;
  };
  subscriptionClient: SubscriptionClient;

  constructor(cloudConfig: Partial<ServerConfig>) {
    super();
    const mergedConfig = merge({}, defaultConfig, cloudConfig);
    this.config = mergedConfig;
    this.authToken = getAndValidateAuthToken(mergedConfig);
    this.workDirectory = mergedConfig.WORK_DIR as string;
    // we will throw an error if the work directory does not contain a package.json1

    this.customPackageJson = require(path.join(
      this.workDirectory,
      'package.json',
    ));
    // we need this for supporting namespaced packages
    this.packedPackageName = `${this.customPackageJson.name
      .replaceAll('@', '')
      .replaceAll('/', '-')}-${this.customPackageJson.version}.tgz`;
    this.wsConFinData = {};
    this.subscriptionClient = new SubscriptionClient(cloudConfig);
  }

  #extractAndValidateServerUrl(serverName: string) {
    if (!this.serverUrl) {
      // example commander URL is https://staging.cloud.wonderland.dev
      // so we need to split by // and insert the server subdomain before first element of domain
      const parts = this.config.COMMANDER_URL?.split('/') as string[];
      // last part contains the domain start so let's prepend server to it
      parts[2] = `server.${parts[2]}`;
      parts.push(serverName);
      this.serverUrl = parts.join('/');
      if (!this.serverUrl.includes('staging.')) {
        this.serverUrl = this.serverUrl.replace('cloud.', '');
      }
      this.serverName = serverName;
    }
  }

  #handleWsMessage(message: string) {
    try {
      const jsonMessage = JSON.parse(message);
      if (jsonMessage.authenticated) {
        this.connectionId = jsonMessage.id;
        logMessage('Created websocket keep alive ping interval');
        this.pingInterval = setInterval(() => {
          this.wsClient?.send('ping');
        }, 10000);

        this.#processFileChange().then(() => this.#listenToFileChanges());
      }
    } catch (err) {
      /* empty */
    }
    logMessage(message.toString());
    this.emit('debug-message', { message });
  }

  #waitForWSClientOpen(attempt = 0, maxAttempts = 6) {
    return new Promise(async (resolve, reject) => {
      if (attempt === maxAttempts) {
        return reject(new Error('server did not start in time!'));
      }
      const currentWaitTime = (attempt) * 1250;
      await asyncTimeout(currentWaitTime);
      const client = new ws(this.wsUrl);

      const closeAndCleanup = () => {
        client.removeAllListeners();
        client.on('error', (error) => {
        });
        setTimeout(() => {
          client.removeAllListeners();
        }, 5000);
        client.close();
      };
      client.on('open', () => {
        closeAndCleanup();
        return resolve({});
      });
      client.on('error', async (err) => {
        closeAndCleanup();
        this.#waitForWSClientOpen(attempt += 1, maxAttempts).then(resolve).catch(reject);
      });
      client.on('close', async (code, reason) => {
        closeAndCleanup();
        this.#waitForWSClientOpen(attempt += 1, maxAttempts).then(resolve).catch(reject);
      });
    });
  }

  async #sendStartServerSignal(): Promise<boolean> {
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/servers/start`,
      {
        body: JSON.stringify({
          path: this.serverName,
        }),
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
      },
    );
    if (response.status === 200) {
      logMessage('Server started!');
      return true;
    } else if (response.status === 201) {
      logMessage('Server scheduled for start');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return this.#sendStartServerSignal();
    } else if (response.status === 202) {
      logMessage('...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return this.#sendStartServerSignal();
    } else {
      logMessage('Failed to start server!!', await response.json());
      throw new Error('failed to start server!');
    }
  }

  #cleanupWsConFinData() {
    delete this.wsConFinData.resolver;
    delete this.wsConFinData.rejector;
    delete this.wsConFinData.promise;
  }

  /**
   * Creates a new debug connection to your CLI server via WebSockets
   */
  async debug(serverName: string) {
    try {
      this.#extractAndValidateServerUrl(serverName);
      // pattern to be able to resolve/reject promise from one point of the application
      // while awaiting the promise from the other part of the application
      const promise: Promise<{ code: number; reason: string }> = new Promise(
        (resolve, reject) => {
          this.wsConFinData.rejector = (err: unknown) => {
            this.#cleanupWsConFinData();
            reject(err);
          };
          this.wsConFinData.resolver = ({
                                          code,
                                          reason,
                                        }: {
            code: number;
            reason: string;
          }) => {
            this.#cleanupWsConFinData();
            resolve({ code, reason });
          };
        },
      );
      this.wsConFinData.promise = promise;

      if (!this.config.IS_LOCAL_SERVER) {
        this.wsUrl = this.#createWsUrl(this.serverUrl);
        await this.#sendStartServerSignal();
      } else {
        this.wsUrl = this.config.SERVER_URL?.replace('http', 'ws') as string;
      }
      logMessage('Waiting for server to be up and running...', this.wsUrl);
      await this.#waitForWSClientOpen();
      logMessage('Server is reachable, establishing debug connection.');
      this.#createWsClient();
      // let's await the result of out WS connection
      return promise;
    } catch (error) {
      logMessage('Failed to create debug server connection', (error as Error).cause || (error as Error).message);
    }
  }

  #createWsUrl(url: string) {
    const urlParts = url.split('/');
    urlParts[0] = 'wss:';
    urlParts[2] = urlParts[2] + ':443';
    return `${urlParts.join('/')}-develop`;
  }

  #createWsClient(maxAttempts = 5, attempt = 0) {
    logMessage('Creating new WS client connection', this.wsUrl);
    const client = new ws(this.wsUrl);
    client.on('open', () => {
      client.on('message', this.#handleWsMessage.bind(this));
      logMessage('authenticating...');
      client.send(
        JSON.stringify({
          auth: this.authToken,
        }),
      );
    });
    client.on('error', async (err) => {
      logMessage('Websocket client closed with error', err);
      if (maxAttempts === attempt) {
        if (this.wsConFinData.rejector) {
          this.wsConFinData.rejector(err);
        }
      } else {
        await asyncTimeout(1000);
        clearInterval(this.pingInterval);
        this.wsClient = this.#createWsClient(maxAttempts, attempt + 1);
      }
    });
    client.on('close', async (code, reason) => {
      if (code === 1006) {
        logMessage(
          'Websocket client abnormally closed, reconnecting...',
          code,
          reason.toString(),
        );
        await asyncTimeout(1000);
        clearInterval(this.pingInterval);
        this.wsClient = this.#createWsClient(maxAttempts, attempt + 1);
      }
      if (this.wsConFinData.resolver) {
        logMessage('Websocket client closed', code, reason.toString());
        this.wsConFinData.resolver({ code, reason: reason.toString() });
      }
    });
    this.wsClient = client;
    return client;
  }

  #listenToFileChanges() {
    logMessage('Listening for file changes...');
    new Promise((resolve) => {
      const watcher = fs.watch(this.workDirectory, async (event, filename) => {
        logMessage('Found a file change!', filename);
        watcher.close();
        await this.#handleFileChange();
        logMessage('Finished handling file change');
        resolve(null);
      });
    }).then(() => {
      this.#listenToFileChanges();
    });
  }

  async #processFileChange() {
    await this.#packFiles();
    await this.#uploadPackage();
  }

  async #handleFileChange() {
    if (!this.fileChangePromise) {
      try {
        this.fileChangePromise = this.#processFileChange();
        await this.fileChangePromise;
      } catch (error) {
        logMessage('Could not handle file change!', (error as Error).cause || (error as Error).message);
      }
      delete this.fileChangePromise;
    } else {
      debugMessage(
        'File change operation already in progress skipping current file change',
      );
    }
  }

  async #packFiles() {
    return new Promise((resolve, reject) => {
      exec(
        'npm pack',
        {
          cwd: this.workDirectory,
        },
        (error) => {
          if (error) {
            logMessage('Failed to pack files', (error as Error).cause || (error as Error).message);
            return reject(error);
          }
          logMessage('Finished packing files!');

          return resolve(null);
        },
      );
    });
  }

  async #testDeployment() {
    logMessage('Testing deployment...');
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/servers/test-deployment`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: this.serverName,
        }),
        headers: {
          authorization: this.authToken,
          'content-type': 'application/json',
        },
      },
    );
    const serverData = await response.json();
    if (response.status < 400) {
      logMessage('Successfully tested deployment', serverData);
    } else {
      logMessage('Failed to test deployment', serverData);
      throw Error('Failed to test deployment');
    }
  }

  async #validateDeployment() {
    logMessage('Validating deployment...');
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/servers/validate-deployment`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: this.serverName,
        }),
        headers: {
          authorization: this.authToken,
          'content-type': 'application/json',
        },
      },
    );
    const serverData = await response.json();
    if (response.status < 400) {
      logMessage('Successfully validating deployment', serverData);
    } else {
      logMessage('Failed to validating deployment', serverData);
      throw Error('Failed to validating deployment');
    }
  }


  async #uploadPackageAndServer({ update, serverName }: { update: boolean, serverName?: string }) {
    logMessage('Uploading server package...');
    const formData = new FormData();
    const file = fs.readFileSync(
      path.join(this.workDirectory, this.packedPackageName),
    );

    formData.append('file', new Blob([file]), this.packedPackageName);
    formData.append('serverName', serverName || this.serverName);
    if (update) {
      formData.append('upgradeServer', 'true');
    }

    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/servers/file`,
      {
        method: 'POST',
        body: formData,
        headers: {
          authorization: this.authToken,
        },
      },
    );
    const serverData = await response.json();
    if (response.status < 400) {
      logMessage(
        'Successfully uploaded package' + update ? 'and updated server' : '',
        serverData,
      );
      return serverData;
    } else {
      logMessage(
        'failed to upload package file' + update ? 'and updated server' : '',
        serverData,
      );
      throw Error(
        'Failed to upload and recreate server' + JSON.stringify(serverData),
      );
    }
  }

  /**
   * Lists all deployed servers and their configurations
   */
  async list(): Promise<CloudServer[]> {
    try {
      const response = await fetch(`${this.config.COMMANDER_URL}/api/servers`, {
        method: 'GET',
        headers: {
          authorization: this.authToken,
          'content-type': 'application/json',
        },
      });
      const listResponse = await response.json();
      if (response.status < 400) {
        return listResponse;
      } else {
        logMessage('Failed to list servers', listResponse);
        throw Error(JSON.stringify(listResponse));
      }
    } catch (error) {
      logMessage('Failed to list servers', (error as Error).cause || (error as Error).message);
      throw error;
    }
  }

  /**
   * load one server from the backend
   */
  async get({ serverName }: { serverName: string }): Promise<CloudServer> {
    try {
      const response = await fetch(
        `${this.config.COMMANDER_URL}/api/servers/${
          serverName
        }`,
        {
          method: 'GET',
          headers: {
            authorization: this.authToken,
          },
        },
      );
      if (response.status < 400) {
        return await response.json();
      } else {
        const deleteResponse = await response.json();
        logMessage('Failed to delete server', deleteResponse);
        throw Error(JSON.stringify(deleteResponse));
      }
    } catch (error) {
      logMessage('Failed to delete server', (error as Error).cause || (error as Error).message);
      throw error;
    }
  }

  /**
   * deletes the server from the current configuration, if provided,
   * serverName from argument is taken, else serverName from env vars,
   * SERVER_NAME
   */
  async delete(serverName?: string) {
    try {
      const response = await fetch(
        `${this.config.COMMANDER_URL}/api/servers/${
          serverName
        }`,
        {
          method: 'DELETE',
          headers: {
            authorization: this.authToken,
          },
        },
      );
      if (response.status < 400) {
        logMessage('Deleted server', this.serverName);
        return true;
      } else {
        const deleteResponse = await response.json();
        logMessage('Failed to delete server', deleteResponse);
        throw Error(JSON.stringify(deleteResponse));
      }
    } catch (error) {
      logMessage('Failed to delete server', (error as Error).cause || (error as Error).message);
      throw error;
    }
  }

  /**
   * Creates a new server deployment by packing the files,
   * then uploading them to remote and deploy.
   *
   * Flow:
   *
   * laod subscrioptions
   * check if we have a working subscription
   * if yes use the first working sub for deployment
   */
  async create({ serverName, hrtfEnabled, isDevelop }: {
    serverName: string,
    hrtfEnabled: boolean,
    isDevelop: boolean
  }): Promise<CloudServer> {

    const subscriptions = await this.subscriptionClient.list();


    const validSubExists = subscriptions.find(sub =>
      sub.type === SUBSCRIPTION_TYPE.TRIAL && isDevelop ? sub.availableCount.debug > 0 :
        sub.type === (hrtfEnabled ? SUBSCRIPTION_TYPE.HRTF : SUBSCRIPTION_TYPE.NORMAL) &&
        sub.availableCount[isDevelop ? 'debug' : 'production'] > 0);

    if (!validSubExists) {
      throw new Error('could not find a valid subscription for creating a new server');
    }

    let packageName;
    if (!isDevelop) {
      // TODO check if this applies to create a server
      await this.#packFiles();

      const { packageName: packageN } = await this.#uploadPackageAndServer({ update: false, serverName });
      console.log({
        name: serverName,
        packageName,
        fileName: this.packedPackageName,
        cli: isDevelop,
        hrtfAudio: hrtfEnabled,
        subscriptionId: validSubExists.id,
      });
      packageName = packageN;
    }


    const createServerResult = await fetch(this.config.COMMANDER_URL + '/api/servers', {
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      redirect: 'follow', // manual, *follow, error
      referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
      body: JSON.stringify({
        name: serverName,
        packageName,
        fileName: this.packedPackageName,
        cli: isDevelop,
        hrtfAudio: hrtfEnabled,
        subscriptionId: validSubExists.id,
      }),
      headers: {
        authorization: this.authToken,
        'Content-Type': 'application/json',
      },
    });
    const createData = await createServerResult.json();
    if (createServerResult.status < 400) {

      logMessage('Created a new server', createData);

      if (!isDevelop) {
        this.serverName = serverName;
        await this.#validateDeployment();
        await this.#testDeployment();
      }
      return createData;
    } else {
      logMessage('Create server error', createData);
      throw new Error('Failed to create a new server');
    }

  }

  /**
   * Updates the server from the current config by packaging the current
   * project files, uploading them to the cloud, then validation and
   * testing the deployment. Returns null on success, else throws.
   */
  async start(serverName: string) {
    try {
      this.#extractAndValidateServerUrl(serverName);
      await this.#sendStartServerSignal();
    } catch (error) {
      logMessage('Failed to start server', (error as Error).cause || (error as Error).message);
      throw error;
    }
  }

  /**
   * Updates the server from the current config by packaging the current
   * project files, uploading them to the cloud, then validation and
   * testing the deployment. Returns null on success, else throws.
   */
  async update(serverName: string) {
    try {
      this.#extractAndValidateServerUrl(serverName);
      await this.#packFiles();
      await this.#uploadPackageAndServer({ update: true });
      await this.#validateDeployment();
      await this.#testDeployment();
      logMessage('New server deployment is up and running!');
    } catch (error) {
      logMessage('Failed to update server', (error as Error).cause || (error as Error).message);
      throw error;
    }
  }

  async #uploadPackage() {
    const formData = new FormData();

    const file = fs.readFileSync(
      path.join(this.workDirectory, this.packedPackageName),
    );

    formData.append('file', new Blob([file]), this.packedPackageName);
    formData.append('packageName', this.customPackageJson.name);
    formData.append('id', this.connectionId);

    fetch(`${this.serverUrl}-develop/cli-upload`, {
      method: 'POST',
      body: formData,

      headers: {
        authorization: this.authToken,
      },
    })
      .then((r) => r.json())
      .then((data) => {
        logMessage('Got response from server', data);
      });
  }
}
