import logging
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path as FilePath
from typing import Annotated

from fastapi import Depends, FastAPI, Path
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.db import get_session
from app.models import Order, OrderItem, Product, User
from app.schemas import (
    DatabaseSnapshot, ErrorResponse, HealthResponse, OrderCreate, OrderOut,
    ProductCreate, ProductOut, UserCreate, UserOut,
)

logger = logging.getLogger(__name__)
ERRORS = {code: {"model": ErrorResponse, "description": description} for code, description in {
    404: "Объект не найден", 409: "Конфликт данных или недостаточный остаток",
    422: "Ошибка валидации", 500: "Внутренняя ошибка", 503: "База недоступна",
}.items()}
app = FastAPI(
    title="API → PostgreSQL: учебный полигон", version="1.0.0",
    description="Выполните действие, сохраните ID и проверьте данные SQL-запросами. "
                "Денежные значения в ответах передаются строками с точностью до копеек.",
    responses=ERRORS,
)
DB = Annotated[Session, Depends(get_session)]
ID = Annotated[int, Path(gt=0, le=2_147_483_647)]


class DomainError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def error_response(status, code, message, details=None):
    return JSONResponse(status_code=status, content={"error": {
        "code": code, "message": message, "details": details or [],
    }})


@app.exception_handler(DomainError)
async def domain_error(request, exc):
    return error_response(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    details = [{"location": list(e["loc"]), "message": e["msg"], "type": e["type"]}
               for e in exc.errors()]
    return error_response(422, "validation_error", "Проверьте параметры запроса", details)


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return error_response(exc.status_code, "http_error", str(exc.detail))


@app.exception_handler(SQLAlchemyError)
async def database_error(request, exc):
    logger.exception("Database operation failed")
    if isinstance(exc, OperationalError):
        return error_response(503, "database_unavailable", "База данных недоступна")
    return error_response(500, "internal_error", "Не удалось выполнить операцию")


@app.exception_handler(Exception)
async def internal_error(request, exc):
    logger.exception("Unexpected error")
    return error_response(500, "internal_error", "Внутренняя ошибка")


def require(db, model, object_id):
    obj = db.get(model, object_id)
    if obj is None:
        raise DomainError(404, "not_found", f"{model.__tablename__}: запись {object_id} не найдена")
    return obj


@app.get("/health", response_model=HealthResponse, tags=["Состояние"], summary="Проверить API и БД")
def health(db: DB):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}


@app.post("/users", response_model=UserOut, status_code=201, tags=["Пользователи"],
          summary="Создать пользователя")
def create_user(body: UserCreate, db: DB):
    try:
        with db.begin():
            user = User(**body.model_dump())
            db.add(user)
            db.flush()
    except IntegrityError as exc:
        if getattr(exc.orig, "sqlstate", None) == "23505":
            raise DomainError(409, "email_exists", "Этот email уже зарегистрирован") from exc
        raise
    return user


@app.get("/users/{id}", response_model=UserOut, tags=["Пользователи"], summary="Получить пользователя")
def get_user(id: ID, db: DB):
    return require(db, User, id)


@app.get("/users", response_model=list[UserOut], tags=["Пользователи"], summary="Все пользователи")
def list_users(db: DB):
    return db.scalars(select(User).order_by(User.id)).all()


@app.post("/products", response_model=ProductOut, status_code=201, tags=["Товары"],
          summary="Создать товар")
def create_product(body: ProductCreate, db: DB):
    with db.begin():
        product = Product(**body.model_dump())
        db.add(product)
        db.flush()
    return product


@app.get("/products", response_model=list[ProductOut], tags=["Товары"], summary="Все товары")
def products(db: DB):
    return db.scalars(select(Product).order_by(Product.id)).all()


@app.get("/products/{id}", response_model=ProductOut, tags=["Товары"], summary="Получить товар")
def get_product(id: ID, db: DB):
    return require(db, Product, id)


@app.post("/orders", response_model=OrderOut, status_code=201, tags=["Заказы"],
          summary="Создать заказ и списать остатки")
def create_order(body: OrderCreate, db: DB):
    with db.begin():
        require(db, User, body.user_id)
        product_ids = sorted(item.product_id for item in body.items)
        # Один порядок блокировки во всех операциях предотвращает взаимные блокировки.
        locked = db.scalars(select(Product).where(Product.id.in_(product_ids))
                            .order_by(Product.id).with_for_update()).all()
        by_id = {product.id: product for product in locked}
        if len(locked) != len(product_ids):
            raise DomainError(404, "not_found", "Один из товаров не найден")
        order = Order(user_id=body.user_id, status="created", total_amount=Decimal("0.00"), items=[])
        for item in body.items:
            product = by_id[item.product_id]
            if product.stock < item.quantity:
                # Даже уже изменённые в этой транзакции товары откатятся целиком.
                raise DomainError(409, "insufficient_stock", f"Недостаточно товара {product.id}")
            product.stock -= item.quantity
            order.items.append(OrderItem(product_id=product.id, quantity=item.quantity,
                                         unit_price=product.price))
            order.total_amount += product.price * item.quantity
        db.add(order)
        db.flush()
    return order


@app.get("/orders/{id}", response_model=OrderOut, tags=["Заказы"], summary="Заказ с позициями")
def get_order(id: ID, db: DB):
    return require(db, Order, id)


@app.get("/orders", response_model=list[OrderOut], tags=["Заказы"], summary="Все заказы с позициями")
def list_orders(db: DB):
    return db.scalars(select(Order).order_by(Order.id.desc())).all()


@app.get("/users/{id}/orders", response_model=list[OrderOut], tags=["Заказы"],
         summary="Все заказы пользователя")
def user_orders(id: ID, db: DB):
    require(db, User, id)
    return db.scalars(select(Order).where(Order.user_id == id).order_by(Order.id)).all()


@app.post("/orders/{id}/cancel", response_model=OrderOut, tags=["Заказы"],
          summary="Отменить заказ и вернуть остатки",
          description="Повторная отмена возвращает тот же заказ без повторного возврата товара.")
def cancel_order(id: ID, db: DB):
    with db.begin():
        # Сначала блокируем заказ: две отмены не смогут вернуть остаток дважды.
        order = db.scalar(select(Order).where(Order.id == id).with_for_update())
        if order is None:
            raise DomainError(404, "not_found", "Заказ не найден")
        if order.status == "created":
            product_ids = sorted(item.product_id for item in order.items)
            locked = db.scalars(select(Product).where(Product.id.in_(product_ids))
                                .order_by(Product.id).with_for_update()).all()
            by_id = {product.id: product for product in locked}
            for item in order.items:
                product = by_id[item.product_id]
                if product.stock + item.quantity > 2_147_483_647:
                    raise DomainError(409, "stock_overflow", "Остаток превышает допустимый предел")
                product.stock += item.quantity
            order.status = "cancelled"
            order.cancelled_at = datetime.now(timezone.utc)
            db.flush()
    return order


@app.get("/lab/database", response_model=DatabaseSnapshot, tags=["Учебный полигон"],
         summary="Согласованный снимок четырёх таблиц, только чтение")
def database_snapshot(db: DB):
    # Один SQL statement даёт один MVCC-снимок даже при работающем эмуляторе.
    # Денежные поля передаём строками, сохраняя точность NUMERIC в браузере.
    return db.scalar(text("""
        SELECT jsonb_build_object(
            'database', current_database(),
            'tables', jsonb_build_object(
                'users', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM users t),
                'products', (SELECT coalesce(jsonb_agg(
                    to_jsonb(t) || jsonb_build_object('price', price::text) ORDER BY id), '[]'::jsonb) FROM products t),
                'orders', (SELECT coalesce(jsonb_agg(
                    to_jsonb(t) || jsonb_build_object('total_amount', total_amount::text) ORDER BY id), '[]'::jsonb) FROM orders t),
                'order_items', (SELECT coalesce(jsonb_agg(
                    to_jsonb(t) || jsonb_build_object('unit_price', unit_price::text) ORDER BY id), '[]'::jsonb) FROM order_items t)
            )
        )
    """))


STATIC_DIR = FilePath(__file__).resolve().parent / "static"
app.mount("/ui", StaticFiles(directory=STATIC_DIR), name="ui")


@app.get("/", include_in_schema=False)
def frontend():
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})
