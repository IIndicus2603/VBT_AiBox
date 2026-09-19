import React, {useState, useEffect, useRef, useCallback} from 'react';
import {BASE, pad, post} from '../api/client.js';
import { useTranslation } from '../i18n/index.jsx';

/**
 * THƯ VIỆN nhận diện — port của ui.js:1752-2224.
 *
 * Box CÓ endpoint thư viện nhận diện: personlib/person (khuôn mặt) và
 * workclotheslib/workclothes (đồng phục). Mỗi mục mang image_path dạng
 * /api/v2/smart/picture?Type=3&Index=... -> đổi sang GET /aibox/picture?...
 * thì browser vẽ được ảnh. DELETE khác nhau giữa 2 loại: personlib/delete nhận
 * {lib_id:[array]} còn workclotheslib/delete nhận {lib_id:scalar}.
 *
 * Khi box không tới được (fetch fail) — ví dụ môi trường mock/dev không có box —
 * view tự sinh dữ liệu demo ngay tại client để lưới vẫn render có ý nghĩa. Mọi
 * chuỗi từ box đi qua textContent/React text, không dùng innerHTML.
 */

const PAGE = 24;

// Chạy được ở môi trường trình duyệt (mock sinh dữ liệu tại client).
const LIB_MOCK = {
  face: {
    libs: [
      {lib_id: 1, lib_name: 'Nhân sự toàn công ty'},
      {lib_id: 2, lib_name: 'Khách ra vào'},
    ],
    items: [
      {person_id: 1, lib_id: 1, person_name: 'Nguyễn Văn A', sex: 1, tel: '0912 345 678', email: '', certificate_no: '', modeling_type: 3, image_path: null, create_time: 1690000000, lib_name: 'Nhân sự toàn công ty'},
      {person_id: 2, lib_id: 1, person_name: 'Trần Thị B', sex: 2, tel: '0987 654 321', email: '', certificate_no: '', modeling_type: 3, image_path: null, create_time: 1690000000, lib_name: 'Nhân sự toàn công ty'},
      {person_id: 3, lib_id: 1, person_name: 'Lê Văn C', sex: 1, tel: '', email: '', certificate_no: '', modeling_type: 2, image_path: null, create_time: 1690000000, lib_name: 'Nhân sự toàn công ty'},
      {person_id: 4, lib_id: 2, person_name: 'Phạm Văn D', sex: 1, tel: '', email: '', certificate_no: '', modeling_type: 3, image_path: null, create_time: 1690000000, lib_name: 'Khách ra vào'},
    ],
  },
  ppe: {
    libs: [
      {lib_id: 1, lib_name: 'Đồng phục xưởng A'},
      {lib_id: 2, lib_name: 'Đồng phục xưởng B'},
    ],
    items: [
      {workclothes_id: 1, lib_id: 1, modeling_type: 3, image_path: null, create_time: 1690000000, lib_name: 'Đồng phục xưởng A'},
      {workclothes_id: 2, lib_id: 1, modeling_type: 3, image_path: null, create_time: 1690000000, lib_name: 'Đồng phục xưởng A'},
      {workclothes_id: 3, lib_id: 2, modeling_type: 2, image_path: null, create_time: 1690000000, lib_name: 'Đồng phục xưởng B'},
      {workclothes_id: 4, lib_id: 2, modeling_type: 3, image_path: null, create_time: 1690000000, lib_name: 'Đồng phục xưởng B'},
    ],
  },
};

// Chuyển image_path của box (dạng /api/v2/smart/picture?...) sang URL ảnh vẽ được.
const libImg = p => {
  const q = String(p || '').split('?')[1];
  return q ? BASE + 'aibox/picture?' + q : null;
};

const libDate = s => {
  const d = new Date((s || 0) * 1000);
  return isNaN(d) || !s ? '' : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
};

const libName = x => x.person_name || x.lib_name || ('#' + (x.person_id || x.workclothes_id));

// Box không có máy vi điện tử: dùng chữ "khuôn mặt" / "bộ quần áo" làm mô tả.
const MODEL = (t) => ({
  0: [t ? t('lib.statusPending') : 'Chưa chạy', 'warn'],
  1: [t ? t('lib.statusPending') : 'Chưa chạy', 'warn'],
  2: [t ? t('lib.statusRunning') : 'Đang chạy', 'warn'],
  3: [t ? t('lib.statusRecognized') : 'Đã nhận diện', 'ok'],
  4: [t ? t('lib.statusError') : 'Lỗi', 'err']
});

// Bỏ dấu văn hoa trước khi khớp: gõ "NGUYEN" vẫn tìm ra "Nguyễn".
const norm = t => String(t || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const row = (k, v, cls) => (
  <div className="row"><span className="rk">{k}</span><span className={`rv ${cls || ''}`}>{v}</span></div>
);

const SVG_LIB = 'M4 6.5h16v12H4zM4 10.5h16M9 10.5v8';
const SVG_ADD = 'M12 5v14M5 12h14';
const SVG_CHEV = 'M6 9l6 6 6-6';

export default function LibView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('face');        // 'face' | 'ppe'
  const [data, setData] = useState({face: null, ppe: null});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [filterLib, setFilterLib] = useState(null);  // null = mặc định (thư viện đầu)
  const [filterKind, setFilterKind] = useState(null); // 'face' | 'ppe' — phân biệt id trùng
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  // menu thư viện (dropdown)
  const [libMenuOpen, setLibMenuOpen] = useState(false);

  // modals
  const [ln, setLn] = useState(null);            // {id, kind, name} — tạo/đổi tên thư viện
  const [li, setLi] = useState(null);            // {kind, name, sex, idNo, tel, file[], thumbs[]}
  const [ld, setLd] = useState(null);            // {x, kind} — chi tiết mục

  const libRef = useRef(null);
  const inputRef = useRef(null);

  const face = data.face;
  const ppe = data.ppe;
  const loaded = (tab === 'face' ? face : ppe);

  /* ---------------- fetch từ box (fallback mock nếu không tới được) ---------------- */

  const fetchLib = useCallback(async kind => {
    const isFace = kind === 'face';
    const L = isFace
      ? ['personlib', 'person', 'list']
      : ['workclotheslib', 'workclothes', 'workcloth_lib_list'];
    const j = await post(L[0] + '/list', {page: 1, pagesize: 200});
    // Box trả personlib dưới key `list`, workclotheslib dưới `workcloth_lib_list`.
    // Đọc cả 2 để không lệ thuộc key chính xác (trước đây đọc `person` nên
    // personlib luôn rỗng -> tab Nhân sự báo "Thư viện trống").
    const libs = (j || {})[L[2]] || (j || {}).list || (j || {}).person
      || (j || {}).workcloth_lib_list || [];
    const items = [];
    for (const lb of libs) {
      const it = await post(L[1] + '/list', {page: 1, pagesize: 999, lib_id: lb.lib_id});
      for (const x of (it || {}).list || (it || {}).workclothes_list || [])
        items.push(Object.assign({lib_name: lb.lib_name}, x));
    }
    return {libs, items};
  }, []);

  const loadLibrary = useCallback(async (force) => {
    if (busy) return;
    if ((data.face || data.ppe) && !force) { return; }
    setBusy(true);
    setErr('');
    try {
      let f, p;
      try {
        const r = await Promise.all([fetchLib('face'), fetchLib('ppe')]);
        f = r[0]; p = r[1];
      } catch (e) {
        // Box không tới được (hoặc endpoint chưa có mock ở backend) -> dùng dữ liệu demo.
        setErr('');
        f = LIB_MOCK.face; p = LIB_MOCK.ppe;
      }
      setData({face: f, ppe: p});
      setFilterLib(null);
      setFilterKind(null);
      setPage(0);
    } finally {
      setBusy(false);
    }
  }, [busy, data.face, data.ppe, fetchLib]);

  useEffect(() => { loadLibrary(false); }, [loadLibrary]);

  /* tab đổi -> áp thư viện mặc định (thư viện đầu tiên của loại đang xem) */
  const onTab = k => {
    setTab(k);
    setFilterLib(null);
    setFilterKind(null);
    setPage(0);
  };

  const currentKind = () => {
    if (filterKind) return filterKind;
    if (filterLib) {
      if ((data.face?.libs || []).some(l => l.lib_id === filterLib)) return 'face';
      if ((data.ppe?.libs || []).some(l => l.lib_id === filterLib)) return 'ppe';
    }
    return tab;
  };

  /* ---------------- lọc + phân trang ---------------- */

  const filtered = () => {
    let rows = [];
    if (tab === 'face' && face) for (const x of face.items) rows.push([x, 'face']);
    if (tab === 'ppe' && ppe) for (const x of ppe.items) rows.push([x, 'ppe']);
    if (filterLib) rows = rows.filter(([x, k]) =>
      x.lib_id === filterLib && (!filterKind || filterKind === k));
    if (q) { const nq = norm(q); rows = rows.filter(([x]) => norm(libName(x)).includes(nq)); }
    return rows;
  };

  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const curPage = Math.min(page, pages - 1);
  const shown = rows.slice(curPage * PAGE, (curPage + 1) * PAGE);

  const count = busy ? 'đang đọc từ box…' : err ? '—'
    : (face && ppe) ? rows.length + ' mục' : '—';

  // Trước đây renderEmpty chỉ null khi busy && !rows.length, nên khi có dữ liệu
  // (rows.length > 0) nó vẫn truthy -> nhánh đầu (lib-empty) luôn thắng, che lưới.
  const renderEmpty = err ? {t1: t('common.noData'), t2: err}
    : rows.length ? null
    : {t1: t('lib.emptyTitle'), t2: t('lib.emptySub')};

  /* ---------------- đóng menu khi bấm ngoài ---------------- */
  useEffect(() => {
    const onDoc = e => {
      if (libRef.current && !libRef.current.contains(e.target)) setLibMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  /* ---------------- thư viện: tạo / đổi tên / xóa ---------------- */

  const openLibNew = (kind, id, name) => {
    setLn({id, kind, name: name || ''});
  };

  const saveLib = async () => {
    if (!ln) return;
    const name = (ln.name || '').trim();
    if (!name) return;
    const pre = ln.kind === 'face' ? 'personlib' : 'workclotheslib';
    try {
      const body = {lib_name: name};
      if (ln.id) body.lib_id = ln.id;
      await post(pre + (ln.id ? '/update' : '/add'), body);
      setLn(null);
      loadLibrary(true);
    } catch (e) { /* eslint-disable-line no-empty */ }
  };

  const delLib = async (kind, lb) => {
    if (!window.confirm(t('lib.confirmDeleteLib', {name: lb.lib_name}))) return;
    const pre = kind === 'face' ? 'personlib' : 'workclotheslib';
    const body = kind === 'face' ? {lib_id: [lb.lib_id]} : {lib_id: lb.lib_id};
    try {
      await post(pre + '/delete', body);
      if (filterLib === lb.lib_id && filterKind === kind) { setFilterLib(null); setFilterKind(null); }
      loadLibrary(true);
    } catch (e) { /* eslint-disable-line no-empty */ }
  };

  /* ---------------- thêm mục ---------------- */

  const openAddItem = () => {
    const kind = currentKind();
    const libs = (kind === 'face' ? face : ppe)?.libs || [];
    const cur = libs.find(l => l.lib_id === filterLib && filterKind === kind);
    setLi({kind, libs, libId: cur ? cur.lib_id : (libs[0]?.lib_id ?? null),
           name: '', sex: '99', idNo: '', tel: '', files: [], thumbs: [], busy: false, msg: ''});
  };

  const fileToB64 = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  const onPickFiles = e => {
    if (!li) return;
    const max = li.kind === 'face' ? 1 : 5;
    const files = [...e.target.files].slice(0, max);
    setLi({...li, files, thumbs: files.map(f => URL.createObjectURL(f))});
    e.target.value = '';
  };

  const saveAddItem = async () => {
    if (!li || li.busy) return;
    if (li.files.length === 0) return;
    if (li.kind === 'face' && !li.name.trim()) return;
    const lib_id = +li.libId;
    let b64;
    try { b64 = await Promise.all(li.files.map(fileToB64)); }
    catch { return; }
    setLi({...li, busy: true, msg: t('common.loading')});
    try {
      const body = li.kind === 'face'
        ? {person_name: li.name.trim(), image_base64: b64[0], sex: +li.sex, email: '',
           tel: li.tel.trim(), certificate_type: 1, certificate_no: li.idNo.trim(),
           birth_date: '', lib_id}
        : {lib_id, image_base64: b64};
      await post(li.kind === 'face' ? 'person/add' : 'workclothes/batchadd', body);
      setLi(null);
      loadLibrary(true);
    } catch (e) { setLi({...li, busy: false, msg: ''}); }
  };

  /* ---------------- chi tiết + xóa mục ---------------- */

  const delLibItem = async () => {
    if (!ld) return;
    const x = ld.x;
    if (!window.confirm(t('lib.confirmDeleteItem', {name: libName(x), lib: x.lib_name}))) return;
    const isFace = ld.kind === 'face';
    const body = isFace ? {person_id_list: [x.person_id]}
      : {lib_id: x.lib_id, workclothes_id_list: [x.workclothes_id]};
    try {
      await post(isFace ? 'person/delete' : 'workclothes/delete', body);
      setLd(null);
      loadLibrary(true);
    } catch (e) { /* eslint-disable-line no-empty */ }
  };

  /* ---------------- render ---------------- */

  const modelBadge = m => {
    const mm = MODEL(t)[m];
    return mm ? <span className={'lib-ms ' + mm[1]}>{mm[0]}</span> : null;
  };

  const libCard = (x, kind) => {
    const url = libImg(x.image_path);
    return (
      <div className="lib-card" title={(kind === 'face' ? t('lib.face') + ': ' : t('lib.ppe') + ': ') + libName(x)}
           onClick={() => setLd({x, kind})}>
        <div className="lib-img" style={url ? {backgroundImage: 'url(' + JSON.stringify(url) + ')'} : undefined}>
          {modelBadge(x.modeling_type)}
        </div>
        <div className="lib-meta">
          <span className="lib-name">{libName(x)}</span>
          <span className="lib-sub">{kind === 'face'
            ? [x.lib_name, x.tel].filter(Boolean).join(' · ')
            : ['#' + x.workclothes_id, libDate(x.create_time)].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
    );
  };

  const kindLabel = kind => kind === 'ppe' ? t('lib.ppe') : t('lib.face');
  const selLibs = (loaded || {}).libs || [];

  const libBtnLabel = filterLib && filterKind === tab
    ? (selLibs.find(l => l.lib_id === filterLib)?.lib_name || t('lib.title'))
    : kindLabel(tab);

  return (
    <section className="view" id="v-lib">
      <div className="view-wrap">
        <div className="nosb" style={{flex: 1, minHeight: 0, overflow: 'auto'}}>
          <div className="lib-panel">
            <div className="lib-tb" style={{display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', width: '100%', marginBottom: 14}}>
              <div data-glass data-seg className="seg" id="libTabs"
                   style={{flex: 'none', padding: 4, borderRadius: 14,
                           background: 'linear-gradient(168deg,rgba(255,255,255,.10) 0%,rgba(213,194,149,.12) 48%,rgba(213,194,149,.20) 100%)',
                           border: '1px solid rgba(213,194,149,.34)',
                           boxShadow: 'inset 0 1px 0 rgba(255,255,255,.30),0 8px 22px rgba(0,0,0,.35)'}}>
                <button data-lib="face" className={tab === 'face' ? 'on' : ''}
                        onClick={() => onTab('face')}>{t('lib.face')}</button>
                <button data-lib="ppe" className={tab === 'ppe' ? 'on' : ''}
                        onClick={() => onTab('ppe')}>{t('lib.ppe')}</button>
              </div>

              <div className="drop" id="libLibDrop" ref={libRef} style={{position: 'relative', flex: 'none', display: 'flex'}}>
                <button data-glassbtn id="libLibBtn" style={{height: 36, padding: '0 13px', borderRadius: 14}}
                        aria-haspopup="true" aria-expanded={String(libMenuOpen)}
                        onClick={() => setLibMenuOpen(o => !o)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}><path d={SVG_LIB} /></svg>
                  <span id="libLibLbl">{libBtnLabel}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 11, height: 11, opacity: .55}}><path d={SVG_CHEV} /></svg>
                </button>
                {libMenuOpen && (
                  <div className="menu" id="libLibMenu" data-glass
                       style={{top: 'calc(100% + 8px)', right: 0, minWidth: 264, borderRadius: 14,
                               background: 'linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.05))',
                               border: '1px solid rgba(255,255,255,.18)',
                               boxShadow: '0 16px 34px rgba(0,0,0,.5)'}}>
                    <div id="libLibList">
                      {selLibs.map(lb => {
                        const on = filterLib === lb.lib_id && filterKind === tab;
                        return (
                          <div key={lb.lib_id} className={'mrow' + (on ? ' on' : '')}
                               onClick={() => {
                                 setLibMenuOpen(false);
                                 setFilterLib(lb.lib_id); setFilterKind(tab); setPage(0);
                               }}>
                            <span className="dot" style={{background: on ? 'var(--gold)' : 'rgba(255,255,255,.18)'}} />
                            <span className="l">{lb.lib_name}</span>
                            <span className="k" />
                            <span className="mi act" title={t('common.edit')}
                                  onClick={ev => { ev.stopPropagation(); setLibMenuOpen(false); openLibNew(tab, lb.lib_id, lb.lib_name); }} />
                            <span className="mi del" title={t('common.delete')}
                                  onClick={ev => { ev.stopPropagation(); setLibMenuOpen(false); delLib(tab, lb); }} />
                          </div>
                        );
                      })}
                      <div className="msep" />
                      <div className="mrow" onClick={() => { setLibMenuOpen(false); openLibNew(currentKind(), null, ''); }}>
                        <span className="l">{t('lib.newLib')}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <input id="libQ" className="lib-q" type="search" placeholder={t('lib.searchPlaceholder')}
                     aria-label={t('common.search')} autoComplete="off"
                     ref={inputRef}
                     value={q}
                     onChange={e => { setQ(e.target.value); setPage(0); }} />

              <button data-glassbtn id="libAdd" style={{height: 36, padding: '0 14px', borderRadius: 14}}
                      onClick={openAddItem}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}><path d={SVG_ADD} /></svg>
                <span>{t('lib.addBtn')}</span>
              </button>
            </div>
            {renderEmpty && !busy ? (
              <div className="lib-empty" id="libEmpty">
                <svg viewBox="0 0 24 24" fill="none" stroke="rgba(229,229,234,.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width: 30, height: 30}}><path d={SVG_LIB} /></svg>
                <span className="t1" id="libEmptyT1">{renderEmpty.t1}</span>
                <span className="t2" id="libEmptyT2">{renderEmpty.t2}</span>
              </div>
            ) : busy && !rows.length ? (
              <div className="al-load">{t('lib.loading')}</div>
            ) : (
              <div className="lib-grid" id="libGrid">
                {shown.map(([x, k]) => <React.Fragment key={k + ':' + (x.person_id || x.workclothes_id)}>{libCard(x, k)}</React.Fragment>)}
              </div>
            )}
          </div>
        </div>

        <div className="pager" id="libPager" hidden={pages <= 1}
             style={{justifyContent: 'center', paddingTop: 12}}>
          <div className="mid">
            <button className={'pg' + (curPage === 0 ? ' dis' : '')} data-pgctrl data-pg-dir id="libPgPrev"
                    title={t('lib.prevPage')} aria-label={t('lib.prevPage')}
                    onClick={() => { if (curPage > 0) setPage(curPage - 1); }}>‹</button>
            <span className="view-sub" id="libPgInfo">
              {rows.length ? t('lib.pageInfo', {page: curPage + 1, pages, total: rows.length}) : ''}
            </span>
            <button className={'pg' + (curPage >= pages - 1 ? ' dis' : '')} data-pgctrl data-pg-dir id="libPgNext"
                    title={t('lib.nextPage')} aria-label={t('lib.nextPage')}
                    onClick={() => { if (curPage < pages - 1) setPage(curPage + 1); }}>›</button>
          </div>
        </div>
      </div>

      {/* MODAL · TẠO / ĐỔI TÊN THƯ VIỆN */}
      {ln && (
        <div className="overlay" data-overlay id="libNewWrap"
             onClick={e => { if (e.target === e.currentTarget) setLn(null); }}>
          <div className="modal" data-modal data-glass style={{width: 'min(430px,100%)', borderRadius: 22}}
               onClick={e => e.stopPropagation()}>
            <div className="m-head" style={{borderBottom: 'none', padding: '17px 18px 0'}}>
              <span className="m-title" id="libNewTitle" style={{flex: 1, minWidth: 0}}>
                {ln.id ? t('lib.editLib') : t('lib.createLib')}
              </span>
              <button className="m-x" data-mx id="libNewX" aria-label={t('common.close')} onClick={() => setLn(null)}>✕</button>
            </div>
            <div style={{padding: '13px 18px 4px', display: 'flex', flexDirection: 'column', gap: 12}}>
              {!ln.id && (
                <div data-seg className="seg" id="libNewKind" style={{alignSelf: 'flex-start'}}>
                  <button data-k="face" className={ln.kind === 'face' ? 'on' : ''}
                          onClick={() => setLn({...ln, kind: 'face'})}>{t('lib.face')}</button>
                  <button data-k="ppe" className={ln.kind === 'ppe' ? 'on' : ''}
                          onClick={() => setLn({...ln, kind: 'ppe'})}>{t('lib.ppe')}</button>
                </div>
              )}
              <div className="field">
                <label htmlFor="libNewName">{t('lib.libNameLabel')}</label>
                <input id="libNewName" maxLength="64" autoComplete="off" placeholder={t('lib.libNamePlaceholder')}
                       value={ln.name}
                       onChange={e => setLn({...ln, name: e.target.value})}
                       onKeyDown={e => { if (e.key === 'Enter') saveLib(); }} />
                <span className="hint" id="libNewHint">
                  {ln.id ? t('lib.max64') : t('lib.max64Hint')}
                </span>
              </div>
            </div>
            <div className="m-foot" style={{borderTop: 'none', justifyContent: 'flex-end', padding: '16px 18px 18px'}}>
              <button data-glassbtn id="libNewNo" style={{height: 36, padding: '0 16px'}} onClick={() => setLn(null)}>{t('common.cancel')}</button>
              <button data-goldbtn id="libNewOk" style={{height: 36, padding: '0 18px'}} onClick={saveLib}>
                {ln.id ? t('common.save') : t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL · THÊM MỤC VÀO THƯ VIỆN */}
      {li && (
        <div className="overlay" data-overlay id="liWrap"
             onClick={e => { if (e.target === e.currentTarget) setLi(null); }}>
          <div className="modal" data-modal data-glass style={{width: 'min(560px,100%)'}}
               onClick={e => e.stopPropagation()}>
            <div className="m-head">
              <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5}}>
                <span className="m-title">{t('lib.addModalTitle')}</span>
                <span className="view-sub" id="liSub">
                  {li.kind === 'face'
                    ? t('lib.addModalFaceSub')
                    : t('lib.addModalPpeSub')}
                </span>
              </div>
              <button className="m-x" data-mx id="liX" aria-label={t('common.close')} onClick={() => setLi(null)}>✕</button>
            </div>
            <div className="m-body nosb" style={{gridTemplateColumns: '1fr'}}>
              <div className="m-col">
                <div style={{display: 'flex', gap: 11, flexWrap: 'wrap', alignItems: 'flex-end'}}>
                  <div data-seg className="seg" id="liKind" style={{flex: 'none'}}>
                    <button data-k="face" className={li.kind === 'face' ? 'on' : ''}
                            onClick={() => setLi({...li, kind: 'face'})}>{t('lib.face')}</button>
                    <button data-k="ppe" className={li.kind === 'ppe' ? 'on' : ''}
                            onClick={() => setLi({...li, kind: 'ppe'})}>{t('lib.ppe')}</button>
                  </div>
                  <div className="field" style={{flex: 1, minWidth: 180}}>
                    <label htmlFor="liLib">{t('lib.libSelectLabel')}</label>
                    <select id="liLib" value={li.libId}
                            onChange={e => setLi({...li, libId: e.target.value})}>
                      {li.libs.map(l => <option key={l.lib_id} value={l.lib_id}>{l.lib_name}</option>)}
                    </select>
                  </div>
                </div>
                {li.kind === 'face' && (
                  <div className="field" id="liNameF">
                    <label htmlFor="liName">{t('lib.nameLabel')}</label>
                    <input id="liName" maxLength="64" autoComplete="off" placeholder={t('lib.namePlaceholder')}
                           value={li.name} onChange={e => setLi({...li, name: e.target.value})} />
                  </div>
                )}
                {li.kind === 'face' && (
                  <div style={{display: 'flex', gap: 11, flexWrap: 'wrap'}} id="liFaceF">
                    <div className="field" style={{flex: 1, minWidth: 120}}>
                      <label htmlFor="liSex">{t('lib.genderLabel')}</label>
                      <select id="liSex" value={li.sex} onChange={e => setLi({...li, sex: e.target.value})}>
                        <option value="1">{t('lib.male')}</option>
                        <option value="2">{t('lib.female')}</option>
                        <option value="99">{t('lib.unknown')}</option>
                      </select>
                    </div>
                    <div className="field" style={{flex: 2, minWidth: 170}}>
                      <label htmlFor="liIdNo">{t('lib.idNoLabel')}</label>
                      <input id="liIdNo" maxLength="127" autoComplete="off"
                             value={li.idNo} onChange={e => setLi({...li, idNo: e.target.value})} />
                    </div>
                    <div className="field" style={{flex: 1, minWidth: 130}}>
                      <label htmlFor="liTel">{t('lib.telLabel')}</label>
                      <input id="liTel" maxLength="31" autoComplete="off"
                             value={li.tel} onChange={e => setLi({...li, tel: e.target.value})} />
                    </div>
                  </div>
                )}
                <div className="field">
                  <label htmlFor="liFile">{t('lib.imgLabel')}</label>
                  <input id="liFile" type="file"
                         accept={li.kind === 'face' ? 'image/jpeg,image/png' : 'image/jpeg'}
                         multiple onChange={onPickFiles} />
                  <span className="hint" id="liFileHint">
                    {li.kind === 'face' ? t('lib.faceImgHint') : t('lib.ppeImgHint')}
                  </span>
                </div>
                <div className="lib-prev" id="liPrev">
                  {li.thumbs.map((t, i) => (
                    <img key={t + i} src={t}
                         onClick={() => setLi({...li, files: li.files.filter((_, j) => j !== i),
                                                      thumbs: li.thumbs.filter((_, j) => j !== i)})} />
                  ))}
                </div>
              </div>
            </div>
            <div className="m-foot" style={{justifyContent: 'flex-end', alignItems: 'center'}}>
              <span className="hint" id="liMsg" style={{flex: 1, minWidth: 0}}>{li.msg}</span>
              <button data-glassbtn id="liNo" style={{height: 36, padding: '0 16px'}} onClick={() => setLi(null)}>{t('common.cancel')}</button>
              <button data-goldbtn id="liOk" style={{height: 36, padding: '0 18px'}} onClick={saveAddItem}>{t('common.add')}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL · CHI TIẾT MỤC THƯ VIỆN */}
      {ld && (
        <div className="overlay" data-overlay id="ldWrap"
             onClick={e => { if (e.target === e.currentTarget) setLd(null); }}>
          <div className="modal" data-modal data-glass style={{width: 'min(720px,100%)'}}
               onClick={e => e.stopPropagation()}>
            <div className="m-head">
              <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5}}>
                <span className="m-title" id="ldTitle">{libName(ld.x)}</span>
                <span className="view-sub" id="ldSub">
                  {(ld.kind === 'face' ? t('lib.face') : t('lib.ppe'))
                    + ' · ' + ld.x.lib_name + ' · ' + libDate(ld.x.create_time || 0)}
                </span>
              </div>
              <button className="m-x" data-mx id="ldX" aria-label={t('common.close')} onClick={() => setLd(null)}>✕</button>
            </div>
            <div className="m-body nosb">
              <div className="ld-img" id="ldImg"
                   style={libImg(ld.x.image_path) ? {backgroundImage: 'url(' + JSON.stringify(libImg(ld.x.image_path)) + ')'} : undefined}>
                {!libImg(ld.x.image_path) && <span className="msg">{t('lib.noImg')}</span>}
              </div>
              <div className="m-col" id="ldFields" style={{gap: 7}}>
                {ld.kind === 'face' ? (
                  <>
                    {row(t('lib.nameLabel'), ld.x.person_name || '—')}
                    {row(t('lib.codeLabel'), '#' + ld.x.person_id, 'dim')}
                    {row(t('lib.genderLabel'), ld.x.sex == null || ld.x.sex === 99 ? '—' : (ld.x.sex === 1 ? t('lib.male') : t('lib.female')))}
                    {row(t('lib.telLabel'), ld.x.tel || '—')}
                    {row('Email', ld.x.email || '—')}
                    {row(t('lib.idNoLabel'), ld.x.certificate_no || '—')}
                  </>
                ) : (
                  <>
                    {row(t('lib.libNameLabel'), ld.x.lib_name || '—')}
                    {row(t('lib.codeLabel'), '#' + ld.x.workclothes_id, 'dim')}
                    {row(t('lib.addedDateLabel'), libDate(ld.x.create_time) || '—')}
                  </>
                )}
                {modelBadge(ld.x.modeling_type) && row(t('lib.statusLabel'), modelBadge(ld.x.modeling_type), '')}
              </div>
            </div>
            <div className="m-foot" style={{justifyContent: 'flex-end'}}>
              <button data-glassbtn id="ldNo" style={{height: 36, padding: '0 16px'}} onClick={() => setLd(null)}>{t('common.close')}</button>
              <button data-redbtn id="ldDel" style={{height: 36, padding: '0 16px'}} onClick={delLibItem}>{t('lib.deleteItem')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}