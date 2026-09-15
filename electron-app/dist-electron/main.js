import { app as t, BrowserWindow as p, ipcMain as f, Menu as _ } from "electron";
import g from "module";
import { fileURLToPath as T } from "url";
import o from "path";
import { spawn as y, execFile as O } from "child_process";
import h from "net";
g.Module.createRequire(import.meta.url);
const m = o.dirname(T(import.meta.url));
process.env.APP_ROOT = o.join(m, "..");
const c = process.env.VITE_DEV_SERVER_URL, k = o.join(process.env.APP_ROOT, "dist-electron"), L = o.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = c ? o.join(process.env.APP_ROOT, "public") : o.join(process.env.APP_ROOT, "dist");
let i, r = null;
const u = parseInt(process.env.BRIDGE_PORT || "8090", 10);
t.requestSingleInstanceLock() ? t.on("second-instance", () => {
  i && (i.isMinimized() && i.restore(), i.focus());
}) : t.quit();
function b() {
  if (c) {
    const n = o.join(process.env.APP_ROOT, "..");
    return { cmd: "py", args: [o.join(n, "aibox.py")], cwd: n };
  }
  const e = o.join(process.resourcesPath, "aibox");
  return { cmd: o.join(e, "aibox.exe"), args: [], cwd: e };
}
function x() {
  const { cmd: e, args: n, cwd: s } = b(), l = t.getPath("userData");
  r = y(e, n, {
    cwd: s,
    env: { ...process.env, AIBOX_DATA: l },
    stdio: "ignore",
    // ponytail: silent; uncomment when debugging startup
    detached: !0
    // tao process group rieng de taskkill /T giet ca go2rtc
  }), r.on("error", (a) => {
    console.error("[aibox] spawn failed:", a.message);
  }), r.on("exit", (a) => {
    console.error("[aibox] exited with code", a), r = null;
  });
}
function w() {
  if (!r || r.killed) return;
  const e = r.pid;
  r.kill(), process.platform === "win32" && e && O("taskkill", ["/PID", String(e), "/T", "/F"], () => {
  }), r = null;
}
function I(e, n = 8e3) {
  return new Promise((s) => {
    const l = Date.now() + n, a = () => {
      const d = h.createConnection({ host: "127.0.0.1", port: e }, () => {
        d.destroy(), s(!0);
      });
      d.on("error", () => {
        if (Date.now() > l) {
          s(!1);
          return;
        }
        setTimeout(a, 200);
      });
    };
    a();
  });
}
function P() {
  i = new p({
    icon: o.join(process.env.VITE_PUBLIC, "logo.svg"),
    // Kiosk: mở full screen, không thoát được bằng F11/Esc (đúng nghĩa kiosk).
    // Muốn thoát thì Task Manager / đóng process. Nếu cần đóng dễ hơn, đổi
    // kiosk:true -> fullscreen:true (vẫn full screen nhưng Alt+F4/Esc thoát được).
    kiosk: !0,
    autoHideMenuBar: !0,
    webPreferences: {
      preload: o.join(m, "preload.mjs"),
      webSecurity: !1,
      allowRunningInsecureContent: !0
    }
  }), _.setApplicationMenu(null), c ? (i.webContents.openDevTools(), i.loadURL(c)) : i.loadURL(`http://127.0.0.1:${u}`);
}
t.on("window-all-closed", () => {
  process.platform !== "darwin" && (w(), t.quit(), i = null);
});
t.on("activate", () => {
  p.getAllWindows().length === 0 && P();
});
t.on("before-quit", w);
t.whenReady().then(async () => {
  x(), await I(u) || console.warn("[aibox] port", u, "not ready after timeout, loading anyway"), P();
});
function R() {
  return o.join(t.getPath("userData"), "aibox.conf.json");
}
f.handle("config:get", async () => {
  try {
    const e = await import("fs").then((n) => n.readFileSync(R(), "utf-8"));
    return JSON.parse(e);
  } catch {
    return {};
  }
});
f.handle("config:save", async (e, n) => {
  const { writeFileSync: s } = await import("fs");
  return s(R(), JSON.stringify(n, null, 1), "utf-8"), !0;
});
export {
  k as MAIN_DIST,
  L as RENDERER_DIST,
  c as VITE_DEV_SERVER_URL
};
