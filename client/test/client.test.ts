import { WonderlandClient } from '../src/client';

const mockConnection = {
  createDataChannel: jest.fn(),
};
//@ts-ignore
global.RTCPeerConnection = jest.fn(() => mockConnection);
describe('test client networking', () => {
  beforeEach(() => {});
  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('Test data connection logic', () => {
    it('should have webRTCSupported true if WebRTC available', () => {
      //@ts-ignore
      global.RTCPeerConnection.mockImplementationOnce(() => mockConnection);
      const client = new WonderlandClient();
      expect(client.webRTCSupported).toBeTruthy();
    });
    it('should have webRTCSupported false if WebRTC not available', () => {
      //@ts-ignore
      global.RTCPeerConnection.mockImplementationOnce(() => {
        throw Error('Not implemented');
      });
      const client = new WonderlandClient();
      expect(client.webRTCSupported).toBeFalsy();
    });
    it('should create datachannel on successful signalling', () => {
      //@ts-ignore
      global.RTCPeerConnection.mockImplementationOnce(() => mockConnection);
      const client = new WonderlandClient();
      expect(client.webRTCSupported).toBeFalsy();
    });
  });
});
