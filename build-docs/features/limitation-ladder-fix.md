# Limitation ladder fix (s.138 NI Act)

Status: BUILT + tested 2026-11-19 (owner: "fix the ladder"). Not deployed.

## Purpose
The Deadlines calculator's cheque-bounce ladder is in the sales deck. It had three faults a senior advocate would spot: it cited s.473 CrPC (repealed; the NI Act has its own proviso), it counted the complaint window as 30 days (the law says one calendar month), and it could not take the real date the notice was received.

## Law used (verified)
- Notice within 30 days of receiving the bank's information (s.138 proviso (b)); cannot be extended.
- Drawer has 15 days from receipt of notice (proviso (c)). Refused/unclaimed: return date treated as service.
- Cause of action = day after the 15 days end; complaint within one calendar month, excluding that day (s.142(1)(b)). Saketh India v. India Securities, (1999) 3 SCC 1: served 29 Sep, 15 days end 14 Oct, CoA 15 Oct, complaint on 15 Nov in time; affirmed in Econ Antri v. Rom Industries (2013).
- Late complaint: proviso to s.142(1)(b), sufficient cause.
- Court closed on the last day: General Clauses Act s.10 (complaints), Limitation Act s.4 (other filings).
- Same rule as the engine's src/rules/s138_windows.py (CoA = receipt + 16, + relativedelta month).

## Architecture
- limitations.calculator.ts: ni138Ladder() with optional noticeReceivedDate; 4 steps (send notice, 15 days end, earliest filing day, last filing day); estimate labels when no receipt date; closedDayReason() = weekends + 26 Jan, 15 Aug, 2 Oct, 25 Dec.
- Route schema + LimitationCalculateRequest accept noticeReceivedDate. Web: optional date field for s.138 only.
- limitation-rules.json s.138 note corrected (75-day figure labelled a rough estimate).

## Impact map
- /limitations/calculator/calculate (additive optional field), LimitationCalculator.tsx, shared types. Matter-type rules path unchanged except wording. Engine untouched (already correct).

## Edge cases
- Receipt before memo → 422. Month end: CoA 31 Jan → 28/29 Feb. Today before CoA → "do not file before". Other court holidays (Pongal, vacations) not known → note says check the court calendar.

## Acceptance criteria
AC1 Saketh dates reproduce. AC2 estimate labelled without receipt. AC3 calendar month. AC4 no CrPC; proviso to s.142(1)(b). AC5 premature warning. AC6 bad receipt refused. AC7 holiday/weekend → s.10. AC8 notes cite cases and the holiday limit. AC9 web field sent only for s.138.
