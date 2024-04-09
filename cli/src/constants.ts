
// eslint-disable-next-line no-shadow
export enum CLI_RESOURCES {
  SERVER = 'server',
  PAGE = 'page',
}

// eslint-disable-next-line no-shadow
export enum PAGES_COMMANDS {
  CREATE = 'create',
  LIST = 'list',
  UPDATE = 'update',
  DELETE = 'delete',
  GET = 'get',
}

// eslint-disable-next-line no-shadow
export enum SERVERS_COMMANDS {
  CREATE = 'create',
  LIST = 'list',
  UPDATE = 'update',
  DELETE = 'delete',
  DEBUG = 'debug',
}

export type COMMAND_ENUMS = SERVERS_COMMANDS | PAGES_COMMANDS;