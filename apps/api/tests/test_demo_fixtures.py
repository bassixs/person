"""Демо-сборка (GitHub Pages) не должна расходиться со схемой и seed настоящего backend."""

import json
import pathlib

from app.seed_data import demo_fixtures

FIXTURE = pathlib.Path(__file__).resolve().parents[2] / "web" / "src" / "demo" / "fixtures.json"


def test_demo_fixtures_up_to_date():
    current = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert current == json.loads(
        json.dumps(demo_fixtures(), ensure_ascii=False)
    ), "Обновите: python -m app.cli export-demo --out ../web/src/demo/fixtures.json"
