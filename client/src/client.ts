/* eslint-disable @typescript-eslint/no-var-requires */
import { parse, write } from 'sdp-transform';

const COMMANDER_URL = 'https://cloud.wonderland.dev';

export interface WonderlandClientOptions {
  debug: boolean;
  host: string;
  port: number;
  path: string;
  secure: boolean;
  audioDeviceId?: string;
  audio: boolean;
  skipServerStart: boolean;
}

enum WSMessageName {
  Join = 'join',
  JoinAck = 'joinack',
  Candidate = 'candidate',
  Offer = 'offer',
  Answer = 'answer',
  Custom = 'custom',
  Pong = 'pong',
  Ping = 'ping',
  Restart = 'restart',
}

interface WSMessageEvent {
  name: WSMessageName;
  data: {
    description?: string;
    candidate?: RTCIceCandidateInit;
  };
  custom_data: string;
}

/**
 * Custom Ws Message type to use for sending data back and forth between your server and the clients.
 * This data will be not processed by the internal server, but instead directly returned to the
 * web socket message handler of your custom server implementation.
 */
export interface WsMessageCustom {
  type: string;
  data: any;
}

/**
 * Default WonderlandClientOptions
 */
const WonderlandClientDefaultOptions: WonderlandClientOptions = {
  debug: false,
  host: 'localhost',
  port: 443,
  path: '',
  secure: true,
  audioDeviceId: undefined,
  audio: true,
  skipServerStart: false,
};

/**
 * {WonderlandClient}
 *
 * Client used for handling WS and WebRTC connection to the server.
 */
export class WonderlandClient {
  eventQueue: any[] = [];
  candidates: RTCIceCandidateInit[] = [];
  peerConnection: RTCPeerConnection;
  datachannel?: RTCDataChannel;
  id: string;
  debug: boolean;
  host: string;
  port: number;
  path: string;
  secure: boolean;
  inputDeviceId?: string;
  outputDeviceId?: string;
  audio: boolean;
  receivedData: any[];
  incomingRemoteStreams?: number;
  context?: AudioContext;
  incomingRemoteGainNode?: GainNode;
  getAudioContextPromise?: Promise<AudioContext>;
  remoteStream?: MediaStream;
  audioNode?: HTMLAudioElement;
  gainNode?: GainNode;
  ws?: WebSocket;
  pingInterval?: number;
  makingOffer: boolean = false;
  audioAdded: boolean = false;
  audioAddingPromise?: Promise<void>;
  skipServerStart: boolean = false;
  isIOS = false;

  /**
   * Constructor
   *
   * @param {boolean} options.audio Whether to use audio streaming for this client
   * @param {boolean} options.debug Enable/disable debug output
   * @param {string} options.host Server host
   * @param {string} options.path Server path, defaults to ''
   * @param {number} options.port Server port
   * @param {boolean} options.secure Whether to enable secure web sockets
   */
  constructor(userOptions: Partial<WonderlandClientOptions> = {}) {
    this.id = this.randomId(10);
    const mergedOptions = { ...WonderlandClientDefaultOptions, ...userOptions };
    this.debug = mergedOptions.debug;
    this.host = mergedOptions.host;
    this.port = mergedOptions.port;
    this.path = mergedOptions.path;
    this.secure = mergedOptions.secure;
    this.inputDeviceId = mergedOptions.audioDeviceId;
    this.skipServerStart = mergedOptions.skipServerStart;

    this.audio = mergedOptions.audio ?? true;

    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);


    this._debugLog('client created with options:', mergedOptions);
    // TODO DO NOT MIX AUDIO IF NOT ENABLED ON CLIENT
    if (this.audio) {
    }
    this.receivedData = [];
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302',
        },
      ],
    });
    this.bindOnWindowCloseEvent();
    this.createInputOutputControls();
  }

  recreateMicrophoneTrack(deviceId?: string){
    const newConstraints = {
      audio: { deviceId },
      echoCancellation: true,
      noiseSuppression: true,
    };

    navigator.mediaDevices.getUserMedia(newConstraints).then((stream) => {
      this._debugLog('got stream for device', deviceId, stream);
      const audioTrack = stream.getTracks()[0];

      const audioSender = this.peerConnection.getSenders().find(function(s) {
        return s.track?.kind == audioTrack.kind;
      });

      if (audioSender) {
        this._debugLog('got audio sender for track replace');
        audioSender.replaceTrack(audioTrack);
      }
    });
  }

  createInputOutputControls(): void {
    //@ts-ignore
    window.wonderlandChangeInputDevice = (deviceId) => {

      if (this.peerConnection.connectionState === 'connected') {
        this._debugLog('already connected, replace track');
        this.recreateMicrophoneTrack(deviceId);
      } else {
        this._debugLog('not connected yet, change the deviceId value of instance');
        this.inputDeviceId = deviceId;
      }


    };
    //@ts-ignore
    window.wonderlandChangeOutputDevice = (deviceId) => {
      if (this.context) {
        this._debugLog('already got audio context, replace sink with ', deviceId);
        //@ts-ignore
        if (this.context.setSinkId) {
          //@ts-ignore
          this.context.setSinkId(deviceId);
        }
        //@ts-ignore
      } else if (this.audioNode && this.audioNode.setSinkId) {
        //@ts-ignore
        this.audioNode.setSinkId(deviceId);
      } else {
        this._debugLog('not connetced yet ', deviceId);
        this.outputDeviceId = deviceId;
      }
    };

    //@ts-ignore
    window.wonderlandGetGainNodeValue = () => {
      if (this.gainNode) {
        return this.gainNode.gain;
      }
      return {
        defaultValue: 1,
        maxValue: 3.4028234663852886e+38,
        minValue: -3.4028234663852886e+38,
        value: 1,
      };
    };

    //@ts-ignore
    window.wonderlandSetGainNodeValue = (gain) => {
      if (this.gainNode && this.incomingRemoteGainNode && this.context) {
        this.gainNode.gain.setValueAtTime(gain, this.context.currentTime);
        this.incomingRemoteGainNode.gain.setValueAtTime(gain, this.context.currentTime);
      }
      console.error('could not change gain, no gainNode or context exists yet');
    };

  }

  onXRSessionStart(): void{
    if(this.audio){
      this.recreateMicrophoneTrack();
    }
  }

  bindOnWindowCloseEvent(): void {
    window.onbeforeunload = () => {
      this.cleanupConnection();
    };
  }

  cleanupConnection(): void {
    if (this.datachannel) {
      this.datachannel.close();
      console.log('datachannel cleaned up');
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      console.log('peer connection cleaned up');
    }
    if (
      this.ws &&
      this.ws.readyState !== this.ws.CLOSED &&
      this.ws.readyState !== this.ws.CLOSING
    ) {
      this.ws.close();
      console.log('ws connection cleaned up');
    }
  }

  async createNewPromise(): Promise<AudioContext> {
    return new Promise((resolve) => {
      try {
        if (this.context && this.context.state !== 'suspended') {
          return resolve(this.context);
        }
        if (!this.context) {
          // Setup Web Audio components
          window.AudioContext =
            // we need to do this, because webkitAudioContext is undefined
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            window.AudioContext || window.webkitAudioContext;
          this.incomingRemoteStreams = 0;
          this.context = new AudioContext();
          this.incomingRemoteGainNode = this.context.createGain();

          this.incomingRemoteGainNode.connect(this.context.destination);
          this.context.resume();
        }
        if (this.context && this.context.state === 'suspended') {
          this.context.resume();
          if (this.context.state !== 'suspended') {
            return resolve(this.context);
          }
          throw new Error('audio context not active');
        } else {
          setInterval(() => {
            // periodically check if context is supspended and resume it
            if (this.context && this.context.state === 'suspended') {
              this.context.resume();
            }
          }, 5000);
          resolve(this.context);
        }
        resolve(this.context);
        setInterval(() => {
          // periodically check if context is supspended and resume it
          if (this.context && this.context.state === 'suspended') {
            this.context.resume();
          }
        }, 5000);
      } catch (err) {
        // something failed, lets wait a few and then try again ...
        // try again..
        this._debugLog('try to get context in a few again', err);
        setTimeout(async () => {
          resolve(await this.createNewPromise());
        }, 500);
      }
    });
  }

  /**
   * Get the audio context from browser
   * Will only resolve once the audio context is available
   * @returns {Promise<unknown>}
   */
  async waitForAudioContext() {
    if (this.isIOS) {
      return;
    }
    if (this.context && this.context.state === 'running') {
      return this.context;
    }
    if (this.getAudioContextPromise) {
      return this.getAudioContextPromise;
    }
    this.getAudioContextPromise = new Promise(async (resolve) => {
      resolve(await this.createNewPromise());
    });
    return this.getAudioContextPromise;
  }

  async addStreamToAudioContext(stream: MediaStream) {
    // TODO: This needs more investigation
    // The MediaStream node doesn't produce audio until an HTML audio element is attached to the stream
    // Pause and remove the element after loading since we only need it to trigger the stream
    // See https://stackoverflow.com/questions/24287054/chrome-wont-play-webaudio-getusermedia-via-webrtc-peer-js
    // and https://bugs.chromium.org/p/chromium/issues/detail?id=121673#c121
    this.remoteStream = stream;
    // @ts-ignore
    if(navigator.audioSession){
      // @ts-ignore
      navigator.audioSession.type = "playback"
    }
    if (!this.isIOS) {
      let audioElem: HTMLAudioElement | null = new Audio();
      audioElem.controls = true;
      audioElem.muted = true;
      audioElem.srcObject = this.remoteStream;


      audioElem.addEventListener('canplaythrough', () => {
        (audioElem as HTMLAudioElement).pause();
        audioElem = null;
      });
    } else {
      const audioElement = document.createElement('audio');
      audioElement.controls = true;
      audioElement.muted = false;
      audioElement.srcObject = this.remoteStream;
      audioElement.addEventListener('canplaythrough', () => {
        audioElement.play();
        audioElement.muted = false;
        audioElement.style.display = 'none';
        document.body.appendChild(audioElement);
        this.audioNode = audioElement;
      });
    }


    if (!this.isIOS && this.context && this.incomingRemoteGainNode) {
      // Gain node for this stream only
      // Connected to gain node for all remote streams
      const gainNode = (this.gainNode = this.context.createGain());
      gainNode.connect(this.incomingRemoteGainNode);

      const audioNode = this.context.createMediaStreamSource(this.remoteStream);
      audioNode.connect(gainNode);

      this._debugLog('added stream to audio context');
    } else {

    }
  }

  // Handles remote MediaStream success by adding it as the remoteVideo src.
  gotRemoteMediaStream(event: RTCTrackEvent) {
    this._debugLog(`Received remote stream from ${this.id}.`);
    this.addStreamToAudioContext(event.streams[0]);
  }

  randomId(length: number) {
    let result = '';
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; ++i) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  async addLocalAudioTracks() {
    if (this.audioAdded) return;
    if (!this.audioAddingPromise) {
      this.audioAddingPromise = new Promise(async (resolve) => {
        // @ts-ignore
        if (navigator.audioSession) {
          // @ts-ignore
          navigator.audioSession.type = 'play-and-record';
        }

        const media = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: this.inputDeviceId || void 0,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        media.getTracks().forEach((track) => {
          this.peerConnection.addTrack(track, media);
        });


        await this.waitForAudioContext();
        this.audioAdded = true;
        this._debugLog('added own media tracks');
        resolve();
      });
    }
    return this.audioAddingPromise;
  }

  async sendStartServerSignal(): Promise<boolean> {
    const response = await fetch(`${COMMANDER_URL}/api/servers/start`, {
      body: JSON.stringify({
        path: this.path.replace('/', '').slice(0, -3),
      }),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    });
    if (response.status === 200) {
      return true;
    } else if (response.status === 201) {
      console.log('Server scheduled for start');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return this.sendStartServerSignal();
    } else if (response.status === 202) {
      console.log('Server is starting start');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return this.sendStartServerSignal();
    } else {
      console.error('failed to start server!!', await response.json());
      return false;
    }
  }

  /**
   * Connect to the server. First sends a request to start the server, then connects to it
   *
   * Creates a new WebSocket connection to the server and joins the room.
   * @param data {object} Custom data to send with the join request
   * @returns {Promise} Promise that resolves when the connection has been successfully opened.
   */
  async connectAndJoinRoom(data = {}): Promise<number[]> {
    if (!this.skipServerStart) {
      const isRunning = await this.sendStartServerSignal();
      if (!isRunning) {
        throw Error('server failed to start or is not running');
      }
    }
    // we are creating objectIds on join which are returned with a joinack message
    // then we create everything else and then return the created object ids
    const createdObjects = await this.createSignalling(data);
    this._debugLog('peer connection created!');
    await this.createDataChannel();
    this._debugLog('datachannel created');
    await this.startNegotiation();
    if (this.audio) await this.addLocalAudioTracks();
    return createdObjects;
  }

  async createSignalling(data: any): Promise<number[]> {
    const url = `${this.secure ? 'wss' : 'ws'}://${this.host}:${this.port}${
      this.path
    }/${this.id}`;
    this._debugLog(`connecting WS to ${url}`);
    this.ws = new WebSocket(url);
    let connected = false;
    return new Promise((resolve, reject) => {
      this.ws?.addEventListener('open', async (event) => {
        this._debugLog('WebSocket connected, signaling ready', event);
        this._debugLog('Creating peer connection', event);
        this.createPeerConnection();
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        this.pingInterval = setInterval(() => {
          this.sendViaWsInternal({ name: WSMessageName.Ping, data: {} });
        }, 5000);
        this.sendViaWsInternal({
          name: WSMessageName.Join,
          custom: { ...data },
        });
      });
      this.ws?.addEventListener('close', (close) => {
        this._debugLog('WebSocket closed:', close);
        clearInterval(this.pingInterval);
        if (!connected) return reject(close);
        this.cleanupConnection();
      });
      this.ws?.addEventListener(
        'message',
        (async (msgEvt: { data: string }) => {
          this._debugLog(msgEvt);
          const msg: WSMessageEvent = JSON.parse(msgEvt.data);
          this._debugLog('received message from server!', msg);
          switch (msg.name) {
            case WSMessageName.Offer:
              const description = msg.data?.description;

              this._debugLog('received', msg.name);
              this._debugLog(description?.split('\r\n'));

              this._debugLog('  - Setting remote description');
              await this.peerConnection.setRemoteDescription({
                sdp: description,
                type: 'offer',
              });
              const answer = await this.peerConnection.createAnswer();
              const parsedSDP = parse(answer.sdp as string);
              parsedSDP.media.forEach((media) => {
                if (media.type === 'audio') {

                  media.fmtp[0].config = media.fmtp[0].config
                    // disable ForwardErrorCorrection as it reduces the sound quality
                    .replace('useinbandfec=1', 'useinbandfec=0')
                    // set the packet size to 10ms per packet
                    .replace('minptime=0', 'minptime=10')
                    // explicitly ask for a stereo input from the server
                    .concat(';stereo=1;ssprop-stereo=1');
                }
              });
              answer.sdp = write(parsedSDP);

              await this.peerConnection.setLocalDescription(answer);
              this.sendViaWsInternal({
                name: WSMessageName.Answer,
                data: {
                  description: answer.sdp,
                },
              });
              this._debugLog('send answerd');
              break;
            case WSMessageName.Answer:
              const description2 = msg.data?.description;
              this._debugLog('received', msg.name);
              this._debugLog(description2?.split('\r\n'));

              await this.peerConnection.setRemoteDescription({
                sdp: description2,
                type: 'answer',
              });

              break;
            case WSMessageName.Candidate:
              if (msg.data && msg.data.candidate) {
                if (this.peerConnection.remoteDescription) {
                  this.peerConnection
                    .addIceCandidate(msg.data.candidate)
                    .then((val) => this._debugLog('added ice candidate', val))
                    .catch((err) =>
                      this._debugLog('could not add candidate', err),
                    );
                } else {
                  this.candidates.push(msg.data.candidate);
                }
              }

              break;
            case WSMessageName.JoinAck:
              try {
                connected = true;

                const parsed = JSON.parse(msg.custom_data);
                resolve(parsed);
              } catch (err) {
                console.error('COULD NOT PARSE JOIN ACK EVENT!!', msg);
                connected = false;
                reject(err);
              }
              break;
            case WSMessageName.Pong:
              this._debugLog('received pong response');
              break;
            case WSMessageName.Restart:
              this._debugLog('received restart command!');
              location.reload();
              break;
            case WSMessageName.Custom:
              if (msg && msg.custom_data) {
                const parsedEvent = JSON.parse(msg.custom_data);
                this._debugLog('RECEIVED CUSTOM EVENT!!', msg, parsedEvent);
                this.eventQueue.push(parsedEvent);
              } else {
                console.error(
                  'received custom event without custom data! cannot be',
                );
              }
              break;
            default:
              console.error('RECEIVED UNKNOWN EVENT!!', msgEvt);
              break;
          }
        }).bind(this),
      );
    });
  }

  async createDataChannel() {
    const datachannel = (this.datachannel =
      this.peerConnection.createDataChannel('data'));

    return new Promise<void>((resolve, reject) => {
      datachannel.onopen = async () => {
        this._debugLog('datachannel opened!');
        resolve();
      };
      datachannel.onmessage = (event) => {
        this.receivedData.push(event.data);
      };
      datachannel.onerror = (error) => {
        console.error('datachannel error:', error);
        reject(error);
      };
      datachannel.onclose = (event) => {
        console.log('datachannel close:', event);
      };
    });
  }

  async startNegotiation() {
    const offer = await this.peerConnection.createOffer();
    const parsedSDP = parse(offer.sdp as string);
    parsedSDP.media.forEach((media) => {
      if (media.type === 'audio') {

        media.fmtp[0].config = media.fmtp[0].config
          // disable ForwardErrorCorrection as it reduces the sound quality
          .replace('useinbandfec=1', 'useinbandfec=0')
          // set the packet size to 10ms per packet
          .replace('minptime=0', 'minptime=20')
          // explicitly offer a mono channel as an input to the server
          .concat(';stereo=0;ssprop-stereo=0');
      }
    });
    offer.sdp = write(parsedSDP);
    await this.peerConnection.setLocalDescription(offer);
    this.sendViaWsInternal({
      name: WSMessageName.Offer,
      data: {
        description: this.peerConnection.localDescription?.sdp,
      },
    });
  }

  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.l.google.com:5349" },
        { urls: "stun:stun1.l.google.com:3478" },
        { urls: "stun:stun1.l.google.com:5349" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:5349" },
        { urls: "stun:stun3.l.google.com:3478" },
        { urls: "stun:stun3.l.google.com:5349" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:5349" }
      ],
      bundlePolicy: 'balanced',
    });
    this.peerConnection.onicegatheringstatechange = (event) => {
      this._debugLog(
        'ice gathering change',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        event.target.iceGatheringState,
      );
    };
    this.peerConnection.onicecandidate = (event) => {
      this._debugLog('iceevent', event);
      if (event.candidate) {
        this.sendViaWsInternal({
          name: WSMessageName.Candidate,
          data: {
            candidate: event.candidate,
          },
        });
      }
    };
    this.peerConnection.onsignalingstatechange = () => {
      this._debugLog(
        'received signalling state change event',
        this.peerConnection.signalingState,
      );
      if (
        this.peerConnection.signalingState === 'have-remote-offer' ||
        this.peerConnection.signalingState === 'stable'
      ) {
        this.candidates.forEach((can) => {
          this.peerConnection
            .addIceCandidate(can)
            .then((val) => console.log('added ice candidate', val, can))
            .catch((err) => console.log('could not add candidate', err));
        });
        this.candidates.length = 0;
      }
    };
    this.peerConnection.ontrack = async (track) => {
      if (!this.audio) return;
      this._debugLog('received track', track);
      this.gotRemoteMediaStream(track);
    };
    this.peerConnection.onnegotiationneeded = async (event) => {
      this._debugLog('received negotiation needed event', event);
      if (this.peerConnection.signalingState !== 'stable') {
        return;
      }
      this.makingOffer = true;
      await this.startNegotiation();
      this.makingOffer = false;
    };
    this.peerConnection.onconnectionstatechange = () => {
      this._debugLog('connection state change', this.peerConnection);
    };
  }

  /**
   * Send some data to the server via the datachannel connection.
   *
   * This may be a string, a Blob, an ArrayBuffer, a TypedArray or a DataView object.
   * @param data {Blob|TypedArray|ArrayBuffer|string} Data to send
   */
  send(data: Blob | ArrayBufferView | ArrayBuffer | string) {
    if (!this.datachannel || this.datachannel.readyState != 'open') return;
    /* TODO: Probably attach a timestamp */
    if (typeof data === 'string') {
      this.datachannel.send(data);
    }
    if (data instanceof Blob) {
      this.datachannel.send(data);
    }
    if (ArrayBuffer.isView(data)) {
      this.datachannel.send(data);
    }
    if (data instanceof ArrayBuffer) {
      this.datachannel.send(data);
    }
  }

  /**
   * Send data to server via the websocket connection
   * @param options
   */
  sendViaWs(options: WsMessageCustom) {
    this.sendViaWsInternal({
      name: WSMessageName.Custom,
      data: {},
      custom: {
        type: options.type,
        data: options.data,
      },
    });
  }

  sendViaWsInternal({
                      name,
                      data = {},
                      custom,
                    }: {
    name: WSMessageName;
    data?: any;
    custom?: any;
  }) {
    this.ws?.send(
      JSON.stringify({
        name,
        id: this.id,
        data,
        timestamp: Date.now(),
        custom_data: custom ? JSON.stringify(custom) : '',
      }),
    );
  }

  /**
   * Retrieve the list of received data
   *
   * Call {@link clear()} after processing the data events.
   *
   * @returns {Object[]} Received data events
   */
  receive() {
    return this.receivedData;
  }

  /**
   * Clear current list of received data events.
   */
  clear() {
    this.receivedData.length = 0;
  }

  /* Internal function for printing debug messages, if enabled */
  _debugLog(...args: unknown[]) {
    if (!this.debug) return;
    console.log(Date.now(), 'WonderlandClient', ...args);
  }
}
