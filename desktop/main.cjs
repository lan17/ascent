const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#04030a",
    title: "Deep Mine",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Pointer lock + WebGL work out of the box; no extra flags needed.
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  // External links open in the user's default browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const indexHtml = path.join(__dirname, "dist-web", "index.html");
  win.loadFile(indexHtml).catch((err) => {
    console.error("Failed to load index.html:", err);
  });

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Standard macOS convention: stay alive until Cmd+Q. Quit on other OSes.
  if (process.platform !== "darwin") app.quit();
});
