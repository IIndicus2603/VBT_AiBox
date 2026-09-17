import React, {useEffect, useState} from 'react';
import Dock from './Dock.jsx';
import {hms} from '../api/client.js';
// logo-app.png / logo.png co nen dac (12,17,25) nung san trong file — 0% alpha,
// nen luon lo nen den tren thanh header. Chi ban -transparent nay co alpha that.
import logoApp from '../assets/logo-diamond-transparent.png';

/**
 * Header — port index.html:27-112 + đồng hồ tick (ui.js:527-539).
 * Gồm: logo + brand, dock điều hướng, lang switch (VI/EN), trạng thái box + clock.
 */
export default function Header({view, onGo, onLang, boxOnline, unread}) {
  const [clock, setClock] = useState('--:--:--');

  useEffect(() => {
    const tick = () => setClock(hms(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header data-glass
            style={{position: 'relative', zIndex: 30, flex: 'none', display: 'flex', alignItems: 'center',
                    gap: 18, height: 82, margin: 0, padding: '0 28px', borderRadius: '0 0 20px 20px',
                    background: 'linear-gradient(168deg,rgba(255,255,255,.13),rgba(255,255,255,.05) 48%,rgba(213,194,149,.06))',
                    border: '1px solid rgba(255,255,255,.15)', borderTop: 'none',
                    boxShadow: 'inset 0 -1px 0 rgba(255,255,255,.05), 0 18px 38px rgba(0,0,0,.5)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, overflow: 'hidden'}}>
        <div className="logo" style={{flex: 'none', width: 44, height: 44}}>
          <img src={logoApp} alt="logo" style={{width: '100%', height: '100%', objectFit: 'contain'}} />
        </div>
        <span className="brand" style={{flex: 'none', whiteSpace: 'nowrap'}}>Vibotics</span>
        <span className="brand-sub" style={{flex: 'none', whiteSpace: 'nowrap'}}>AI Smart Box</span>
      </div>

      <div style={{flex: 1}} />

      <Dock view={view} onGo={onGo} unread={unread} />

      <span data-langswitch data-lang="vi" title="Đổi ngôn ngữ" style={{cursor: 'pointer'}}
            onClick={onLang}>
        <span data-langthumb />
        <span data-l="vi">VI</span>
        <span data-l="en">EN</span>
      </span>

      <span className="h-vr" />

      <div className="hstat">
        <div className="hstat-r">
          <div style={{flex: 'none', display: 'flex', alignItems: 'center', gap: 7}}>
            <span className="h-online" style={{color: boxOnline === false ? 'var(--err)' : undefined}}>
              {boxOnline === false ? 'ngoại tuyến' : 'trực tuyến'}
            </span>
          </div>
          <span className="h-div" />
          <span className="h-clock" id="clock">{clock}</span>
        </div>
        <div style={{flex: 'none', maxWidth: '100%', display: 'inline-flex', alignItems: 'center', gap: 7, height: 22, minWidth: 0, overflow: 'hidden'}}>
          <span className="h-box" style={{whiteSpace: 'nowrap'}}>AI BOX …</span>
        </div>
      </div>
    </header>
  );
}