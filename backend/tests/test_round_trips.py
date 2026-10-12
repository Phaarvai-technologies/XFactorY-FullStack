"""The Manufacturer dashboard loads with few database round trips: each trip costs network
time between the backend and the database (Render -> Supabase). Real PostgreSQL; skipped
without E2E_DATABASE_URL."""
import os

import pytest
from sqlalchemy import event

from test_admin import new_manufacturer, no_clerk  # noqa: F401  (fixture)
from test_e2e_local import client  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("E2E_DATABASE_URL"), reason="E2E_DATABASE_URL not set")


async def _statements(client, path, headers):  # noqa: F811
    from app.core.database import engine
    seen = []

    def count(conn, cursor, statement, *args):
        seen.append(statement.split()[0].upper())

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        r = await client.get(path, headers=headers)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)
    assert r.status_code == 200, r.text
    return seen


async def test_dashboard_round_trips(client, no_clerk):  # noqa: F811
    sub, mh, org = await new_manufacturer(client, "Round Trip Co")
    await client.get("/manufacturer/bootstrap", headers=mh)          # first visit records "last seen"
    boot = await _statements(client, "/manufacturer/bootstrap", mh)
    notes = await _statements(client, "/manufacturer/notifications", mh)
    print("bootstrap:", boot, "notifications:", notes)
    # bootstrap = user/company context + one snapshot query; notifications = context + one query
    assert len(boot) <= 3, boot
    assert len(notes) <= 3, notes
