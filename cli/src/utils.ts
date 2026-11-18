const isDebug = process.env.LOG_LEVEL === 'debug';
import { v4 } from 'uuid';

export const logMessage = (...messages: any[]) => {
  console.log(new Date().toLocaleString(), ...messages);
};

export const debugMessage = (...messages: any[]) => {
  if (!isDebug) return;
  console.log(new Date().toLocaleString(), ...messages);
};
export const asyncTimeout = async (duration: number) => {
  return new Promise((resolve) => setTimeout(resolve, duration));
};

const RETRYABLE_NETWORK_ERRORS = [
  'ECONNRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
];

export const getErrorCode = (err: unknown): string | undefined => {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' ? code : undefined;
};

export const fetchWithJSON = async (
  url: string,
  options: Record<string, any> = { noContentType: false },
  attempt = 0
): Promise<Response> => {
  const initialHeaders = options.noContentType
    ? { requestId: v4() }
    : {
        'content-type': 'application/json',
        requestId: v4(),
      };
  try {
    debugMessage('performing fetch', initialHeaders.requestId, url, options);
    const response = await fetch(url, {
      ...options,
      headers: {
        ...initialHeaders,
        ...(options.headers || {}),
      },
    });
    debugMessage(
      'fetch finished',
      initialHeaders.requestId,
      url,
      response.status
    );
    if (response.status > 299) {
      logMessage(
        `Failed to fetch ${initialHeaders.requestId} ${url} ${
          options.method || 'GET'
        } - status code: ${response.status}`
      );
      try {
        const json = await response.json();
        response.json = () => new Promise((resolve) => resolve(json));
        logMessage(
          `${initialHeaders.requestId} Response ${JSON.stringify(json)}`
        );
      } catch (err) {
        logMessage('Failed to parse response as JSON', err);
        const text = await response.text();
        logMessage(`Response text: ${text}`);
        response.json = () =>
          new Promise((resolve) => resolve({ textContent: text }));
        response.text = () => new Promise((resolve) => resolve(text));
      }
    }
    return response;
  } catch (err) {
    logMessage('fetch failed', initialHeaders.requestId, url, String(err));
    /* Node's fetch wraps socket errors: the code is on err.cause */
    const code = getErrorCode(err);
    if (attempt < 2 && code && RETRYABLE_NETWORK_ERRORS.includes(code)) {
      logMessage(
        `Fetch ${code} error for ${url} ${options.method || 'GET'}, retrying...`
      );
      await asyncTimeout(500 * 2 ** attempt);
      return fetchWithJSON(url, options, attempt + 1);
    }
    throw err;
  }
};
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
