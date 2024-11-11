import {
  CLI_RESOURCES,
  PAGES_COMMANDS,
  SERVERS_COMMANDS,
  COMMAND_ENUMS,
  SUBSCRIPTION_COMMAND,
  API_COMMANDS,
} from './constants';

const helpMapping: {
  [resource in CLI_RESOURCES as string]: {
    [command in COMMAND_ENUMS as string]: string;
  };
} = {};

const serverArguments = `
Optional arguments: 
  --workDir (alternative work directory)
  --authToken (your wl-api auth token)
  --authJsonLocation (alternatively a path to your auth json file, default is
  your current workdir and 'wle-apitoken.json')`;
helpMapping[CLI_RESOURCES.SERVER] = {};
helpMapping[CLI_RESOURCES.PAGE] = {};
helpMapping[CLI_RESOURCES.SUBSCRIPTION] = {};
helpMapping[CLI_RESOURCES.API] = {};

helpMapping[CLI_RESOURCES.SERVER][
  SERVERS_COMMANDS.UPDATE
] = `wl-cloud server update my-new-server-name .Update your production server with a a new package file. It will pack the 
files in the current work folder and upload them to the cloud, replacing your 
current server deployment and performing automated validation of the new server
deployment. Please note that this will cause a downtime of your server.
If the server is a develop server, this action will fail.
 ${serverArguments}
`;
helpMapping[CLI_RESOURCES.SERVER][
  SERVERS_COMMANDS.CREATE
] = `example usage wl-cloud server create my-new-server.
Creates a new server, please note that we will take the first available 
subscription for creating this server. Available flags:
--develop if you want to have a develop server for CLI
--hrtf if you want to have spatial audio mixing
 ${serverArguments}`;

helpMapping[CLI_RESOURCES.SERVER][
  SERVERS_COMMANDS.DEBUG
] = `example usage wl-cloud server debug my-new-server.
Connect to your CLI server and debug your server code live. This command will
pickup any code changes in the current work directory, repackage your server
package and then push the code to the CLI server, also triggering a restart and a 
window reload on clients connected via the browser. Also, each console.log call
is streamed to your console for a convenient debugging experience.
${serverArguments}
`;
helpMapping[CLI_RESOURCES.SERVER][
  SERVERS_COMMANDS.DELETE
] = `Delete a server deployment permanently. Note: this action is not reversible.
${serverArguments}
`;
helpMapping[CLI_RESOURCES.SERVER][
  SERVERS_COMMANDS.LIST
] = `List all your deployed servers. The format is:
SERVER_NAME - PACKAGE_NAME - CLI_ENABLED - HRTF_ENABLED
${serverArguments}
`;

const pageArguments = `Optional arguments:
  --config -c: if provided, the config json file from this location will be used to determine
  the page's name and deployment settings. If no config file exists, a new file will be 
  created at the provided location
  --access: 'public' or 'unlisted', default is 'unlisted' determine if your page will be 
  shown in the public page explorer
  --noThreads: explicitly disable additional response headers, which enable the multi threading 
  feature of Wonderland Engine.`;

helpMapping[CLI_RESOURCES.PAGE][
  PAGES_COMMANDS.UPDATE
] = `Usage: wl-cloud page update <your-page-name> <deployment-dir> [additionalArgs] 
Update an existing page deployment. You can either provide the pages name after 
the command, or use the additional arguments to use an existing page config file.
If no config file is used, then a deployment directory needs to be provided as a 
second argument
${pageArguments}`;
helpMapping[CLI_RESOURCES.PAGE][
  PAGES_COMMANDS.CREATE
] = `Usage: wl-cloud page create <your-page-name> <deployment-dir> [additionalArgs] 
Creates a new page deployment.
${pageArguments}`;
helpMapping[CLI_RESOURCES.PAGE][
  PAGES_COMMANDS.GET
] = `Usage: wl-cloud page get <your-page-name> [additionalArgs] 
Loads information about the provided page project name.
${pageArguments}`;
helpMapping[CLI_RESOURCES.PAGE][
  PAGES_COMMANDS.DELETE
] = `Usage: wl-cloud page delete <your-page-name> [additionalArgs] 
Permanently removes a page deployment from the Wonderland Cloud.
${pageArguments}`;
helpMapping[CLI_RESOURCES.PAGE][
  PAGES_COMMANDS.LIST
] = `Usage: wl-cloud page list [additionalArgs] 
List your existing page project deployments.
${pageArguments}`;
helpMapping[CLI_RESOURCES.PAGE][
  PAGES_COMMANDS.ADD_API
] = `Add a new API routing to your page domain:
  Usage: wl-cloud page add-api page-name api-name api-path.
${pageArguments}`;
helpMapping[CLI_RESOURCES.PAGE][
  PAGES_COMMANDS.DELETE_API
] = `Removed an existing API routing from your page domain:
  Usage: wl-cloud page delete-api page-name api-name.
${pageArguments}`;

helpMapping[CLI_RESOURCES.SUBSCRIPTION][SUBSCRIPTION_COMMAND.LIST] =
  'List your current subscriptions and how many servers are available';
helpMapping[CLI_RESOURCES.API][API_COMMANDS.CREATE] =
  'Creates a new api deployment, example command:' +
  'wl-cloud api create my-api-name 1234 image/to/api {optionalBase64EncodedDockerConfig} env1=vau1,env2=value2';
helpMapping[CLI_RESOURCES.API][API_COMMANDS.DELETE] =
  'Creates an existing api deployment, example command wl-cloud api delete my-api-name.' +
  'Please note, that you cannot delete a api deployment which is still in use by pages routings';
helpMapping[CLI_RESOURCES.API][API_COMMANDS.UPDATE] =
  'Updates an existing api deployment, example command:' +
  'wl-cloud api update my-api-name image imagename:tag \n wl-cloud api update my-api-name env env1=value1,env2=value2 \n ' +
  'wl-cloud api update my-api-name dockerConfigBase64 base64encodeddockerconfig \n' +
  'wl-cloud api update my-api-name port 1234';
helpMapping[CLI_RESOURCES.API][API_COMMANDS.GET] =
  'Get the settings of a single API deployment.';
export default helpMapping;
