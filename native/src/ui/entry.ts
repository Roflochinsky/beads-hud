import type { RpcRequest, Transport } from '../shared.js';
import { mount, type MountOptions } from './index.js';
import './styles.css';

declare global {
  interface Window {
    beadsTransport?: Transport;
  }
}

function httpTransport(): Transport {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('token') || '';
  if (window.location.hash) {
    history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}`);
  }
  return {
    async request<T>(request: RpcRequest): Promise<T> {
      if (!token) throw new Error('Missing access token. Open the authenticated link from the host.');
      const response = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(request),
        credentials: 'same-origin',
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : `HTTP ${response.status}`;
        throw new Error(message);
      }
      return payload as T;
    },
  };
}

const params = new URLSearchParams(window.location.search);
const platformParam = params.get('platform') ?? document.body.dataset.platform;
const platforms: NonNullable<MountOptions['platform']>[] = ['tern', 'paseo', 'linux', 'macos'];
const platform = platforms.find((value) => value === platformParam);
const options: MountOptions = { mode: params.get('mode') === 'tray' ? 'tray' : 'board', platform };
const transport: Transport = window.beadsTransport ?? httpTransport();
const root = document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));
mount(root, transport, options);
