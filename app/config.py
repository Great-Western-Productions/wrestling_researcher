"""Single configuration module for the Pro Wrestling Researcher web app.

Reads `.env` from the project root, exposes a `Config` dataclass. All env
access goes through here — `app.py` and `db.py` import from this module
rather than reading `os.environ` directly.
"""
from __future__ import annotations

import getpass
import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Tiny stdlib `.env` loader — picks up `KEY=value` and `export KEY=value` lines."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class Config:
    database_url: str
    pg_host: str
    pg_port: int
    pg_db: str
    pg_user: str
    google_api_token: str | None
    secret: str
    host: str
    port: int
    debug: bool

    @classmethod
    def from_env(cls) -> "Config":
        url = os.environ.get("DATABASE_URL")
        host = os.environ.get("PWBIB_PG_HOST", "localhost")
        port = int(os.environ.get("PWBIB_PG_PORT", "5432"))
        db = os.environ.get("PWBIB_PG_DB", "wrestling_bibliography")
        user = os.environ.get("PWBIB_PG_USER", getpass.getuser())
        if not url:
            url = f"postgresql://{user}@{host}:{port}/{db}"
        return cls(
            database_url=url,
            pg_host=host,
            pg_port=port,
            pg_db=db,
            pg_user=user,
            google_api_token=os.environ.get("GOOGLE_API_TOKEN") or None,
            secret=os.environ.get("PWBIB_SECRET", "local-only-not-a-real-secret"),
            host=os.environ.get("PWBIB_HOST", "127.0.0.1"),
            port=int(os.environ.get("PWBIB_PORT", "5150")),
            debug=os.environ.get("PWBIB_DEBUG", "").lower() in ("1", "true", "yes"),
        )


CONFIG = Config.from_env()
