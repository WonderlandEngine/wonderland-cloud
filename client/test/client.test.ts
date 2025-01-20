import { WonderlandClient } from '../src/client';

const mockConnection = {};
//@ts-ignore
window.RTCPeerConnection = jest.fn(() => mockConnection);
describe('test client networking', () => {
  beforeEach(() => {});
  afterEach(() => {});
  describe('test connection via Datachannel', () => {
    it('should have webRTCSupported if WebRTC available', () => {
      const client = new WonderlandClient();
      expect(client.webRTCSupported).toBeTruthy();
    });
    it('should have webRTCSupported if WebRTC not available', () => {
      const client = new WonderlandClient();
      window.RTCPeerConnection.mockImplementationOnce(() => {
        throw Error('Not implemented');
      });
      expect(client.webRTCSupported).toBeTruthy();
    });
  });
});
