const isDebug = process.env.LOG_LEVEL === 'debug';

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
  options: Record<string, any> = {},
  attempt = 0
): Promise<Response> => {
  const initialHeaders = {
    'Content-Type': 'application/json',
  };
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...initialHeaders,
        ...(options.headers || {}),
      },
    });
    if (response.status > 299) {
      logMessage(
        `Failed to fetch ${url} ${options.method || 'GET'} - status code: ${
          response.status
        }`
      );
      try {
        let json = await response.json();
        //@ts-expect-error recreate json promise
        response.json = new Promise((resolve) => resolve(json));
        logMessage(`Response ${json}`);
      } catch (err) {
        logMessage('Failed to parse response as JSON', err);
        let text = await response.text();
        logMessage(`Response text: ${text}`);
        //@ts-expect-error recreate text promise
        response.text = new Promise((resolve) => resolve(text));
      }
    }
    return response;
  } catch (err) {
    if (attempt < 2 && JSON.stringify(err as Error).includes('ECONNRESET')) {
      logMessage(
        `Fetch connection reset error for ${url} ${
          options.method || 'GET'
        }, retrying...`
      );
      return fetchWithJSON(url, options, attempt + 1);
    }
    throw err;
  }
};
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
