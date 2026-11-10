"""Create a fresh disposable DB, migrate it, run pytest, then drop ONLY that DB."""
import os
import subprocess
import sys
import uuid
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from app.db import database_url

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = make_url(database_url())
    if source.get_backend_name() != "postgresql":
        raise SystemExit("Тестам требуется PostgreSQL")
    name = "playground_test_" + uuid.uuid4().hex
    # Имя генерируется здесь, оно не берётся из пользовательского DATABASE_URL.
    test_url = source.set(database=name)
    admin = create_engine(source.set(database="postgres"), isolation_level="AUTOCOMMIT")
    env = {**os.environ, "DATABASE_URL": test_url.render_as_string(hide_password=False),
           "TEST_RUN_ACTIVE": "1"}
    result = 1
    created = False
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
        created = True
        print(f"Изолированная тестовая база: {name}", flush=True)
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
                       cwd=ROOT, env=env, check=True)
        result = subprocess.run([sys.executable, "-m", "pytest", *sys.argv[1:]],
                                cwd=ROOT, env=env).returncode
    finally:
        if created:
            with admin.connect() as connection:
                connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
            print("Тестовая база удалена.", flush=True)
        admin.dispose()
    return result


if __name__ == "__main__":
    raise SystemExit(main())
