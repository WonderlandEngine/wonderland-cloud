const isDebug = process.env.LOG_LEVEL === 'debug';

export const logMessage = (...messages: any[]) => {
  console.log(new Date().toISOString(), ...messages);
};

export const debugMessage = (...messages: any[]) => {
  if (!isDebug) return;
  console.log(new Date().toISOString(), ...messages);
};
export const asyncTimeout = async (duration: number) => {
  return new Promise((resolve) => setTimeout(resolve, duration));
};

export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
