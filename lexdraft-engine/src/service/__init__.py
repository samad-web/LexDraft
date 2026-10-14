"""Service layer — the API-facing wrapper around the drafting engine.

This package is what the FastAPI app (and its tests) call. It owns:

  adapters/   the inbound-JSON <-> engine-kwargs mapping per document type, the
              422-vs-refusal boundary, and the refusal-field translation back to
              inbound keys.

The engine itself (src/pipelines, src/rules, src/verify) is untouched by this
layer — the service adapts to it, never the reverse.
"""

from __future__ import annotations
