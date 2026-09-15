"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Giao dien duoc phuc vu tu 127.0.0.1:<port> cua CHINH may khach, nen
// location.hostname KHONG phai may chu BE. Bom goc BE that vao day de
// ui/app.js va ui/ai.js biet duong ve (xem hang ORIGIN o hai file do).
// Scheme+host, KHONG cong — ui/app.js va ui/ai.js tu gan :8090 / :1984.
electron_1.contextBridge.exposeInMainWorld('AIBOX_ORIGIN', electron_1.ipcRenderer.sendSync('aibox:origin'));
// URL day du co cong — chi ui/offline.html dung de hien thi va sua.
electron_1.contextBridge.exposeInMainWorld('AIBOX_SERVER', electron_1.ipcRenderer.sendSync('aibox:server'));
// Chi offline.html dung: doi dia chi BE khi khong ket noi duoc.
electron_1.contextBridge.exposeInMainWorld('aiboxSetOrigin', (v) => electron_1.ipcRenderer.invoke('aibox:set-origin', v));
