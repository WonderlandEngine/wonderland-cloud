#!/usr/bin/env node
import { CloudClient } from './lib';
import cliConfig, { CloudConfig, getAndValidateAuthToken, positionals } from './cli_config';
import { debugMessage, logMessage } from './utils';
import path from 'path';
import process from 'process';
import fs from 'fs';
import { Page, UploadPageResponse } from './resources/page';
import readline from 'readline';
import { rm } from 'node:fs/promises';
import { CloudServer } from './resources/server';
import { CLI_RESOURCES, COMMAND_ENUMS, PAGES_COMMANDS, SERVERS_COMMANDS, SUBSCRIPTION_COMMAND } from './constants';

import helpDictionary from './cli_help';
import { SUBSCRIPTION_TYPE_STRING_MAPPING } from './resources/subscriptions';

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
      'Number of arguments does not match, command expects at least 2 arguments,' +
      ' the project name and the project location, ' +
      'the project location can be relative or absolute.\n' +
      ' Example usage: "wle-cloud pages create my-project-name --access unlisted --no-threads',
    );
    throw new Error('Failed to process command');
  }
  return {
    projectName: args[0],
    projectLocation: args[1],
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
  uploadProjectResponse: UploadPageResponse,
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
            createProjectResponse,
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
            updateProjectResponse,
            cliConfig,
          );
          break;
        case PAGES_COMMANDS.LIST:
          const pages = await client.page?.list();
          console.log('found projects');
          pages?.map((page: Page) =>
            console.log(
              `${page.projectName} - ${page.accessType} - ${page.projectDomain} - ${page.fullProjectUrl}`,
            ),
          );
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
