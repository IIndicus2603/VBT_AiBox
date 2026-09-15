import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import ModuleNode from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { spawn, execFile } from 'child_process';
import net from 'net';
ModuleNode.Module.createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, '..');
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT, 'public')
    : path.join(process.env.APP_ROOT, 'dist');
let win;
let aiboxProc = null;
const AIBOX_PORT = parseInt(process.env.BRIDGE_PORT || '8090', 10);
// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) {
    app.quit();
}
else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.focus();
        }
    });
}
// ---------- aibox backend child process ----------
function aiboxCommand() {
    if (VITE_DEV_SERVER_URL) {
        // dev: chay truc tiep bang Python, data o ngay canh aibox.py
        const dir = path.join(process.env.APP_ROOT, '..');
        return { cmd: 'py', args: [path.join(dir, 'aibox.py')], cwd: dir };
    }
    // prod: aibox.exe (PyInstaller) trong resources/aibox/, data o userData
    const dir = path.join(process.resourcesPath, 'aibox');
    return { cmd: path.join(dir, 'aibox.exe'), args: [], cwd: dir };
}
function spawnAibox() {
    const { cmd, args, cwd } = aiboxCommand();
    const dataDir = app.getPath('userData');
    aiboxProc = spawn(cmd, args, {
        cwd,
        env: { ...process.env, AIBOX_DATA: dataDir },
        stdio: 'ignore', // ponytail: silent; uncomment when debugging startup
        detached: true, // tao process group rieng de taskkill /T giet ca go2rtc
    });
    aiboxProc.on('error', (err) => {
        console.error('[aibox] spawn failed:', err.message);
    });
    aiboxProc.on('exit', (code) => {
        console.error('[aibox] exited with code', code);
        aiboxProc = null;
    });
}
function killAibox() {
    if (!aiboxProc || aiboxProc.killed)
        return;
    const pid = aiboxProc.pid;
    aiboxProc.kill();
    // Windows khong tu giet con chau (go2rtc.exe) -> taskkill /T giet ca cay.
    // ponytail: chi Windows can; POSIX kill() da giet ca process group.
    if (process.platform === 'win32' && pid) {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => { });
    }
    aiboxProc = null;
}
function waitForPort(port, ms = 8000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + ms;
        const tryConnect = () => {
            const s = net.createConnection({ host: '127.0.0.1', port }, () => {
                s.destroy();
                resolve(true);
            });
            s.on('error', () => {
                if (Date.now() > deadline) {
                    resolve(false);
                    return;
                }
                setTimeout(tryConnect, 200);
            });
        };
        tryConnect();
    });
}
// ---------- window ----------
function createWindow() {
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC, 'logo.svg'),
        // Kiosk: mở full screen, không thoát được bằng F11/Esc (đúng nghĩa kiosk).
        // Muốn thoát thì Task Manager / đóng process. Nếu cần đóng dễ hơn, đổi
        // kiosk:true -> fullscreen:true (vẫn full screen nhưng Alt+F4/Esc thoát được).
        kiosk: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'),
            webSecurity: false,
            allowRunningInsecureContent: true,
        },
    });
    Menu.setApplicationMenu(null);
    if (VITE_DEV_SERVER_URL) {
        win.webContents.openDevTools();
        win.loadURL(VITE_DEV_SERVER_URL);
    }
    else {
        // KHONG loadFile(dist/index.html): file:// origin bi go2rtc WebSocket reject.
        // aibox.py serve UI tai :8090 — Origin la http://127.0.0.1:8090, go2rtc cho phep.
        win.loadURL(`http://127.0.0.1:${AIBOX_PORT}`);
    }
}
// ---------- app lifecycle ----------
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        killAibox();
        app.quit();
        win = null;
    }
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
app.on('before-quit', killAibox);
app.whenReady().then(async () => {
    spawnAibox();
    const ready = await waitForPort(AIBOX_PORT);
    if (!ready) {
        console.warn('[aibox] port', AIBOX_PORT, 'not ready after timeout, loading anyway');
    }
    createWindow();
});
// ---------- IPC handlers ----------
function confPath() {
    return path.join(app.getPath('userData'), 'aibox.conf.json');
}
ipcMain.handle('config:get', async () => {
    try {
        const raw = await import('fs').then(f => f.readFileSync(confPath(), 'utf-8'));
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
});
ipcMain.handle('config:save', async (_e, data) => {
    const { writeFileSync } = await import('fs');
    writeFileSync(confPath(), JSON.stringify(data, null, 1), 'utf-8');
    return true;
});
