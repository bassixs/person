"""Итерация 4: смысловой поиск (pgvector) — индексация, гибридный поиск, отбор кусков для ИИ."""

import json

import pytest

from app.ai import topic_researcher
from app.ai.client import Completion, set_provider_override
from app.ai.embeddings import set_embedder_override
from app.knowledge.chunks import split

# Подменная модель: слова-синонимы попадают в одно «смысловое» измерение.
CONCEPTS = {
    "мост": 0,
    "переправ": 0,
    "закры": 1,
    "перекры": 1,
    "автобус": 2,
    "маршрут": 2,
    "мусор": 3,
    "отход": 3,
    "вод": 4,
    "кран": 4,
    "школ": 5,
    "дет": 5,
}


def fake_embed(texts):
    out = []
    for t in texts:
        v = [0.0] * 1024
        for w in t.lower().replace(",", " ").replace(".", " ").split():
            for stem, i in CONCEPTS.items():
                if w.startswith(stem):
                    v[i] += 1
        v[1023] += 0.01  # чтобы не было нулевого вектора
        out.append(v)
    return out


@pytest.fixture
def emb():
    set_embedder_override(fake_embed)
    yield
    set_embedder_override(None)


def _text(api, title, text, **kw):
    r = api.post("/api/v1/knowledge/texts", json={"title": title, "text": text, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_index_and_hybrid_search(client_for, emb):
    api = client_for("ed@example.org", ["editor"])
    a = _text(api, "Объявление", "Мост на Лесной закрыт до конца ноября.")
    _text(api, "График", "Вывоз мусора по вторникам и пятницам.")
    assert api.get(f"/api/v1/knowledge/{a['id']}").json()["index_status"] == "ok"
    st = api.get("/api/v1/knowledge/index-status").json()
    assert st["configured"] is True and st["counts"] == {"ok": 2}

    # «переправу перекрыли» — ни одного общего слова с документом.
    text_only = api.get(
        "/api/v1/knowledge/search", params={"q": "переправу перекрыли", "mode": "text"}
    ).json()
    assert text_only["semantic"] is False and text_only["hits"] == []
    r = api.get("/api/v1/knowledge/search", params={"q": "переправу перекрыли"}).json()
    assert r["semantic"] is True
    assert r["hits"][0]["item"]["id"] == a["id"] and r["hits"][0]["match"] == "semantic"
    assert "Мост на Лесной" in r["hits"][0]["excerpt"]

    # Совпадение и по словам, и по смыслу.
    r = api.get("/api/v1/knowledge/search", params={"q": "мост закрыт"}).json()
    assert r["hits"][0]["match"] == "both"


def test_without_embeddings_text_only(client_for):
    api = client_for("ed@example.org", ["editor"])
    a = _text(api, "Объявление", "Мост на Лесной закрыт до конца ноября.")
    assert a["index_status"] == "none"
    r = api.get("/api/v1/knowledge/search", params={"q": "мост"}).json()
    assert r["semantic"] is False and r["hits"][0]["match"] == "text"
    assert api.post("/api/v1/knowledge/reindex").status_code == 503

    # Ключ подключили — переиндексация.
    set_embedder_override(fake_embed)
    try:
        assert api.post("/api/v1/knowledge/reindex").json() == {"queued": 1}
        assert api.get(f"/api/v1/knowledge/{a['id']}").json()["index_status"] == "ok"
    finally:
        set_embedder_override(None)
    au = client_for("au@example.org", ["author"])
    assert au.post("/api/v1/knowledge/reindex").status_code == 403


def test_embedding_failure_is_honest(client_for):
    def broken(texts):
        raise ValueError("сеть упала")

    set_embedder_override(broken)
    try:
        api = client_for("ed@example.org", ["editor"])
        a = _text(api, "Объявление", "Мост на Лесной закрыт до конца ноября.")
        it = api.get(f"/api/v1/knowledge/{a['id']}").json()
        assert it["index_status"] == "failed" and it["index_error"]
    finally:
        set_embedder_override(None)


def test_split_keeps_pages_and_overlap():
    text = (
        "— стр. 1 —\n"
        + " ".join(f"Предложение номер {i} про мост." for i in range(60))
        + "\n\n— стр. 2 —\n"
        + " ".join(f"Фраза {i} про автобус." for i in range(60))
    )
    parts = split(text)
    assert len(parts) >= 3
    assert parts[0].page == 1 and parts[-1].page == 2
    assert all(len(p.text) <= 1500 for p in parts)
    assert "стр." not in parts[0].text[:12]  # маркер страницы не попадает в текст куска
    # перекрытие: конец куска повторяется в начале следующего
    assert parts[0].text.split(".")[-2].strip() in parts[1].text


def test_understanding_gets_relevant_fragments(client_for, emb, monkeypatch):
    monkeypatch.setattr(topic_researcher, "MATERIALS_BUDGET", 3000)
    api = client_for("ed@example.org", ["editor"])
    t = api.post(
        "/api/v1/topics", json={"title": "Мост закрыт", "summary": "Мост на Лесной закрыт"}
    ).json()
    filler = " ".join(f"Отвлечённая строка {i} о погоде и праздниках." for i in range(400))
    big = filler + " Главное: переправу перекрыли до 30 ноября. " + filler
    _text(api, "Большой отчёт", big, layer="topic", topic_ids=[t["id"]])

    class LLM:
        model = "m"
        prompt = ""

        def complete(self, messages):
            LLM.prompt = messages[1]["content"]
            return Completion(text=json.dumps({"summary": "ok", "understood": True}), model="m")

    set_provider_override(LLM())
    try:
        r = api.post(f"/api/v1/topics/{t['id']}/understanding")
        run = api.get(f"/api/v1/topics/{t['id']}/understanding/{r.json()['id']}").json()
    finally:
        set_provider_override(None)
    assert run["status"] == "done"
    assert "переправу перекрыли до 30 ноября" in LLM.prompt  # нужный кусок из середины попал к ИИ
    assert "выбранные фрагменты" in LLM.prompt
    assert run["card"]["sources"][0]["fragments"] is True


def test_unrelated_documents_are_not_shown(client_for, emb):
    api = client_for("ed@example.org", ["editor"])
    _text(api, "Объявление", "Мост на Лесной закрыт до конца ноября.")
    _text(api, "Вода", "Плановое снижение давления воды ночью.")
    hits = api.get("/api/v1/knowledge/search", params={"q": "переправа"}).json()["hits"]
    assert [h["item"]["title"] for h in hits] == ["Объявление"]
