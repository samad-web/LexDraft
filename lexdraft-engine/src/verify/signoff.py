"""Document sign-off + the mandatory review banner. Deterministic. No LLM.

CLAUDE.md rule 6 (advocate sign-off before filing) made visible and enforceable.

Two DISTINCT signals live on a generated document; neither replaces the other and
both can appear together:

  - the TABLE MARKER (src/verify/tables.marker_for) says "this FIGURE came from a
    table the advocate has not verified";
  - the REVIEW BANNER (here) says "an advocate must REVIEW this whole document
    before it is filed".

The review banner is on EVERY generated draft, regardless of which tables it
consumes. It is suppressed ONLY when the document is explicitly signed off as
final — an ACTION, recorded in an audit trail with who signed off and when, never
a config toggle.

Hard rule: a document with any unfilled narrative slot ("[to be drafted]") MUST
carry the banner and CANNOT be marked final at all. Sign-off refuses.

The matter id AND the fact-sheet VERSION both come from the MatterFactSheet — the
same versioned source the document's facts come from — never from the caller.

The audit trail is an append-only JSONL file (verify/signoff_audit.jsonl by
default). Each sign-off appends one record: document, matter_id, VERSION, reviewer,
and the timestamp. Lookup stays keyed on (document, matter_id) so it is stable
across revisions; the version is stored alongside and compared on read.
`banner_for()` restores the banner (treats the document as still a draft) when the
sign-off is against a SUPERSEDED fact-sheet version — if the facts are revised
after sign-off, the signed document no longer corresponds to current facts. This is
the same discipline as the unfilled-slot re-check.
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Mapping, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from ..factsheet import MatterFactSheet

# The narrative slot placeholder the pipelines emit for an undrafted paragraph.
LLM_SLOT_PLACEHOLDER = "[to be drafted]"

# A broader family of "unfilled slot" placeholders than the single canonical
# marker above. The DRAFT model is instructed to emit ONLY LLM_SLOT_PLACEHOLDER,
# but it (and advocates) naturally write descriptive variants — "[deponent name
# to be provided]", "the cheque was returned on [date to be filled] per the memo".
# These are AI/authoring gaps that must NOT reach a filed document, so slot
# detection matches them anywhere inside a bracketed span, mid-sentence included.
#
# Deliberately does NOT match bare underscore runs ("____"): those are wet-ink
# fields the advocate/oath-commissioner completes at execution (the swearing date,
# case-number blanks), not AI gaps. See the 1c decision.
SLOT_PATTERN = re.compile(
    r"\[[^\]]{0,80}?\b(to be (drafted|provided|filled|completed|supplied))\b[^\]]{0,80}?\]",
    re.IGNORECASE,
)

# The one review-banner string, shared by every document.
REVIEW_BANNER = (
    "[DRAFT — for advocate review; not to be filed until reviewed and signed off]"
)

_DEFAULT_AUDIT = Path(__file__).resolve().parents[2] / "verify" / "signoff_audit.jsonl"
_lock = threading.Lock()


class SignOffError(RuntimeError):
    """A sign-off was attempted that the rules do not permit."""


@dataclass(frozen=True)
class SignOffRecord:
    document: str
    matter_id: str
    version: int            # the fact-sheet version that was signed off
    reviewer: str
    signed_on: str          # ISO date/datetime — supplied by the caller (no clock here)

    def key(self) -> tuple:
        # Lookup is keyed on (document, matter_id) — stable across fact-sheet
        # revisions; the version is stored alongside and compared on read.
        return (self.document, self.matter_id)


# --------------------------------------------------------------------------
# Unfilled-slot detection.
# --------------------------------------------------------------------------

def unfilled_slots(context: Mapping[str, Any]) -> List[str]:
    """Context keys whose value is (or contains) the undrafted-slot placeholder.

    Scans every string value, and the items of any list/tuple value, because
    pipelines hold slots under names like 'transaction_slot' / 'accident_slot',
    not only numbered-paragraph keys.
    """
    found: List[str] = []
    for key, value in context.items():
        if _is_slot(value):
            found.append(key)
    return sorted(found)


def _is_slot(value: Any) -> bool:
    if isinstance(value, str):
        # Exact canonical marker, OR any descriptive "[... to be provided ...]"
        # variant appearing ANYWHERE in the string (substring, not equality) so a
        # placeholder embedded mid-sentence is caught.
        return value.strip() == LLM_SLOT_PLACEHOLDER or bool(SLOT_PATTERN.search(value))
    if isinstance(value, (list, tuple)):
        return any(_is_slot(v) for v in value)
    if isinstance(value, Mapping):
        return any(_is_slot(v) for v in value.values())
    return False


def has_unfilled_slots(context: Mapping[str, Any]) -> bool:
    return bool(unfilled_slots(context))


# --------------------------------------------------------------------------
# Audit trail.
# --------------------------------------------------------------------------

def _read_records(audit_path: Path) -> List[SignOffRecord]:
    if not audit_path.exists():
        return []
    records: List[SignOffRecord] = []
    for line in audit_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        raw = json.loads(line)
        records.append(SignOffRecord(
            document=raw["document"], matter_id=raw["matter_id"],
            version=int(raw["version"]),
            reviewer=raw["reviewer"], signed_on=raw["signed_on"],
        ))
    return records


def is_signed_off(document: str, matter_id: str, *,
                  audit_path: Optional[Path] = None) -> Optional[SignOffRecord]:
    """The latest sign-off record for (document, matter_id), or None.

    The key is (document, matter_id) — STABLE across fact-sheet revisions — so a
    re-sign-off of a later version supersedes the earlier record. The caller
    compares the record's `version` against the current fact-sheet version to
    decide whether the sign-off still corresponds to the facts.
    """
    path = audit_path or _DEFAULT_AUDIT
    match: Optional[SignOffRecord] = None
    for rec in _read_records(path):
        if rec.document == document and rec.matter_id == matter_id:
            match = rec
    return match


def sign_off(
    *,
    document: str,
    factsheet: "MatterFactSheet",
    reviewer: str,
    signed_on: str,
    context: Mapping[str, Any],
    audit_path: Optional[Path] = None,
) -> SignOffRecord:
    """Mark a document final. Records who, when, and against WHICH fact-sheet
    version, in the audit trail.

    The matter id and the version both come from `factsheet` — the same versioned
    source the document's facts come from — not from the caller.

    Refuses (SignOffError) if:
      - the reviewer or date is blank (a sign-off must be attributable and dated);
      - the document still has an unfilled narrative slot — such a document can
        never be marked final.
    """
    if not str(reviewer).strip():
        raise SignOffError("sign-off requires the reviewer's name")
    if not str(signed_on).strip():
        raise SignOffError("sign-off requires the date of sign-off")

    slots = unfilled_slots(context)
    if slots:
        raise SignOffError(
            "document has unfilled narrative slot(s) "
            f"({', '.join(slots)}) and cannot be marked final; the "
            "'[to be drafted]' paragraphs must be drafted first"
        )

    record = SignOffRecord(
        document=document, matter_id=factsheet.matter_id,
        version=factsheet.version, reviewer=str(reviewer), signed_on=str(signed_on),
    )
    path = audit_path or _DEFAULT_AUDIT
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "document": record.document,
                "matter_id": record.matter_id,
                "version": record.version,
                "reviewer": record.reviewer,
                "signed_on": record.signed_on,
            }) + "\n")
    return record


# --------------------------------------------------------------------------
# Banner resolution.
# --------------------------------------------------------------------------

def banner_for(
    context: Mapping[str, Any],
    *,
    document: str,
    factsheet: "MatterFactSheet",
    audit_path: Optional[Path] = None,
) -> str:
    """The review banner for this document, or "" if it is signed off as final.

    The banner is restored (returned non-empty) in three cases — a document is
    "final, no banner" only when NONE of them holds:

      1. an unfilled narrative slot remains — such a document can never be final;
      2. no sign-off record exists for (document, matter_id);
      3. the sign-off record is against a SUPERSEDED fact-sheet version — the facts
         have since been revised, so the signed document no longer corresponds to
         the current facts. Same discipline as the slot re-check: a stale sign-off
         never suppresses the banner.
    """
    if has_unfilled_slots(context):
        return REVIEW_BANNER
    record = is_signed_off(document, factsheet.matter_id, audit_path=audit_path)
    if record is None:
        return REVIEW_BANNER
    if record.version != factsheet.version:
        # Facts revised after sign-off — the sign-off is stale.
        return REVIEW_BANNER
    return ""


def resolve_context(
    context: Mapping[str, Any],
    *,
    document: str,
    factsheet: "MatterFactSheet",
    audit_path: Optional[Path] = None,
) -> dict:
    """Return a copy of `context` with the review banner attached.

    The banner ('review_banner') is INDEPENDENT of the table marker
    ('unverified_marker', already in the context if the pipeline set it) — both
    may be present, neither replaces the other. This is the single place rule 6
    is applied, so no pipeline has to inject the banner itself.
    """
    ctx = dict(context)
    ctx["review_banner"] = banner_for(
        context, document=document, factsheet=factsheet, audit_path=audit_path
    )
    # Preserve the table marker if the pipeline set one; default to "" so the
    # template's marker line renders blank rather than erroring.
    ctx.setdefault("unverified_marker", "")
    return ctx


def render_document(
    template,
    context: Mapping[str, Any],
    out_path,
    *,
    document: str,
    factsheet: "MatterFactSheet",
    audit_path: Optional[Path] = None,
):
    """Render a document with both signals resolved (rule-6 entry point).

    This is the entry point pipelines' output should pass through: it injects the
    review banner (suppressed only by a current, recorded sign-off) alongside any
    table marker, then renders. `factsheet` is the versioned source of both the
    matter id and the version. Import-local to avoid a component<-verify cycle.
    """
    from ..components.render import render_to_docx
    ctx = resolve_context(context, document=document, factsheet=factsheet,
                          audit_path=audit_path)
    return render_to_docx(template, ctx, out_path)


def audit_path() -> Path:
    return _DEFAULT_AUDIT
