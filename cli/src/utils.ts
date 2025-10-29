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
        let json = await response.json();
        response.json = () => new Promise((resolve) => resolve(json));
        logMessage(
          `${initialHeaders.requestId} Response ${JSON.stringify(json)}`
        );
      } catch (err) {
        logMessage('Failed to parse response as JSON', err);
        let text = await response.text();
        logMessage(`Response text: ${text}`);
        response.text = () => new Promise((resolve) => resolve(text));
      }
    }
    return response;
  } catch (err) {
    logMessage('fetch failed', initialHeaders.requestId, url);
    if (attempt < 2 && JSON.stringify(err as Error).includes('ECONNRESET')) {
      if (JSON.stringify(err as Error).includes('ENETUNREACH')) {
        logMessage(
          `Fetch ENETUNREACH error for ${url} ${
            options.method || 'GET'
          }, retrying...`
        );
      }
      if (JSON.stringify(err as Error).includes('ECONNRESET')) {
        logMessage(
          `Fetch ECONNRESET error for ${url} ${
            options.method || 'GET'
          }, retrying...`
        );
      }
      return fetchWithJSON(url, options, attempt + 1);
    }
    throw err;
  }
};
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
