// eslint-disable-next-line no-shadow
export enum CLI_RESOURCES {
  SERVER = 'server',
  PAGE = 'page',
  SUBSCRIPTION = 'subscription',
  API = 'api',
}

// eslint-disable-next-line no-shadow
export enum PAGES_COMMANDS {
  CREATE = 'create',
  LIST = 'list',
  UPDATE = 'update',
  DELETE = 'delete',
  GET = 'get',
  ADD_API = 'add-api',
  DELETE_API = 'delete-api',
}

// eslint-disable-next-line no-shadow
export enum SERVERS_COMMANDS {
  CREATE = 'create',
  LIST = 'list',
  UPDATE = 'update',
  DELETE = 'delete',
  DEBUG = 'debug',
  GET = 'get',
  START = 'start',
}

// eslint-disable-next-line no-shadow
export enum SUBSCRIPTION_COMMAND {
  LIST = 'list',
}

// eslint-disable-next-line no-shadow
export enum API_COMMANDS {
  LIST = 'list',
  CREATE = 'create',
  DELETE = 'delete',
  UPDATE = 'update',
  GET = 'get',
}

export type COMMAND_ENUMS =
  | SERVERS_COMMANDS
  | PAGES_COMMANDS
  | SUBSCRIPTION_COMMAND
  | API_COMMANDS;
