"""Run a command-line coroutine (python -m app.admin_account / migrate / import ...).

On Windows, asyncio.run() uses the ProactorEventLoop, which the psycopg async driver
(DATABASE_URL = postgresql+psycopg://...) cannot use ("Psycopg cannot use the 'ProactorEventLoop'
to run in async mode"). Uvicorn already uses a selector loop for the server; the commands now do
the same. asyncpg (postgresql+asyncpg://) works with either loop.
"""
import asyncio
import selectors
import sys


def run(coro):
    if sys.platform == "win32":
        return asyncio.run(coro, loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()))
    return asyncio.run(coro)
