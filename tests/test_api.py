from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from tools.seed import seed


def payload(items=None, user=1):
    return {"user_id": user, "items": items if items is not None else [{"product_id": 1, "quantity": 2}]}


def test_create_user(client, sql):
    response = client.post("/users", json={"name": "Тест", "email": "new@example.com"})
    assert response.status_code == 201
    assert response.json()["created_at"]
    assert sql("SELECT name, email FROM users WHERE id=:id", id=response.json()["id"]) == [
        {"name": "Тест", "email": "new@example.com"}]
    assert sql("SELECT count(*) AS n FROM users")[0]["n"] == 4


def test_duplicate_email_no_changes(client, snapshot):
    before = snapshot()
    response = client.post("/users", json={"name": "Другой", "email": "ALEX@example.com"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_exists"
    assert snapshot() == before


def test_order_persists_and_reads(client, sql):
    response = client.post("/orders", json=payload())
    assert response.status_code == 201
    order = response.json()
    assert Decimal(order["total_amount"]) == Decimal("200.00")
    assert order["status"] == "created"
    assert order["cancelled_at"] is None
    assert client.get(f"/orders/{order['id']}").json() == order
    assert client.get("/users/1/orders").json() == [order]
    assert sql("SELECT stock FROM products WHERE id=1")[0]["stock"] == 8
    assert sql("SELECT count(*) AS n FROM orders")[0]["n"] == 1
    assert sql("SELECT quantity, unit_price FROM order_items WHERE order_id=:id", id=order["id"]) == [
        {"quantity": 2, "unit_price": Decimal("100.00")}]


def test_multiple_items_and_price_snapshot(client, sql):
    response = client.post("/orders", json=payload([
        {"product_id": 1, "quantity": 2}, {"product_id": 2, "quantity": 3}]))
    assert response.status_code == 201
    order = response.json()
    assert Decimal(order["total_amount"]) == Decimal("276.50")
    assert sql("SELECT id, stock FROM products WHERE id IN (1,2) ORDER BY id") == [
        {"id": 1, "stock": 8}, {"id": 2, "stock": 17}]
    sql("UPDATE products SET price=999 WHERE id=1")
    saved = client.get(f"/orders/{order['id']}").json()
    assert Decimal(saved["items"][0]["unit_price"]) == Decimal("100.00")
    assert Decimal(saved["total_amount"]) == Decimal("276.50")


def test_insufficient_stock_no_changes(client, snapshot):
    before = snapshot()
    response = client.post("/orders", json=payload([{"product_id": 1, "quantity": 11}]))
    assert response.status_code == 409
    assert snapshot() == before


def test_partial_order_rolls_back(client, snapshot):
    before = snapshot()
    response = client.post("/orders", json=payload([
        {"product_id": 1, "quantity": 2}, {"product_id": 5, "quantity": 1}]))
    assert response.status_code == 409
    assert snapshot() == before


def test_cancel_and_repeat(client, sql, snapshot):
    order = client.post("/orders", json=payload()).json()
    response = client.post(f"/orders/{order['id']}/cancel")
    assert response.status_code == 200
    cancelled = response.json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["cancelled_at"] is not None
    assert sql("SELECT stock FROM products WHERE id=1")[0]["stock"] == 10
    before = snapshot()
    assert client.post(f"/orders/{order['id']}/cancel").json() == cancelled
    assert snapshot() == before


@pytest.mark.parametrize("body", [
    payload(user=999999), payload([{"product_id": 999999, "quantity": 1}]),
])
def test_missing_entities_no_changes(client, snapshot, body):
    before = snapshot()
    assert client.post("/orders", json=body).status_code == 404
    assert snapshot() == before


@pytest.mark.parametrize("body", [
    payload([]),
    payload([{"product_id": 1, "quantity": 0}]),
    payload([{"product_id": 1, "quantity": -1}]),
    payload([{"product_id": 1, "quantity": 1.5}]),
    payload([{"product_id": 1, "quantity": True}]),
    payload([{"product_id": 1, "quantity": 1}, {"product_id": 1, "quantity": 2}]),
])
def test_invalid_order_no_changes(client, snapshot, body):
    before = snapshot()
    response = client.post("/orders", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert snapshot() == before


@pytest.mark.parametrize("price,stock", [("-1", 2), ("0", 2), ("1.001", 2), ("1", -1)])
def test_invalid_product(client, snapshot, price, stock):
    before = snapshot()
    assert client.post("/products", json={"name": "Ошибка", "price": price, "stock": stock}).status_code == 422
    assert snapshot() == before


def test_concurrent_last_item(client, sql):
    barrier = Barrier(2)

    def buy(user):
        with TestClient(app) as other:
            barrier.wait(timeout=10)
            return other.post("/orders", json=payload([{"product_id": 4, "quantity": 1}], user=user))

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(buy, [1, 2]))
    assert sorted(r.status_code for r in responses) == [201, 409]
    assert sql("SELECT stock FROM products WHERE id=4")[0]["stock"] == 0
    assert sql("SELECT count(*) AS n FROM orders")[0]["n"] == 1
    assert sql("SELECT product_id, quantity FROM order_items") == [{"product_id": 4, "quantity": 1}]


def test_concurrent_cancellation(client, sql):
    order_id = client.post("/orders", json=payload()).json()["id"]
    barrier = Barrier(2)

    def cancel(_):
        with TestClient(app) as other:
            barrier.wait(timeout=10)
            return other.post(f"/orders/{order_id}/cancel")

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(cancel, range(2)))
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert sql("SELECT stock FROM products WHERE id=1")[0]["stock"] == 10


def test_seed_idempotent_preserves_current_stock(client, snapshot):
    assert client.post("/orders", json=payload()).status_code == 201
    before = snapshot()
    with SessionLocal.begin() as db:
        seed(db)
    assert snapshot() == before


def test_health_and_error_documentation(client):
    assert client.get("/health").json() == {"status": "ok", "database": "ok"}
    assert client.get("/does-not-exist").json()["error"]["code"] == "http_error"
    assert client.get("/users/999999/orders").status_code == 404
    assert client.post("/orders/999999/cancel").status_code == 404
    schema = client.get("/openapi.json").json()
    assert schema["paths"]["/orders"]["post"]["responses"]["422"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponse"}
