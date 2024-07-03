// eslint-disable-next-line no-shadow
import { merge } from 'lodash';
import { getAndValidateAuthToken } from '../cli_config';
import path from 'path';
import process from 'process';
import { logMessage } from '../utils';

export enum SUBSCRIPTION_TYPE {
  NORMAL = 0,
  HRTF = 1,
  TRIAL = 2,
}

interface SubscriptionsMap {
  [k: number]: string;
}

const defaultConfig: Partial<SubscriptionConfig> = {
  COMMANDER_URL: process.env.COMMANDER_URL || 'https://cloud.wonderland.dev',
  WLE_CREDENTIALS_LOCATION: path.join(
    process.env.AUTH_JSON_LOCATION ||
    path.join(process.cwd(), 'wle-apitoken.json'),
  ),
};

export interface SubscriptionConfig {
  COMMANDER_URL?: string;
  WLE_CREDENTIALS_LOCATION?: string;
  WLE_CREDENTIALS?: string;
}

export const SUBSCRIPTION_TYPE_STRING_MAPPING: SubscriptionsMap = {
  0: 'Basic',
  1: 'Spatial Audio',
  2: 'Trial',
};

export interface Subscription {
  // type of subscription
  type: SUBSCRIPTION_TYPE;
  // start date time of the subscription
  start: Date;
  // end date time of the subscription
  end: Date;
  // email of the user who owns this subscription
  email: string;
  // number of servers which can be created with this subscription
  serversCount: number;
  stripeId: string;
  teams: string[];
  toFe: () => Promise<SubscriptionFe>;
  trial: boolean;
}

export interface SubscriptionFe
  extends Omit<Subscription, 'start' | 'end' | 'teams' | 'toFe'> {
  id: string;
  start: string;
  end: string;
  teams: string[];
  availableCount: {
    debug: number;
    production: number;
  };
}


export class SubscriptionClient {

  config: Partial<SubscriptionConfig>;
  authToken: string;

  constructor(cloudConfig: Partial<SubscriptionConfig>) {
    const mergedConfig = merge({}, defaultConfig, cloudConfig);
    this.config = mergedConfig;
    this.authToken = getAndValidateAuthToken(mergedConfig);
  }

  async list(): Promise<SubscriptionFe[]> {
    logMessage(
      'Listing subscriptions...',
    );
    const response = await fetch(
      `${this.config.COMMANDER_URL}/api/subscriptions`,
      {
        method: 'GET',
        headers: {
          authorization: this.authToken,
        },
      },
    );
    const serverData = await response.json();
    if (response.status < 400) {
      return serverData;
    } else {
      logMessage('Failed to list subscriptions', serverData);
      throw Error('Failed to list subscriptions');
    }
  }
}
