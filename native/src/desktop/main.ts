import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, net, protocol, screen, session, Tray } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, Rectangle } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setInterval, clearInterval } from 'node:timers';
import { handleRequest } from '../core/service.js';
import type { Project } from '../shared.js';
import { loadReadiness } from './load-readiness.js';
import { parseLaunchArgs, projectsFromPaths } from './projects.js';
import { assertTrustedDocument, authorizeDesktopRequest } from './requests.js';
import type { ReadinessState } from './readiness.js';
import { trayImage } from './tray-icon.js';

const DOCUMENT = 'beads://app/index.html';
const SHORTCUT = 'CommandOrControl+Shift+Space';
const desktopDir = dirname(fileURLToPath(import.meta.url));
const uiDir = join(desktopDir, '..', 'ui');
const platform = process.platform === 'darwin' ? 'macos' : 'linux';
const panelHeight = platform === 'macos' ? 640 : 560;

// A standard, secure origin lets browser modules and fonts load without giving
// the renderer file:// access or relaxing Chromium's same-origin policy.
protocol.registerSchemesAsPrivileged([{ scheme: 'beads', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.platform === 'linux') app.setDesktopName('dev.roflochinsky.beads.desktop');
app.setName('Beads Board');

let projects: Project[] = [];
let tray: Tray | undefined;
let panel: BrowserWindow | undefined;
let board: BrowserWindow | undefined;
let panelReady = false;
let pendingCapture = false;
let choosingProjects = false;
let lastPanelBlur = 0;
let readiness: ReadinessState = { kind: 'unconfigured' };
let readinessGeneration = 0;
let refreshing = false;
let refreshAgain = false;
let refreshTimer: NodeJS.Timeout | undefined;
let shortcutAvailable = false;
function reportError(title: string, error: unknown): void {
  dialog.showErrorBox(title, error instanceof Error ? error.message : String(error));
}

function registerProtocol(): void {
  protocol.handle('beads', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app' || url.username || url.password || !['GET', 'HEAD'].includes(request.method)) {
      return new Response('Not found', { status: 404 });
    }
    let file: string | undefined;
    if (url.pathname === '/index.html') file = join(desktopDir, 'index.html');
    else if (url.pathname === '/ui/entry.js' || url.pathname === '/ui/entry.css') file = join(uiDir, url.pathname.slice('/ui/'.length));
    else if (/^\/ui\/assets\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(url.pathname)) file = join(uiDir, url.pathname.slice('/ui/'.length));
    return file ? net.fetch(pathToFileURL(file).href, { method: request.method }) : new Response('Not found', { status: 404 });
  });
}

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const windows = [panel, board];
  const owned = windows.some((window) => window && !window.isDestroyed()
    && window.webContents === event.sender && window.webContents.mainFrame === event.senderFrame);
  assertTrustedDocument(owned, event.senderFrame?.url ?? '', DOCUMENT);
}

function publishReadiness(): void {
  if (!tray) return;
  tray.setImage(trayImage(readiness, platform === 'macos'));
  if (readiness.kind === 'ready') {
    const { ready, projectCount } = readiness.readiness;
    tray.setToolTip(`Beads: ${ready} ready across ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`);
    if (platform === 'macos') tray.setTitle(String(ready), { fontType: 'monospacedDigit' });
  } else {
    tray.setToolTip(readiness.kind === 'unconfigured' ? 'Beads: choose projects'
      : readiness.kind === 'loading' ? 'Beads: loading selected projects' : `Beads: ${readiness.message}`);
    if (platform === 'macos') tray.setTitle(readiness.kind === 'error' ? '!' : readiness.kind === 'loading' ? '…' : '–');
  }
}

async function refreshReadiness(): Promise<void> {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      const generation = readinessGeneration;
      const selected = projects;
      let next: ReadinessState;
      try { next = await loadReadiness(selected); }
      catch (error) { next = { kind: 'error', message: error instanceof Error ? error.message : String(error) }; }
      if (generation === readinessGeneration) {
        readiness = next;
        publishReadiness();
      }
    } while (refreshAgain);
  } finally {
    refreshing = false;
  }
}

function replaceProjects(next: Project[]): void {
  if (next.length === projects.length && next.every((project, index) => project.id === projects[index].id)) return;
  projects = next;
  readinessGeneration += 1;
  // Do not show a count from the previous selection while the new one loads.
  readiness = next.length ? { kind: 'loading' } : { kind: 'unconfigured' };
  publishReadiness();
  for (const window of [panel, board]) {
    if (window && !window.isDestroyed() && !window.webContents.isLoadingMainFrame()) {
      window.webContents.send('beads:projects-changed');
    }
  }
  void refreshReadiness();
}

async function chooseProjects(): Promise<void> {
  if (choosingProjects) return;
  choosingProjects = true;
  try {
    const result = await dialog.showOpenDialog({
      title: 'Choose Beads project folders',
      buttonLabel: 'Use selected projects',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (!result.canceled) replaceProjects(await projectsFromPaths(result.filePaths));
  } catch (error) {
    reportError('Unable to select projects', error);
  } finally {
    choosingProjects = false;
  }
}

function createWindow(mode: 'tray' | 'board'): BrowserWindow {
  const isPanel = mode === 'tray';
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const panelWidth = platform === 'macos' || workArea.width < 900 ? 400 : 760;
  const window = new BrowserWindow({
    width: isPanel ? Math.min(panelWidth, workArea.width) : 1200,
    height: isPanel ? Math.min(panelHeight, workArea.height) : 800,
    minWidth: isPanel ? undefined : 600,
    minHeight: isPanel ? undefined : 400,
    show: false,
    frame: !isPanel,
    resizable: !isPanel,
    fullscreenable: !isPanel,
    alwaysOnTop: isPanel,
    skipTaskbar: isPanel,
    backgroundColor: '#fdfbfa',
    title: 'Beads Board',
    webPreferences: {
      preload: join(desktopDir, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (isPanel) {
    panelReady = false;
    window.webContents.on('did-finish-load', () => {
      panelReady = true;
      if (pendingCapture) {
        pendingCapture = false;
        window.webContents.send('beads:quick-capture');
      }
    });
    window.on('blur', () => {
      if (!choosingProjects && window.isVisible()) {
        lastPanelBlur = Date.now();
        window.hide();
      }
    });
    window.on('closed', () => { panel = undefined; panelReady = false; });
  } else {
    window.on('closed', () => { board = undefined; });
  }
  void window.loadURL(`${DOCUMENT}?mode=${mode}&platform=${platform}`).catch((error: unknown) => reportError('Unable to load Beads', error));
  return window;
}

function panelBounds(): Rectangle {
  const anchor = tray?.getBounds();
  const display = anchor && anchor.width && anchor.height
    ? screen.getDisplayMatching(anchor)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const width = Math.min(platform === 'macos' || area.width < 900 ? 400 : 760, area.width);
  const height = Math.min(panelHeight, area.height);
  const usableAnchor = anchor && anchor.width > 0 && anchor.height > 0;
  const center = usableAnchor ? anchor.x + anchor.width / 2 : area.x + area.width - width / 2;
  const below = usableAnchor ? anchor.y + anchor.height : area.y;
  const above = usableAnchor ? anchor.y - height : area.y;
  const y = usableAnchor && anchor.y > area.y + area.height / 2 ? above : below;
  return {
    x: Math.round(Math.max(area.x, Math.min(center - width / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    width,
    height,
  };
}
function showPanel(capture = false): void {
  const window = panel && !panel.isDestroyed() ? panel : (panel = createWindow('tray'));
  if (capture) {
    if (panelReady) window.webContents.send('beads:quick-capture');
    else pendingCapture = true;
  }
  window.setBounds(panelBounds());
  window.show();
  window.focus();
}

function togglePanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide();
  // A tray click can first blur and hide the popover; don't immediately reopen it.
  else if (Date.now() - lastPanelBlur > 250) showPanel();
}

function openBoard(): void {
  if (panel && !panel.isDestroyed()) panel.hide();
  const window = board && !board.isDestroyed() ? board : (board = createWindow('board'));
  window.show();
  window.focus();
}

function installIpc(): void {
  ipcMain.handle('beads:request', async (event, value: unknown) => {
    trusted(event);
    const request = authorizeDesktopRequest(value, projects);
    const result = await handleRequest(request, projects);
    if (!['projects', 'snapshot', 'issue', 'comments'].includes(request.method)) void refreshReadiness();
    return result;
  });
  ipcMain.on('beads:open-board', (event) => { try { trusted(event); openBoard(); } catch { /* reject untrusted sender */ } });
  ipcMain.on('beads:choose-projects', (event) => { try { trusted(event); void chooseProjects(); } catch { /* reject untrusted sender */ } });
  ipcMain.on('beads:hide-tray', (event) => {
    try {
      trusted(event);
      if (panel && !panel.isDestroyed() && event.sender === panel.webContents) panel.hide();
    } catch { /* reject untrusted sender */ }
  });
}

function createTray(): void {
  tray = new Tray(trayImage(readiness, platform === 'macos'));
  const menu = Menu.buildFromTemplate([
    { label: 'Toggle Beads', click: togglePanel },
    { label: 'Open board', click: openBoard },
    { label: shortcutAvailable ? 'Quick capture' : 'Quick capture (global shortcut unavailable)', click: () => showPanel(true) },
    { label: 'Choose projects…', click: () => { void chooseProjects(); } },
    { type: 'separator' },
    { label: 'Quit Beads', role: 'quit' },
  ]);
  tray.on('click', togglePanel);
  if (platform === 'macos') tray.on('right-click', () => tray?.popUpContextMenu(menu));
  else tray.setContextMenu(menu);
  publishReadiness();
}

async function applyLaunch(argv: readonly string[], cwd: string, initial: boolean): Promise<void> {
  try {
    const args = parseLaunchArgs(argv.slice(process.defaultApp ? 2 : 1), cwd);
    if (args.projectPaths.length) replaceProjects(await projectsFromPaths(args.projectPaths));
    if (args.quickCapture) showPanel(true);
    else if (!initial && args.toggle) togglePanel();
    else showPanel();
  } catch (error) {
    reportError('Unable to open Beads', error);
    if (initial) showPanel();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => { /* the tray keeps the app running */ });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    clearInterval(refreshTimer);
  });
  const startup = app.whenReady().then(async () => {
    registerProtocol();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    if (platform === 'macos') app.dock?.hide();
    installIpc();
    try {
      shortcutAvailable = globalShortcut.register(SHORTCUT, () => showPanel(true));
    } catch (error) {
      console.warn('Beads: global shortcut registration failed', error);
    }
    if (!shortcutAvailable) console.warn(`Beads: could not register global shortcut ${SHORTCUT}`);
    createTray();
    await applyLaunch(process.argv, process.cwd(), true);
    refreshTimer = setInterval(() => { void refreshReadiness(); }, 30_000);
  });
  app.on('second-instance', (_event, argv, cwd) => {
    void startup.then(() => applyLaunch(argv, cwd, false)).catch((error: unknown) => reportError('Unable to open Beads', error));
  });
  void startup.catch((error: unknown) => { reportError('Unable to start Beads', error); app.quit(); });
}
