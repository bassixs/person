"""Определение формата и извлечение текста (PROJECT_CONTEXT §9.2, ТЗ §3).

Формат определяется по содержимому (сигнатуре), а не по присланному типу. Честные статусы:
- `ok` — текст извлечён полностью;
- `partial` — часть страниц без текста (например, скан) — «документ обработан» не говорим;
- `failed` — текст не извлечён (ошибка разбора или пустой результат);
- `unsupported` — формат сохранён, но извлечение не подключено (изображения без OCR).
"""

import csv
import io
import re
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser

MAX_TEXT_CHARS = 2_000_000
MAX_XLSX_ROWS = 20_000

KINDS = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "txt": "text/plain",
    "md": "text/markdown",
    "csv": "text/csv",
    "html": "text/html",
}


class UnsupportedFormat(Exception):
    pass


@dataclass
class Extracted:
    kind: str
    mime: str
    text: str
    status: str  # ok | partial | failed | unsupported
    note: str
    pages_total: int | None = None
    pages_with_text: int | None = None
    title: str | None = None


def _decode(data: bytes) -> str | None:
    if b"\x00" in data[:8192]:
        return None
    for enc in ("utf-8-sig", "cp1251"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return None


def _looks_html(text: str) -> bool:
    head = text[:2000].lower()
    return "<html" in head or "<!doctype html" in head or "<body" in head


def detect(data: bytes, filename: str = "", content_type: str = "") -> str:
    """Возвращает вид материала по сигнатуре; расширение уточняет только текстовые форматы."""
    if data.startswith(b"%PDF"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith(b"PK\x03\x04"):
        try:
            names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
        except zipfile.BadZipFile as e:
            raise UnsupportedFormat("Повреждённый архив") from e
        if "word/document.xml" in names:
            return "docx"
        if "xl/workbook.xml" in names:
            return "xlsx"
        raise UnsupportedFormat("Архив этого типа не поддерживается")
    text = _decode(data)
    if text is None:
        raise UnsupportedFormat(
            "Формат не поддерживается: TXT, MD, CSV, PDF, DOCX, XLSX, PNG, JPG, WEBP"
        )
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if content_type == "text/html" or ext in ("html", "htm") or _looks_html(text):
        return "html"
    if ext in ("md", "markdown"):
        return "md"
    if ext == "csv" or content_type == "text/csv":
        return "csv"
    return "txt"


class _HtmlText(HTMLParser):
    SKIP = {"script", "style", "noscript", "template", "svg", "nav", "footer", "header", "form"}
    BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0
        self.in_title = False
        self.title = ""

    def handle_starttag(self, tag, attrs):  # type: ignore[no-untyped-def]
        if tag in self.SKIP:
            self.skip += 1
        elif tag == "title":
            self.in_title = True
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):  # type: ignore[no-untyped-def]
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        elif tag == "title":
            self.in_title = False
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):  # type: ignore[no-untyped-def]
        if self.in_title:
            self.title += data
        elif not self.skip:
            self.parts.append(data)


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:MAX_TEXT_CHARS]


def _result(kind: str, text: str, note_ok: str = "Текст извлечён") -> Extracted:
    text = _normalize(text)
    if not text:
        return Extracted(kind, KINDS[kind], "", "failed", "Текст не найден: документ пустой")
    return Extracted(kind, KINDS[kind], text, "ok", note_ok)


def extract(data: bytes, filename: str = "", content_type: str = "") -> Extracted:
    kind = detect(data, filename, content_type)
    try:
        if kind in ("txt", "md"):
            return _result(kind, _decode(data) or "")
        if kind == "csv":
            raw = _decode(data) or ""
            try:
                rows = list(csv.reader(io.StringIO(raw)))
                return _result(kind, "\n".join(" | ".join(r) for r in rows))
            except csv.Error:
                return _result(kind, raw)
        if kind == "html":
            p = _HtmlText()
            p.feed(_decode(data) or "")
            r = _result(kind, "".join(p.parts), "Текст страницы извлечён (без меню и скриптов)")
            r.title = _normalize(p.title)[:300] or None
            return r
        if kind == "pdf":
            return _pdf(data)
        if kind == "docx":
            return _docx(data)
        if kind == "xlsx":
            return _xlsx(data)
    except UnsupportedFormat:
        raise
    except Exception as e:  # noqa: BLE001 — любой сбой разбора = честный статус failed
        return Extracted(
            kind, KINDS[kind], "", "failed", f"Не удалось разобрать файл: {type(e).__name__}"
        )
    # Изображения
    return Extracted(
        kind,
        KINDS[kind],
        "",
        "unsupported",
        "Изображение сохранено. Распознавание текста (OCR) не подключено — текст не извлечён.",
    )


def _pdf(data: bytes) -> Extracted:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:  # noqa: BLE001
            return Extracted("pdf", KINDS["pdf"], "", "failed", "PDF защищён паролем")
    parts: list[str] = []
    with_text = 0
    total = len(reader.pages)
    for i, page in enumerate(reader.pages, start=1):
        t = (page.extract_text() or "").strip()
        if t:
            with_text += 1
            parts.append(f"— стр. {i} —\n{t}")
    text = _normalize("\n\n".join(parts))
    if not text:
        return Extracted(
            "pdf",
            KINDS["pdf"],
            "",
            "failed",
            f"Текст не найден ни на одной из {total} стр.: вероятно, скан. OCR не подключён.",
            total,
            0,
        )
    if with_text < total:
        return Extracted(
            "pdf",
            KINDS["pdf"],
            text,
            "partial",
            f"Текст есть на {with_text} из {total} стр.; "
            "остальные, вероятно, сканы — не разобраны.",
            total,
            with_text,
        )
    return Extracted(
        "pdf", KINDS["pdf"], text, "ok", f"Текст извлечён со всех {total} стр.", total, total
    )


def _docx(data: bytes) -> Extracted:
    import docx

    d = docx.Document(io.BytesIO(data))
    parts = [p.text for p in d.paragraphs]
    for table in d.tables:
        for row in table.rows:
            parts.append(" | ".join(c.text.strip() for c in row.cells))
    return _result("docx", "\n".join(parts))


def _xlsx(data: bytes) -> Extracted:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    rows_seen = 0
    cut = False
    for ws in wb.worksheets:
        parts.append(f"— лист «{ws.title}» —")
        for row in ws.iter_rows(values_only=True):
            rows_seen += 1
            if rows_seen > MAX_XLSX_ROWS:
                cut = True
                break
            cells = ["" if v is None else str(v) for v in row]
            if any(cells):
                parts.append(" | ".join(cells))
        if cut:
            break
    r = _result("xlsx", "\n".join(parts))
    if cut and r.status == "ok":
        r.status, r.note = "partial", f"Извлечены первые {MAX_XLSX_ROWS} строк таблицы"
    return r
