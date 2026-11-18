import fs from 'fs';
import os from 'os';
import path from 'path';
import { CloudClient } from '../src/lib';

/* uuid 13 is ESM-only, which ts-jest cannot load */
jest.mock('uuid', () => ({ v4: () => 'test-request-id' }));

const fetchMock = jest.fn();
global.fetch = fetchMock;

function response(status: number) {
  return {
    status,
    json: async () => ({}),
    text: async () => '',
  };
}

describe('CloudClient.validateAuthToken', () => {
  let client: CloudClient;
  let tokenFile: string;

  beforeAll(() => {
    tokenFile = path.join(os.tmpdir(), `wle-apitoken-${process.pid}.json`);
    fs.writeFileSync(tokenFile, JSON.stringify({ token: 'test-token' }));
    CloudClient.AUTH_RETRY_DELAYS_MS = [1, 1, 1];
  });

  afterAll(() => {
    fs.rmSync(tokenFile, { force: true });
  });

  beforeEach(() => {
    fetchMock.mockReset();
    client = new CloudClient(
      { WLE_CREDENTIALS_LOCATION: tokenFile },
      'server' as any
    );
  });

  it('caches a successful validation', async () => {
    fetchMock.mockResolvedValue(response(200));
    await expect(client.validateAuthToken()).resolves.toBe(true);
    await expect(client.validateAuthToken()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a rejected token', async () => {
    fetchMock.mockResolvedValue(response(401));
    await expect(client.validateAuthToken()).rejects.toThrow(
      'provided auth token is not valid!'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries server errors with backoff and then gives up', async () => {
    fetchMock.mockResolvedValue(response(500));
    await expect(client.validateAuthToken()).rejects.toThrow('status code 500');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('recovers when a retry succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    await expect(client.validateAuthToken()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries fetch network errors using the error cause code', async () => {
    const err = new TypeError('fetch failed', {
      cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    } as any);
    fetchMock.mockRejectedValueOnce(err).mockResolvedValueOnce(response(200));
    await expect(client.validateAuthToken()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
