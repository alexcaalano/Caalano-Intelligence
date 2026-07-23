# Meta creative-fatigue webhook — setup guide

This connects Meta's **own** `creative_fatigue` signal (a real-time push) to the
dashboard, so the **Meta Insights → Creative fatigue · Meta** tab shows Meta's
Low/Med/High verdict beside our computed proxy.

The receiver is already built and deployed:

```
Callback URL:  https://360.caalanodigital.com.au/.netlify/functions/meta-webhook
```

Nothing shows on the Meta tab until a Meta App is connected and subscribes each
client's ad account. The proxy tab keeps covering every client in the meantime.

---

## What you set (Netlify, once)

In **Netlify → Site settings → Environment variables**, add:

| Variable | Value |
|---|---|
| `META_VERIFY_TOKEN` | Any string you invent (e.g. a random 20+ char phrase). You'll paste the same value into Meta. |
| `META_APP_SECRET`   | The Meta App's secret (from Step 1). Used to verify every event is genuinely from Meta. |

Redeploy after adding them (a fresh deploy picks up new env vars).

---

## Step 1 — Create the Meta App
1. **developers.facebook.com → My Apps → Create App → Business.**
2. Link it to the **Caalano Digital Business Manager**.
3. Copy the **App ID** and **App Secret** → put the secret in `META_APP_SECRET`.

## Step 2 — Business verification
**Business Settings → Security Centre → Verify** Caalano Digital as a business.
(Usually already done for ad management — skip if so.)

## Step 3 — System User + account access
1. **Business Settings → System Users → Add** → name it (e.g. `Caalano360 Webhook`), role **Admin**.
2. **Assign assets** → add each **client ad account** with `ads_read` (+ `ads_management`).
3. **Generate token** for the System User → keep it safe (used in Step 5).
   - ⚠️ Each client ad account must be **owned by or shared into your Business Manager**.
     If Windsor is your only link to an account, set up a partner share to your BM first.

## Step 4 — Add the Webhooks product
1. In the App → **Add Product → Webhooks**.
2. Object = **Ad Account**. Add field **`creative_fatigue`**
   (optionally also `ad_recommendations`, `with_issues_ad_objects`).
3. **Callback URL** = the URL above. **Verify token** = your `META_VERIFY_TOKEN`.
4. Click **Verify and Save**. Meta calls the endpoint; it echoes the token and saves. ✅

## Step 5 — Subscribe each client ad account
For every client account, subscribe the app (replace `<ACCOUNT_ID>` with the numeric
id — see `netlify/functions/windsor.mjs` `CLIENTS` for each — and `<SYSTEM_USER_TOKEN>`):

```bash
curl -X POST \
  "https://graph.facebook.com/v21.0/act_<ACCOUNT_ID>/subscribed_apps" \
  -d "subscribed_fields=creative_fatigue" \
  -d "access_token=<SYSTEM_USER_TOKEN>"
```

Check what's subscribed:

```bash
curl -G \
  "https://graph.facebook.com/v21.0/act_<ACCOUNT_ID>/subscribed_apps" \
  -d "access_token=<SYSTEM_USER_TOKEN>"
```

Current client account ids (numeric):

| Client | Meta account id |
|---|---|
| ablycalm | 2531025873751747 |
| finr-advisory | 562656435170426 |
| nexia-health | 538799668712983 |
| pool-haus | 722206724104428 |
| healan-centre | 1332047794857601 |
| simchat | 3329764523983981 |
| swift-emergency | 1080637839761918 |
| ido-ido | 1446200046468733 |
| owl-psa | 24559773240339868 |
| psychology-hub | 1849212035791025 |
| a2z | 3872288763038641 |

(Confirm the live list against `CLIENTS` in `windsor.mjs` — it's the source of truth.)

## Step 6 — App Review (unlocks all clients)
Because you're subscribing **clients'** accounts, the app needs **Advanced Access** to
`ads_management` / `ads_read` via **App Review** (a short use-case description + a
screen recording). A few days to ~2 weeks.

- **Before approval:** the webhook only fires for accounts the app already owns — good
  for testing on one account.
- **After approval:** it fires across all clients, and the Meta tab fills in
  automatically.

---

## How to tell it's working
- **Meta App → Webhooks** shows the Ad Account subscription as active.
- The dashboard's **Creative fatigue · Meta** tab stops showing "Not receiving Meta
  events yet" and lists accounts as their first verdicts arrive.
- Each event is stored in the Netlify Blobs store `meta-webhooks`, keyed `acct:<id>`.

## Security notes
- Every POST is verified with `META_APP_SECRET` (HMAC SHA-256). Unsigned/mis-signed
  requests are rejected with 401 once the secret is set.
- The endpoint only ever **stores** fatigue verdicts; it takes no action on the account.
