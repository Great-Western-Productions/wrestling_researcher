"""Postgres connection helper for the Flask app.

Provides a per-request `psycopg.Connection` (via `flask.g`) and a tiny
query-style API that mirrors the SQLite cursor-fetch shape, so route
code reads close to what it did before.
"""
from __future__ import annotations

from typing import Any, Sequence

import psycopg
from psycopg.rows import dict_row
from flask import g

from config import CONFIG


def get_db() -> psycopg.Connection:
    if "db" not in g:
        g.db = psycopg.connect(CONFIG.database_url, row_factory=dict_row)
    return g.db


def close_db(_exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query(sql: str, params: Sequence[Any] | None = None) -> list[dict]:
    cur = get_db().execute(sql, params or ())
    return cur.fetchall()


def query_one(sql: str, params: Sequence[Any] | None = None) -> dict | None:
    cur = get_db().execute(sql, params or ())
    return cur.fetchone()


def execute(sql: str, params: Sequence[Any] | None = None) -> psycopg.Cursor:
    """Execute a statement and return the cursor (for `.rowcount`, `RETURNING`)."""
    return get_db().execute(sql, params or ())


def commit() -> None:
    get_db().commit()
