# Mobile usability + end-to-end test cases (Android app)

Build under test: DifAi 2.1-preview (versionCode 10) on a Samsung SM-E075F, Android 16, over USB (adb).
Runs against the **live** server with the advocate's own account.

**Who does each step**
- **A** = automated over adb: tap/scroll from the UI tree, screenshot, read the log.
- **U** = needs you: Google sign-in, fingerprint/PIN, OTP/captcha.
- **W** = writes live data. Run only with your OK, and delete afterwards (no leftover test data).

**Pass bar for every screen:** no crash or JS error in the log; nothing cut off or overflowing at 360–412 px; tap targets ≥ 44 px; black and white only (red only on a named mandatory button); back button goes back one step; loads in < 3 s on Wi-Fi.

## 1. Launch, sign-in, lock
| ID | Steps | Expected | Who |
|---|---|---|---|
| L1 | Cold start | System icon → splash (Di → DifAi, Powered by Sirah Digital, court scene) → app in ≤ 3 s total; no white flash | A |
| L2 | Tap during splash | Splash closes at once | A |
| L3 | Signed out: open app | Sign-in screen, no landing page; Google button visible | A |
| L4 | Sign in with Google | Dashboard opens; name correct | U |
| L5 | Cold start while signed in | Splash → lock → fingerprint/PIN prompt appears only after the splash | U |
| L6 | Cancel the prompt | Stays on "DifAi is locked"; Unlock retries | U |
| L7 | Back on the lock screen | App exits; nothing revealed | A |
| L8 | Home, wait < 60 s, return | No lock | A |
| L9 | Home, wait ≥ 60 s, return | Lock + prompt | U |
| L10 | Recent apps | DifAi thumbnail shows no case details (Android 13+) | A |
| L11 | Settings → App lock → Turn off | Asks for unlock first; then off; cold start has no lock | U |

## 2. Navigation shell
| ID | Steps | Expected | Who |
|---|---|---|---|
| N1 | Tap each dock item (Home, Hearings, Draft, Cases, More) | Right screen; active item marked; dock never covers content you need | A |
| N2 | More → every menu item | Each opens without error; locked plan features show a clear upgrade card, not a blank | A |
| N3 | Back button through 3 screens | Steps back one at a time; on Dashboard, exits | A |
| N4 | Notifications bell | Panel opens/closes; back closes it | A |
| N5 | Global search: type a matter name | Results; tap opens the matter | A |
| N6 | Rotate to landscape | Layout holds or stays portrait; nothing lost | A |
| N7 | Phone font size at largest | Text wraps, no overlap or clipped buttons | A |

## 3. Core modules (read)
| ID | Screen | Check | Who |
|---|---|---|---|
| M1 | Dashboard | Greeting, KPI cards, needs-attention list, hearings; titles readable (not "S…") | A |
| M2 | Cases list | Search, filter chips scroll, sort; tap a case | A |
| M3 | Case detail | Tabs (overview, hearings/timeline, documents, billing); CNR shown; scroll whole page | A |
| M4 | Cause List / Calendar / Court Diary | Today's list; calendar month moves; diary empty state or entries | A |
| M5 | eCourts | Tabs/tiles load; CNR search field usable with keyboard (keyboard doesn't hide the field) | A |
| M6 | eFiling | Signed-out card fits one screen; captcha image visible | A |
| M7 | Draft | Composer, chips, Attach, language toggle; keyboard doesn't cover the text box | A |
| M8 | Legal Research | Ask box; Search statutes tab | A |
| M9 | Limitation | List or plan card; red button only when due ≤ 7 days | A |
| M10 | Clients, Tasks, Documents, Invoices, Expenses | Each loads, empty states read well | A |
| M11 | Settings | Profile, App lock row, MFA, language, privacy | A |
| M12 | Plan & Billing | No in-app payment checkout opens (Play payments policy) | A |

## 4. Actions (write — needs your OK)
| ID | Steps | Expected | Who |
|---|---|---|---|
| W1 | Draft a s.138 notice from a short brief | Draft appears; export/download → Android share sheet | W |
| W2 | Download any PDF/DOCX | Share sheet opens; file saves to Files | W/A |
| W3 | Add then delete a diary entry | Saved, shown, deleted, nothing left | W |
| W4 | Legal Research question | Answer with citations | W (uses AI quota) |

## 5. Resilience
| ID | Steps | Expected | Who |
|---|---|---|---|
| R1 | Airplane mode, open Cases | Clear offline error, retry works when back online (offline cache comes later) | A |
| R2 | Kill app mid-screen, reopen | Splash → lock → back in, session kept | U |
| R3 | 10 min of use | No memory warnings / crashes in log | A |

## Results
Recorded in `TESTING.md` under "Mobile E2E".
