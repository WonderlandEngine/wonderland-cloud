import { CloudConfig, getAndValidateAuthToken } from '../cli_config';
import { debugMessage, logMessage, PartialBy } from '../utils';
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
 * Either WLE_CREDENTIALS or WLE_CREDENTIALS_LOCATION should be set. If none are set,
 * the library tries to find a wle-apitoken.json in the current work directory
 */
export type OperationsConfig = PartialBy<
  Pick<
    CloudConfig,
    'WLE_CREDENTIALS' | 'COMMANDER_URL' | 'WLE_CREDENTIALS_LOCATION'
  >,
  'WLE_CREDENTIALS' | 'WLE_CREDENTIALS_LOCATION'
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
      logMessage('Operation is still running, please wait...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      result = await this.get(jobId);
    }

    if (result.error) {
      logMessage(jobId, 'Operation failed with error:', result.error);
      throw new Error(result.error.message || 'unknown error');
    }
    return result.result as T;
  }

  /**
   * Get an operation by it's jobId
   * @param jobId
   */
  async get(jobId: string): Promise<Operation> {
    debugMessage('Loading operation status... ', jobId);
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/operations/${jobId}`,
      {
        method: 'GET',
        headers: {
          authorization: this.authToken,
        },
      }
    );
    const operationData = await response.json();
    if (response.status < 300) {
      debugMessage('Successfully got operation status', operationData);
      if (operationData.error) {
        logMessage('Operation has failed', operationData);
        throw new Error(operationData.error);
      }
      return operationData;
    } else {
      logMessage('Failed to get operation status', operationData);
      throw Error('Failed to get operation status');
    }
  }
}
