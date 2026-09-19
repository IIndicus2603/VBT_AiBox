import React, {useState, useEffect, useRef, useCallback} from 'react';
import {BASE, evKey} from './api/client.js';
import Header from './components/Header.jsx';
import LiveView from './views/LiveView.jsx';
import DetailView from './views/DetailView.jsx';
import LogView from './views/LogView.jsx';
import LibView from './views/LibView.jsx';
import SearchView from './views/SearchView.jsx';
import CamView from './views/CamView.jsx';
import AiView from './views/AiView.jsx';
import ConfigView from './views/ConfigView.jsx';
import useEvents from './api/useEvents.js';
import { LanguageProvider, useTranslation } from './i18n/index.jsx';

/**
 * App shell — port index.html:18-116 (aurora + header + body) và go() app.js:336.
 * App state giữ view hiện tại (live|detail|log|lib|search|cam|ai|cfg) + render
 * Header + Dock + view đang active. Các view con là placeholder (agent song song
 * sẽ điền đầy đủ); Header/Dock/live-view đã có scaffold thật.
 */
const VIEWS = {
  live: LiveView,
  detail: DetailView,
  log: LogView,
  lib: LibView,
  search: SearchView,
  cam: CamView,
  ai: AiView,
  cfg: ConfigView,
};

function AppInner() {
  const [view, setView] = useState('live');
  const [focus, setFocus] = useState(null); // tên luồng đang mở ở detail
  // Clip đang xem lại: {url, algo} — null = đang xem luồng trực tiếp. Clip chiếu
  // trên chính stage của trang chi tiết (port openVideo/stopVideo ui.js:1012).
  const [clip, setClip] = useState(null);
  const { lang, setLang } = useTranslation();
  const [boxOnline] = useState(true);
  // Badge cảnh báo chưa đọc trên toàn app (icon Nhật ký) — port #navUnread.
  // Nguồn sự thật là Mongo (alarm.seen), không phải bộ đếm trong RAM: số này
  // sống qua refresh và giống nhau ở mọi máy đang mở app.
  const [unread, setUnread] = useState(0);
  const unreadRef = useRef(0);
  const setN = n => { unreadRef.current = n; setUnread(n); };

  // Số chưa đọc lúc mở app + mỗi lần đánh dấu đã đọc (server trả count mới).
  const loadUnread = useCallback(async () => {
    try {
      const j = await (await fetch(BASE + 'api/alarms/unread-count')).json();
      if (j.code === 0) setN(j.count || 0);
    } catch { /* backend chưa lên -> giữ số cũ */ }
  }, []);
  useEffect(() => { loadUnread(); }, [loadUnread]);

  // Alarm mới qua SSE: backend đã ghi seen=false rồi, ở đây chỉ +1 cho kịp thời
  // (khỏi gọi lại count mỗi alarm — box đẩy vài cái/giây).
  useEvents(ev => {
    if (!ev || ev.kind === 'video') return;
    if (ev.algo_model === 'AreaRuleData') return;
    if (ev.type == null || ev.type === 2 || ev.type === 6 || ev.type === 7) return;
    setN(unreadRef.current + 1);
  }, []);

  const readAll = async () => {
    try {
      await fetch(BASE + 'api/alarms/mark-read-all', {method: 'POST'});
      setN(0);
    } catch { setN(0); }
  };

  const seen = ev => {
    if (!ev || ev.seen) return;
    fetch(BASE + 'api/alarms/mark-read', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: evKey(ev)}),
    }).then(r => r.json()).then(j => {
      if (j && typeof j.count === 'number') setN(j.count);
    }).catch(() => {});
  };

  const go = (targetView, opts) => {
    if (targetView) setView(targetView);
    if (opts?.focus !== undefined) setFocus(opts.focus);
    if (opts?.cam !== undefined) setFocus(opts.cam);
  };

  const openDetail = camName => {
    setClip(null);
    setFocus(camName || null);
    setView('detail');
  };

  const openAi = camName => {
    setFocus(camName || null);
    setView('ai');
  };

  // Bấm 1 thẻ trong bảng thông báo (Dock) -> vào Nhật ký + highlight đúng sự kiện.
  const [hlEvent, setHlEvent] = useState(null);
  const goToEvent = ev => {
    if (!ev) return;
    const isClip = Boolean(ev.image_path && String(ev.image_path).includes('.mp4'));
    if (isClip && ev.cam_id) {
      openDetail(ev.cam_id);
      setClip({url: BASE + 'aibox/picture?' + String(ev.image_path).split('?')[1], algo: ev.algo_name});
    } else {
      setHlEvent(ev);
      setView('log');
    }
  };

  // Bấm "Xem lại" ở nhật ký / lịch sử cảnh báo -> vào detail đúng camera rồi chiếu
  // clip lên stage. Box cắt clip theo khoảng thời gian nên mỗi lần mở là 1 request.
  const openClip = (ev, fallbackCam) => {
    if (!ev || !ev.image_path) return;
    const camName = ev.cam_id || fallbackCam || focus;
    if (camName) setFocus(camName);
    const q = String(ev.image_path).split('?')[1];
    setClip({url: BASE + 'aibox/picture?' + (q || ''), algo: ev.algo_name || ev.algo_model});
    setView('detail');
  };

  const Active = VIEWS[view] || LiveView;
  const detailName = focus || 'ch1';

  return (
    <div id="app"
         style={{position: 'relative', height: '100vh', display: 'flex', flexDirection: 'column',
                 overflow: 'hidden',
                 background: 'radial-gradient(140% 120% at 18% -10%, #16181d 0%, #0b0c0f 55%, #08090b 100%)'}}>
      <div className="aurora a" />
      <div className="aurora b" />
      <div className="aurora c" />
      <div className="aurora vig" />

      <Header
        view={view}
        focus={focus}
        lang={lang}
        onGo={go}
        onLang={() => setLang(lang === 'vi' ? 'en' : 'vi')}
        boxOnline={boxOnline}
        unread={unread}
        onEvent={goToEvent}
        onReadAll={readAll}
      />

      <div className="body" style={{position: 'relative', zIndex: 1, flex: 1, minHeight: 0, display: 'flex'}}>
        <main style={{flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0}}>
          {view === 'detail'
            ? <DetailView name={detailName} go={go} focus={detailName}
                          clip={clip} onClipClose={() => setClip(null)}
                          onPlayClip={setClip} />
            : view === 'live'
              ? <LiveView onOpen={openDetail} onSeen={seen} unread={unread}
                          onClip={openClip} />
              : <Active onOpen={openDetail} onAi={openAi} go={go} focus={focus}
                        onReadAll={readAll} onSeen={seen} unread={unread}
                        onClip={openClip} highlight={hlEvent}
                        onHighlightDone={() => setHlEvent(null)} />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  );
}