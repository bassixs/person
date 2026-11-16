"""Импорт исходной семёрки легенд как ЧЕРНОВИКОВ (никогда не активирует).

  python scripts/seed_personas.py --as editor@example.org --confirm

Обёртка над `python -m app.cli seed-personas` (apps/api). Идемпотентна.
"""

import pathlib
import sys

API = pathlib.Path(__file__).resolve().parent.parent / "apps" / "api"
sys.path.insert(0, str(API))

from app.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main(["seed-personas", *sys.argv[1:]]))
