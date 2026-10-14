"""VERIFY registries — externalised legal reference data pending advocate review.

Two registries, both plain JSON on disk so an advocate can edit them without
touching Python:

  verify/tables/     one file per VERIFY-marked reference table (court-fee slabs,
                     pecuniary limits, custody/default-bail periods, bail bars,
                     BNSS<->CrPC section mappings, consumer tiers, the MACT
                     compensation tables). Loaded by `tables.py`.
  verify/averments/  one file per document type, listing its mandatory / advisory
                     averments. Loaded by `averments.py`.

Every entry carries a `verified` flag plus `reviewed_by` / `reviewed_on`. While
`verified` is false, any document that consumes the data renders with the visible
unverified marker (generalising the MACT pattern). Flipping `verified` to true —
in the JSON file, no code change — removes the marker.
"""

from __future__ import annotations
