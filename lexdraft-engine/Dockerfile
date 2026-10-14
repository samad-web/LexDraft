# LexDraft Engine — deterministic legal drafting service (FastAPI, Python).
#
# Co-located, internal-only: the Node API is the sole caller, authenticated via
# LEXDRAFT_SERVICE_TOKEN (shared-token auth, see src/service/app.py). This
# service never faces the browser directly — bind it to localhost/an internal
# docker network only, never publish its port to the host.
#
# Build context is this repo's root:
#   docker build -t lexdraft-engine:local .

FROM python:3.11-slim AS runtime

WORKDIR /app

# System deps: none beyond what pip needs (no LibreOffice — this service never
# renders PDFs, only .docx via docxtpl).
RUN pip install --no-cache-dir --upgrade pip

COPY pyproject.toml ./
COPY src ./src
COPY templates ./templates
COPY verify ./verify
COPY intake ./intake

RUN pip install --no-cache-dir ".[service]"

RUN useradd --create-home --uid 10001 engine \
    && mkdir -p /app/verify \
    && chown -R engine:engine /app
USER engine

# Append-only sign-off audit trail — mount a named volume here so it survives
# container recreation (it's a compliance record, not disposable state).
VOLUME ["/app/verify"]

EXPOSE 8099

CMD ["uvicorn", "src.service.app:app", "--host", "0.0.0.0", "--port", "8099"]
