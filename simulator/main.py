import asyncio
import json
import os
import random
import uuid
from collections import Counter

import httpx


async def simulate():
    base = os.getenv("API_URL", "http://api:8000")
    users = int(os.getenv("SIM_USERS", "4"))
    actions = int(os.getenv("SIM_ACTIONS", "12"))
    delay = float(os.getenv("SIM_DELAY", "0.2"))
    seed = int(os.getenv("SIM_SEED", "42"))
    if not (1 <= users <= 100) or not (1 <= actions <= 100_000) or not 0 <= delay <= 60:
        raise SystemExit("Ожидаются SIM_USERS=1..100, SIM_ACTIONS=1..100000, SIM_DELAY=0..60")
    run = uuid.uuid4().hex[:12]
    summary = Counter(success=0, expected_rejection=0, unexpected_error=0)

    async with httpx.AsyncClient(base_url=base, timeout=20,
                                 limits=httpx.Limits(max_connections=users)) as client:
        async def request(method, path, expected=(200,), **kwargs):
            try:
                response = await client.request(method, path, **kwargs)
                if response.status_code not in expected:
                    summary["unexpected_error"] += 1
                    print(f"UNEXPECTED {method} {path}: {response.status_code} {response.text[:300]}", flush=True)
                    return None
                if response.status_code >= 400:
                    summary["expected_rejection"] += 1
                else:
                    summary["success"] += 1
                return response
            except httpx.HTTPError as exc:
                summary["unexpected_error"] += 1
                print(f"HTTP ERROR {method} {path}: {exc}", flush=True)
                return None

        async def worker(number):
            rng = random.Random(seed + number)
            response = await request("POST", "/users", expected=(201,), json={
                "name": f"Simulator {number}", "email": f"sim-{run}-{number}@example.com",
            })
            if response is None:
                return
            user_id = response.json()["id"]
            order_ids = []
            for _ in range(actions):
                choice = rng.random()
                if choice < 0.2:
                    await request("POST", "/orders", expected=(422,), json={"user_id": user_id, "items": []})
                elif choice < 0.4 and order_ids:
                    order_id = rng.choice(order_ids)
                    await request("POST", f"/orders/{order_id}/cancel")
                else:
                    response = await request("GET", "/products")
                    if response is not None and response.json():
                        product = rng.choice(response.json())
                        response = await request("POST", "/orders", expected=(201, 409), json={
                            "user_id": user_id,
                            "items": [{"product_id": product["id"], "quantity": rng.randint(1, 3)}],
                        })
                        if response is not None and response.status_code == 201:
                            order_ids.append(response.json()["id"])
                    elif response is not None:
                        summary["success"] -= 1
                        summary["unexpected_error"] += 1
                        print("Нет товаров: выполните seed перед эмуляцией", flush=True)
                await asyncio.sleep(delay)

        await asyncio.gather(*(worker(i) for i in range(users)))
    print(json.dumps({"run": run, "users": users, "actions_per_user": actions,
                      "http_requests": dict(summary)}, ensure_ascii=False), flush=True)
    return 1 if summary["unexpected_error"] else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(simulate()))
