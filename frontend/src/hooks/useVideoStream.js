import {useEffect, useRef, useState, useCallback} from 'react';
// video-stream.js tự customElements.define('video-stream') (VideoStream extends
// VideoRTC). Phải dùng createElement chứ KHÔNG new VideoRTC(): HTMLElement
// không cho `new` trực tiếp -> "Illegal constructor" -> màn hình đen.
import '../vendor/video-stream.js';

/**
 * useVideoStream — port video-stream.js (VideoStream extends VideoRTC) cho React.
 *
 * VideoRTC là một HTMLElement tự append <video> vào chính nó. Trong React ta tạo
 * một instance VideoRTC, đưa element của nó vào một <div ref>, và để player quản
 * lý thẻ <video> bên trong — y như <video-stream> làm với innerHTML.
 *
 * Phần port: stall watchdog 6s (requestVideoFrameCallback hoặc fallback interval),
 * maxRetry 3, state machine connecting/live/retry/error/idle. State được đẩy ra
 * ngoài qua callback (tương đương CustomEvent('state')) — hook trả `state`.
 *
 * @param {string} src URL ws tuyệt đối tới go2rtc (vd G + 'api/ws?src=chN').
 * @param {object} [opts] mode, media, visibilityThreshold, stallTimeout, maxRetry.
 * @param {(detail:object)=>void} [onState] callback nhận {state, mode, error, attempt}.
 */
export function useVideoStream(src, opts = {}, onState) {
  const wrapRef = useRef(null);       // div chứa player
  const playerRef = useRef(null);     // <video-stream> instance (VideoStream)
  const srcRef = useRef(src);
  const optsRef = useRef(opts);
  const onStateRef = useRef(onState);
  const [state, setState] = useState('idle');
  // Tăng -> remount player hoàn toàn (WS/consumer mới). Đây là "F5 tự động": khi
  // camera OFFLINE kéo dài, go2rtc không tự mở lại producer cho consumer cũ, chỉ có
  // kết nối mới hoàn toàn (giống remount) mới bắt go2rtc khởi động lại nguồn RTSP.
  const [gen, setGen] = useState(0);
  const restartTRef = useRef(0);      // timer auto-reload (0 = chưa đặt)

  srcRef.current = src;
  optsRef.current = opts;
  onStateRef.current = onState;

  const emit = useCallback((s, extra) => {
    const detail = {state: s, ...extra};
    setState(s);
    onStateRef.current?.(detail);
    // Auto-reload OFFLINE kéo dài: error đầu tiên đặt timer `restartDelay` (mặc định
    // 30s), KHÔNG reset khi vòng reconnect 15s của video-rtc lại error, để sau 30s
    // liên tục offline thì remount. Có hình ('live') hoặc remount thì xoá timer.
    if (s === 'error' && !restartTRef.current) {
      restartTRef.current = setTimeout(() => {
        restartTRef.current = 0;
        setGen(g => g + 1);
      }, optsRef.current.restartDelay ?? 30000);
    } else if (s === 'live' && restartTRef.current) {
      clearTimeout(restartTRef.current);
      restartTRef.current = 0;
    }
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    const p = document.createElement('video-stream');
    p.mode = opts.mode || 'webrtc,mse';
    p.media = opts.media || 'video';
    if (opts.visibilityThreshold != null) p.visibilityThreshold = opts.visibilityThreshold;
    if (opts.visibilityCheck != null) p.visibilityCheck = opts.visibilityCheck;
    p.maxRetry = opts.maxRetry || 3;
    p.stallTimeout = opts.stallTimeout || 6000;

    // Chống 'chưa có hình' -> tránh emit error trước frame đầu.
    let stallOn = false;
    let stallTO = 0;
    let stallInt = 0;
    let stallLast = -1;
    let stallAt = 0;
    let retries = 0;
    // Connect timeout RIÊNG (mặc định 20s): canh "connecting quá lâu" (WS mở nhưng
    // chưa có frame). KHÔNG dùng stallTimeout 6s cho connecting — WebRTC/MSE negl
    // của một số camera (Dahua/Imou) mất >6s, đóng WS sớm sẽ phá phiên (đã đo: camera
    // tốt bị kẹt ĐANG KẾT NỐI). 20s cho đủ negl; camera chết vẫn thoát -> error.
    let connectTO = 0;
    let connectOn = false;

    const stallReset = () => {
      clearTimeout(stallTO);
      stallTO = setTimeout(stallDetect, p.stallTimeout);
    };
    const frameTick = () => {
      if (!stallOn) return;
      stallReset();
      if (p.video.requestVideoFrameCallback) p.video.requestVideoFrameCallback(frameTick);
    };
    const stallCheck = () => {
      const t = p.video.currentTime;
      if (t !== stallLast) { stallLast = t; stallAt = performance.now(); return; }
      if (performance.now() - stallAt > p.stallTimeout) stallDetect();
    };
    const stallDetect = () => {
      if (!stallOn) return;
      console.warn('[stream] stalled ' + (p.stallTimeout / 1000) + 's, reconnecting');
      if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.close();
      stallReset();
    };
    const connectDetect = () => {
      connectOn = false;
      if (!p.ws || p.ws.readyState !== WebSocket.OPEN) return;
      console.warn('[stream] connect timeout ' + ((opts.connectTimeout ?? 20000) / 1000) + 's, reconnecting');
      p.ws.close();
    };
    const armConnect = () => {
      if (connectOn) return;
      connectOn = true;
      clearTimeout(connectTO);
      connectTO = setTimeout(connectDetect, opts.connectTimeout ?? 20000);
    };
    const disarmConnect = () => {
      connectOn = false;
      clearTimeout(connectTO);
      connectTO = 0;
    };
    const armStall = () => {
      if (stallOn) return;
      stallOn = true;
      if (p.video.requestVideoFrameCallback) {
        p.video.requestVideoFrameCallback(frameTick);
      } else {
        stallLast = p.video.currentTime;
        stallAt = performance.now();
        stallInt = setInterval(stallCheck, 1000);
      }
      stallReset();
    };
    const stallDisarm = () => {
      stallOn = false;
      clearTimeout(stallTO);
      if (stallInt) { clearInterval(stallInt); stallInt = 0; }
    };

    // overrides của VideoStream trên instance cụ thể
    const origOninit = p.oninit.bind(p);
    p.oninit = () => {
      origOninit();
      p.video.controls = false;
      p.video.addEventListener('resize', () => {
        if (p.video.videoHeight) {
          retries = 0;
          disarmConnect();   // đã có hình -> hết giai đoạn connecting
          emit('live', {mode: p.playMode});
          armStall();
        }
      });
    };
    const origOnconnect = p.onconnect.bind(p);
    p.onconnect = () => {
      const ok = origOnconnect();
      if (ok) { emit('connecting'); armConnect(); }
      return ok;
    };
    const origOnopen = p.onopen.bind(p);
    p.onopen = () => {
      const ok = origOnopen();
      p.onmessage['ui'] = msg => {
        if (msg.type === 'error') emit('error', {error: msg.value});
        else if (['mse', 'hls', 'mp4', 'mjpeg'].includes(msg.type)) p.playMode = msg.type.toUpperCase();
      };
      return ok;
    };
    const origOnclose = p.onclose.bind(p);
    p.onclose = () => {
      const retry = origOnclose();
      if (retry && p.pcState !== WebSocket.OPEN) {
        disarmConnect();    // WS đóng, chờ reconnect -> tạm dừng connect timeout
        stallDisarm();      // WS đóng -> tạm dừng canh treo
        if (++retries > p.maxRetry) {
          emit('error', {error: 'Thử lại ' + p.maxRetry + ' lần không được'});
        } else {
          emit('retry', {attempt: retries});
        }
      }
      return retry;
    };
    const origOnpcvideo = p.onpcvideo.bind(p);
    p.onpcvideo = video => {
      origOnpcvideo(video);
      if (p.pcState !== WebSocket.CLOSED) p.playMode = 'RTC';
    };
    const origOndisconnect = p.ondisconnect.bind(p);
    p.ondisconnect = () => {
      origOndisconnect();
      p.playMode = null;
      retries = 0;
      disarmConnect();
      stallDisarm();
      emit('idle');
    };

    p.addEventListener('state', e => {
      emit(e.detail.state, e.detail);
    });

    wrap.appendChild(p);
    playerRef.current = p;

    // set src (http->ws được VideoRTC.src setter tự xử lý; nhưng ta truyền ws sẵn).
    if (srcRef.current) p.src = srcRef.current;

    return () => {
      stallDisarm();
      disarmConnect();
      clearTimeout(restartTRef.current);
      restartTRef.current = 0;
      p.remove();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, gen]);

  return {ref: wrapRef, state, playMode: state};
}