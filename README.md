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

Required API access:
- **User** (basic/profile) – to read faction ID
- **Faction** (ranked wars) – `selections=rankedwars`

No private or full-access API permissions are required.

Your API key is:
- Stored **locally** in Tampermonkey
- Never transmitted anywhere else
- Never logged or shared

---

## How it works

When you click any gym **TRAIN** button on:

https://www.torn.com/gym.php

If your faction has a **pending Ranked War**, RW Energy Guard will:

1. Instantly disable all TRAIN buttons
2. Display a confirmation modal
3. Only allow training if you explicitly click **Train anyway**

Cancelling guarantees **no energy is spent**.

---

## Torn rules & safety

This script:
- Adds a confirmation UI layer only
- Uses **official Torn API endpoints only**
- Does not scrape Torn pages or HTML
- Does not automate gameplay actions

It is designed for **safety and mistake prevention**, not advantage.

---

## Author

**Eaglewing [571041]**

---

## License

MIT License (see `LICENSE`)
