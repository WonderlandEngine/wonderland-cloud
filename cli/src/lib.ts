import path from 'path';
import { CloudConfig, getAndValidateAuthToken } from './cli_config';
import { config as dotenvConfig } from 'dotenv';
import process from 'process';
import { merge } from 'lodash';
import { debugMessage, logMessage } from './utils';
import { PageClient } from './resources/page';
import { ServerClient } from './resources/server';
import { CLI_RESOURCES } from './constants';

dotenvConfig();

const defaultConfig: Partial<CloudConfig> = {
  WORK_DIR: process.env.WORK_DIR || process.cwd(),
  SERVER_URL: process.env.SERVER_URL,
  COMMANDER_URL: process.env.COMMANDER_URL || 'https://cloud.wonderland.dev',
  IS_LOCAL_SERVER: process.env.IS_LOCAL_SERVER === 'true',
  PAGE_CONFIG_LOCATION: process.env.PAGE_CONFIG_LOCATION,
  PAGE_ACCESS: process.env.ACCESS,
  WLE_CREDENTIALS_LOCATION: path.join(
    process.env.AUTH_JSON_LOCATION ||
    path.join(process.cwd(), 'wle-apitoken.json'),
  ),
};

/**
 * Creates a new CLI client. This client will connect via Websockets to your
 * custom client server instance. Once it picks up any change in the custom server's
 * working directory, we will repack the server, upload it to the custom
 * server instance and restart it. Every console.log output of your custom
 * server instance will be sent back to the cli_client and printed on the console.
 *
 * For configuration options see {@link CliClientArgs}
 */
export class CloudClient {
  config: Partial<CloudConfig>;
  page?: PageClient;
  server?: ServerClient;
  authToken: string;

  constructor(cloudConfig: Partial<CloudConfig>, enabledResource?: CLI_RESOURCES) {
    this.config = merge({}, defaultConfig, cloudConfig);
    this.authToken = getAndValidateAuthToken(this.config);
    debugMessage('initialized CloudClient with config', this.config);
    // we will throw an error if the work directory does not contain a package.json1
    if (enabledResource) {
      switch (enabledResource) {
        case CLI_RESOURCES.SERVER:
          this.server = new ServerClient(this.config);
          break;
        case CLI_RESOURCES.PAGE:
          this.page = new PageClient(this.config);
          break;
        default:
          logMessage('unknown resource provided', enabledResource);
          throw Error(`unknown resource ${enabledResource} provided`);
      }
    } else {
      this.server = new ServerClient(this.config);
      this.page = new PageClient(this.config);
    }
  }

  /**
   * Helper function to check the validity of the provided Wonderland API auth token
   */
  async validateAuthToken() {
    const response = await fetch('https://api.wonderlandengine.com/user/me', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authToken,
        'User-Agent': 'wonderland-cloud-sdk',
      },
    });
    if (response.status === 200) {
      return true;
    } else {
      logMessage(
        'Validation of the auth token failed, please make sure it exists and is not expired!',
      );
      throw Error('provided auth token is not valid!');
    }
  }
}
