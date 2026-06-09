# Mocha Med Log

PWA for two people to track whether Mocha's medication was given at:

- `8:30 AM`
- `4:30 PM`
- `11:30 PM`

The flow is:

- enter the shared site password
- choose whether this is `Johnny` or `Pai`
- log medication on the main screen

Either person can mark a slot complete. The app records who marked it, when it happened, and the time difference from the scheduled medication time. A Cloudflare Worker cron keeps sending Web Push reminders until the slot is completed.

The settings page also supports:

- changing medication time for a specific future date and slot
- skipping specific future slots entirely, for example during boarding

## Stack

- React + Vite PWA frontend
- Cloudflare Worker for API + static asset hosting
- Cloudflare D1 for users, medication slots, and push subscriptions
- Web Push via `@pushforge/builder`, which runs in Workers

## Setup

1. Install packages and generate icons:

   ```bash
   npm install
   npm run icons
   ```

2. Create the D1 database:

   ```bash
   npx wrangler d1 create mocha_med_log
   ```

   Copy the returned `database_id` into [wrangler.jsonc](/Users/pluto/github/mocha_med_log/wrangler.jsonc:1).

3. Apply the schema:

   ```bash
   npm run db:migrate:local
   npm run db:migrate:remote
   ```

4. Generate VAPID keys:

   ```bash
   npx @pushforge/builder vapid
   ```

   Save:

   - `publicKey` as `VAPID_PUBLIC_KEY`
   - the full private JWK JSON object as `VAPID_PRIVATE_KEY`
   - a contact string like `mailto:you@example.com` as `VAPID_SUBJECT`

5. Set Worker secrets:

   ```bash
   wrangler secret put SESSION_SECRET
   wrangler secret put SITE_PASSWORD
   wrangler secret put VAPID_PUBLIC_KEY
   wrangler secret put VAPID_PRIVATE_KEY
   wrangler secret put VAPID_SUBJECT
   ```

6. Create the two identities used in the dropdown after the shared password check:

   ```bash
   wrangler d1 execute mocha_med_log --remote --command "
   INSERT INTO users (id, username, name, created_at) VALUES
     ('johnny', 'johnny', 'Johnny', datetime('now')),
     ('pai', 'pai', 'Pai', datetime('now'));
   "
   ```

   After someone enters the shared site password, the app shows these identities in a dropdown and stores which person marked the medication.

## Local and deploy

- Build the client: `npm run build`
- Typecheck: `npm run typecheck`
- Deploy: `npm run deploy`

For integrated local Worker testing, run:

```bash
npm run build
npx wrangler dev
```

## Notes

- Reminder cadence defaults to every `5` minutes. Change `REMINDER_INTERVAL_MINUTES` in [wrangler.jsonc](/Users/pluto/github/mocha_med_log/wrangler.jsonc:1) if you want a different repeat interval.
- iPhone and iPad push notifications only work after the PWA is installed with **Add to Home Screen**.
- The Worker cron in [wrangler.jsonc](/Users/pluto/github/mocha_med_log/wrangler.jsonc:1) is currently set to run every `5` minutes.
- The app only tracks dates starting on `2026-06-08`.
