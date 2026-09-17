import React from 'react';

/**
 * Dock — port của <nav data-dock> từ index.html:27-85.
 * Có 6 nút gốc (theo đúng thứ tự & nhãn tiếng Việt của nav gốc):
 *   live, log, lib, search, cam, cfg.
 * 'detail' và 'ai' là 2 view phụ (không có nút riêng — go() map detail→live,
 * ai→cfg). Nút 'on' được đánh dấu theo view hiện tại.
 */
const ITEMS = [
  {go: 'live', title: 'Live', label: 'Live', icon: <path d="M4 10.5 12 4l8 6.5V20H4zM10 20v-6h4v6" />},
  {go: 'log', title: 'Nhật ký', label: 'Nhật ký', icon: <path d="M12 7v5l3.5 2M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16" />},
  {go: 'lib', title: 'Thư viện', label: 'Thư viện', icon: <path d="M4 6.5h16v12H4zM4 10.5h16M9 10.5v8" />},
  {go: 'search', title: 'Tìm kiếm nâng cao', label: 'Tìm kiếm', icon: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M21 21l-4.5-4.5" />},
  {go: 'cam', title: 'Camera', label: 'Camera', icon: <path d="M3.5 7.5h11v9h-11zM14.5 11l6-3v8l-6-3" />},
  {go: 'cfg', title: 'Cấu hình', label: 'Cấu hình', icon: <path d="M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2M19 12a7 7 0 0 0-.1-1l1.6-1.3-1.7-2.9-1.9.8a7 7 0 0 0-1.7-1L14.8 4H9.2l-.4 2a7 7 0 0 0-1.7 1l-1.9-.8-1.7 2.9L5.1 11a7 7 0 0 0 0 2l-1.6 1.3 1.7 2.9 1.9-.8a7 7 0 0 0 1.7 1l.4 2h5.6l.4-2a7 7 0 0 0 1.7-1l1.9.8 1.7-2.9-1.6-1.3a7 7 0 0 0 .1-1" />},
];

/** go() map: view 'detail' sáng nút 'live', view 'ai' sáng nút 'cfg'. */
const activeOf = view =>
  view === 'detail' ? 'live' : view === 'ai' ? 'cfg' : view;

export default function Dock({view, onGo, unread}) {
  const active = activeOf(view);
  return (
    <nav data-dock
         style={{position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', gap: 0,
                 padding: 5, borderRadius: 26, transition: 'border-radius .26s ease',
                 background: 'linear-gradient(168deg,rgba(255,255,255,.10) 0%,rgba(213,194,149,.12) 48%,rgba(213,194,149,.20) 100%)',
                 border: '1px solid rgba(213,194,149,.34)',
                 boxShadow: 'inset 0 1px 0 rgba(255,255,255,.30),0 8px 22px rgba(0,0,0,.35)'}}>
      <span data-dockrail />
      {ITEMS.map(it => (
        <button key={it.go} data-go={it.go} data-dockitem
                title={it.title} className={active === it.go ? 'on' : ''}
                style={{flex: 'none', position: 'relative'}}
                onClick={() => onGo(it.go)}>
          <span data-dock-icon>
            <span data-dockgold />
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"
                 strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{it.icon}</svg>
            {/* Badge cảnh báo chưa đọc — nằm TRONG [data-dock-icon] (đã position:relative)
                nên neo vào góc ICON, không phải góc <button> 46x42. */}
            {it.go === 'log' && unread > 0 && (
              <span className="badge" id="navUnread">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </span>
          <span data-dock-label>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}