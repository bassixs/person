"""Замер эмбеддинг-моделей AITUNNEL на русском поиске (корпус «Ремонт моста» + соседние темы).

Метрики: Hit@1 (первым найден нужный документ), Recall@5, MRR@10, задержка, стоимость.
Базовая линия — нынешний полнотекстовый поиск PostgreSQL (websearch_to_tsquery, russian).
Ключ читается из .env и никуда не выводится.
"""

import json
import math
import pathlib
import sys
import time

import httpx

ROOT = pathlib.Path(sys.argv[1])
DATA = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
env = dict(
    l.split("=", 1)
    for l in (ROOT / ".env").read_text(encoding="utf-8").splitlines()
    if "=" in l and not l.startswith("#")
)
BASE = env["LLM_BASE_URL"].rstrip("/")
KEY = env["LLM_API_KEY"]

MODELS = [
    "qwen3-embedding-8b",
    "voyage-4",
    "voyage-4-large",
    "embed-5-fast",
    "embed-5-pro",
    "gigachat-embeddings-2",
    "text-embedding-3-small",
    "text-embedding-3-large",
    "gemini-embedding-001",
    "pplx-embed-v1-4b",
]
ids = list(DATA["docs"])
docs = [DATA["docs"][i] for i in ids]
queries = DATA["queries"]


def embed(model, texts):
    t = time.perf_counter()
    r = httpx.post(
        f"{BASE}/embeddings",
        headers={"Authorization": f"Bearer {KEY}"},
        json={"model": model, "input": texts},
        timeout=120,
    )
    dt = time.perf_counter() - t
    if r.status_code != 200:
        raise RuntimeError(f"{r.status_code} {r.text[:200]}")
    j = r.json()
    vecs = [d["embedding"] for d in sorted(j["data"], key=lambda d: d["index"])]
    usage = j.get("usage", {})
    return vecs, dt, usage


def cos(a, b):
    s = sum(x * y for x, y in zip(a, b))
    return s / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)) or 1)


def score(rankings):
    hit1 = rec5 = mrr = 0.0
    for q, ranked in zip(queries, rankings):
        rel = set(q["rel"])
        hit1 += ranked[0] in rel if ranked else 0
        rec5 += len(rel & set(ranked[:5])) / len(rel)
        rr = next((1 / (k + 1) for k, d in enumerate(ranked[:10]) if d in rel), 0)
        mrr += rr
    n = len(queries)
    return hit1 / n, rec5 / n, mrr / n


results = []
misses = {}
for m in MODELS:
    try:
        dv, t1, u1 = embed(m, docs)
        qv, t2, u2 = embed(m, [q["q"] for q in queries])
    except Exception as e:  # noqa: BLE001
        print(f"{m:26} ОШИБКА {e}")
        continue
    rankings = []
    for v in qv:
        sims = sorted(((cos(v, d), i) for d, i in zip(dv, ids)), reverse=True)
        rankings.append([i for _, i in sims])
    h1, r5, mrr = score(rankings)
    tok = (u1.get("total_tokens") or u1.get("prompt_tokens") or 0) + (
        u2.get("total_tokens") or u2.get("prompt_tokens") or 0
    )
    results.append((m, h1, r5, mrr, len(dv[0]), round(t2 * 1000), tok))
    misses[m] = [q["q"] for q, r in zip(queries, rankings) if r[0] not in q["rel"]]
    print(f"{m:26} hit@1={h1:.2f} recall@5={r5:.2f} mrr={mrr:.3f} dim={len(dv[0])} "
          f"запросы={round(t2*1000)}мс токены={tok}", flush=True)

# Базовая линия: полнотекстовый поиск PostgreSQL, как в /knowledge/search
try:
    import psycopg

    url = env["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(url) as c:
        rankings = []
        for q in queries:
            rows = c.execute(
                "SELECT id, ts_rank_cd(to_tsvector('russian', t), websearch_to_tsquery('russian', %s)) r "
                "FROM unnest(%s::text[], %s::text[]) AS x(id, t) "
                "WHERE to_tsvector('russian', t) @@ websearch_to_tsquery('russian', %s) ORDER BY r DESC",
                (q["q"], ids, docs, q["q"]),
            ).fetchall()
            rankings.append([r[0] for r in rows])
        h1, r5, mrr = score(rankings)
        empty = sum(1 for r in rankings if not r)
        print(f"{'ПОИСК ПО СЛОВАМ (сейчас)':26} hit@1={h1:.2f} recall@5={r5:.2f} mrr={mrr:.3f} "
              f"пустых ответов={empty}/{len(queries)}")
except Exception as e:  # noqa: BLE001
    print("baseline error", e)

print("\nПРОМАХИ (первым найден не тот документ):")
for m, h1, *_ in sorted(results, key=lambda r: -r[3])[:4]:
    print(f"  {m}: {misses[m]}")
pathlib.Path(sys.argv[3]).write_text(json.dumps({"results": results, "misses": misses}, ensure_ascii=False, indent=1), encoding="utf-8")
