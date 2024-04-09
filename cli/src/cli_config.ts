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
      default: process.env.AUTH_TOKEN,
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
  },
  strict: !process.env.TEST_MODE,
};

config();

/**
 * Available CLI Client config arguments.
 *
 * example usage from your multiplayer server project:
 * ```sh
 * node ./node_modules/@wonderlandengine/multi-user-server-api/dist/cli_client --authToken="YOURWLEAPITOKEN " --serverUrl="https://k8s.cloud.wonderlandengine.dev/yourServerPath"
 * ```
 * You only need to set `--workDir` argument if your server is located not in the same project where your multiuser server api types package is installed.
 * You can also set a path to the location of your WLE-API token file via `--authJsonLocation` or `AUTH_JSON_LOCATION` env var. Default for the file location
 * is your custom server directory and the filename `wle-apitoken.json`. Make sure to add this file to `.gitignore`, so you do not expose
 * your WLE API credentials by accident.
 * All these arguments can be aso set via env vars: `AUTH_TOKEN`, `WORK_DIR` and `SERVER_URL`.
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
  help: boolean
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
export const { values, positionals } = parseArgs(parseArgsConfig);

const args = values as unknown as CliClientArgs;

export interface CloudConfig {
  AUTH_TOKEN: string;
  WORK_DIR: string;
  SERVER_URL: string;
  IS_LOCAL_SERVER: boolean;
  PAGE_CONFIG_LOCATION: string;
  PAGE_ACCESS: string;
  PAGE_NO_THREADS: boolean;
  COMMANDER_URL?: string;
  AUTH_TOKEN_LOCATION: string;
  HELP: boolean;
}

const cliConfig: Partial<CloudConfig> = {
  AUTH_TOKEN: args.authToken,
  WORK_DIR: args.workDir,
  SERVER_URL: args.serverUrl,
  IS_LOCAL_SERVER: args.isLocalServer,
  PAGE_CONFIG_LOCATION: args.config,
  PAGE_ACCESS: args.access,
  PAGE_NO_THREADS: args.noThreads,
  COMMANDER_URL: args.commanderUrl,
  AUTH_TOKEN_LOCATION: path.join(args.authJsonLocation),
  HELP: args.help
};

export const getAndValidateAuthToken = (
  cloudConfig: Partial<CloudConfig>
): string => {
  // if auth token location is not set, check under default location
  if (!cloudConfig.AUTH_TOKEN_LOCATION) {
    cloudConfig.AUTH_TOKEN_LOCATION = path.join(
      process.cwd(),
      'wle-apitoken.json'
    );
  }
  // check if auth token exists under the AUTH_TOKEN_LOCATION
  if (!fs.existsSync(cloudConfig.AUTH_TOKEN_LOCATION)) {
    assert.ok(
      cloudConfig.AUTH_TOKEN,
      'Could not find WLE api token file and also missing AUTH_TOKEN, please either set via cmd arg --authToken="YOUR_AUTH_TOKEN" or via AUTH_TOKEN env var.\n' +
        'Alternatively you can also provide a path to your WLE api token file via "--authJsonLocation" or `AUTH_JSON_LOCATION` env var. Default location for your API token is: \n' +
        `${path.join(process.cwd(), 'wle-apitoken.json')}`
    );
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const apiTokenJSON = require(cloudConfig.AUTH_TOKEN_LOCATION as string);
    assert.ok(
      apiTokenJSON.token,
      `Missing "token" property in WLE api token file, located in ${cloudConfig.AUTH_TOKEN_LOCATION},\n` +
        `please double check ` +
        `if the token file is valid or else provide an auth token via AUTH_TOKEN env var or --authToken="YOUR_AUTH_TOKEN" argument. \n` +
        `Default location for token file is ${path.join(
          process.cwd(),
          'wle-apitoken.json'
        )}`
    );
    cloudConfig.AUTH_TOKEN = apiTokenJSON.token;
  }
  return cloudConfig.AUTH_TOKEN as string;
};

export const validateServerUrl = (
  cloudConfig: Partial<CloudConfig>
): string => {
  assert.ok(
    cloudConfig.SERVER_URL,
    'Missing SERVER_URL, please either set via cmd arg --serverUrl="YOUR_SERVER_URL" or via SERVER_URL env var'
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
      `Provided server url protocol is not https, but ${protocol}`
    );
    assert.match(
      domain,
      /server.wonderland.dev/,
      `Provided server domain is not 'server.wonderland.dev', please make sure to se the CLI url from the server settings page of your server`
    );
    assert.match(
      serverPathEnding,
      /-develop/,
      `Provided server path is not ending with '-develop', please make sure to se the CLI url from the server settings page of your server`
    );
  }
  return cloudConfig.SERVER_URL;
};

export default cliConfig as CloudConfig;
