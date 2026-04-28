import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "app" / "app.py"


def load_app_module():
    sys.path.insert(0, str(ROOT / "app"))
    spec = importlib.util.spec_from_file_location("pwr_app", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_merge_books_fills_blank_target_fields_moves_authors_and_deletes_duplicate(monkeypatch):
    app_module = load_app_module()
    target = {
        "id": 1,
        "title": "Accepted: How I Learned to Stop Worrying and Love the Ring",
        "subtitle": None,
        "category_code": "by_wrestler",
        "publisher": "",
        "year_published": 2014,
        "isbn10": None,
        "isbn13": None,
        "pages": None,
        "format": None,
        "language": "English",
        "country": "United States",
        "subject_wrestler": None,
        "era": None,
        "territory_or_promotion": None,
        "synopsis": None,
        "source_url": None,
        "confidence": "medium",
        "primary_source_value": None,
    }
    duplicate = {
        **target,
        "id": 2,
        "title": "Accepted",
        "subtitle": "How I Learned to Stop Worrying and Love the Ring",
        "publisher": "ECW Press",
        "isbn13": "9781770411617",
        "confidence": "high",
    }

    def fake_query_one(sql, params=None):
        if params == (1,):
            return target
        if params == (2,):
            return duplicate
        return None

    calls = []
    monkeypatch.setattr(app_module, "query_one", fake_query_one)
    monkeypatch.setattr(app_module, "execute", lambda sql, params=None: calls.append((sql, params)))
    monkeypatch.setattr(app_module, "commit", lambda: calls.append(("COMMIT", None)))

    app_module.merge_books(1, 2)

    assert "INSERT INTO book_authors" in calls[0][0]
    assert "ON CONFLICT DO NOTHING" in calls[0][0]
    assert calls[0][1] == (1, 2)
    assert calls[1] == ("DELETE FROM books WHERE id = %s", (2,))

    update_sql, update_params = calls[2]
    assert "UPDATE books" in update_sql
    assert "subtitle = %s" in update_sql
    assert "publisher = %s" in update_sql
    assert "isbn13 = %s" in update_sql
    assert "confidence = %s" not in update_sql
    assert update_params == (
        "How I Learned to Stop Worrying and Love the Ring",
        "ECW Press",
        "9781770411617",
        1,
    )
    assert calls[-1] == ("COMMIT", None)


def test_merge_books_rejects_self_merge():
    app_module = load_app_module()

    with pytest.raises(ValueError, match="same book"):
        app_module.merge_books(1, 1)


def test_book_merge_route_sets_logged_in_and_redirects_to_next(monkeypatch):
    app_module = load_app_module()
    merged = []
    monkeypatch.setattr(app_module, "merge_books", lambda target, duplicate: merged.append((target, duplicate)))

    client = app_module.app.test_client()
    response = client.post(
        "/books/10/merge",
        data={"duplicate_book_id": "11", "next": "/books?q=Accepted"},
    )

    assert merged == [(10, 11)]
    assert response.status_code == 302
    assert response.headers["Location"] == "/books?q=Accepted"
    with app_module.app.test_request_context("/"):
        app_module.mark_logged_in()
        assert app_module.logged_in_context()["logged_in"] is True



def test_update_book_from_form_updates_metadata_and_replaces_authors(monkeypatch):
    app_module = load_app_module()
    author_ids = {"Mick Foley": 7}
    calls = []

    def fake_query_one(sql, params=None):
        if "SELECT id FROM authors" in sql and params == ("Mick Foley",):
            return {"id": author_ids["Mick Foley"]}
        if "SELECT id FROM authors" in sql and params == ("New Person",):
            return None
        return None

    def fake_execute(sql, params=None):
        calls.append((sql, params))
        if "INSERT INTO authors" in sql:
            return type("Cursor", (), {"fetchone": lambda self: {"id": 42}})()
        return type("Cursor", (), {"fetchone": lambda self: None})()

    monkeypatch.setattr(app_module, "query_one", fake_query_one)
    monkeypatch.setattr(app_module, "execute", fake_execute)
    monkeypatch.setattr(app_module, "commit", lambda: calls.append(("COMMIT", None)))

    form = {
        "title": "Have a Nice Day!",
        "subtitle": "A Tale of Blood and Sweatsocks",
        "category_code": "by_wrestler",
        "publisher": "ReganBooks",
        "year_published": "1999",
        "isbn10": "0061031011",
        "isbn13": "9780061031014",
        "pages": "768",
        "format": "paperback",
        "language": "English",
        "country": "United States",
        "subject_wrestler": "Mick Foley",
        "era": "Attitude Era",
        "territory_or_promotion": "WWF",
        "synopsis": "Updated synopsis",
        "source_url": "https://example.test/book",
        "confidence": "high",
        "authors": "Mick Foley, New Person",
        "authors_are_wrestlers": "1",
    }

    app_module.update_book_from_form(154, form)

    update_sql, update_params = calls[0]
    assert "UPDATE books" in update_sql
    assert update_params[0] == "Have a Nice Day!"
    assert update_params[4] == 1999
    assert update_params[7] == 768
    assert update_params[-1] == 154
    assert any(sql == "DELETE FROM book_authors WHERE book_id = %s" and params == (154,) for sql, params in calls)
    assert any("INSERT INTO authors" in sql and params == ("New Person", 1) for sql, params in calls)
    assert any("INSERT INTO book_authors" in sql and params == (154, 7) for sql, params in calls)
    assert any("INSERT INTO book_authors" in sql and params == (154, 42) for sql, params in calls)
    assert calls[-1] == ("COMMIT", None)


def test_edit_book_route_renders_existing_book_and_redirects_after_save(monkeypatch):
    app_module = load_app_module()
    book = {
        "id": 154,
        "title": "Have a Nice Day!",
        "subtitle": "A Tale of Blood and Sweatsocks",
        "category_code": "by_wrestler",
        "publisher": "ReganBooks",
        "year_published": 1999,
        "isbn10": "0061031011",
        "isbn13": "9780061031014",
        "pages": 768,
        "format": "paperback",
        "language": "English",
        "country": "United States",
        "subject_wrestler": "Mick Foley",
        "era": "Attitude Era",
        "territory_or_promotion": "WWF",
        "synopsis": "Bang bang",
        "source_url": "https://example.test/book",
        "confidence": "high",
        "primary_source_value": None,
    }
    saved = []

    monkeypatch.setattr(app_module, "query_one", lambda sql, params=None: book if "FROM books" in sql else None)
    monkeypatch.setattr(app_module, "query", lambda sql, params=None: [] if "DISTINCT" in sql else [{"name": "Mick Foley"}])
    monkeypatch.setattr(app_module, "update_book_from_form", lambda book_id, form: saved.append((book_id, form["title"])))

    client = app_module.app.test_client()
    get_response = client.get("/book/154/edit")
    assert get_response.status_code == 200
    assert b"Edit book" in get_response.data
    assert b"Have a Nice Day!" in get_response.data

    post_response = client.post("/book/154/edit", data={"title": "Updated", "category_code": "by_wrestler"})
    assert saved == [(154, "Updated")]
    assert post_response.status_code == 302
    assert post_response.headers["Location"].endswith("/book/154")
