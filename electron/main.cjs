// Optional desktop wrapper for Windows 11.
//   npm i -D electron
//   npm run build && npm run desktop
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

// Ask Windows to run the renderer on the discrete GPU (RTX 4070) and let it
// use the full WebGL2 feature set.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.disableDomainBlockingFor3DAPIs();

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#0c0c0e',
    autoHideMenuBar: true,
    title: 'Mochi — a cat simulator',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
