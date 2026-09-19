import React, {useEffect, useRef, useState} from 'react';
import Dock from './Dock.jsx';
import {hms, BASE, API, jget} from '../api/client.js';
import logoApp from '../assets/logo-diamond-transparent.png';
import { useTranslation } from '../i18n/index.jsx';

export default function Header({view, focus, onGo, onLang, lang: propLang, boxOnline, unread, onEvent, onReadAll}) {
  const { t, lang: ctxLang, setLang } = useTranslation();
  const lang = ctxLang || propLang || 'vi';
  const [clock, setClock] = useState('--:--:--');
  const [boxText, setBoxText] = useState('AI BOX …');
  const [boxColor, setBoxColor] = useState('#30d158');
  const boxBusy = useRef(false);
  const [camOn, setCamOn] = useState(0);
  const [camTot, setCamTot] = useState(0);
  const [camNames, setCamNames] = useState({});

  useEffect(() => {
    const tick = () => setClock(hms(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const checkBox = async () => {
      if (boxBusy.current) return;
      boxBusy.current = true;
      try {
        const j = await jget('sys/info');
        if (j && j.dev_name) {
          setBoxText(j.dev_name);
          setBoxColor('#30d158');
        } else {
          setBoxText(t('header.boxOnline'));
          setBoxColor('#30d158');
        }
      } catch {
        setBoxText(t('header.boxOffline'));
        setBoxColor('#ff453a');
      } finally {
        boxBusy.current = false;
      }
    };
    checkBox();
    const id = setInterval(checkBox, 15000);
    return () => clearInterval(id);
  }, [t]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      let total = 0, online = 0;
      const nm = {};
      try {
        const rC = await fetch(BASE + 'api/cameras');
        const jC = await rC.json();
        if (jC.code === 0 && Array.isArray(jC.cameras)) {
          total = jC.cameras.length;
          jC.cameras.forEach(c => {
            if (c.id && c.name) nm[c.id] = c.name;
          });
        }
      } catch { /* fallback */ }

      try {
        const rS = await fetch(BASE + 'api/streams');
        const st = await rS.json();
        if (st && typeof st === 'object') {
          for (let i = 1; i <= Math.max(total, 16); i++) {
            const k = 'ch' + i;
            if (st[k] && st[k].producers && st[k].producers.length > 0) online++;
          }
        }
      } catch { online = total; }

      if (alive) {
        setCamTot(total);
        setCamOn(online);
        setCamNames(nm);
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const viewTitleKey = 'header.' + (view || 'live');
  const viewTitle = t(viewTitleKey);
  const currentCamName = focus ? (camNames[focus] || focus) : '—';

  const handleLangToggle = () => {
    const nextLang = lang === 'vi' ? 'en' : 'vi';
    setLang(nextLang);
    onLang?.(nextLang);
  };

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

        {view === 'detail' && (
          <button data-glassbtn id="back" style={{height: 32, padding: '0 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 'none'}} onClick={() => onGo?.('live')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}>
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <span>{t('header.allCams')}</span>
          </button>
        )}

        <span style={{
          font: '700 14px/1 var(--b)',
          letterSpacing: '0.06em',
          color: '#f5e3b5',
          whiteSpace: 'nowrap',
          textTransform: 'uppercase',
          textShadow: '0 0 10px rgba(245,227,181,0.25)',
          flex: 'none'
        }}>
          {viewTitle}
        </span>

        {view === 'detail' && (
          <>
            <span style={{color: 'rgba(255,255,255,0.3)', font: '400 14px var(--b)', flex: 'none'}}>·</span>
            <span style={{
              font: '600 14px/1 var(--b)',
              color: '#fff',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden'
            }}>
              {currentCamName}
            </span>
          </>
        )}
      </div>

      <div style={{flex: 1}} />

      <Dock view={view} onGo={onGo} unread={unread} onEvent={onEvent} onReadAll={onReadAll} />

      <span data-langswitch data-lang={lang} title={t('header.switchLang')} style={{cursor: 'pointer'}}
            onClick={handleLangToggle}>
        <span data-langthumb />
        <span data-l="vi">VI</span>
        <span data-l="en">EN</span>
      </span>

      <span className="h-vr" />

      <div className="hstat" style={{alignItems: 'flex-end'}}>
        <div className="hstat-r" style={{gap: 6}}>
          <span className="h-online">{t('header.online')}</span>
          <span className="h-div" />
          <span className="h-clock">{clock}</span>
        </div>
        <div className="hstat-r">
          <span className="h-box" style={{whiteSpace: 'nowrap', color: boxColor, textTransform: 'uppercase'}}>{boxText}</span>
        </div>
      </div>
    </header>
  );
}