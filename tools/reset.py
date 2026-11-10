import argparse
from sqlalchemy import text
from app.db import SessionLocal
from tools.seed import seed


def main():
    parser = argparse.ArgumentParser(description="Удалить все учебные записи и восстановить исходные данные")
    parser.add_argument("--yes", action="store_true", help="Подтверждение удаления данных полигона")
    args = parser.parse_args()
    if not args.yes:
        parser.error("Для сброса данных используйте --yes. Предварительно остановите эмулятор.")
    with SessionLocal.begin() as session:
        session.execute(text("TRUNCATE order_items, orders, products, users RESTART IDENTITY"))
        seed(session)
    print("Полигон сброшен: 3 пользователя, 5 товаров, заказов нет.")


if __name__ == "__main__":
    main()
