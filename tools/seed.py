"""Idempotent demo data. Does not restore stocks of existing products."""
from decimal import Decimal

from sqlalchemy import select, text
from app.db import SessionLocal
from app.models import Product, User

USERS = [("Алексей", "alex@example.com"), ("Мария", "maria@example.com"), ("Иван", "ivan@example.com")]
PRODUCTS = [
    ("Блокнот", "100.00", 10),
    ("Ручка", "25.50", 20),
    ("Рюкзак", "2500.00", 3),
    ("Кружка", "450.00", 1),
    ("Календарь", "300.00", 0),
]


def seed(session):
    # Сериализует два одновременных seed; не меняет уже существующие строки.
    session.execute(text("SELECT pg_advisory_xact_lock(732019)"))
    for name, email in USERS:
        if session.scalar(select(User).where(User.email == email)) is None:
            session.add(User(name=name, email=email))
    for name, price, stock in PRODUCTS:
        if session.scalar(select(Product).where(Product.name == name)) is None:
            session.add(Product(name=name, price=Decimal(price), stock=stock))
    session.flush()
    print("Учебные данные готовы. Текущие товары:")
    for product in session.scalars(select(Product).order_by(Product.id)):
        print(f"  id={product.id} {product.name}: price={product.price}, stock={product.stock}")


def main():
    with SessionLocal.begin() as session:
        seed(session)


if __name__ == "__main__":
    main()
