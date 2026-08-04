import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage<{ requestId: string }>();

export const RequestContext = {
  run<T>(requestId: string, callback: () => T): T {
    return storage.run({ requestId }, callback);
  },
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
