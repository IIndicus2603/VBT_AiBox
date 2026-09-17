import React, {useState, useEffect, useRef, useCallback} from 'react';
import {BASE} from './api/client.js';
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

export default function App() {
  const [view, setView] = useState('live');
  const [focus, setFocus] = useState(null); // tên luồng đang mở ở detail
  // Clip đang xem lại: {url, algo} — null = đang xem luồng trực tiếp. Clip chiếu
  // trên chính stage của trang chi tiết (port openVideo/stopVideo ui.js:1012).
  const [clip, setClip] = useState(null);
  const [lang, setLang] = useState('vi');
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

  // Đánh dấu đã đọc: body {} = tất cả, {event_id:[id]} = 1 cảnh báo. Server trả
  // count còn lại -> lấy luôn, không tự trừ (2 tab cùng mở vẫn khớp).
  const markRead = async body => {
    try {
      const j = await (await fetch(BASE + 'api/alarms/read', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      })).json();
      if (j.code === 0) setN(j.count || 0);
    } catch { /* khe */ }
  };

  const go = v => {
    // detail + ai là view phụ của 1 camera cụ thể -> giữ focus, không reset.
    if (v === 'detail' || v === 'ai') {
      setView(v);
    } else {
      setView(v);
      setFocus(null); // closeDetail()
      setClip(null);  // rời trang chi tiết -> thôi xem lại
      // KHÔNG reset unread khi vào tab Nhật ký — badge chỉ giảm khi đã đọc
      // (nút "Đã xem" trong log) hoặc bấm xem từng cảnh báo (openDetail).
    }
  };

  const openDetail = name => {
    setFocus(name);
    setClip(null);   // mở camera = xem luồng trực tiếp, không phải clip cũ
    setView('detail');
  };

  // Bấm "Xem lại" ở nhật ký / lịch sử cảnh báo -> vào detail đúng camera rồi chiếu
  // clip lên stage. Box cắt clip theo khoảng thời gian nên mỗi lần mở là 1 request.
  const openClip = (cam, c) => {
    if (cam) setFocus(cam);
    setClip(c || null);
    setView('detail');
  };

  // Bấm "Cấu hình AI" ở dòng camera (tab Camera) -> vào thẳng view AI của camera đó.
  const openAi = name => {
    setFocus(name);
    setView('ai');
  };

  // Bấm xem 1 cảnh báo (hist-item / dòng nhật ký) -> ghi seen=true cho đúng
  // alarm đó. Không có event_id (alarm cũ box không gửi) thì chỉ trừ tại chỗ.
  const seen = eventId => {
    if (eventId == null) {
      if (unreadRef.current > 0) setN(unreadRef.current - 1);
      return;
    }
    markRead({event_id: [eventId]});
  };

  // Nút "Đã xem" trong tab Nhật ký -> đánh dấu đã đọc toàn bộ.
  const readAll = () => markRead({});

  const Active = VIEWS[view] || LiveView;
  const detailName = focus;

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
        lang={lang}
        onGo={go}
        onLang={() => setLang(l => (l === 'vi' ? 'en' : 'vi'))}
        boxOnline={boxOnline}
        unread={unread}
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
                        onClip={openClip} />}
        </main>
      </div>
    </div>
  );
}