import os

import pytest
from sqlalchemy.engine import make_url

# Проверка выполняется до импорта приложения и любых операций с таблицами.
url = make_url(os.getenv("DATABASE_URL", "postgresql+psycopg://localhost/unsafe"))
if (os.getenv("TEST_RUN_ACTIVE") != "1" or url.get_backend_name() != "postgresql"
        or not (url.database or "").startswith("playground_test_")):
    raise pytest.UsageError("Запускайте тесты только через python -m tools.run_tests")

from fastapi.testclient import TestClient
from sqlalchemy import text
from app.db import SessionLocal, engine
from app.main import app
from tools.seed import seed


@pytest.fixture(autouse=True)
def demo_data():
    with SessionLocal.begin() as db:
        db.execute(text("TRUNCATE order_items, orders, products, users RESTART IDENTITY"))
        seed(db)
    yield


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def sql():
    def execute(query, **params):
        with engine.begin() as connection:
            result = connection.execute(text(query), params)
            return [dict(row) for row in result.mappings()] if result.returns_rows else []
    return execute


@pytest.fixture
def snapshot(sql):
    def read():
        return {table: sql(f"SELECT * FROM {table} ORDER BY id")
                for table in ("users", "products", "orders", "order_items")}
    return read
