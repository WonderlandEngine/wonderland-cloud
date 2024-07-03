
// eslint-disable-next-line no-shadow
export enum CLI_RESOURCES {
  SERVER = 'server',
  PAGE = 'page',
  SUBSCRIPTION = 'subscription'
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
  GET = 'get'
}


// eslint-disable-next-line no-shadow
export enum SUBSCRIPTION_COMMAND {
  LIST = 'list',
}



export type COMMAND_ENUMS = SERVERS_COMMANDS | PAGES_COMMANDS | SUBSCRIPTION_COMMAND;