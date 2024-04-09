import { CloudConfig, getAndValidateAuthToken } from '../cli_config';
import { logMessage, PartialBy } from '../utils';
import path from 'path';
import compressing from 'compressing';
import * as fs from 'fs';

export interface Operation {
  message: string;
  isRunning: boolean;
  error: any;
  result: any;
  jobId: any;
}

/**
 * Either AUTH_TOKEN or AUTH_TOKEN_LOCATION should be set. If none are set,
 * the library tries to find a wle-apitoken.json in the current work directory
 */
export type OperationsConfig = PartialBy<
  Pick<CloudConfig, 'AUTH_TOKEN' | 'COMMANDER_URL' | 'AUTH_TOKEN_LOCATION'>,
  'AUTH_TOKEN' | 'AUTH_TOKEN_LOCATION'
>;

/**
 * Helper class for interacting with the projects resouce.
 */
export class OperationsClient {
  config: OperationsConfig;
  authToken: string;

  // todo create dedicated projects config
  constructor(config: OperationsConfig) {
    this.config = config;
    this.authToken = getAndValidateAuthToken(this.config);
  }

  async waitUntilJobHasFinished<T = any>(jobId: string) {
    let result = await this.get(jobId);
    while (result.isRunning) {
      logMessage('wait 10seconds before next poll...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      result = await this.get(jobId);
    }

    if (result.error) {
      logMessage(jobId, 'operation finished with an error', result.error);
      throw new Error(result.error.message || 'unknown error');
    }
    return result.result as T;
  }

  /**
   * Get an operation by it's jobId
   * @param jobId
   */
  async get(jobId: string): Promise<Operation> {
    logMessage('loading operation status... ', jobId);
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/operations/${jobId}`,
      {
        method: 'GET',
        headers: {
          authorization: this.authToken,
        },
      }
    );
    const serverData = await response.json();
    if (response.status < 300) {
      logMessage('successfully got operation status', serverData);
      return serverData;
    } else {
      logMessage('failed to get operation status', serverData);
      throw Error('failed to get operation status');
    }
  }
}
