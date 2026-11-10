FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /project
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home learner
COPY --chown=learner:learner . .
USER learner
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
