import {useEffect} from 'react';

/**
 * SSE hook — subscribe vào /events của aibox.py.
 * Mở một EventSource('/events') (được Vite proxy tới 8090), gọi onEvent(msg)
 * cho mỗi message, đóng + dọn dẹp khi unmount.
 *
 * @param {(msg: object) => void} onEvent callback nhận JSON message từ SSE.
 * @param {Array} deps tuỳ chọn — truyền nếu component muốn re-subscribe.
 */
export default function useEvents(onEvent, deps = []) {
  useEffect(() => {
    if (typeof onEvent !== 'function') return undefined;
    const es = new EventSource('/events');
    es.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { msg = e.data; }
      onEvent(msg);
    };
    return () => { es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}