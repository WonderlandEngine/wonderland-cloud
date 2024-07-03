import { config } from 'dotenv';
import * as process from 'process';
import * as assert from 'assert';
import path from 'path';
import * as fs from 'fs';
import { parseArgs, ParseArgsConfig } from 'util';
import { boolean } from 'yargs';

const parseArgsConfig: ParseArgsConfig = {
  allowPositionals: true,
  options: {
    authToken: {
      type: 'string',
      default: process.env.WLE_CREDENTIALS,
    },
    workDir: {
      type: 'string',
      default: process.env.WORK_DIR || process.cwd(),
    },
    serverUrl: {
      type: 'string',
      default: process.env.SERVER_URL,
    },
    authJsonLocation: {
      type: 'string',
      default:
        process.env.AUTH_JSON_LOCATION ||
        path.join(process.cwd(), 'wle-apitoken.json'),
    },
    isLocalServer: {
      type: 'boolean',
      short: 'l',
      default: false,
    },
    config: {
      type: 'string',
      short: 'c',
      default: process.env.PAGE_CONFIG_LOCATION,
    },
    access: {
      type: 'string',
      default: process.env.ACCESS,
    },
    commanderUrl: {
      type: 'string',
      default: process.env.COMMANDER_URL || 'https://cloud.wonderland.dev',
    },
    noThreads: {
      type: 'boolean',
      default: process.env.PAGE_NO_THREADS !== undefined,
    },
    debug: {
      type: 'boolean',
      default: process.env.PRINT_DEBUG_LOGS !== undefined || false,
      short: 'd',
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
    force: {
      type: 'boolean',
      short: 'f',
      default: false,
    },
    develop:{
      type: 'boolean',
      short: 'd',
      default: false
    },
    hrtf:{
      type: 'boolean',
      default: false
    }
  },
  strict: !process.env.TEST_MODE,
};

config();

/**
 * Available CLI Client config arguments.
 *
 * example usage from your multiplayer server project:
 * ```sh
 * npm exec wl-cloud --authToken="YOURWLEAPITOKEN " --serverUrl="https://k8s.cloud.wonderlandengine.dev/yourServerPath"
 * ```
 * You only need to set `--workDir` argument if your server is located not in the same project where your multiuser server api types package is installed.
 * You can also set a path to the location of your WLE-API token file via `--authJsonLocation` or `AUTH_JSON_LOCATION` env var. Default for the file location
 * is your custom server directory and the filename `wle-apitoken.json`. Make sure to add this file to `.gitignore`, so you do not expose
 * your WLE API credentials by accident.
 * All these arguments can be aso set via env vars: `WLE_CREDENTIALS`, `WORK_DIR` and `SERVER_URL`.
 *
 * Please note, that you `need` to set the `authToken` and the `serverUrl`, otherwise the cli client will fail to start.
 */
export interface CliClientArgs {
  authToken: string;
  workDir: string;
  serverUrl: string;
  authJsonLocation: string;
  isLocalServer?: boolean;
  config: string;
  access: string;
  commanderUrl: string;
  noThreads: boolean;
  help: boolean;
  force: boolean;
  develop: boolean,
  hrtf: boolean;
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
export const { values, positionals } = parseArgs(parseArgsConfig);

const args = values as unknown as CliClientArgs;

export interface CloudConfig {
  WLE_CREDENTIALS: string;
  WORK_DIR: string;
  SERVER_URL: string;
  IS_LOCAL_SERVER: boolean;
  PAGE_CONFIG_LOCATION: string;
  PAGE_ACCESS: string;
  PAGE_NO_THREADS: boolean;
  COMMANDER_URL?: string;
  WLE_CREDENTIALS_LOCATION: string;
  HELP: boolean;
  FORCE: boolean;
  DEVELOP: boolean;
  HRTF: boolean;
}

const cliConfig: Partial<CloudConfig> = {
  WLE_CREDENTIALS: args.authToken,
  WORK_DIR: args.workDir,
  SERVER_URL: args.serverUrl,
  IS_LOCAL_SERVER: args.isLocalServer,
  PAGE_CONFIG_LOCATION: args.config,
  PAGE_ACCESS: args.access,
  PAGE_NO_THREADS: args.noThreads,
  COMMANDER_URL: args.commanderUrl,
  WLE_CREDENTIALS_LOCATION: path.join(args.authJsonLocation),
  HELP: args.help,
  FORCE: args.force,
  DEVELOP: args.develop,
  HRTF: args.hrtf
};

export const getAndValidateAuthToken = (
  cloudConfig: Partial<CloudConfig>,
): string => {
  // if auth token location is not set, check under default location
  if (!cloudConfig.WLE_CREDENTIALS_LOCATION) {
    cloudConfig.WLE_CREDENTIALS_LOCATION = path.join(
      process.cwd(),
      'wle-apitoken.json',
    );
  }
  // check if auth token exists under the WLE_CREDENTIALS_LOCATION
  if (!fs.existsSync(cloudConfig.WLE_CREDENTIALS_LOCATION)) {
    assert.ok(
      cloudConfig.WLE_CREDENTIALS,
      'Could not find WLE api token file and also missing WLE_CREDENTIALS, please either set via cmd arg --authToken="YOUR_WLE_CREDENTIALS" or via WLE_CREDENTIALS env var.\n' +
      'Alternatively you can also provide a path to your WLE api token file via "--authJsonLocation" or `AUTH_JSON_LOCATION` env var. Default location for your API token is: \n' +
      `${path.join(process.cwd(), 'wle-apitoken.json')}`,
    );
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const apiTokenJSON = require(cloudConfig.WLE_CREDENTIALS_LOCATION as string);
    assert.ok(
      apiTokenJSON.token,
      `Missing "token" property in WLE api token file, located in ${cloudConfig.WLE_CREDENTIALS_LOCATION},\n` +
      `please double check ` +
      `if the token file is valid or else provide an auth token via WLE_CREDENTIALS env var or --authToken="YOUR_WLE_CREDENTIALS" argument. \n` +
      `Default location for token file is ${path.join(
        process.cwd(),
        'wle-apitoken.json',
      )}`,
    );
    cloudConfig.WLE_CREDENTIALS = apiTokenJSON.token;
  }
  return cloudConfig.WLE_CREDENTIALS as string;
};

export const validateServerUrl = (
  cloudConfig: Partial<CloudConfig>,
): string => {
  assert.ok(
    cloudConfig.SERVER_URL,
    'Missing SERVER_URL, please either set via cmd arg --serverUrl="YOUR_SERVER_URL" or via SERVER_URL env var',
  );

  if (!cloudConfig.IS_LOCAL_SERVER) {
    const serverUrlParts = cloudConfig.SERVER_URL.split('/');
    const protocol = serverUrlParts[0];
    const domain = serverUrlParts[2];
    const serverPath = serverUrlParts[3];
    const serverPathEnding = serverPath.substring(serverPath.length - 8);
    assert.match(
      protocol,
      /https/,
      `Provided server url protocol is not https, but ${protocol}`,
    );
    assert.match(
      domain,
      /server.wonderland.dev/,
      `Provided server domain is not 'server.wonderland.dev', please make sure to se the CLI url from the server settings page of your server`,
    );
    assert.match(
      serverPathEnding,
      /-develop/,
      `Provided server path is not ending with '-develop', please make sure to se the CLI url from the server settings page of your server`,
    );
  }
  return cloudConfig.SERVER_URL;
};

export default cliConfig as CloudConfig;
