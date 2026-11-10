"""Concurrent last-item purchase via HTTP; creates its own users and product."""
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx


def main():
    base = os.getenv("API_URL", "http://localhost:8000")
    run = uuid.uuid4().hex[:12]
    with httpx.Client(base_url=base, timeout=15) as client:
        users = []
        for i in range(2):
            response = client.post("/users", json={"name": f"Race {i}", "email": f"race-{run}-{i}@example.com"})
            response.raise_for_status()
            users.append(response.json()["id"])
        response = client.post("/products", json={"name": f"Race-{run}", "price": "10.00", "stock": 1})
        response.raise_for_status()
        product_id = response.json()["id"]
    barrier = threading.Barrier(2)

    def buy(user_id):
        with httpx.Client(base_url=base, timeout=15) as client:
            barrier.wait(timeout=10)
            return client.post("/orders", json={"user_id": user_id,
                               "items": [{"product_id": product_id, "quantity": 1}]})

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(buy, users))
    codes = sorted(response.status_code for response in results)
    for response in results:
        print(response.status_code, response.json())
    with httpx.Client(base_url=base, timeout=15) as client:
        response = client.get(f"/products/{product_id}")
        response.raise_for_status()
        stock = response.json()["stock"]
        orders = []
        for user in users:
            response = client.get(f"/users/{user}/orders")
            response.raise_for_status()
            orders.extend(response.json())
    print(f"product_id={product_id}, user_ids={users}, stock={stock}, orders={len(orders)}")
    if codes != [201, 409] or stock != 0 or len(orders) != 1:
        raise SystemExit("FAIL: нарушены ожидания конкурентной покупки")
    print("PASS: один заказ, один отказ, остаток 0. Данные оставлены для SQL-проверки.")


if __name__ == "__main__":
    main()
