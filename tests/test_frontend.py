from decimal import Decimal


def test_frontend_and_assets_are_served_without_mutation(client, snapshot):
    before = snapshot()
    response = client.get("/")
    assert response.status_code == 200
    assert 'lang="ru"' in response.text
    assert "Практикум" in response.text
    assert response.headers["cache-control"] == "no-store"
    for path in ("/ui/app.js", "/ui/utils.js", "/ui/styles.css", "/ui/favicon.svg"):
        assert client.get(path).status_code == 200
    assert snapshot() == before


def test_user_and_order_lists_include_new_actions(client):
    assert len(client.get("/users").json()) == 3
    assert client.get("/orders").json() == []
    response = client.post("/orders", json={"user_id": 2, "items": [{"product_id": 1, "quantity": 2}]})
    assert response.status_code == 201
    assert client.get("/orders").json() == [response.json()]


def test_database_snapshot_matches_sql_and_is_read_only(client, sql, snapshot):
    response = client.post("/orders", json={"user_id": 1, "items": [{"product_id": 1, "quantity": 2}]})
    assert response.status_code == 201
    before = snapshot()
    data = client.get("/lab/database").json()
    assert data["database"].startswith("playground_test_")
    assert set(data["tables"]) == {"users", "products", "orders", "order_items"}
    assert len(data["tables"]["users"]) == 3
    assert data["tables"]["products"][0]["stock"] == sql("SELECT stock FROM products WHERE id=1")[0]["stock"] == 8
    assert data["tables"]["products"][0]["price"] == "100.00"
    assert data["tables"]["orders"][0]["total_amount"] == "200.00"
    assert data["tables"]["order_items"][0]["order_id"] == response.json()["id"]
    assert Decimal(data["tables"]["order_items"][0]["unit_price"]) == Decimal("100.00")
    assert snapshot() == before
