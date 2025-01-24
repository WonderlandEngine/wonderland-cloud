// @ts-nocheck
import { WonderlandClient } from '../src/client';

const mockDataChannel = {
  send: jest.fn(),
};

const mockConnection = {
  createDataChannel: jest.fn(() => mockDataChannel),
};

class MockWebSocket {
  eventListener = new Map<string, any>();
  send = jest.fn();
  readyState = 'OPEN';

  addEventListener(event: string, fn: any) {
    this.eventListener.set(event, fn);
  }

  async triggerEventListener(event: string, data: any) {
    const listener = this.eventListener.get(event);
    if (listener) {
      await listener(data);
    }
  }
}

global.RTCPeerConnection = jest.fn(() => mockConnection);
//@ts-ignore
global.WebSocket = jest.fn(() => new MockWebSocket());
global.fetch = jest.fn();
describe('test client networking', () => {
  beforeEach(() => {});
  afterEach(() => {
    jest.resetAllMocks();
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
    it('should create WebRTC datachannel on successful signalling and receive/send data via it', async () => {
      //@ts-ignore
      global.RTCPeerConnection.mockImplementation(() => mockConnection);
      const mockSignallingWS = new MockWebSocket();
      global.WebSocket = jest.fn(() => mockSignallingWS);
      mockConnection.createDataChannel.mockImplementation(
        () => mockDataChannel
      );
      const client = new WonderlandClient({ audio: false, debug: true });
      expect(client.webRTCSupported).toBeTruthy();

      const customJoinData = {
        some: 'data',
      };

      const customJoinResponse = [0, 1, 2, 3, 4, 5];

      // mock successful starting of the server
      fetch.mockImplementationOnce(() => ({ status: 200 }));

      const loginPromise = client.connectAndJoinRoom(customJoinData);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await mockSignallingWS.triggerEventListener('open', {});
      await mockSignallingWS.triggerEventListener('message', {
        data: JSON.stringify({
          name: 'joinack',
          custom_data: JSON.stringify(customJoinResponse),
        }),
      });
      // expect that we have created event listeners on the DataChannel
      expect(mockDataChannel.onopen).toBeDefined();
      expect(mockDataChannel.onmessage).toBeDefined();
      expect(mockDataChannel.onerror).toBeDefined();
      expect(mockDataChannel.onclose).toBeDefined();

      // Open the Datachannel to resolve the connection promise
      mockDataChannel.onopen();
      // set DC to open otherwise we cannot send anything
      mockDataChannel.readyState = 'open';

      const loginAck = await loginPromise;

      expect(loginAck).toEqual(customJoinResponse);

      // whenever we send data via the Datachannel, it should be correctly received

      const sentData = new ArrayBuffer(1);
      const sentData2 = new ArrayBuffer(2);
      mockDataChannel.onmessage({ data: sentData });
      mockDataChannel.onmessage({ data: sentData2 });

      expect(client.receivedData).toEqual([sentData, sentData2]);

      client.send(sentData);

      expect(mockDataChannel.send).toHaveBeenCalledTimes(1);
      expect(mockDataChannel.send).toHaveBeenCalledWith(sentData);
    });
    it('should create Websocket data channels if no WebRTC available on successful signalling and receive/send data via it', async () => {
      //@ts-ignore
      global.RTCPeerConnection.mockImplementation(() => {
        throw Error('Not implemented');
      });
      const mockSignallingWS = new MockWebSocket();
      let websocketCreateCalls = 0;
      const webSocketData = [];
      global.WebSocket = jest.fn(() => {
        if (websocketCreateCalls === 0) {
          websocketCreateCalls += 1;
          return mockSignallingWS;
        }
        const newWsDataClient = new MockWebSocket();
        webSocketData.push(newWsDataClient);
        websocketCreateCalls += 1;
        return newWsDataClient;
      });

      mockConnection.createDataChannel.mockImplementation(
        () => mockDataChannel
      );
      const client = new WonderlandClient({ audio: false, debug: true });
      expect(client.webRTCSupported).toBeFalsy();

      const customJoinData = {
        some: 'data',
      };

      const customJoinResponse = [0, 1, 2, 3, 4, 5];

      // mock successful starting of the server
      fetch.mockImplementationOnce(() => ({ status: 200 }));

      const loginPromise = client.connectAndJoinRoom(customJoinData);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await mockSignallingWS.triggerEventListener('open', {});
      await mockSignallingWS.triggerEventListener('message', {
        data: JSON.stringify({
          name: 'joinack',
          custom_data: JSON.stringify(customJoinResponse),
        }),
      });
      // expect that we have created 8 WS data connections
      expect(webSocketData.length).toBe(8);

      for (let i = 0; i < webSocketData.length; i++) {
        await webSocketData[i].triggerEventListener('open', {});
      }
      const loginAck = await loginPromise;

      expect(loginAck).toEqual(customJoinResponse);

      console.log('login ack', loginAck);

      // validate that we can receive data on every ws data channel
      for (let i = 0; i < webSocketData.length; i++) {
        const sentData = new ArrayBuffer(2 * i);
        await webSocketData[i].triggerEventListener('message', {
          data: sentData,
        });
        expect(client.receivedData[i]).toEqual(sentData);
      }

      // verify that we send the data via round robin between the WS conections
      for (let i = 0; i < webSocketData.length; i++) {
        const sentData = new ArrayBuffer(2 * i);
        client.send(sentData);
        expect(webSocketData[i].send).toHaveBeenCalledTimes(1);
        expect(webSocketData[i].send).toHaveBeenCalledWith(sentData);
      }

      for (let i = 0; i < webSocketData.length; i++) {
        const sentData = new ArrayBuffer(2 * i);
        client.send(sentData);
        expect(webSocketData[i].send).toHaveBeenCalledTimes(2);
        expect(webSocketData[i].send).toHaveBeenCalledWith(sentData);
      }
    });
  });
});
