import React, {useRef, useState} from 'react';
import {useVideoStream} from '../hooks/useVideoStream.js';
import {G, mask, nice} from '../api/client.js';
import {useTranslation} from '../i18n/index.jsx';

/* Port của makeTile/paintTile/tileState/statusOf/codecLine/metaOf/noteOf
   (app.js:90-226). Mỗi tile = 1 <video> (do useVideoStream quản lý bên trong một
   div), + badge trạng thái (LIVE/OFFLINE/kết nối), + dòng codec + meta + note.
   Dùng đúng class CSS từ style.css: .tile .t-top .t-id .t-name .t-code
   .badge(.live/.off/.wait) .t-area .t-bot .t-meta .t-note .scan + data-edge. */

const statusOf = (t, state) => {
  if (state === 'live') return {cls: '', txt: t('live.stLive')};
  if (state === 'down') return {cls: 'off', txt: t('live.stOffline')};
  if (state === 'pause') return {cls: 'wait', txt: t('live.stPause')};
  return {cls: 'wait', txt: t('live.stConnecting')};
};

export default function VideoTile({
  name,
  streamUrl,      // ws URL tuyệt đối tới go2rtc (G + api/ws?src=...)
  codecLine,      // chuỗi codec (có thể null)
  meta,           // '1080p · 25fps'
  note,           // '1.2 Mbps · H.264'
  bpsMbps,
  onOpen,
  onFullscreen,
  onMute,
}) {
  const {t} = useTranslation();
  const [state, setState] = useState('wait');
  const [err, setErr] = useState(null);
  const [muted, setMuted] = useState(false);
  const vidRef = useRef(null);

  const {ref: wrapRef} = useVideoStream(
    streamUrl,
    {mode: 'webrtc,mse', media: 'video', visibilityThreshold: 0.01},
    d => {
      setState(d.state);
      if (d.error) setErr(d.error);
      if (d.state === 'live') setErr(null);
    },
  );

  const st = statusOf(t, state);
  const isDown = state === 'down';
  const displayNote = isDown
    ? (err ? String(err).slice(0, 42) : t('live.disconnected'))
    : (state === 'pause' ? t('live.outOfView')
      : [bpsMbps ? bpsMbps.toFixed(1) + ' Mbps' : null, nice(codecLine)].filter(Boolean).join(' · '));

  const toggleMute = e => {
    e.stopPropagation();
    const v = vidRef.current;
    if (v) { v.muted = !v.muted; setMuted(v.muted); }
    onMute?.(name, muted);
  };
  const goFullscreen = e => {
    e.stopPropagation();
    const el = wrapRef.current;
    if (el) {
      document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.();
    }
    onFullscreen?.(name);
  };

  return (
    <div className={'tile' + (isDown ? ' alert' : '')} data-tile data-rim
         style={{minHeight: 120}} onClick={() => onOpen?.(name)}>
      <span data-edge="top" /><span data-edge="right" /><span data-edge="bottom" /><span data-edge="left" />
      <div ref={wrapRef} style={{position: 'absolute', inset: 0}} />
      <div className="t-top">
        <div className="t-id">
          <div className="t-name">{name}</div>
          <div className="t-code">{codecLine || t('live.noCodec')}</div>
        </div>
        <span className={'badge ' + st.cls}><span className="t">{st.txt}</span></span>
      </div>
      <div className="t-bot">
        <span className="t-meta">{meta || '—'}</span>
        <div className="grow" />
        <span className="t-note" style={{color: isDown ? 'var(--err2)' : 'var(--dim)'}}>{displayNote}</span>
      </div>
    </div>
  );
}