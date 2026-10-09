# eCourts App Traffic Capture — Step-by-Step

**Goal:** capture the single establishment request the current official eCourts
app sends, so we can restore the court-location searches (party / advocate / FIR
/ case-number / filing / act / cause-list) in the LexDraft eCourts portal.

**Why this is needed:** the endpoint `courtEstWebService.php` changed on eCourts'
side and now rejects the params LexDraft sends (`{"status":"N","msg":"ERROR_ERROR"}`).
The only reliable way to learn the *current* correct endpoint + params is to
watch what the official app actually sends. This guide gets you exactly that.

**What I need back from you (the payload):** for the establishment call, the
- **URL** (the `...WebService.php` name), and
- the **decrypted `params` JSON** (or the raw encrypted `params` value — I can decrypt it with the app keys we already have).

You do **not** need to understand the crypto — just capture the request and paste
me the URL + the `params` query value. That's enough.

---

## What you'll need

- An **Android phone** (eCourts Services app is easiest to intercept on Android).
  iOS works too but certificate trust is fiddlier — Android recommended.
- A **computer on the same Wi-Fi** as the phone.
- **mitmproxy** (free, cross-platform). Alternative: Charles Proxy (paid, GUI).

---

## The catch you must know up front: certificate pinning

Modern apps often **pin** their TLS certificate, which makes a plain proxy show
nothing (the app refuses the proxy's cert). Two outcomes:

- **If eCourts does NOT pin** → the steps below "just work."
- **If eCourts DOES pin** → you'll see the app fail to load data while the proxy
  is on. Then you need the **rooted-phone + Frida unpinning** path (Section B).
  Try Section A first; only go to B if A shows no eCourts traffic.

> Reality check: the app talks to `app.ecourts.gov.in` over HTTPS with an
> `okhttp/4.12.0` client. okhttp apps *can* pin but many government apps don't.
> We find out by trying.

---

## Section A — Standard capture (try this first)

### 1. Install mitmproxy on your computer
- Download from <https://mitmproxy.org/> (or `pip install mitmproxy`).
- Start it: run `mitmweb` (gives a browser UI at <http://127.0.0.1:8081>).
- Note your computer's **LAN IP** (e.g. `192.168.1.20`) — `ipconfig` on Windows.

### 2. Point the phone at the proxy
- Phone → Wi-Fi → your network → **Modify / Advanced → Proxy: Manual**.
- Host = your computer's LAN IP, Port = **8080** (mitmproxy's default).

### 3. Install mitmproxy's CA certificate on the phone
- On the phone browser, go to **<http://mitm.it>** (only resolves while the
  proxy is active).
- Download the **Android** cert and install it:
  **Settings → Security → Encryption & credentials → Install a certificate →
  CA certificate** (path varies by Android version).
- Android 11+ note: a user-installed CA is **not** trusted by apps by default.
  If the app ignores it, that's the pinning/user-CA problem → Section B.

### 4. Filter to eCourts traffic
- In the mitmweb UI, set the filter box to:
  ```
  ~u app.ecourts.gov.in
  ```
  This hides everything except eCourts calls.

### 5. Reproduce the establishment lookup in the app
- Open the **eCourts Services** app.
- Go to a search that forces a **court** choice, e.g.
  **Case Status → Search by Party Name** (or Advocate / FIR).
- Pick **State**, then **District**. The moment you pick a district, the app
  fetches the list of **court complexes / establishments** — **that is the call
  we want.**

### 6. Grab the request
In mitmweb, find the request whose URL ends in a `...WebService.php` fired right
after you selected the district. The likely names (capture whichever appears):
- `courtEstWebService.php`
- `courtComplexWebService.php`
- `estWebService.php`
- something else entirely (that's fine — whatever it actually is)

For that request, copy me:
1. The **full URL** (including the `?params=...` query string), and
2. The request **method** (GET/POST) and any **headers** that look non-standard
   (especially `Authorization: Bearer ...` — you can redact the token value).

If it's a POST, also copy the **request body**.

**That single request is the whole deliverable.** Paste it back and I wire it in.

---

## Section B — If the app shows no traffic (certificate pinning)

Symptoms: proxy is on, `mitm.it` cert installed, but the eCourts app fails to
load any data / you see no `app.ecourts.gov.in` requests in mitmweb.

This means the app pins its cert. To bypass, on a **rooted** Android (or an
Android **emulator** you control):

1. Install **Frida** on the computer (`pip install frida-tools`) and the
   **frida-server** binary on the device.
2. Use a standard **okhttp/TrustManager unpinning** Frida script (widely
   available; e.g. "frida-multiple-unpinning"). Run:
   ```
   frida -U -f in.gov.ecourts.eCourtsServices -l unpin.js
   ```
   (`in.gov.ecourts.eCourtsServices` is the app's package id — confirmed from the
   crypto layer we already reverse-engineered.)
3. With pinning bypassed, repeat Section A steps 4–6.

> If you don't have a rooted device or emulator, this is where it's worth
> handing the task to whoever originally built the LexDraft eCourts client —
> they clearly did exactly this capture once already (that's how the current
> integration exists). They may still have the tooling set up.

---

## What happens after you send me the payload

Once I have the current establishment endpoint + params, I will:

1. Fix `listCourtEstablishments()` in `apps/api/src/services/ecourts.service.ts`
   to call the correct endpoint/params, and correct the `CourtEstablishment`
   type field names (same class of fix I just did for `District`).
2. Verify live with a smoke test (State → District → Establishment → Case Types).
3. Build the **CourtPicker** cascade component (State → District → Court).
4. Wire the six court-scoped searches + cause list into the portal UI
   (`EcourtsView.tsx`), replacing the "coming soon" tab.
5. Add "Add to my cases" on every result type (reusing the flow already built).
6. Typecheck + verify end-to-end.

Everything downstream is already scoped and ready — the establishment payload is
the **one missing key** that unlocks the entire remaining portal.

---

## Reference: facts about the LexDraft ↔ eCourts wire protocol (for context)

- Base URL (district courts): `https://app.ecourts.gov.in/services_DC_4.0/`
- Base URL (high courts): `https://app.ecourts.gov.in/services_HC_4.0/`
- User-Agent the app/our client sends: `okhttp/4.12.0`
- App package id: `in.gov.ecourts.eCourtsServices`
- Request `params` are **AES-128-CBC encrypted** then wrapped as
  `<ran_hex(16)><iv_idx(1)><base64_ciphertext>`. **You don't need to decrypt —
  just send me the raw `params` value and I'll decrypt it with the app keys we
  already hold.**
- Endpoints our client already knows: `stateWebService.php`,
  `districtWebService.php`, `courtEstWebService.php` (broken),
  `caseTypesWebService.php`, `causeListWebService.php`, `caseHistoryWebService.php`,
  `searchByActWebService.php`, `searchByFilingNumberWebService.php`,
  `actWebService.php`, `policeStationWebService.php`, `appReleaseWebService.php`.
