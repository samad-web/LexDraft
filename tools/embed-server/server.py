"""DifAi embedding service — the contract apps/api/src/services/embeddings.service.ts calls.

    POST /embed   {"texts": [...]}                 -> {"embeddings": [[...]], "model", "dims"}
    POST /rerank  {"query": "...", "documents": []} -> {"scores": [...]}
    GET  /health                                     -> {"ok": true, "model", "dims"}

BAAI/bge-m3 (1024-d, normalised), the same space as judgment_paragraphs.embedding
and matter_document_chunks (0041). Rerank scores are cosine similarities from the
same model — no second (2 GB) cross-encoder to download; ordering, not calibration,
is what callers use them for.

Run:  python -m uvicorn server:app --host 127.0.0.1 --port 8001
Env:  EMBED_MODEL (default BAAI/bge-m3), EMBED_API_KEY (optional bearer token),
      EMBED_BATCH (default 16).
"""

from __future__ import annotations

import os
import threading
from typing import List

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MODEL_NAME = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
API_KEY = os.environ.get("EMBED_API_KEY", "")
BATCH = int(os.environ.get("EMBED_BATCH", "16"))
MAX_TEXTS = 256
MAX_CHARS = 8000
# 256 tokens covers a typical judgment paragraph; on CPU it is ~3x faster than 512.
MAX_TOKENS = int(os.environ.get("EMBED_MAX_TOKENS", "256"))
THREADS = int(os.environ.get("EMBED_THREADS", str(os.cpu_count() or 4)))

app = FastAPI(title="DifAi embeddings")
_model = None
_lock = threading.Lock()


def model():
    """Load once, lazily — the first request pays the load cost.

    From the local cache first: an online load re-checks the Hub on every start
    (~2 min). Inputs are capped at MAX_TOKENS (bge-m3 defaults to 8192, which on
    CPU ran ~1 paragraph/s).
    """
    global _model
    with _lock:
        if _model is None:
            import torch
            from sentence_transformers import SentenceTransformer
            torch.set_num_threads(THREADS)  # torch defaults to half the logical CPUs
            try:
                _model = SentenceTransformer(MODEL_NAME, device="cpu", local_files_only=True)
            except Exception:
                _model = SentenceTransformer(MODEL_NAME, device="cpu")
            _model.max_seq_length = MAX_TOKENS
        return _model


def _auth(authorization: str | None) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="unauthorized")


def _encode(texts: List[str]) -> List[List[float]]:
    vecs = model().encode([t[:MAX_CHARS] for t in texts], batch_size=BATCH,
                          normalize_embeddings=True, show_progress_bar=False)
    return [v.tolist() for v in vecs]


class EmbedBody(BaseModel):
    texts: List[str] = Field(default_factory=list)


class RerankBody(BaseModel):
    query: str
    documents: List[str] = Field(default_factory=list)


@app.get("/health")
def health():
    m = model()
    return {"ok": True, "model": MODEL_NAME, "dims": m.get_sentence_embedding_dimension()}


@app.post("/embed")
def embed(body: EmbedBody, authorization: str | None = Header(default=None)):
    _auth(authorization)
    if len(body.texts) > MAX_TEXTS:
        raise HTTPException(status_code=413, detail=f"at most {MAX_TEXTS} texts")
    vecs = _encode(body.texts) if body.texts else []
    dims = len(vecs[0]) if vecs else model().get_sentence_embedding_dimension()
    return {"embeddings": vecs, "model": MODEL_NAME, "dims": dims}


@app.post("/rerank")
def rerank(body: RerankBody, authorization: str | None = Header(default=None)):
    _auth(authorization)
    if not body.documents:
        return {"scores": []}
    q, *docs = _encode([body.query, *body.documents])
    return {"scores": [sum(a * b for a, b in zip(q, d)) for d in docs]}
