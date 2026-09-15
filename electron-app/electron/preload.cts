import { contextBridge, ipcRenderer } from 'electron'

// Giao dien duoc phuc vu tu 127.0.0.1:<port> cua CHINH may khach, nen
// location.hostname KHONG phai may chu BE. Bom goc BE that vao day de
// ui/app.js va ui/ai.js biet duong ve (xem hang ORIGIN o hai file do).
// Scheme+host, KHONG cong — ui/app.js va ui/ai.js tu gan :8090 / :1984.
contextBridge.exposeInMainWorld('AIBOX_ORIGIN', ipcRenderer.sendSync('aibox:origin'))
// URL day du co cong — chi ui/offline.html dung de hien thi va sua.
contextBridge.exposeInMainWorld('AIBOX_SERVER', ipcRenderer.sendSync('aibox:server'))

// Chi offline.html dung: doi dia chi BE khi khong ket noi duoc.
contextBridge.exposeInMainWorld('aiboxSetOrigin', (v: string) =>
  ipcRenderer.invoke('aibox:set-origin', v))
