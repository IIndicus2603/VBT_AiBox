#!/usr/bin/env python3
"""uvicorn entrypoint: python run.py  ->  uvicorn app.main:app on config.PORT."""
import uvicorn

from app import config


def main():
    uvicorn.run('app.main:app', host='0.0.0.0', port=config.PORT)


if __name__ == '__main__':
    main()