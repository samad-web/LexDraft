# Workspace Dashboard — Overview Page

Screenshot reference: Aboothahir – Wellness Coach workspace, nusi.in/dashboard, 2026-10-21.

## Page chrome

- **Left sidebar** (collapsible), grouped:
  - Workspace switcher header: logo, workspace name ("NUSI"), subtitle ("Aboothahir – Wellness ...")
  - Primary nav: Overview, Clients, Programs, Assessments, Daily logs, Exercise, Reminders, Appointments, Messaging, Nutrition, Help & guides
  - "Grow" section: Analytics, Community, Public page
  - Footer: trial/plan badge with inline "Upgrade" button, account row (avatar, name, logout)
- **Top bar**:
  - Breadcrumb: workspace name / current page ("Overview")
  - Center: workspace tagline/motto ("RESET YOU DESTINY")
  - Right: trial badge ("Free trial · 3d left"), "Upgrade" CTA, refresh icon, theme toggle, notifications bell (badge count)
- **Trial banner** (dismissible strip, full width): countdown message + "Choose a plan" CTA. Only shown while on trial / near expiry.

## Greeting block

- Date (uppercase, small): "WEDNESDAY, OCTOBER 21"
- Headline: "Good evening, {owner first name}" (time-of-day greeting, name highlighted in accent color)
- Subtext: "{workspace name} · {N} clients · {N} active this week"
- Right-aligned: "All clients" link/button

## KPI card row (2 rows × 3 cards)

Each card: icon, label (uppercase small caps), large metric, small supporting line. Color-tinted background per card (green, blue, pink/red, purple, yellow, gray).

| Card | Icon | Metric | Supporting line |
|---|---|---|---|
| Active clients | people | 5 | "of 5 total" |
| Active programs | clipboard | 1 | "0% avg progress" |
| Needs a nudge | warning | 3 | "clients at risk" |
| Your plan | card | "Trial" | "4 days left" |
| AI credits | sparkle | 121/500 | "this month · resets 1 Nov" + progress bar |
| Storage | storage/disk | 2 MB/1 GB | "photos, files & documents" + progress bar |

Notes:
- AI credits and Storage cards include a horizontal progress bar under the metric.
- "Needs a nudge" uses warning/alert color treatment (red-tinted) to signal risk.

## Lower section (2-column split)

### Left: Priority — "Needs attention"
- Header: "PRIORITY" (eyebrow) / "Needs attention" (title), right-aligned "Review all" link
- List of at-risk clients, each row:
  - Avatar (initial-based), client name
  - Status line: source + recency, e.g. "Program · 11 days ago"
  - Right-aligned status pill: "At risk" (red/pink)
  - Chevron to drill in

### Right: Schedule — "Upcoming sessions"
- Header: "SCHEDULE" (eyebrow) / "Upcoming sessions" (title), right-aligned "Calendar" link
- Empty state: calendar icon + "No upcoming sessions"

## Footer

- Copyright: "© 2026 {workspace name}. All rights reserved."
- "Powered by Sirah Digital"

## Data sources (inferred)

- Active clients / active programs / needs-a-nudge → clients + program_assignments + compliance roll-up (workspace overview endpoint)
- AI credits → `ai_usage_events` monthly count vs plan cap (see `UsageService.checkQuota`)
- Storage → Supabase Storage usage vs plan cap
- Priority list → at-risk clients ranked by inactivity/program non-compliance
- Plan/trial badge → workspace `plan` + `trial_ends_at`
