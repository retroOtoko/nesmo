// Offline support: registers the service worker that saves the whole app on
// this device, asks the browser to keep saved projects, and tracks whether
// we're online so the UI can say so.
import { toast } from './ui/dom';

export type OfflineState = 'dev' | 'unsupported' | 'installing' | 'ready' | 'failed';

export const offlineStatus = {
  state: (import.meta.env.PROD ? 'installing' : 'dev') as OfflineState,
  online: navigator.onLine,
  /** true = browser promised not to clear our storage, false = it may, null = unknown */
  persisted: null as boolean | null,
  version: '',
};

const listeners = new Set<() => void>();
export function onOfflineChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((f) => f());

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function initOffline() {
  const setOnline = (announce: boolean) => {
    offlineStatus.online = navigator.onLine;
    document.body.classList.toggle('offline', !navigator.onLine);
    if (announce && !navigator.onLine) toast("You're offline. Editing, building and running still work.", 3500);
    changed();
  };
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(true));
  setOnline(false);

  navigator.storage?.persisted?.().then((p) => {
    offlineStatus.persisted = p;
    changed();
    if (!p) {
      navigator.storage.persist?.().then((granted) => {
        offlineStatus.persisted = granted;
        changed();
      });
    }
  });

  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) {
    offlineStatus.state = 'unsupported';
    changed();
    return;
  }

  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (hadController) toast('NesMo was updated. Reload to use the new version.', 4000);
  });
  sw.addEventListener('message', (e: MessageEvent<{ version?: string }>) => {
    if (e.data?.version) {
      offlineStatus.version = e.data.version;
      changed();
    }
  });
  sw.register(import.meta.env.BASE_URL + 'sw.js')
    .then(() => sw.ready)
    .then((reg) => {
      offlineStatus.state = 'ready';
      reg.active?.postMessage('version');
      changed();
      if (!localStorage.getItem('nesmo:offline-ready')) {
        localStorage.setItem('nesmo:offline-ready', '1');
        toast('NesMo is saved on this device and now works offline.', 3500);
      }
    })
    .catch(() => {
      offlineStatus.state = 'failed';
      changed();
    });
}
