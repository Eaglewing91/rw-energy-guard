# RW Energy Guard

RW Energy Guard is a Torn userscript designed to **protect stacked energy** by preventing accidental gym training when your faction has a **pending or scheduled Ranked War**.

Gym training is **hard-blocked** unless the user explicitly confirms they want to train.

---

## Features

- ✅ Detects **pending/scheduled Ranked Wars** via the official Torn API
- 🛑 Hard-blocks all gym **TRAIN** buttons until confirmed
- ⚠️ Confirmation modal before training
- ⏱ Optional “Don’t ask again for 30 minutes”
- 🧠 Cached API calls to minimise API usage
- ❌ No scraping
- ❌ No automation (manual clicks only)

---

## One-click install (Tampermonkey)

Install RW Energy Guard using this link:

https://raw.githubusercontent.com/Eaglewing91/rw-energy-guard/main/rw-energy-guard.user.js

(Tampermonkey will prompt you to install the script.)

---

## Requirements

- Tampermonkey (Chrome, Firefox, Edge)
- A **PUBLIC Torn API key only**

Required API access (Torn API v2):
- **Faction → rankedwars** – to detect a pending ranked war
- **Faction → basic** – to identify your faction so the opponent's name can be shown

No private or full-access API permissions are required. On first use you are asked for your key once; after that, use the Tampermonkey menu (**RW Energy Guard: Set API key**).

Your API key is:
- Stored **locally** in Tampermonkey
- Sent only to `api.torn.com`, in the request's `Authorization` header (never in the URL)
- Never logged or shared

## Terms of Service

| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
| --- | --- | --- | --- | --- |
| No / Only locally (API key, faction ID and "don't ask again" time in Tampermonkey; war status in memory only) | Nobody | Other (mistake prevention: asks for confirmation before gym training while your faction has a pending ranked war) | Stored locally / Not shared, sent only to api.torn.com | Public (faction rankedwars, faction basic) |

---

## How it works

When you click any gym **TRAIN** button on:

https://www.torn.com/gym.php

If your faction has a **pending Ranked War**, RW Energy Guard will:

1. Instantly block the click and disable all TRAIN buttons
2. Display a confirmation modal with a countdown to the war start (in TCT)
3. Only allow training if you explicitly click **Train anyway**, which clicks your chosen TRAIN button exactly once

Cancelling guarantees **no energy is spent**.

War status is checked when the gym page opens and refreshed every 5 minutes in the background (API only). If you click TRAIN before the first check finishes, the click is held and you're asked to click again in a moment. If the API can't be reached, you're told that training is not being guarded.

---

## Torn rules & safety

This script:
- Adds a confirmation UI layer only
- Uses **official Torn API endpoints only**
- Does not scrape Torn pages or HTML
- Does not automate gameplay actions

It is designed for **safety and mistake prevention**, not advantage.

---

## Changelog

### 0.4.0
- **Fixed:** the TRAIN click is now blocked instantly. Previously the check waited for the API before blocking, so Torn could process the training first, and **Train anyway** could then train a second time.
- War status is loaded in advance and refreshed every 5 minutes, so the guard decides immediately when you click.
- Uses Torn API v2 (`faction/rankedwars`) with exact war fields instead of guessing; the opponent's name now shows correctly.
- API key is sent in the `Authorization` header instead of the URL; clearer messages for key errors.
- Start time shown in TCT alongside the countdown.
- You're asked for an API key once, not on every gym visit.
- Fixed a leftover Escape-key listener that could close a later confirmation.
- Added `@noframes` and the Terms of Service table.

## Author

**Eaglewing [571041]**

---

## License

MIT License (see `LICENSE`)
