const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'StockFlow - Enterprise Warehouse & Inventory ERP',
    icon: path.join(__dirname, '../dist/assets/stockflow_logo_1783944743908-CgKOd-om.jpg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  // Remove default menu bar for clean app experience
  Menu.setApplicationMenu(null);

  // Load the built Vite index.html file
  const indexPath = path.join(__dirname, '../dist/index.html');
  mainWindow.loadFile(indexPath).catch(() => {
    // If not yet built, try loading dev server
    mainWindow.loadURL('http://localhost:3000');
  });

  mainWindow.maximize();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
