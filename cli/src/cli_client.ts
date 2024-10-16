#!/usr/bin/env node
import { CloudClient } from './lib';
import cliConfig, { CloudConfig, getAndValidateAuthToken, positionals } from './cli_config';
import { debugMessage, logMessage } from './utils';
import path from 'path';
import process from 'process';
import fs from 'fs';
import { Page } from './resources/page';
import readline from 'readline';
import { rm } from 'node:fs/promises';
import { CloudServer } from './resources/server';
import {
  API_COMMANDS,
  CLI_RESOURCES,
  COMMAND_ENUMS,
  PAGES_COMMANDS,
  SERVERS_COMMANDS,
  SUBSCRIPTION_COMMAND,
} from './constants';

import helpDictionary from './cli_help';
import { SUBSCRIPTION_TYPE, SUBSCRIPTION_TYPE_STRING_MAPPING } from './resources/subscriptions';

const readLineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

getAndValidateAuthToken(cliConfig);

interface ResourceCommandAndArguments {
  resource: CLI_RESOURCES;
  arguments?: string[];
  command: COMMAND_ENUMS;
}

const checkAndGetCommandArgs = (): ResourceCommandAndArguments => {
  const resource = positionals[0];
  const command = positionals[1];
  const remainingArguments = positionals.splice(2, positionals.length);
  if (!resource) {
    logMessage(
      `Please provide a resource after 'wl-cloud', possible options are ${Object.values(
        CLI_RESOURCES,
      )} for help use wl-cloud <resource> <command> --help`,
    );
    process.exit(1);
  }
  if (!Object.values(CLI_RESOURCES).includes(resource as CLI_RESOURCES)) {
    logMessage(
      `Provided resource ${resource} is unknown, available resources: ${Object.values(
        CLI_RESOURCES,
      )} for help use wl-cloud <resource> <command> --help`,
    );
    process.exit(1);
  } else {
    if (resource === CLI_RESOURCES.PAGE && !Object.values(PAGES_COMMANDS).includes(command as PAGES_COMMANDS)) {
      logMessage(
        `Provided command ${command} is unknown, available commands: ${Object.values(
          PAGES_COMMANDS,
        )} for help use wl-cloud <resource> <command> --help`,
      );
      process.exit(1);
    }

    if (
      resource === CLI_RESOURCES.SERVER && !Object.values(SERVERS_COMMANDS).includes(command as SERVERS_COMMANDS)
    ) {
      logMessage(
        `Provided command ${command} is unknown, available commands: ${Object.values(
          SERVERS_COMMANDS,
        )} for help use wl-cloud <resource> <command> --help`,
      );
      process.exit(1);
    }


    return {
      resource: resource as CLI_RESOURCES,
      arguments: remainingArguments,
      command: command as COMMAND_ENUMS,
    };
  }
};

const checkAndGetAccessType = (config: CloudConfig) => {
  let isPublic = false;
  if (config.PAGE_ACCESS) {
    logMessage('Found access argument', config.PAGE_ACCESS);
    if (config.PAGE_ACCESS === 'public') {
      isPublic = true;
    } else if (config.PAGE_ACCESS === 'unlisted') {
      isPublic = false;
    } else {
      logMessage(
        'Unknown access parameter provided ',
        config.PAGE_ACCESS,
        ' possible options are "public" | "unlisted"',
      );
      throw new Error('Unknown access parameter provided');
    }
  }
  return isPublic;
};

/**
 * For creation of a project, a project name and project location
 * explicitly needs to be provided either via command arguments or via env vars.
 *
 * Config location is not read, instead we will only write to the specified
 * location if any provided upon creating the project.
 * @param args
 * @param config
 */
const validateAndGetCreateArgs = (
  args: string[],
  config: CloudConfig,
): {
  projectName: string;
  projectLocation: string;
  isPublic: boolean;
  withThreads: boolean;
} => {
  if (args.length < 2) {
    logMessage(
      'Number of arguments does not match, command expects at least 1 arguments,' +
      ' the project name and optional project location, ' +
      'the project location can be relative or absolute.\n' +
      ' Example usage: "wle-cloud pages create my-project-name --access unlisted --noThreads',
    );
    throw new Error('Failed to process command');
  }
  return {
    projectName: args[0],
    projectLocation: args[1] ?? './deploy',
    isPublic: checkAndGetAccessType(config),
    // if no threads is true, withThreads is false
    withThreads: !config.PAGE_NO_THREADS,
  };
};

/**
 * For project update or delete, projectName and location can either be provided via
 * command line or via a config file.
 *
 * The priority of config values, if the upper exists, values below are ignored:
 *
 * 1. Config under --config or PROJECT_CONFIG_LOCATION
 * 2. Config under $WORK_DIR/deployment.json
 * 3. Arguments after command e.g wle-cloud projects create project-name-123456 ./deploy
 *
 * THe config file will be overwritten on any changes of the project.
 * @param args
 * @param config
 */
const validateAndGetUpdateArgs = (
  args: string[],
  config: CloudConfig,
): {
  projectName: string;
  projectLocation: string;
  isPublic: boolean;
  withThreads: boolean;
} => {
  let projectConfig;
  const projectConfigLocation = config.PAGE_CONFIG_LOCATION
    ? path.join(config.PAGE_CONFIG_LOCATION)
    : path.join(process.cwd(), 'deployment.json');
  try {
    projectConfig = fs.readFileSync(projectConfigLocation, {
      encoding: 'utf-8',
    });
    projectConfig = JSON.parse(projectConfig);
  } catch (err) {
    logMessage(
      'Could not find deployment file or file corrupt, using cmd args instead',
      projectConfig,
    );
  }
  if (projectConfig) {
    if (projectConfig.projectName && projectConfig.projectLocation) {
      if (config.PAGE_ACCESS) {
        // only overwrite access type from config if access argument is provided
        projectConfig.isPublic = checkAndGetAccessType(config);
      } else {
        projectConfig.isPublic = projectConfig.accessType === 'public';
      }
      // update withThreads if changed
      projectConfig.withThreads = !config.PAGE_NO_THREADS;
      logMessage('Found deployment config to use', projectConfig);
      return projectConfig;
    }
    logMessage(
      'Project file not valid, please delete and provide project name and project directory to recreate a new deployment file',
    );
    throw new Error('Malformed project file');
  }
  return validateAndGetCreateArgs(args, config);
};

const deleteDeploymentConfig = (config: CloudConfig) => {
  const projectConfigLocation = config.PAGE_CONFIG_LOCATION
    ? path.join(config.PAGE_CONFIG_LOCATION)
    : path.join(process.cwd(), 'deployment.json');
  return rm(projectConfigLocation, {
    recursive: true,
    force: true,
  });
};

const saveDeploymentConfig = (
  projectLocation: string,
  uploadProjectResponse: Page,
  config: CloudConfig,
) => {
  const projectConfigLocation = config.PAGE_CONFIG_LOCATION
    ? path.join(config.PAGE_CONFIG_LOCATION)
    : path.join(process.cwd(), 'deployment.json');

  const projectConfigPath = path.parse(projectConfigLocation);
  if (projectConfigPath.dir && !fs.existsSync(projectConfigPath.dir)) {
    fs.mkdirSync(projectConfigPath.dir, { recursive: true });
  }
  fs.writeFileSync(
    projectConfigLocation,
    JSON.stringify({ projectLocation, ...uploadProjectResponse }),
  );
};

const evalCommandArgs = async (command: ResourceCommandAndArguments) => {
  // arguments is everything after the
  const commandArguments = command.arguments as string[];
  const commandVerb = command.command;
  const resource = command.resource;
  if (cliConfig.HELP) {
    logMessage(helpDictionary[resource][commandVerb]);
    process.exit(0);
  }
  const client = new CloudClient(cliConfig, resource);
  await client.validateAuthToken();
  debugMessage('Found command', command);

  switch (resource) {
    case CLI_RESOURCES.SERVER:
      const [serverName] = commandArguments;

      if (!serverName) {
        throw new Error('Please provide a valid server name');
      }
      if (!serverName.match(
        /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/gm,
      )) {
        throw new Error('Name can only contain numbers and lowercase characters');
      }
      switch (commandVerb) {
        case SERVERS_COMMANDS.GET:
          const loadedServer = await client.server?.get({
            serverName,
          });
          logMessage(
            'Loaded server', loadedServer,
          );
          break;
        case SERVERS_COMMANDS.CREATE:
          logMessage(
            'Creating a new server...', serverName,
          );
          const server = await client.server?.create({
            serverName,
            hrtfEnabled: cliConfig.HRTF,
            isDevelop: cliConfig.DEVELOP,
          });
          logMessage(
            'Created new server',
            server,
          );
          break;
        case SERVERS_COMMANDS.START:
          await client.server?.start(serverName);
          break;
        case SERVERS_COMMANDS.DELETE:
          await client.server?.delete(serverName);
          break;
        case SERVERS_COMMANDS.DEBUG:
          try {
            const result = await client.server?.debug(serverName);
            logMessage('WS connection closed with', result);
          } catch (err) {
            logMessage('WS connection failed:', err);
            process.exit(1);
          }
          break;
        case SERVERS_COMMANDS.LIST:
          const servers = await client.server?.list();
          logMessage('Found servers');
          console.log(
            `SERVER_NAME - PACKAGE_NAME - CLI_ENABLED - HRTF_ENABLED`,
          );
          servers?.map((server: CloudServer) =>
            console.log(
              `${server.serverName} - ${server.packageName} - ${server.cli} - ${server.hrtfAudio}`,
            ),
          );
          break;
        case SERVERS_COMMANDS.UPDATE:
          await client.server?.update(serverName);
          break;
      }
      break;
    case CLI_RESOURCES.PAGE:
      const [pageName, apiName, apiPath] = commandArguments;
      switch (commandVerb) {
        case PAGES_COMMANDS.GET:
          const getProjectSettings = validateAndGetUpdateArgs(
            commandArguments,
            cliConfig,
          );
          const getProjectResponse = await client.page?.get(
            getProjectSettings.projectName,
          );
          logMessage('Found project');
          logMessage(getProjectResponse);
          break;
        case PAGES_COMMANDS.CREATE:
          const createProjectSettings = validateAndGetCreateArgs(
            commandArguments,
            cliConfig,
          );
          const createProjectResponse = await client.page?.create(
            createProjectSettings.projectLocation,
            createProjectSettings.projectName,
            createProjectSettings.isPublic,
            createProjectSettings.withThreads,
          );
          saveDeploymentConfig(
            createProjectSettings.projectLocation,
            createProjectResponse as Page,
            cliConfig,
          );
          logMessage(
            `Project files successfully uploaded and the domain has been created.
             Please note, that it takes up to 24h for the domain to work because of
             SSL certificates provisioning process by Google.`,
          );
          break;
        case PAGES_COMMANDS.DELETE:
          const deleteProjectSettings = validateAndGetUpdateArgs(
            commandArguments,
            cliConfig,
          );

          const toDelete = cliConfig.FORCE || await new Promise((resolve) => {
            readLineInterface.question(
              'Are you sure that you want to delete the project with the full name ' +
              deleteProjectSettings.projectName +
              '?\n Please confirm by re-typing the projects name and submit with pressing enter:\n',
              async (projectName) => {
                if (
                  deleteProjectSettings.projectName !==
                  projectName.replace(/(\r\n|\n|\r)/gm, '')
                ) {
                  return resolve(false);
                } else {
                  return resolve(true);
                }
              },
            );
          });

          if (!toDelete) {
            console.log(deleteProjectSettings.projectName);
            console.log('Project name mismatch, exiting');
            process.exit(1);
          }

          await client.page?.delete(deleteProjectSettings.projectName);
          await deleteDeploymentConfig(cliConfig);

          logMessage(
            `Successfully deleted domain and files for ${deleteProjectSettings.projectName}`,
          );

          break;
        case PAGES_COMMANDS.UPDATE:
          const updateProjectSettings = validateAndGetUpdateArgs(
            commandArguments,
            cliConfig,
          );
          const updateProjectResponse = await client.page?.update(
            updateProjectSettings.projectLocation,
            updateProjectSettings.projectName,
            updateProjectSettings.isPublic,
            updateProjectSettings.withThreads,
          );
          saveDeploymentConfig(
            updateProjectSettings.projectLocation,
            updateProjectResponse as Page,
            cliConfig,
          );
          break;
        case PAGES_COMMANDS.LIST:
          const pages = await client.page?.list();
          logMessage('found projects');
          pages?.map((page: Page) =>
            console.log(
              `${page.projectName} - ${page.accessType} - ${page.projectDomain} - ${page.fullProjectUrl}`,
            ),
          );
          break;
        case PAGES_COMMANDS.ADD_API:
          if (!pageName) {
            throw Error('no page name provided as third argument, wl-cloud page add-api <pagename> <apiname> <apipath>');
          }
          if (!apiName) {
            throw Error('no apiName provided as fourth argument, wl-cloud page add-api <pagename> <apiname> <apipath>');
          }
          if (!apiPath) {
            throw Error('no apiPath provided as fifth argument, wl-cloud page add-api <pagename> <apiname> <apipath>');
          }
          const validPath = /^[a-z](([a-z]|\d)-?([a-z]|\d)?){0,20}[a-z]/gm.test(
            apiPath,
          );
          if (!validPath) {
            throw new Error('api path can ony be /^[a-z](([a-z]|\\d)-?([a-z]|\\d)?){0,20}[a-z]');
          }
          logMessage('adding api routing', pageName, apiName, apiPath);
          const intialPageState = await (client.page?.get(pageName));
          if (!intialPageState) {
            throw new Error('could not find desired page');
          }
          if (intialPageState.apiNames) {
            intialPageState.apiNames.push(apiName);
            intialPageState.apiPaths.push(apiPath);
          } else {
            intialPageState.apiNames = [apiName];
            intialPageState.apiPaths = [apiPath];
          }

          const newState = await client.page?.modifyApis(intialPageState);
          logMessage('added new api routing to page', newState);
          break;
        case PAGES_COMMANDS.DELETE_API:

          if (!pageName) {
            throw Error('no page name provided as third argument, wl-cloud page delete-api <pagename> <apiname> <apipath>');
          }
          if (!apiName) {
            throw Error('no apiName provided as fourth argument, wl-cloud page delete-api <pagename> <apiname> <apipath>');
          }
          const intialPageState2 = await (client.page?.get(pageName));
          if (!intialPageState2) {
            throw new Error('could not find desired page');
          }
          if (intialPageState2.apiNames) {
            const existingApi = intialPageState2.apiNames.indexOf(apiName);
            if (existingApi > -1) {
              intialPageState2.apiNames.splice(existingApi, 1);
              intialPageState2.apiPaths.splice(existingApi, 1);
            } else {
              logMessage('Nothing to do, page does not contain any apis linked');
            }
          } else {
            logMessage('Nothing to do, page does not contain any apis linked');
          }
          const newState2 = await client.page?.modifyApis(intialPageState2);
          logMessage('removed apiRouting from API', newState2);
          break;
      }
      break;
    case CLI_RESOURCES.SUBSCRIPTION:
      switch (commandVerb) {
        case SUBSCRIPTION_COMMAND.LIST:

          const subs = await client.subscription?.list();
          const foundSubs = subs?.map(sub => ({
            ...sub,
            type: SUBSCRIPTION_TYPE_STRING_MAPPING[sub.type],
          }));
          logMessage(
            'Found subscriptions:',
            foundSubs,
          );
          break;
      }
      break;
    case CLI_RESOURCES.API:
      const [apiName2, port, image, dockerConfigBase64, envVars] = commandArguments;
      switch (commandVerb) {
        case API_COMMANDS.LIST:
          const foundApis = await client.api?.list();
          logMessage(
            'Found apis:',
            foundApis?.map(api => ({
              ...api,
              env: JSON.stringify(api.env),
            })));
          break;
        case API_COMMANDS.CREATE:
          if (!apiName2) {
            throw new Error('please provide apiName: wl-cloud api create <apiname> <apiport> <image> <docvkerConfigBase64> <envVars>');
          }
          if (!port) {
            throw new Error('please provide port: wl-cloud api create <apiname> <apiport> <image> <docvkerConfigBase64> <envVars>');
          }
          if (!image) {
            throw new Error('please provide image: wl-cloud api create <apiname> <apiport> <image> <docvkerConfigBase64> <envVars>');
          }

          const envVarsParsed: { [k: string]: string } = {};
          if (envVars) {
            envVars.split(',').forEach(envVar => {
              const [key, value] = envVar.split('=');
              envVarsParsed[key] = value;
            });

          }
          const createdApi = await client.api?.create({
            name: apiName2,
            port: Number(port),
            dockerConfigBase64,
            env: envVarsParsed,
            image,
          });
          logMessage('created new api deployment', createdApi);
          break;
        case API_COMMANDS.DELETE:
          if (!apiName2) {
            throw new Error('please provide apiName: wl-cloud api delete <apiname> <apiport> <image> <docvkerConfigBase64> envVar1=Value,envVar2=value2');
          }
          await client.api?.delete(apiName2);
          logMessage('deleted existing api deployment', apiName2);
          break;
      }
      break;
  }
  process.exit(0);
};

const command = checkAndGetCommandArgs();

const evalCommandWrapped = async (promise: Promise<void>) => {
  try {
    await promise;
  } catch (error) {
    logMessage('Error:', (error as Error).message);
    await new Promise(resolve => setTimeout(resolve, 400));
    throw error;
  }
};

// do this so we can actually test outcome in our cli tests

export default evalCommandWrapped(evalCommandArgs(command));
