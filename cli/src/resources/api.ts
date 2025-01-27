import { CloudConfig, getAndValidateAuthToken } from '../cli_config';
import { debugMessage, logMessage, PartialBy } from '../utils';
import path from 'path';
import compressing from 'compressing';
import * as fs from 'fs';
import { Operation, OperationsClient } from './operations';
import { SUBSCRIPTION_TYPE, SubscriptionClient } from './subscriptions';

export interface WleApi {
  port: number;
  name: string;
  image: string;
  dockerConfigBase64: string;
  teams: string[];
  email: string;
  env: { key: string; value: string }[];
}

export type UpdateDataWleApi = keyof Pick<
  WleApi,
  'env' | 'image' | 'dockerConfigBase64' | 'port'
>;

/**
 * Either WLE_CREDENTIALS or WLE_CREDENTIALS_LOCATION should be set. If none are set,
 * the library tries to find a wle-apitoken.json in the current work directory
 */
export type ApisConfig = PartialBy<
  Pick<
    CloudConfig,
    'WLE_CREDENTIALS' | 'COMMANDER_URL' | 'WLE_CREDENTIALS_LOCATION'
  >,
  'WLE_CREDENTIALS' | 'WLE_CREDENTIALS_LOCATION'
>;

/**
 * Helper class for interacting with the projects resouce.
 */
export class ApisClient {
  config: ApisConfig;
  authToken: string;
  operationsClient: OperationsClient;
  subscriptionClient: SubscriptionClient;

  // todo create dedicated projects config
  constructor(config: ApisConfig) {
    this.config = config;
    this.authToken = getAndValidateAuthToken(this.config);
    this.operationsClient = new OperationsClient(config);
    this.subscriptionClient = new SubscriptionClient(config);
  }

  /**
   * Delete a single api resource. Please note, that an Api which is
   * actively used by a Pages deployment cannot be removed.
   * @apiName jobId
   */
  async delete(apiName: string): Promise<void> {
    debugMessage('deleting api ', apiName);
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/apis/${apiName}`,
      {
        method: 'DELETE',
        headers: {
          authorization: this.authToken,
        },
      }
    );
    const serverData = await response.json();
    if (response.status < 300) {
      await this.operationsClient.waitUntilJobHasFinished(serverData.jobId);
      debugMessage('Successfully deleted api', apiName);
    } else {
      logMessage('Failed to delete apis', serverData);
      throw Error('Failed to get apis');
    }
  }

  /**
   * List all apis available to the user
   */
  async list(): Promise<WleApi[]> {
    debugMessage('Loading apis... ');
    const response = await fetch(`${this.config.COMMANDER_URL}/api/apis`, {
      method: 'GET',
      headers: {
        authorization: this.authToken,
      },
    });
    const serverData = await response.json();
    if (response.status < 300) {
      debugMessage('Successfully got apis', serverData);
      return serverData;
    } else {
      logMessage('Failed to get apis', serverData);
      throw Error('Failed to get apis');
    }
  }

  /**
   * Get a single API deployment
   */
  async get(apiName: string): Promise<WleApi> {
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/apis/${apiName}`,
      {
        method: 'GET',
        headers: {
          authorization: this.authToken,
        },
      }
    );
    const serverData = await response.json();
    if (response.status < 300) {
      debugMessage('Successfully got api', serverData);
      return serverData;
    } else {
      logMessage(`Failed to get api ${apiName}`, serverData);
      throw Error(`Failed to get api ${apiName}`);
    }
  }

  /**
   * Create new api deployment
   */
  async create(
    createApiData: Omit<
      Pick<WleApi, 'port' | 'name' | 'image' | 'dockerConfigBase64'>,
      'env'
    > &
      Partial<Omit<WleApi, 'env'>> & {
        env: { [k: string]: string };
      }
  ): Promise<WleApi> {
    const validName = /^[a-z](([a-z]|\d)-?([a-z]|\d)?){0,20}[a-z]/gm.test(
      createApiData.name
    );
    if (!validName) {
      throw new Error(
        'api name can ony be /^[a-z](([a-z]|\\d)-?([a-z]|\\d)?){0,20}[a-z]'
      );
    }
    const subscriptions = await this.subscriptionClient.list();

    const validSubExists = subscriptions.find(
      (sub) => sub.type === SUBSCRIPTION_TYPE.PAGES_APIS
    );

    if (!validSubExists) {
      throw new Error(
        'could not find a valid subscription for creating a new server'
      );
    }
    console.log({
      ...createApiData,
      subscription: validSubExists.id,
    });
    const response = await fetch(`${this.config.COMMANDER_URL}/api/apis`, {
      method: 'POST',
      headers: {
        authorization: this.authToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...createApiData,
        subscription: validSubExists.id,
      }),
    });
    const serverData = await response.json();
    if (response.status < 300) {
      debugMessage('Successfully got apis', serverData);
      await this.operationsClient.waitUntilJobHasFinished(serverData.jobId);
      return await this.get(createApiData.name);
    } else {
      logMessage('Failed to get apis', serverData);
      throw Error('Failed to get apis');
    }
  }

  /**
   * Create new api deployment
   */
  async update(data: {
    name: string;
    [key: string]: any;
    updateEnv: boolean;
  }): Promise<WleApi> {
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/apis/${data.name}`,
      {
        method: 'PUT',
        headers: {
          authorization: this.authToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify(data),
      }
    );
    const serverData = await response.json();
    if (response.status < 300) {
      debugMessage('Successfully updated apis', serverData);
      await this.operationsClient.waitUntilJobHasFinished(serverData.jobId);
      return this.get(data.name);
    } else {
      logMessage('Failed to update apis', serverData);
      throw Error('Failed to updated apis');
    }
  }
}
