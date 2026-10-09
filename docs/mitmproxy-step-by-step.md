# mitmproxy — Step-by-Step Setup & Capture (eCourts)

**One-sentence goal:** watch the eCourts app make its "load the list of courts"
request, and copy that request to me.

**You need:** a Windows PC + an Android phone, both on the **same Wi-Fi**.

**Time:** ~20–30 minutes the first time.

---

## Part 1 — Install mitmproxy on your PC (5 min)

1. Go to <https://mitmproxy.org/> → **Download** → Windows installer.
2. Run the installer. It installs three commands: `mitmproxy`, `mitmweb`, `mitmdump`.
3. We'll use **`mitmweb`** — it shows captured traffic in your browser, which is
   the friendliest.

**Start it** (open PowerShell and run):
```powershell
mitmweb
```
- A browser tab opens at **http://127.0.0.1:8081** — this is where captured
  requests appear.
- mitmproxy is now listening on **port 8080** (this is the port the phone will use).
- Leave this window running the whole time.

---

## Part 2 — Find your PC's Wi-Fi IP address (2 min)

In PowerShell:
```powershell
ipconfig
```
Look under your **Wi-Fi adapter** for **IPv4 Address** — something like
`192.168.1.20`. Write it down. (Not `127.0.0.1` — you want the `192.168.x.x` one.)

---

## Part 3 — Point your phone at mitmproxy (3 min)

On the **Android phone**:
1. **Settings → Wi-Fi** → tap your connected network → **Modify / gear icon**.
2. Find **Proxy** → change to **Manual**.
3. Set:
   - **Proxy hostname:** your PC's IP from Part 2 (e.g. `192.168.1.20`)
   - **Proxy port:** `8080`
4. Save.

> Now all the phone's web traffic routes through your PC. If web pages stop
> loading on the phone, that's expected until Part 4 is done.

---

## Part 4 — Install mitmproxy's certificate on the phone (5 min)

This is the step that lets mitmproxy read HTTPS (otherwise everything is scrambled).

1. On the **phone's browser**, go to: **http://mitm.it**
   - This special page only loads **while the proxy is active** (it's served by
     mitmproxy itself). If it doesn't load, the proxy in Part 3 isn't set right.
2. Tap the **Android** icon → download the certificate file.
3. Install it:
   - **Settings → Security → More security settings → Encryption & credentials
     → Install a certificate → CA certificate**
   - (The exact path varies by phone. Search Settings for "**CA certificate**"
     if you can't find it.)
   - Pick the downloaded file. Accept the "your data may be monitored" warning
     (that's literally what we're doing, on purpose, temporarily).

---

## Part 5 — Filter to eCourts only (1 min)

Back in the **mitmweb browser tab** on your PC:
- Find the **filter/search box** at the top.
- Type:
  ```
  ~u app.ecourts.gov.in
  ```
- Press Enter. Now the list only shows eCourts app traffic — everything else is
  hidden. (If you're capturing from the **website** instead, use
  `~u services.ecourts.gov.in`.)

---

## Part 6 — Trigger the request in the eCourts app (2 min)

On the **phone**, open the **eCourts Services** app:
1. Go to **Case Status → Search by Party Name** (Advocate or FIR also work).
2. Select a **State** (e.g. Tamil Nadu or Kerala).
3. Select a **District** (e.g. Chennai / Ernakulam).
4. **The instant you pick the district, the app loads the list of courts** —
   that's the request we want.

Watch the mitmweb list on your PC — new rows appear as you tap.

---

## Part 7 — Copy the request to me (2 min)

In mitmweb, look for a request whose URL ends in **`...WebService.php`** that
fired right after you picked the district. Likely names:
- `courtEstWebService.php`
- `courtComplexWebService.php`
- or something else — **whatever it actually is** is what we need.

Click that request. Copy me:
1. The **full URL** (including the `?params=...` part).
2. The **method** (GET or POST).
3. Any **Authorization** header (you can black-out the token value — I just need
   to know it's there).
4. If it's a **POST**, the **request body** too.

> You do **not** need to decrypt the `params` — paste the raw scrambled value
> and I'll decrypt it with the app keys already in your codebase.

**That single request is the whole deliverable.** Paste it back and I wire the
full portal.

---

## Part 8 — Clean up when done (IMPORTANT — 2 min)

After you've captured the request, **undo the changes** so your phone is normal
and secure again:
1. **Phone → Wi-Fi → your network → Proxy → back to "None".**
2. **Remove the certificate:** Settings → Security → Encryption & credentials →
   **Trusted credentials / User** tab → find **mitmproxy** → **Remove**.
3. On the PC, close the `mitmweb` window (Ctrl+C in PowerShell).

Leaving the proxy + cert on your phone is a security risk — don't skip this.

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `mitm.it` won't load on phone | Proxy not set correctly | Re-check Part 3: right IP, port 8080, same Wi-Fi |
| Web pages load but **no** eCourts rows appear when you search | The app **pins** its certificate (refuses the middleman) | This is the hard case — needs a rooted phone + Frida "unpinning". See `ecourts-traffic-capture-guide.md` Section B, or hand it to whoever built the original client |
| Phone has no internet at all after proxy | Wrong IP or PC firewall blocking port 8080 | Verify IP; allow mitmproxy through Windows Firewall when prompted |
| Can't find "Proxy" in Wi-Fi settings | Some phones hide it under "Advanced" | Expand advanced options on the network detail screen |
| Nothing in the list at all | mitmweb filter too strict | Clear the filter box, look for `ecourts` manually |

---

## The catch to expect (read this)

The likely failure mode is **certificate pinning** (the "no eCourts rows" row in
the table). Government apps sometimes pin; if this one does, a plain proxy won't
work and you'd need a rooted device + Frida — which is genuinely advanced.

**Two easier fallbacks if that happens:**
1. **Chrome DevTools on the website** — no proxy, no phone, no certificate. Open
   `services.ecourts.gov.in` on your PC, press **F12 → Network**, do a party
   search, pick State + District, and read the court-list request right there.
   (Different backend than the app, but zero setup — worth trying first, honestly.)
2. **Let me probe the backend from here** — I can attempt to hit the current
   court-list endpoint server-side with no tools on your end.

If you'd rather not fight mitmproxy, say the word and we do one of these instead.
