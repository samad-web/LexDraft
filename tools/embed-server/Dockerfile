# DifAi embedding service (bge-m3, CPU). ~2.5 GB RAM once the model is loaded.
#   docker build -t difai-embed tools/embed-server
#   docker run -d --name difai-embed-1 --network lexdraft-net --restart unless-stopped \
#     -v difai-embed-cache:/root/.cache/huggingface difai-embed
# The API then uses EMBED_SERVICE_URL=http://difai-embed-1:8001
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .

ENV HF_HUB_DISABLE_TELEMETRY=1
EXPOSE 8001
# Load the model at start so the first search isn't the slow one.
CMD ["sh", "-c", "python -c 'import server; server.model()' && exec uvicorn server:app --host 0.0.0.0 --port 8001"]
