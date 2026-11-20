"""Итерация 3: база знаний (загрузка, извлечение, поиск), защита от SSRF, реестр источников."""

import io
import socket

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import get_engine
from app.knowledge import fetch as fetch_mod
from app.knowledge.fetch import FetchBlocked, FetchResult, check_url, resolve_public


def _pdf(pages: list[str]) -> bytes:
    """Минимальный PDF: страница с ASCII-текстом или пустая (как скан)."""
    objs: list[bytes] = []
    kids = []
    font_id = 3
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"")  # pages — заполним позже
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for t in pages:
        stream = f"BT /F1 12 Tf 72 720 Td ({t}) Tj ET".encode() if t else b""
        content_id = len(objs) + 1
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page_id = len(objs) + 1
        objs.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents %d 0 R "
            b"/Resources << /Font << /F1 %d 0 R >> >> >>" % (content_id, font_id)
        )
        kids.append(page_id)
    objs[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % k for k in kids),
        len(kids),
    )
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def _docx() -> bytes:
    import docx

    d = docx.Document()
    d.add_paragraph("Справка о графике вывоза мусора в Северном районе.")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text = "Улица Лесная"
    t.rows[0].cells[1].text = "вторник"
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _xlsx() -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Остановки"
    ws.append(["Остановка", "Маршрут"])
    ws.append(["Садовая", "12"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _upload(api, name, data, **form):
    return api.c.post(
        "/api/v1/knowledge/files",
        files={"file": (name, data, "application/octet-stream")},
        data=form,
        headers={"X-CSRF-Token": api.csrf},
    )


@pytest.fixture
def no_net():
    yield
    fetch_mod.set_fetch_override(None)


def test_upload_formats_and_honest_statuses(client_for):
    api = client_for("au@example.org", ["author"])
    r = _upload(api, "заметка.txt", "Мост на Лесной закрыт до 25 ноября.".encode("cp1251"))
    assert r.status_code == 201, r.text
    assert r.json()["extraction_status"] == "ok" and "Лесной" in r.json()["text"]

    r = _upload(api, "отчёт.pdf", _pdf(["Repair of the bridge ends on November 25", ""]))
    j = r.json()
    assert r.status_code == 201 and j["format"] == "pdf"
    assert j["extraction_status"] == "partial" and (j["pages_total"], j["pages_with_text"]) == (
        2,
        1,
    )
    assert "стр. 1" in j["text"]

    r = _upload(api, "скан.pdf", _pdf(["", ""]))
    assert r.json()["extraction_status"] == "failed" and "OCR" in r.json()["extraction_note"]

    j = _upload(api, "справка.docx", _docx()).json()
    assert j["format"] == "docx" and "Лесная | вторник" in j["text"]
    j = _upload(api, "остановки.xlsx", _xlsx()).json()
    assert j["format"] == "xlsx" and "Садовая | 12" in j["text"]

    j = _upload(api, "скрин.png", PNG).json()
    assert j["extraction_status"] == "unsupported" and j["has_file"] is True
    dl = api.c.get(f"/api/v1/knowledge/{j['id']}/file")
    assert dl.status_code == 200 and dl.content == PNG
    assert dl.headers["content-type"] == "application/octet-stream"
    assert dl.headers["content-disposition"].startswith("attachment")

    # Формат определяется по содержимому: исполняемый файл с «.pdf» не пройдёт.
    r = _upload(api, "virus.pdf", b"MZ\x90\x00" + b"\x00" * 100)
    assert r.status_code == 415
    # Повтор того же содержимого — дубликат.
    r = _upload(api, "копия.txt", "Мост на Лесной закрыт до 25 ноября.".encode("cp1251"))
    assert r.status_code == 409 and r.json()["error"]["details"]["existing_id"]


def test_search_returns_source_and_excerpt(client_for):
    api = client_for("au@example.org", ["author"])
    api.post(
        "/api/v1/knowledge/texts",
        json={
            "title": "Объявление о ремонте",
            "text": "Движение по мосту на Лесной улице закрыто. Объезд по Садовой.",
        },
    )
    api.post(
        "/api/v1/knowledge/texts",
        json={"title": "Про школу", "text": "Школа номер пять откроется после ремонта спортзала."},
    )
    hits = api.get("/api/v1/knowledge/search", params={"q": "мосты лесная"}).json()
    assert len(hits) == 1
    assert hits[0]["item"]["title"] == "Объявление о ремонте"
    assert "⟦" in hits[0]["excerpt"]  # морфология: «мосты» нашло «мосту»


def test_topic_layer_and_links(client_for):
    ed = client_for("ed@example.org", ["editor"])
    t = ed.post("/api/v1/topics", json={"title": "Ремонт моста"}).json()
    r = ed.post(
        "/api/v1/knowledge/texts",
        json={"title": "Материал темы", "text": "Текст о мосте и сроках.", "layer": "topic"},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "topic_required"
    r = ed.post(
        "/api/v1/knowledge/texts",
        json={
            "title": "Материал темы",
            "text": "Текст о мосте и сроках.",
            "layer": "topic",
            "topic_ids": [t["id"]],
        },
    )
    assert r.status_code == 201 and r.json()["topics"][0]["title"] == "Ремонт моста"
    lst = ed.get("/api/v1/knowledge", params={"topic_id": t["id"]}).json()
    assert lst["total"] == 1
    assert ed.get("/api/v1/knowledge/search", params={"q": "мост", "topic_id": t["id"]}).json()


def test_ssrf_guard():
    for bad in (
        "http://localhost/admin",
        "http://127.0.0.1/",
        "http://10.0.0.5/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "file:///etc/passwd",
        "ftp://example.org/x",
        "http://example.org:8080/",
        "http://user:pass@example.org/",
        "http://db.internal/",
    ):
        with pytest.raises(FetchBlocked):
            check_url(bad)
    assert check_url("https://example.org/news") == ("example.org", 443)


def test_dns_pointing_inside_is_blocked(monkeypatch):
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, 1, 6, "", ("10.1.2.3", 80))]
    )
    with pytest.raises(FetchBlocked):
        resolve_public("evil.example", 80)


def test_url_import_blocked_and_ok(client_for, no_net):
    api = client_for("au@example.org", ["author"])
    r = api.post("/api/v1/knowledge/urls", json={"url": "http://127.0.0.1:8000/api/v1/health"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "url_blocked"

    page = "<html><head><title>Новости района</title><script>evil()</script></head><body><p>Мост откроют 30 ноября.</p></body></html>"
    fetch_mod.set_fetch_override(
        lambda url, mx: FetchResult(url, url, 200, "text/html", page.encode(), False, 12)
    )
    r = api.post("/api/v1/knowledge/urls", json={"url": "https://example.org/news/1"})
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["title"] == "Новости района" and "30 ноября" in j["text"] and "evil" not in j["text"]


def test_rbac(client_for):
    op = client_for("op@example.org", ["operator"])
    assert op.get("/api/v1/knowledge").status_code == 403
    au = client_for("au@example.org", ["author"])
    assert au.post("/api/v1/sources", json={"name": "Сайт администрации"}).status_code == 403
    item = au.post(
        "/api/v1/knowledge/texts",
        json={"title": "Заметка автора", "text": "Какой-то текст заметки."},
    ).json()
    au2 = client_for("au2@example.org", ["author"])
    assert au2.post(f"/api/v1/knowledge/{item['id']}/archive").status_code == 403
    ed = client_for("ed@example.org", ["editor"])
    assert ed.post(f"/api/v1/knowledge/{item['id']}/archive").json()["archived_at"]
    assert ed.get("/api/v1/knowledge").json()["total"] == 0
    admin = client_for("ad@example.org", ["admin"])
    assert admin.get("/api/v1/knowledge").status_code == 200
    assert (
        admin.post("/api/v1/knowledge/texts", json={"title": "x" * 5, "text": "y" * 20}).status_code
        == 403
    )


def test_sources_registry_and_check(client_for, no_net):
    ed = client_for("ed@example.org", ["editor"])
    r = ed.post("/api/v1/sources", json={"name": "Внутренний", "url": "http://192.168.1.1/"})
    assert r.status_code == 422
    s = ed.post(
        "/api/v1/sources",
        json={
            "name": "Сайт администрации",
            "url": "https://example.org",
            "kind": "official",
            "priority": 5,
        },
    ).json()
    assert s["status"] == "active" and s["last_checked_at"] is None

    fetch_mod.set_fetch_override(
        lambda url, mx: FetchResult(url, url, 200, "text/html", b"<html></html>", False, 30)
    )
    r = ed.post(f"/api/v1/sources/{s['id']}/check")
    assert r.status_code == 200 and r.json()["ok"] is True

    def down(url, mx):
        raise fetch_mod.FetchFailed("Источник не ответил вовремя")

    fetch_mod.set_fetch_override(down)
    r = ed.post(f"/api/v1/sources/{s['id']}/check")
    assert r.json()["ok"] is False
    s2 = ed.get(f"/api/v1/sources/{s['id']}").json()
    assert s2["last_error"] == "Источник не ответил вовремя" and s2["last_ok_at"] is not None
    assert len(ed.get(f"/api/v1/sources/{s['id']}/fetches").json()) == 2

    # Материал из источника учитывается в реестре.
    ed.post(
        "/api/v1/knowledge/texts",
        json={"title": "Из источника", "text": "Сообщение администрации.", "source_id": s["id"]},
    )
    assert ed.get(f"/api/v1/sources/{s['id']}").json()["items_count"] == 1

    assert (
        ed.patch(f"/api/v1/sources/{s['id']}", json={"status": "disabled"}).json()["status"]
        == "disabled"
    )
    assert ed.post(f"/api/v1/sources/{s['id']}/check").status_code == 409

    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(text("DELETE FROM source_fetches WHERE source_id = :i"), {"i": s["id"]})
