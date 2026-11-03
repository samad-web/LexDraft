# case-swipe-actions

## Purpose
Thumb-speed triage of the case list on phones.

## Architecture
- Pointer-event swipe on stacked case cards (≤640 px only); no gesture library.
- Left swipe → Archive (uses `useArchive`, Undo toast 5 s). Right swipe → Add hearing (opens existing hearing modal as a bottom sheet).
- Same two actions stay in the card's "⋯" menu (accessibility, keyboard, TalkBack).
- "Tag" from the brief is out: no tag model exists.

## Impact map
- CasesListView, `watchStackedTables()` card markup, useArchive, hearing modal, `lib/native.ts` back button (closes sheet first).

## Edge cases
- Vertical scroll must win: lock axis after 10 px; horizontal only past 60 px.
- Archive fails → card springs back, error toast. Read-only/guest users → no swipe.
- Reduced motion → no slide animation, actions still work.

## Acceptance criteria
- Scrolling the list never triggers an action. Archive + Undo restores the case. Menu path does the same without gestures.
