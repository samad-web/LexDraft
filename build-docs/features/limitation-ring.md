# limitation-ring

## Purpose
One glance on the dashboard: how close the nearest limitation is.

## Architecture
- `components/dashboard/LimitationRing.tsx`: single inline SVG; arc = days left / 90 (clamped). Centre: days (Source Serif 4), below: case label + filing type. Up to 3 smaller rows for the next deadlines.
- Data: existing `limitations` list endpoint (no new API), soonest open first.
- Colour: ink stroke on `--border` track. ≤7 days → the existing red `.adv-alert-btn` "N due within 7 days" sits under the ring; the ring itself never turns red.
- Tap → `/app/limitation`.

## Impact map
- AdvocateDashboardView (placement), DashboardKpis (avoid duplicating the limitation KPI), chambers.css tokens, offline cache allow-list.

## Edge cases
- None open → "No limitation deadlines" + "Add limitation" link. Overdue → "Overdue by N days" + red button. >90 days → full ring.
- Reduced motion → no arc animation.

## Acceptance criteria
- Correct day count in IST; empty, overdue, ≤7, >90 states each render; `role="img"` with an aria-label stating days and matter; light/dark/360 px screenshots.
