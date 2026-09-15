import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import http from 'http'
import net from 'net'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Mo hinh: 1 BE + N client.
//   BE   = aibox.py + go2rtc, chay tren MAY CHU (co box trong LAN).
//   FE   = thu muc ui/, dong goi THANG VAO BO CAI nay va duoc phuc vu tu
//          127.0.0.1:<port> cua chinh may khach.
// Khong con backend con o may khach: app nay chi mo giao dien roi goi API ve BE.
//
// Vi sao phai co HTTP server noi bo chu khong dung loadFile: ui/index.html nap
// <script type="module">, ma ES module bi trinh duyet chan khi origin la file://.
// Them nua origin http://127.0.0.1:<port> nam san trong danh sach CORS cua
// aibox.py (_cors), nen khong phai sua gi ben BE.
// ---------------------------------------------------------------------------

const DEV = !app.isPackaged
const UI_DIR = DEV ? path.join(__dirname, '..', '..', 'ui')
                   : path.join(process.resourcesPath, 'ui')

// Dia chi BE khi chua co server.txt. Doi may BE thi SUA FILE, khong build lai:
//   %APPDATA%\unv-smartbox-desktop\server.txt
const DEFAULT_ORIGIN = 'http://192.168.21.34:8090'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}

let win: BrowserWindow | null = null
let origin = DEFAULT_ORIGIN          // URL day du, co cong: de do cong + luu server.txt
let originUi = ''                    // scheme+host KHONG cong: de bom cho giao dien

// ui/app.js va ui/ai.js TU gan ':8090' / ':1984' vao gia tri nay (xem hang ORIGIN o
// hai file do). Bom ca cong vao la thanh '...:8090:8090' -> URL rac, moi loi goi API
// hong. Nen phai cat cong ra truoc khi bom.
function originHost(o: string): string {
  try { const u = new URL(o); return u.protocol + '//' + u.hostname } catch { return o }
}

// ---------------------------------------------------------------- cau hinh BE
const originFile = () => path.join(app.getPath('userData'), 'server.txt')

function readOrigin(): string {
  try {
    const s = fs.readFileSync(originFile(), 'utf8').trim()
    if (s) return s.replace(/\/+$/, '')
  } catch { /* chua co file -> dung mac dinh */ }
  return DEFAULT_ORIGIN
}

function writeOrigin(v: string): boolean {
  let s = String(v || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s/]+(:\d+)?$/.test(s)) return false
  // Nguoi dung hay go thieu cong -> mac dinh 8090, khong thi phep do cong se roi vao 80.
  if (!/:\d+$/.test(s)) s += ':8090'
  fs.writeFileSync(originFile(), s + '\n', 'utf8')
  return true
}

// ------------------------------------------------------------------ http noi bo
function serveUi(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0])
      const file = path.normalize(path.join(UI_DIR, rel === '/' ? 'index.html' : rel))
      // Chan path traversal: /../../... khong duoc thoat khoi UI_DIR.
      if (!file.startsWith(path.normalize(UI_DIR + path.sep))) {
        res.writeHead(403).end(); return
      }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end(); return }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',   // sua ui/ -> mo lai la thay, khong dinh cache
        })
        res.end(buf)
      })
    })
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as net.AddressInfo).port))
  })
}

// BE song chua? Do cong truoc khi mo cua so, de con kip hien trang "nhap dia chi"
// thay vi mot giao dien trang tron (giao dien van load duoc, chi API la chet).
function reachable(o: string, ms = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    let u: URL
    try { u = new URL(o) } catch { resolve(false); return }
    const s = net.createConnection(
      { host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) },
      () => { s.destroy(); resolve(true) })
    s.setTimeout(ms, () => { s.destroy(); resolve(false) })
    s.on('error', () => resolve(false))
  })
}

// ---------------------------------------------------------------------- window
function createWindow(port: number, ok: boolean) {
  win = new BrowserWindow({
    icon: path.join(UI_DIR, 'assets', 'logo.png'),
    // Kiosk: mo full screen, khong thoat duoc bang F11/Esc (dung nghia kiosk).
    // Muon thoat thi Task Manager / dong process. Can dong de hon thi doi
    // kiosk:true -> fullscreen:true (van full screen nhung Alt+F4/Esc thoat duoc).
    // Chi bat o ban dong goi: luc dev ma kiosk thi khong thoat ra de sua duoc.
    kiosk: !DEV,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  })
  Menu.setApplicationMenu(null)
  win.loadURL(`http://127.0.0.1:${port}/${ok ? 'index.html' : 'offline.html'}`)
}

// ------------------------------------------------------------------ IPC
ipcMain.on('aibox:origin', (e) => { e.returnValue = originUi })   // cho ui/app.js, ui/ai.js
ipcMain.on('aibox:server', (e) => { e.returnValue = origin })     // cho ui/offline.html

ipcMain.handle('aibox:set-origin', (_e, v: string) => {
  if (!writeOrigin(v)) return { ok: false, err: 'Dia chi phai dang http://ip:cong' }
  app.relaunch()
  app.exit(0)
  return { ok: true }
})

// ------------------------------------------------------------------ lifecycle
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { app.quit(); win = null }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) app.whenReady().then(boot)
})

async function boot() {
  origin = readOrigin()
  originUi = originHost(origin)
  const ok = await reachable(origin)
  if (!ok) console.warn('[aibox] BE khong tra loi:', origin)
  const port = await serveUi()
  createWindow(port, ok)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
  app.whenReady().then(boot)
}
