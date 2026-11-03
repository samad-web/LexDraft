# Embedding service

Serves `BAAI/bge-m3` (1024-d) for the API's `embeddings.service.ts`: judgment search,
statute search and drafting authority retrieval. Without it, search falls back to
keywords.

## Local (started by `pnpm dev`)

Create the venv once, outside OneDrive (torch is thousands of files):

```
python -m venv %LOCALAPPDATA%\difai-embed\.venv
%LOCALAPPDATA%\difai-embed\.venv\Scripts\python -m pip install -r tools/embed-server/requirements.txt
```

`pnpm dev` then starts it on `127.0.0.1:8001` and points the API at it. The first
request downloads (~2.3 GB, once) and loads the model.

## Backfilling judgment embeddings

```
pnpm --filter @lexdraft/api ingest:judgments --court SC --from 2023 --to 2025 --limit 300 --force
```
