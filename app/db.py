import os

from sqlalchemy import URL, create_engine
from sqlalchemy.orm import sessionmaker


def database_url():
    return os.getenv("DATABASE_URL") or URL.create(
        "postgresql+psycopg",
        username=os.getenv("POSTGRES_USER", "playground"),
        password=os.getenv("POSTGRES_PASSWORD", "playground_local"),
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("POSTGRES_DB", "playground"),
    )


engine = create_engine(database_url(), pool_pre_ping=True, connect_args={"connect_timeout": 5})
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_session():
    with SessionLocal() as session:
        yield session
