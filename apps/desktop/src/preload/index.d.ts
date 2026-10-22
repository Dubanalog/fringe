import type { FringeApi } from '../shared/ipc';

declare global {
  interface Window {
    fringe: FringeApi;
  }
}
