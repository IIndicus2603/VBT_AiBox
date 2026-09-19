import React, {useState} from 'react';
import VideoTile from './VideoTile.jsx';
import {useTranslation} from '../i18n/index.jsx';

/**
 * TileGrid — port drawGrid (app.js:187-226).
 * Lưới camera theo layout (cols), lấp đầy chiều cao viewport bằng gridTemplateRows
 * = repeat(cols, 1fr). Mỗi tile có min-height:120px (an toàn nếu thiếu chiều cao
 * xác định — IntersectionObserver của player không bao giờ fire). Phân trang khi
 * số luồng vượt cols*cols.
 *
 * Props:
 *  - names: mảng tên luồng đang hiển thị (đã lọc)
 *  - cols:  số cột layout (2|3|4)
 *  - tileOf(name): trả {streamUrl, codecLine, meta, note, bpsMbps} cho từng luồng
 *  - onOpen(name)
 */
export default function TileGrid({names, cols = 3, tileOf, onOpen}) {
  const {t} = useTranslation();
  const size = cols * cols;
  const pages = Math.max(1, Math.ceil(names.length / size));
  const [page, setPage] = useState(0);
  const safePage = Math.min(page, pages - 1);
  const shown = names.slice(safePage * size, safePage * size + size);

  if (!shown.length) {
    return (
      <div id="grid"
           style={{flex: 1, minHeight: 0, display: 'grid', gap: 12,
                   gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`,
                   gridTemplateRows: `repeat(${cols},minmax(0,1fr))`}}>
        <div className="empty">
          <span className="plus">+</span>
          <span className="t">{t('live.noMatchingStream')}</span>
        </div>
      </div>
    );
  }

  return (
    <div id="grid"
         style={{flex: 1, minHeight: 0, display: 'grid', gap: 12,
                 gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`,
                 gridTemplateRows: `repeat(${cols},minmax(0,1fr))`}}>
      {shown.map(n => {
        const t = tileOf(n) || {};
        return (
          <VideoTile
            key={n}
            name={n}
            streamUrl={t.streamUrl}
            codecLine={t.codecLine}
            meta={t.meta}
            note={t.note}
            bpsMbps={t.bpsMbps}
            onOpen={onOpen}
          />
        );
      })}
      {pages > 1 && (
        <div className="pager-overlay" style={{position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6, zIndex: 5}}>
          <button
            className={'pg' + (safePage === 0 ? ' dis' : '')}
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}>‹</button>
          {Array.from({length: pages}, (_, i) => (
            <button key={i} className={'pg' + (i === safePage ? ' on' : '')}
                    onClick={() => setPage(i)}>{i + 1}</button>
          ))}
          <button
            className={'pg' + (safePage >= pages - 1 ? ' dis' : '')}
            disabled={safePage >= pages - 1}
            onClick={() => setPage(safePage + 1)}>›</button>
        </div>
      )}
    </div>
  );
}