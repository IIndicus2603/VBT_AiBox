import React, {useEffect, useRef, useState} from 'react';
import Dock from './Dock.jsx';
import {hms, BASE} from '../api/client.js';
// logo-app.png / logo.png co nen dac (12,17,25) nung san trong file — 0% alpha,
// nen luon lo nen den tren thanh header. Chi ban -transparent nay co alpha that.
import logoApp from '../assets/logo-diamond-transparent.png';

/**
 * Header — port index.html:27-112 + đồng hồ tick (ui.js:527-539).
 * Gồm: logo + brand, dock điều hướng, lang switch (VI/EN), trạng thái box + clock.
 */
const VIEW_TITLES = {
  vi: {
    live: 'XEM TRỰC TIẾP',
    detail: 'CHI TIẾT CAMERA',
    log: 'NHẬT KÝ SỰ KIỆN AI',
    lib: 'THƯ VIỆN NHẬN DIỆN',
    search: 'TÌM KIẾM NÂNG CAO',
    cam: 'QUẢN LÝ CAMERA',
    ai: 'CẤU HÌNH AI',
    cfg: 'CẤU HÌNH HỆ THỐNG',
  },
  en: {
    live: 'LIVE VIEW',
    detail: 'CAMERA DETAILS',
    log: 'AI EVENT LOGS',
    lib: 'RECOGNITION LIBRARY',
    search: 'ADVANCED SEARCH',
    cam: 'CAMERA MANAGEMENT',
    ai: 'AI CONFIGURATION',
    cfg: 'SYSTEM CONFIGURATION',
  },
};

export default function Header({view, onGo, onLang, lang = 'vi', boxOnline, unread}) {
  const [clock, setClock] = useState('--:--:--');
  // Tên box hiện ở header — port checkBox() ui.js:1094. boxText = nội dung 'AI BOX …',
  // boxColor + boxPulse theo trạng thái (xanh kết nối, vàng thiếu cấu hình, đỏ lỗi).
  const [boxText, setBoxText] = useState('AI BOX …');
  const [boxColor, setBoxColor] = useState('#30d158');
  const [boxPulse, setBoxPulse] = useState(false);
  const boxBusy = useRef(false);

  useEffect(() => {
    const tick = () => setClock(hms(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

// Port checkBox() ui.js:1094 — poll trạng thái box mỗi 30s + lúc mount.
  useEffect(() => {
    let on = true;
    const done = () => { boxBusy.current = false; };
    const setBox = (txt, col, pulse) => {
      if (!on) return;
      setBoxText(txt); setBoxColor(col); setBoxPulse(!!pulse);
    };
    const checkBox = async () => {
      if (boxBusy.current) return;
      boxBusy.current = true;
      try {
        let d;
        try {
          const j = await (await fetch(BASE + 'api/conn',
            {signal: AbortSignal.timeout(6000)})).json();
          d = j.data || {};
        } catch {
          return setBox('AI BOX MẤT KẾT NỐI', 'var(--err2)');
        }
        if (!d.host) return setBox('AI BOX CHƯA CẤU HÌNH', 'var(--warn)');
        if (!d.has_pass) return setBox('AI BOX THIẾU MẬT KHẨU', 'var(--warn)');
        setBox('AI BOX ĐANG THỬ…', 'var(--dim)');
        let j;
        try {
          const r = await fetch(BASE + 'api/conn/test', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}',
            signal: AbortSignal.timeout(20000),
          });
          j = await r.json();
        } catch {
          return setBox('AI BOX KHÔNG PHẢN HỒI', 'var(--err2)');
        }
        if (j.code === 0) {
          const nm = (j.data || {}).device_name || (j.data || {}).model || d.host;
          setBox('AI BOX ' + nm, 'var(--ok)', true);
        } else {
          // code 3 = sai user/pass, 1000-1004 = loi dang nhap, -1 = khong toi duoc box
          setBox('AI BOX LỖI ' + j.code, 'var(--err2)');
        }
      } catch {
        setBox('AI BOX KHÔNG PHẢN HỒI', 'var(--err2)');
      } finally {
        done();
      }
    };
    checkBox();
    const id = setInterval(checkBox, 30000);
    return () => { on = false; clearInterval(id); };
  }, []);
  const titles = VIEW_TITLES[lang] || VIEW_TITLES.vi;

  return (
    <header data-glass
            style={{position: 'relative', zIndex: 30, flex: 'none', display: 'flex', alignItems: 'center',
                    gap: 18, height: 82, margin: 0, padding: '0 28px', borderRadius: '0 0 20px 20px',
                    background: 'linear-gradient(168deg,rgba(255,255,255,.13),rgba(255,255,255,.05) 48%,rgba(213,194,149,.06))',
                    border: '1px solid rgba(255,255,255,.15)', borderTop: 'none',
                    boxShadow: 'inset 0 -1px 0 rgba(255,255,255,.05), 0 18px 38px rgba(0,0,0,.5)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, overflow: 'hidden'}}>
        <div className="logo" style={{flex: 'none', width: 44, height: 44}}>
          <img src={logoApp} alt="logo" style={{width: '100%', height: '100%', objectFit: 'contain'}} />
        </div>
        <span className="brand" style={{flex: 'none', whiteSpace: 'nowrap'}}>Vibotics</span>
        <span className="brand-sub" style={{flex: 'none', whiteSpace: 'nowrap'}}>AI Smart Box</span>

        <span className="h-vr" style={{height: 20, opacity: 0.35, margin: '0 2px'}} />

        <span style={{
          font: '700 14px/1 var(--b)',
          letterSpacing: '0.06em',
          color: '#f5e3b5',
          whiteSpace: 'nowrap',
          textTransform: 'uppercase',
          textShadow: '0 0 10px rgba(245,227,181,0.25)'
        }}>
          {titles[view] || titles.log}
        </span>
      </div>

      <div style={{flex: 1}} />

      <Dock view={view} onGo={onGo} unread={unread} />

      <span data-langswitch data-lang={lang} title="Đổi ngôn ngữ" style={{cursor: 'pointer'}}
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
          <span className="h-box" style={{whiteSpace: 'nowrap', color: boxColor, animation: boxPulse ? 'aPulse 2s ease-in-out infinite' : 'none'}}>{boxText}</span>
        </div>
      </div>
    </header>
  );
}