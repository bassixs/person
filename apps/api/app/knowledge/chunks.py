"""Нарезка текста материала на куски для смыслового поиска и отбора контекста ИИ.

Куски ~1200 символов с перекрытием ~200, режем по абзацам и предложениям. Номер страницы
берём из маркеров «— стр. N —», которые ставит извлечение PDF, — чтобы в цитате было место.
"""

import re
from dataclasses import dataclass

TARGET = 1200
OVERLAP = 200
MAX_CHUNKS = 2000

_PAGE = re.compile(r"— стр\. (\d+) —")
_SPLIT = re.compile(r"(?<=[.!?…])\s+|\n+")


@dataclass
class Chunk:
    position: int
    text: str
    char_start: int
    page: int | None


def _page_at(markers: list[tuple[int, int]], pos: int) -> int | None:
    page = None
    for at, n in markers:
        if at <= pos:
            page = n
        else:
            break
    return page


def split(text: str) -> list[Chunk]:
    text = text.strip()
    if not text:
        return []
    markers = [(m.start(), int(m.group(1))) for m in _PAGE.finditer(text)]
    # Маркеры страниц заменяем переводами строк той же длины: позиции сохраняются,
    # а сам маркер не попадает в текст кусков.
    text = _PAGE.sub(lambda m: "\n" * len(m.group(0)), text)
    # Предложения с позициями.
    pieces: list[tuple[int, str]] = []
    pos = 0
    for part in _SPLIT.split(text):
        if not part:
            continue
        start = text.find(part, pos)
        pos = start + len(part)
        part = part.strip()
        if part and not _PAGE.fullmatch(part):
            # Очень длинное «предложение» (таблица, перечень) режем жёстко.
            for k in range(0, len(part), TARGET):
                pieces.append((start + k, part[k : k + TARGET]))
    chunks: list[Chunk] = []
    buf: list[tuple[int, str]] = []
    size = 0
    for start, part in pieces:
        if buf and size + len(part) > TARGET:
            chunks.append(_make(len(chunks), buf, markers))
            # перекрытие: хвост предыдущего куска
            tail: list[tuple[int, str]] = []
            t = 0
            for s, p in reversed(buf):
                if t + len(p) > OVERLAP:
                    break
                tail.insert(0, (s, p))
                t += len(p)
            buf, size = tail, t
            if len(chunks) >= MAX_CHUNKS:
                break
        buf.append((start, part))
        size += len(part) + 1
    if buf and len(chunks) < MAX_CHUNKS:
        chunks.append(_make(len(chunks), buf, markers))
    return chunks


def _make(position: int, buf: list[tuple[int, str]], markers: list[tuple[int, int]]) -> Chunk:
    start = buf[0][0]
    return Chunk(
        position=position,
        text=" ".join(p for _, p in buf),
        char_start=start,
        page=_page_at(markers, start),
    )
