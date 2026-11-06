import { contextBridge, ipcRenderer } from 'electron';
import type { RpcRequest, Transport } from '../shared.js';

// No IPC primitives or Node objects cross the context-isolation boundary.
const transport: Transport = {
  async request<T>(request: RpcRequest): Promise<T> {
    return await ipcRenderer.invoke('beads:request', request) as T;
  },
};
contextBridge.exposeInMainWorld('beadsTransport', transport);

for (const event of ['beads:quick-capture', 'beads:projects-changed'] as const) {
  ipcRenderer.on(event, () => window.dispatchEvent(new CustomEvent(event)));
}
for (const event of ['beads:open-board', 'beads:choose-projects'] as const) {
  window.addEventListener(event, () => ipcRenderer.send(event));
}

if (new URLSearchParams(window.location.search).get('mode') === 'tray') {
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // Let the shared UI dismiss its dialog, query, or selected issue first.
    window.setTimeout(() => {
      if (!event.defaultPrevented) ipcRenderer.send('beads:hide-tray');
    }, 0);
  });
}
