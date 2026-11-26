# Team documents: who made it, who is on it, copies under the original, send to a teammate (team-docs)

**Status:** BUILT 2026-11-26 (owner "yes" to the plan with all recommendations). Not deployed; migration 0125 local only.

## Owner asks (2026-11-25 / 26)
- "Shareable inside the team, and who had done it; the marked document should get worked on."
- "The written document should be under the original, as a sub-document, not collapsed."
- "In a firm or chamber, if someone is duplicating a document or taking case notes, the app should know who is working on it and show the name."

## Decisions (owner: "yes")
- Copies always shown under the original (no fold). Sharing = a task + notification. Teammates tick notes Done and reply; the marks stay the marker's own. Copies visible to the whole firm.

## What the advocate sees
1. **Who made it:** every document records its maker (uploads, edited / marked / copied copies, handwritten pages): "by Anand", "Marked copy · by Priya" in Documents, the case's Documents tab and the viewer. Existing marked and edited copies get their names from records the app already had; older uploads stay unnamed.
2. **Copies under the original:** a copy is listed right under the document (or draft) it came from, indented with ↳, oldest first; a copy of a copy goes one step deeper. A copy whose original isn't in the list stays at the top.
3. **Working on it now:** while someone marks a review copy, edits an imported document on the Draft page, or writes / edits a case note, everyone else in the firm sees "● Priya is working on this now" on that document (and its original), or "Priya is writing a note on this case now" on the case's notes. It clears ~1 minute after they stop.
4. **Send to teammate** (marker only): pick teammates, a message, a due date → each gets a task "Work on the marks: <title>" and a notification that opens the review. On the review, everyone can tick each note **Done** ("Done by Priya, 3:40 pm") and **Reply**. When every note is Done, the sent tasks move to Done and the marker is told "All marks done by Priya". The review header says "Marked by Anand".

## Architecture
- Migration **0125** (additive): `documents.created_by`, `parent_document_id`, `parent_draft_id` (+ index), `document_reviews.task_ids uuid[]`; backfill of maker / parent for existing marked and edited copies from `document_reviews` and `drafts`.
- `documents.service`: list/get join the maker's name and return parent ids + created time; `create` accepts `createdBy` / parents. Set by: upload route (signed-in user; client can't set parents), import (original, edited copy), copy to another case, review export.
- `presence.service` + `/api/presence` (`GET` firm view, `POST` heartbeat, `POST /leave`): in memory, one API process, 75 s expiry, targets `doc|draft|review|case-notes:<uuid>` only, never your own entries, never another firm's.
- `reviews.service`: `send` (firm members only, not yourself; tasks via tasksService, own notification with `view: review/<id>`), `workOnNote` (row lock; Done / undo / reply ≤ 20 × 500 chars; all-done → tasks to Done + notify the marker), author saves keep stored ticks and replies (never taken from the save). DTO gains `authorName`, `sentCount`.
- Web: `lib/doc-tree` (nesting + maker line), `hooks/usePresence`, `components/review/NoteWork`, `components/review/SendToTeammate`; Documents page, case Documents tab, viewer, Draft page, Case notes, Review screen.
- Layering fix found while testing: the review screen (layer 80) hid dialogs (layer 50: Send to teammate, Delete review). It is now at 48 and the app's bars / rails / floating buttons hide while it is open.

## Edge cases
- A teammate removed from the firm: send refuses them; their earlier ticks stay with their name.
- Two people ticking at once: row lock, both kept. The marker's autosave never wipes ticks.
- Presence is lost on an API restart (it rebuilds within 25 s from the open screens).
- Deleting an original: its copies stay (parent link cleared) and show at the top.

## Acceptance criteria
1. A marked copy appears right under its original with "Marked copy · by <maker>".
2. Uploads and copies show who made them; the viewer too.
3. While A marks a review, B sees "A is working on this now" on the original; it clears after A leaves.
4. Writing a case note shows "A is writing a note on this case now" to others.
5. Send to teammate creates a task + notification for each picked teammate (not self, not other firms).
6. Ticking Done / replying records who and when; the marker's edits keep them; all Done → tasks Done + marker notified.
