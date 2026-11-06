const { app, BrowserWindow, webFrameMain, ipcMain, screen } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  fs.writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), ...patch }));
}

// YouTube refuses to play embeds without a real HTTP origin (error 153 on file://).
function startServer() {
  const html = fs.readFileSync(path.join(__dirname, 'player.html'), 'utf8');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const PLAYER_CSS = `
  .ytp-chrome-top, .ytp-gradient-top, .ytp-gradient-bottom, .ytp-chrome-bottom,
  .ytp-pause-overlay, .ytp-watermark, .ytp-ce-element, .ytp-cards-teaser,
  .ytp-cards-button, .ytp-endscreen-content, .ytp-impression-link,
  .ytp-paid-content-overlay, .ytp-youtube-button, .ytp-title, .ytp-show-cards-title,
  .ytp-large-play-button, .ytp-contextmenu, .ytp-error-content-wrap-subreason,
  .iv-branding, .annotation, .ytp-suggested-action, .ytp-overflow-button,
  .ytp-chrome-top-buttons, .ytp-player-content.ytp-iv-player-content,
  .ytp-tooltip, .ytp-bezel, .ytp-bezel-text-wrapper {
    display: none !important;
  }
  html, body, #player, .html5-video-player { background: #000 !important; cursor: none !important; }
`;

const contains = (outer, r) =>
  r.x >= outer.x && r.y >= outer.y &&
  r.x + r.width <= outer.x + outer.width && r.y + r.height <= outer.y + outer.height;

const intersects = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

function moveOntoDisplay(win, display) {
  const area = display.workArea;
  const frame = win.getBounds();
  const content = win.getContentBounds();
  const chrome = frame.height - content.height;
  const scale = Math.min(1, area.width / frame.width, (area.height - chrome) / content.height);
  const width = Math.round(content.width * scale);
  const height = Math.round(content.height * scale) + chrome;
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  win.setBounds({
    x: clamp(frame.x, area.x, area.x + area.width - width),
    y: clamp(frame.y, area.y, area.y + area.height - height),
    width,
    height,
  });
}

// macOS shows a window that straddles displays on the one under the cursor, but full screen
// and zoom use the display holding most of its area, so the window would jump screens.
function settleOnCursorDisplay(win) {
  if (win.isFullScreen()) return;
  const bounds = win.getBounds();
  const target = cursorDisplay();
  if (contains(target.bounds, bounds) || !intersects(target.bounds, bounds)) return;
  moveOntoDisplay(win, target);
}

function toggleFullScreen(win, { fromPointer = false } = {}) {
  if (!win.isFullScreen() && fromPointer) {
    const target = cursorDisplay();
    if (!contains(target.bounds, win.getBounds())) moveOntoDisplay(win, target);
  }
  win.setFullScreen(!win.isFullScreen());
}

async function createWindow() {
  const port = await startServer();

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true,
    minWidth: 320,
    minHeight: 180,
    title: 'ytbla',
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setAspectRatio(16 / 9);

  win.webContents.on('did-frame-finish-load', (_e, isMainFrame, processId, routingId) => {
    if (isMainFrame) return;
    const frame = webFrameMain.fromId(processId, routingId);
    if (!frame || !frame.url.includes('youtube')) return;
    frame
      .executeJavaScript(
        `(() => {
          const s = document.createElement('style');
          s.textContent = ${JSON.stringify(PLAYER_CSS)};
          document.documentElement.appendChild(s);
        })()`
      )
      .catch(() => {});
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.meta || input.control || input.alt) return;
    if (pickerOpen.has(win.webContents.id)) return;
    if (input.key === 'Escape' && win.isFullScreen()) {
      event.preventDefault();
      win.setFullScreen(false);
    } else if (input.key === 'f' || input.key === 'F') {
      event.preventDefault();
      toggleFullScreen(win);
    }
  });

  let settleTimer;
  win.on('moved', () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => !win.isDestroyed() && settleOnCursorDisplay(win), 300);
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.once('ready-to-show', () => win.show());
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

ipcMain.on('toggle-fullscreen', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) toggleFullScreen(win, { fromPointer: true });
});

ipcMain.on('get-settings', (e) => {
  e.returnValue = readSettings();
});

ipcMain.on('save-settings', (_e, patch) => writeSettings(patch));

// The picker has a text field, so window-level shortcuts must not swallow typed keys.
const pickerOpen = new Set();
ipcMain.on('picker-open', (e, open) => {
  open ? pickerOpen.add(e.sender.id) : pickerOpen.delete(e.sender.id);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
