/* eslint-disable @typescript-eslint/ban-ts-comment */

import { ServerClient, ServerConfig } from '../../src/resources/server';
import path from 'path';
import { ExecException } from 'child_process';
import * as child_process from 'child_process';
import fs from 'fs';

const serverName = 'my-dev-server';
const serverVersion = '0.0.1';
const packageName = '@wonderlandengine/my-dev-server';
const packageFileName = `wonderlandengine-my-dev-server-${serverVersion}.tgz`;
const config: ServerConfig = {
  WORK_DIR: 'current',
  SERVER_URL: `https://server.wonderland.dev/${serverName}-develop`,
  COMMANDER_URL: 'https://cloud.wonderland.dev',
  AUTH_TOKEN: 'abcdefghijklmnop',
  /* we need to add a non existing location,
  otherwise it will use the api token from
  our local file */
  AUTH_TOKEN_LOCATION: 'non-existing-location',
};
//@ts-ignore
global.fetch = jest.fn();
const serverPackageJson = {
  name: packageName,
  version: serverVersion,
};

const responseJson = jest.fn();
const response = {
  json: responseJson,
  status: 200,
};
jest.mock('child_process', () => ({
  __esModule: true, // this property makes it work
  default: 'mockedDefaultExport',
  exec: jest.fn(),
}));
jest.mock('fs', () => ({
  __esModule: true, // this property makes it work
  default: {
    readFileSync: jest.fn(),
    existsSync: jest.fn(),
  },
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
}));
describe('test servers resource client', () => {
  beforeAll(() => {
    jest.mock(
      path.join(config.WORK_DIR, 'package.json'),
      () => serverPackageJson,
      { virtual: true }
    );
  });
  describe('test update function', () => {
    it('should validate config, then pack, upload, start, validate and test package', async () => {
      const serversClient = new ServerClient(config);

      // mock packaging of file exec call
      //@ts-ignore
      child_process.exec.mockImplementationOnce(
        (
          cmd: string,
          ops: {
            cwd: string;
          },
          callback: (err: ExecException | null) => void
        ) => {
          callback(null);
        }
      );

      // mock loading of packed file for upload
      const test = Buffer.from('EXAMPLE DATA');
      // @ts-ignore
      fs.existsSync.mockReturnValueOnce(false);
      // @ts-ignore
      fs.readFileSync.mockReturnValueOnce(test);

      // mock requests to remote
      // mock upload request
      // @ts-ignore
      fetch.mockResolvedValueOnce(response);
      // mock validate request
      // @ts-ignore
      fetch.mockResolvedValueOnce(response);
      // mock test deployment request
      // @ts-ignore
      fetch.mockResolvedValueOnce(response);

      // mock upload file request
      console.log(config.COMMANDER_URL);
      expect(serversClient.config).toMatchObject({
        AUTH_TOKEN: config.AUTH_TOKEN,
        COMMANDER_URL: config.COMMANDER_URL,
        IS_LOCAL_SERVER: false,
        SERVER_URL: config.SERVER_URL,
        WORK_DIR: config.WORK_DIR,
      });

      await serversClient.update();
      // @ts-ignore
      expect(fs.readFileSync).toHaveBeenCalledWith(
        `${config.WORK_DIR}/${packageFileName}`
      );
      // check that we send right data for package update
      expect(fetch).nthCalledWith(
        1,
        `${config.COMMANDER_URL}/api/servers/file`,
        expect.objectContaining({})
      );

      // @ts-ignore
      const updatePackageRequestData = fetch.mock.calls[0][1];
      expect(updatePackageRequestData.headers).toEqual({
        authorization: config.AUTH_TOKEN,
      });
      expect(updatePackageRequestData.method).toEqual('POST');
      const bodySymbols = Object.getOwnPropertySymbols(
        updatePackageRequestData.body
      );

      const formBody = updatePackageRequestData.body[bodySymbols[0]];
      const serverNameField = formBody.find(
        (val: any) => val.name === 'serverName'
      );
      expect(serverNameField).toEqual({
        name: 'serverName',
        value: serverName,
      });
      const upgradeServerField = formBody.find(
        (val: any) => val.name === 'upgradeServer'
      );
      expect(upgradeServerField).toEqual({
        name: 'upgradeServer',
        value: 'true',
      });

      const fileField = formBody.find((val: any) => val.name === 'file');
      expect(fileField.value.name).toEqual(packageFileName);
      expect(fileField.value.size).toEqual(test.length);
      // check that we send right data for package validation
      expect(fetch).nthCalledWith(
        2,
        `${config.COMMANDER_URL}/api/servers/validate-deployment`,
        {
          body: JSON.stringify({ name: serverName }),
          headers: {
            authorization: config.AUTH_TOKEN,
            'content-type': 'application/json',
          },
          method: 'POST',
        }
      );
      // check that we send right data for package testing
      expect(fetch).nthCalledWith(
        3,
        `${config.COMMANDER_URL}/api/servers/test-deployment`,
        {
          body: JSON.stringify({ name: serverName }),
          headers: {
            authorization: config.AUTH_TOKEN,
            'content-type': 'application/json',
          },
          method: 'POST',
        }
      );
    });
  });
});
