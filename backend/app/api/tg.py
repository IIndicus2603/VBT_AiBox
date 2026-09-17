#!/usr/bin/env python3
"""Telegram groups router (port of aibox.py do_POST /api/tg/groups + /api/tg/chatname).

Routes:
  POST /api/tg/groups   -> _tg_discover()
  POST /api/tg/chatname -> _tg_chat_info()
"""
from fastapi import APIRouter, Request

from app import config
from app.telegram.bot import _tg_chat_info, _tg_discover

router = APIRouter(prefix='/api')


@router.post('/tg/groups')
async def tg_groups():
    groups, err = _tg_discover()
    return {'code': 0 if not err else 1, 'msg': err or 'ok',
            'data': {'groups': groups, 'selected': config.CONN.get('tg_chats') or []}}


@router.post('/tg/chatname')
async def tg_chatname(request: Request):
    try:
        req = await request.json()
    except Exception:
        req = {}
    cid = str(req.get('id', '')).strip()
    if not cid:
        return {'code': 2, 'msg': 'Thieu chat_id'}
    name, cid_canon, err = _tg_chat_info(cid)
    return {'code': 0 if name else 1, 'msg': err or 'ok',
            'data': {'id': cid_canon or cid, 'title': name or cid}}