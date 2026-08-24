import { buildPushPayload, type PushSubscription as WebPushSubscription } from '@block65/webcrypto-web-push';

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SESSION_SECRET: string;
  SITE_PASSWORD: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  TIMEZONE?: string;
  REMINDER_INTERVAL_MINUTES?: string;
  REMINDER_WINDOW_HOURS?: string;
  // Local testing only (.dev.vars). Never set in production.
  DEV_AUTH_BYPASS?: string;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

type SessionPayload = {
  exp: number;
  unlocked?: boolean;
  uid?: string;
  name?: string;
};

type UserRow = {
  id: string;
  name: string;
};

type SlotRow = {
  id: string;
  slot_date: string;
  slot_key: string;
  slot_label: string;
  slot_time: string;
  status: 'pending' | 'completed' | 'skipped';
  completed_at: string | null;
  completed_by_name: string | null;
  last_notified_at: string | null;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type OverrideRow = {
  slot_date: string;
  slot_key: string;
  slot_time: string;
};

type SkippedRow = {
  slot_date: string;
  slot_key: string;
  reason: string | null;
};

type SeizureRow = {
  id: string;
  occurred_on: string;
  occurred_time: string | null;
  notes: string | null;
  created_at: string;
  created_by_name: string | null;
};

type DayStats = {
  completedCount: number;
  pendingCount: number;
  skippedCount: number;
  averageLatenessMinutes: number | null;
  maxLatenessMinutes: number | null;
  minLatenessMinutes: number | null;
};

type StatsPoint = {
  date: string;
  completedCount: number;
  pendingCount: number;
  skippedCount: number;
  averageLatenessMinutes: number | null;
};

const COOKIE_NAME = 'mocha_med_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const DEFAULT_REMINDER_INTERVAL_MINUTES = 5;
// How long past its scheduled time a dose keeps generating reminders. A dose
// past this window still counts as missed in Stats and still appears in the
// overdue list; it just stops pushing.
const DEFAULT_REMINDER_WINDOW_HOURS = 1;
const TRACKING_START_DATE = '2026-06-08';
const MEDICATION_START_DATE = '2026-05-25';
const SLOT_DEFINITIONS = [
  { key: 'morning', label: '8:30 AM', time: '08:30' },
  { key: 'afternoon', label: '4:30 PM', time: '16:30' },
  { key: 'night', label: '11:30 PM', time: '23:30' },
] as const;

const STATS_DEFAULT_DAY_LIMIT = 7;
const STATS_MAX_DAY_LIMIT = 92;
const SLOT_UPSERT_BATCH_SIZE = 90;

const SLOT_UPSERT_SQL = `INSERT INTO slots (
  id, slot_date, slot_key, slot_label, slot_time, status, created_at, updated_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
ON CONFLICT(id) DO UPDATE SET
  slot_label = excluded.slot_label,
  slot_time = excluded.slot_time,
  updated_at = excluded.updated_at,
  status = CASE
    WHEN slots.status = 'completed' THEN slots.status
    ELSE excluded.status
  END,
  completed_at = CASE
    WHEN excluded.status = 'skipped' THEN NULL
    WHEN slots.status = 'completed' THEN slots.completed_at
    ELSE NULL
  END,
  completed_by_user_id = CASE
    WHEN excluded.status = 'skipped' THEN NULL
    WHEN slots.status = 'completed' THEN slots.completed_by_user_id
    ELSE NULL
  END,
  last_notified_at = CASE
    WHEN excluded.status = 'skipped' THEN NULL
    ELSE slots.last_notified_at
  END`;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    ctx.waitUntil(runReminderSweep(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;

async function handleApiRequest(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    if (request.method === 'GET' && url.pathname === '/api/auth/state') {
      return authState(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/unlock') {
      return unlock(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/login') {
      return login(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/logout') {
      return logout();
    }

    const session = await readSession(request, env);
    if (!isPersonSession(session)) {
      return json({ error: 'Authentication required.' }, 401);
    }

    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      return bootstrap(env, session);
    }

    if (request.method === 'GET' && url.pathname === '/api/day') {
      return dayView(env, session, url);
    }

    if (request.method === 'GET' && url.pathname === '/api/settings') {
      return settingsView(env, url);
    }

    if (request.method === 'POST' && url.pathname === '/api/settings/slot') {
      return saveSettingsSlot(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/settings/batch') {
      return saveBatchSettings(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/stats') {
      return statsView(env, url);
    }

    if (request.method === 'POST' && url.pathname === '/api/push/subscribe') {
      return savePushSubscription(request, env, session);
    }

    if (request.method === 'POST' && url.pathname === '/api/push/test') {
      return testPush(env, session);
    }

    if (request.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
      return disablePushSubscription(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/seizures') {
      return listSeizures(env);
    }

    if (request.method === 'POST' && url.pathname === '/api/seizures') {
      return logSeizure(request, env, session);
    }

    const seizureMatch = url.pathname.match(/^\/api\/seizures\/([^/]+)$/);
    if (request.method === 'DELETE' && seizureMatch) {
      return deleteSeizure(env, decodeURIComponent(seizureMatch[1]));
    }

    const completeMatch = url.pathname.match(/^\/api\/slots\/([^/]+)\/complete$/);
    if (request.method === 'POST' && completeMatch) {
      return completeSlot(env, session, decodeURIComponent(completeMatch[1]));
    }

    const uncompleteMatch = url.pathname.match(/^\/api\/slots\/([^/]+)\/uncomplete$/);
    if (request.method === 'POST' && uncompleteMatch) {
      return uncompleteSlot(env, decodeURIComponent(uncompleteMatch[1]));
    }

    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: 'Internal server error.' }, 500);
  }
}

async function authState(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);

  if (!session) {
    if (isDevAuthBypass(env)) {
      const users = await listUsers(env.DB);
      return json({ stage: 'identity', users });
    }
    return json({ stage: 'password' });
  }

  if (isPersonSession(session)) {
    return json({
      stage: 'ready',
      me: { id: session.uid, name: session.name },
    });
  }

  if (session.unlocked || isDevAuthBypass(env)) {
    const users = await listUsers(env.DB);
    return json({ stage: 'identity', users });
  }

  return json({ stage: 'password' });
}

function isDevAuthBypass(env: Env): boolean {
  return env.DEV_AUTH_BYPASS === 'true';
}

async function unlock(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ password?: string }>().catch(() => null);
  const password = String(body?.password ?? '');

  if (!password) {
    return json({ error: 'Password is required.' }, 400);
  }

  if (!timingSafeEqual(password, env.SITE_PASSWORD)) {
    return json({ error: 'Incorrect site password.' }, 401);
  }

  const token = await createSessionToken(
    {
      unlocked: true,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    },
    env,
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...jsonHeaders,
      'set-cookie': serializeCookie(COOKIE_NAME, token, SESSION_MAX_AGE),
    },
  });
}

async function login(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session?.unlocked && !isDevAuthBypass(env)) {
    return json({ error: 'Enter the site password first.' }, 401);
  }

  const body = await request.json<{ userId?: string }>().catch(() => null);
  const userId = normalizeIdentity(body?.userId ?? '');
  if (!userId) {
    return json({ error: 'Choose who is using the app.' }, 400);
  }

  const row = await env.DB.prepare('SELECT id, name FROM users WHERE id = ?1 LIMIT 1')
    .bind(userId)
    .first<UserRow>();

  if (!row) {
    return json({ error: 'Invalid person selected.' }, 401);
  }

  const token = await createSessionToken(
    {
      unlocked: true,
      uid: row.id,
      name: row.name,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    },
    env,
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...jsonHeaders,
      'set-cookie': serializeCookie(COOKIE_NAME, token, SESSION_MAX_AGE),
    },
  });
}

function logout(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...jsonHeaders,
      'set-cookie': serializeCookie(COOKIE_NAME, '', 0),
    },
  });
}

async function bootstrap(
  env: Env,
  session: SessionPayload & { uid: string; name: string },
): Promise<Response> {
  const now = new Date();
  const timezone = getTimezone(env);
  const todayDate = getLocalDateTime(now, timezone).date;

  await ensureScheduleWindow(env.DB, now, timezone);

  const [day, overdue, settings] = await Promise.all([
    getDayData(env.DB, todayDate, timezone),
    getOverdueSlots(env.DB, now, timezone),
    getSettingsData(env.DB, todayDate, timezone, todayDate),
  ]);

  return json({
    me: { id: session.uid, name: session.name },
    timezone,
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    reminderIntervalMinutes: getReminderIntervalMinutes(env),
    generatedAt: now.toISOString(),
    startDate: TRACKING_START_DATE,
    todayDate,
    selectedDate: todayDate,
    schedule: SLOT_DEFINITIONS,
    day,
    overdue,
    settings,
  });
}

async function dayView(
  env: Env,
  session: SessionPayload & { uid: string; name: string },
  url: URL,
): Promise<Response> {
  const timezone = getTimezone(env);
  const now = new Date();
  const todayDate = getLocalDateTime(now, timezone).date;
  const requestedDate = String(url.searchParams.get('date') ?? '').trim();

  if (!isIsoDate(requestedDate)) {
    return json({ error: 'A valid date is required.' }, 400);
  }

  if (requestedDate < TRACKING_START_DATE || requestedDate > todayDate) {
    return json({ error: 'Date is out of range.' }, 400);
  }

  await ensureSlotsForRange(env.DB, requestedDate, requestedDate);

  const day = await getDayData(env.DB, requestedDate, timezone);

  return json({
    me: { id: session.uid, name: session.name },
    selectedDate: requestedDate,
    day,
  });
}

async function settingsView(env: Env, url: URL): Promise<Response> {
  const timezone = getTimezone(env);
  const todayDate = getLocalDateTime(new Date(), timezone).date;
  const requestedDate = String(url.searchParams.get('date') ?? '').trim() || todayDate;

  if (!isIsoDate(requestedDate)) {
    return json({ error: 'A valid date is required.' }, 400);
  }

  if (requestedDate < todayDate) {
    return json({ error: 'Settings only support today or future dates.' }, 400);
  }

  const settings = await getSettingsData(env.DB, requestedDate, timezone, todayDate);
  return json(settings);
}

async function statsView(env: Env, url: URL): Promise<Response> {
  const timezone = getTimezone(env);
  const todayDate = getLocalDateTime(new Date(), timezone).date;
  const startDate = String(url.searchParams.get('start') ?? '').trim() || TRACKING_START_DATE;
  const endDate = String(url.searchParams.get('end') ?? '').trim() || todayDate;

  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    return json({ error: 'Invalid stats range.' }, 400);
  }

  if (startDate < TRACKING_START_DATE || endDate > todayDate) {
    return json({ error: 'Stats range is out of bounds.' }, 400);
  }

  const rawCursor = String(url.searchParams.get('dayCursor') ?? '').trim();
  if (rawCursor && !isIsoDate(rawCursor)) {
    return json({ error: 'Invalid stats cursor.' }, 400);
  }
  const dayCursor = rawCursor || null;

  const rawLimit = Number(url.searchParams.get('dayLimit') ?? STATS_DEFAULT_DAY_LIMIT);
  const dayLimit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), STATS_MAX_DAY_LIMIT)
    : STATS_DEFAULT_DAY_LIMIT;

  const stats = await getStatsData(
    env.DB,
    timezone,
    startDate,
    endDate,
    todayDate,
    dayCursor,
    dayLimit,
  );
  return json(stats);
}

async function saveSettingsSlot(request: Request, env: Env): Promise<Response> {
  const timezone = getTimezone(env);
  const todayDate = getLocalDateTime(new Date(), timezone).date;
  const body = await request.json<{
    date?: string;
    slotKey?: string;
    time?: string | null;
    skipped?: boolean;
    reason?: string | null;
  }>().catch(() => null);

  const slotDate = String(body?.date ?? '').trim();
  const slotKey = String(body?.slotKey ?? '').trim();
  const time = body?.time === null ? null : String(body?.time ?? '').trim();
  const skipped = !!body?.skipped;
  const reason = body?.reason ? String(body.reason).trim() : null;

  if (!isIsoDate(slotDate) || slotDate < todayDate) {
    return json({ error: 'Settings can only be changed for today or future dates.' }, 400);
  }

  const base = SLOT_DEFINITIONS.find((slot) => slot.key === slotKey);
  if (!base) {
    return json({ error: 'Invalid slot selected.' }, 400);
  }

  if (time && !isTimeString(time)) {
    return json({ error: 'Time must be in HH:MM format.' }, 400);
  }

  const now = new Date().toISOString();

  if (time && time !== base.time) {
    await env.DB.prepare(
      `INSERT INTO schedule_overrides (slot_date, slot_key, slot_time, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(slot_date, slot_key) DO UPDATE SET
         slot_time = excluded.slot_time,
         updated_at = excluded.updated_at`,
    )
      .bind(slotDate, slotKey, time, now)
      .run();
  } else {
    await env.DB.prepare('DELETE FROM schedule_overrides WHERE slot_date = ?1 AND slot_key = ?2')
      .bind(slotDate, slotKey)
      .run();
  }

  if (skipped) {
    await env.DB.prepare(
      `INSERT INTO skipped_slots (slot_date, slot_key, reason, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(slot_date, slot_key) DO UPDATE SET
         reason = excluded.reason,
         updated_at = excluded.updated_at`,
    )
      .bind(slotDate, slotKey, reason, now)
      .run();
  } else {
    await env.DB.prepare('DELETE FROM skipped_slots WHERE slot_date = ?1 AND slot_key = ?2')
      .bind(slotDate, slotKey)
      .run();
  }

  await ensureSlotsForRange(env.DB, slotDate, slotDate, { force: true });

  const settings = await getSettingsData(env.DB, slotDate, timezone, todayDate);
  const day = await getDayData(env.DB, slotDate, timezone);
  return json({ settings, day });
}

async function saveBatchSettings(request: Request, env: Env): Promise<Response> {
  const timezone = getTimezone(env);
  const todayDate = getLocalDateTime(new Date(), timezone).date;
  const body = await request.json<{
    startDate?: string;
    endDate?: string;
    slots?: Array<{
      slotKey?: string;
      time?: string | null;
      skipped?: boolean;
      reason?: string | null;
    }>;
  }>().catch(() => null);

  const startDate = String(body?.startDate ?? '').trim();
  const endDate = String(body?.endDate ?? '').trim();
  const slots = Array.isArray(body?.slots) ? body!.slots : [];

  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate || startDate < todayDate) {
    return json({ error: 'Batch settings require a valid future date range.' }, 400);
  }

  if (!slots.length) {
    return json({ error: 'At least one slot change is required.' }, 400);
  }

  const dates = enumerateDateRange(startDate, endDate);
  for (const date of dates) {
    for (const slot of slots) {
      const slotKey = String(slot.slotKey ?? '').trim();
      const base = SLOT_DEFINITIONS.find((item) => item.key === slotKey);
      if (!base) {
        return json({ error: `Invalid slot key: ${slotKey}` }, 400);
      }

      const time = slot.time === null ? null : String(slot.time ?? '').trim();
      if (time && !isTimeString(time)) {
        return json({ error: `Invalid time for ${slotKey}` }, 400);
      }

      await applySlotSetting(env.DB, {
        slotDate: date,
        slotKey,
        baseTime: base.time,
        time,
        skipped: !!slot.skipped,
        reason: slot.reason ? String(slot.reason).trim() : null,
      });
    }
  }

  // One forced pass over the whole range, rather than a re-apply per date.
  await ensureSlotsForRange(env.DB, startDate, endDate, { force: true });

  const settings = await getSettingsData(env.DB, startDate, timezone, todayDate);
  return json({ settings });
}

async function savePushSubscription(
  request: Request,
  env: Env,
  session: SessionPayload & { uid: string; name: string },
): Promise<Response> {
  const body = await request.json<WebPushSubscription & { expirationTime?: number | null }>().catch(() => null);
  const subscription = normalizeSubscription(body);
  if (!subscription) {
    return json({ error: 'Invalid push subscription.' }, 400);
  }

  const now = new Date().toISOString();
  const id = await sha256Hex(subscription.endpoint);

  await env.DB.prepare(
    `INSERT INTO push_subscriptions (
      id, user_id, endpoint, expiration_time, p256dh, auth, user_agent, created_at, updated_at, disabled_at, failure_count, last_success_at, last_failure_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, NULL, 0, NULL, NULL)
    ON CONFLICT(endpoint) DO UPDATE SET
      id = excluded.id,
      user_id = excluded.user_id,
      expiration_time = excluded.expiration_time,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      updated_at = excluded.updated_at,
      disabled_at = NULL,
      failure_count = 0,
      last_failure_at = NULL`,
  )
    .bind(
      id,
      session.uid,
      subscription.endpoint,
      body?.expirationTime ?? null,
      subscription.keys.p256dh,
      subscription.keys.auth,
      request.headers.get('user-agent'),
      now,
    )
    .run();

  return json({ ok: true });
}

async function disablePushSubscription(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ endpoint?: string }>().catch(() => null);
  const endpoint = String(body?.endpoint ?? '').trim();
  if (!endpoint) {
    return json({ error: 'Endpoint is required.' }, 400);
  }

  await env.DB.prepare('UPDATE push_subscriptions SET disabled_at = ?1, updated_at = ?1 WHERE endpoint = ?2')
    .bind(new Date().toISOString(), endpoint)
    .run();

  return json({ ok: true });
}

async function testPush(
  env: Env,
  session: SessionPayload & { uid: string; name: string },
): Promise<Response> {
  const subscriptions = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1 AND disabled_at IS NULL`,
  )
    .bind(session.uid)
    .all<SubscriptionRow>();

  if (!subscriptions.results.length) {
    return json({ error: 'No active subscription found for your account. Enable notifications first.' }, 400);
  }

  let delivered = 0;
  for (const subscription of subscriptions.results) {
    const sent = await sendPush(env, subscription, {
      title: 'Mocha Med Log',
      body: 'Push notifications are working.',
      tag: 'test',
    });
    if (sent) delivered += 1;
  }

  if (delivered === 0) {
    return json({ error: 'Push delivery failed — the subscription may have expired. Try re-enabling notifications.' }, 500);
  }

  return json({ ok: true });
}

async function completeSlot(
  env: Env,
  session: SessionPayload & { uid: string; name: string },
  slotId: string,
): Promise<Response> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE slots
      SET status = 'completed',
          completed_at = ?1,
          completed_by_user_id = ?2,
          updated_at = ?1
      WHERE id = ?3
        AND slot_date >= ?4
        AND status = 'pending'`,
  )
    .bind(now, session.uid, slotId, TRACKING_START_DATE)
    .run();

  return slotResponse(env, slotId);
}

async function uncompleteSlot(env: Env, slotId: string): Promise<Response> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE slots
      SET status = 'pending',
          completed_at = NULL,
          completed_by_user_id = NULL,
          updated_at = ?1
      WHERE id = ?2
        AND status = 'completed'`,
  )
    .bind(now, slotId)
    .run();

  return slotResponse(env, slotId);
}

async function slotResponse(env: Env, slotId: string): Promise<Response> {
  const slot = await env.DB.prepare(
    `SELECT
      slots.id,
      slots.slot_date,
      slots.slot_key,
      slots.slot_label,
      slots.slot_time,
      slots.status,
      slots.completed_at,
      users.name AS completed_by_name,
      slots.last_notified_at
     FROM slots
     LEFT JOIN users ON users.id = slots.completed_by_user_id
     WHERE slots.id = ?1
     LIMIT 1`,
  )
    .bind(slotId)
    .first<SlotRow>();

  if (!slot) {
    return json({ error: 'Slot not found.' }, 404);
  }

  return json({ slot: mapSlotRow(slot, getTimezone(env)) });
}

async function listSeizures(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT s.id, s.occurred_on, s.occurred_time, s.notes, s.created_at, u.name AS created_by_name
     FROM seizure_events s
     LEFT JOIN users u ON u.id = s.created_by_user_id
     ORDER BY s.occurred_on DESC, s.occurred_time DESC, s.created_at DESC`,
  ).all<SeizureRow>();

  return json({
    medicationStartDate: MEDICATION_START_DATE,
    events: rows.results.map((row) => ({
      id: row.id,
      date: row.occurred_on,
      time: row.occurred_time,
      notes: row.notes,
      loggedByName: row.created_by_name,
      createdAt: row.created_at,
    })),
  });
}

async function logSeizure(
  request: Request,
  env: Env,
  session: SessionPayload & { uid: string; name: string },
): Promise<Response> {
  const body = await request.json<{ date?: string; time?: string | null; notes?: string }>().catch(() => null);
  const date = String(body?.date ?? '').trim();
  const time = body?.time ? String(body.time).trim() : null;
  const notes = body?.notes ? String(body.notes).trim() : null;

  if (!isIsoDate(date)) {
    return json({ error: 'A valid date is required.' }, 400);
  }

  if (time && !isTimeString(time)) {
    return json({ error: 'Time must be in HH:MM format.' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO seizure_events (id, occurred_on, occurred_time, notes, created_at, created_by_user_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, date, time, notes, now, session.uid)
    .run();

  return listSeizures(env);
}

async function deleteSeizure(env: Env, id: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM seizure_events WHERE id = ?1').bind(id).run();
  return listSeizures(env);
}

async function runReminderSweep(env: Env, now: Date): Promise<void> {
  const timezone = getTimezone(env);
  await ensureScheduleWindow(env.DB, now, timezone);

  const local = getLocalDateTime(now, timezone);

  // A missed dose stays 'pending' forever, so without a lower bound this picks
  // up every dose ever skipped and re-notifies it on each sweep, indefinitely.
  // Only remind within a window after the scheduled time.
  const cutoff = getLocalDateTime(
    new Date(now.getTime() - getReminderWindowHours(env) * 3_600_000),
    timezone,
  );

  const dueSlots = await env.DB.prepare(
    `SELECT id, slot_date, slot_key, slot_label, slot_time, status, completed_at, NULL AS completed_by_name, last_notified_at
     FROM slots
     WHERE status = 'pending'
       AND slot_date >= ?1
       AND (slot_date > ?1 OR slot_time >= ?2)
       AND (slot_date < ?3 OR (slot_date = ?3 AND slot_time <= ?4))
     ORDER BY slot_date ASC, slot_time ASC
     LIMIT 12`,
  )
    .bind(cutoff.date, cutoff.time, local.date, local.time)
    .all<SlotRow>();

  if (!dueSlots.results.length) {
    return;
  }

  const activeSubscriptions = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE disabled_at IS NULL`,
  ).all<SubscriptionRow>();

  if (!activeSubscriptions.results.length) {
    return;
  }

  const reminderIntervalMs = getReminderIntervalMinutes(env) * 60_000;

  for (const slot of dueSlots.results) {
    if (!shouldSendReminder(slot.last_notified_at, now, reminderIntervalMs)) {
      continue;
    }

    let delivered = 0;
    for (const subscription of activeSubscriptions.results) {
      const sent = await sendSlotReminder(env, slot, subscription);
      if (sent) delivered += 1;
    }

    if (delivered > 0) {
      const sentAt = new Date().toISOString();
      await env.DB.prepare('UPDATE slots SET last_notified_at = ?1, updated_at = ?1 WHERE id = ?2')
        .bind(sentAt, slot.id)
        .run();
    }
  }
}

async function sendPush(
  env: Env,
  subscription: SubscriptionRow,
  message: { title: string; body: string; tag: string; requireInteraction?: boolean; renotify?: boolean; url?: string; topic?: string; urgency?: 'low' | 'normal' | 'high' },
): Promise<boolean> {
  try {
    const webPushSub: WebPushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      expirationTime: null,
    };
    const { topic, urgency, ...notification } = message;
    const init = await buildPushPayload(
      {
        data: JSON.stringify(notification),
        // High urgency tells iOS these are time-critical so it delivers
        // immediately instead of deferring for battery. A long TTL lets the
        // push survive brief unreachability, and the per-slot collapse topic
        // means a reconnecting device gets only the latest reminder.
        options: { ttl: 60 * 60, urgency: urgency ?? 'high', ...(topic ? { topic } : {}) },
      },
      webPushSub,
      { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    );
    const response = await fetch(subscription.endpoint, init as unknown as RequestInit);
    const responseText = await response.text().catch(() => '');

    if (response.ok) {
      await env.DB.prepare(
        `UPDATE push_subscriptions SET failure_count = 0, last_success_at = ?1, updated_at = ?1 WHERE id = ?2`,
      ).bind(new Date().toISOString(), subscription.id).run();
      return true;
    }
    if (response.status === 404 || response.status === 410 || (response.status === 400 && responseText.includes('VapidPkHashMismatch'))) {
      await disableSubscriptionById(env.DB, subscription.id);
      return false;
    }
    await markSubscriptionFailure(env.DB, subscription.id);
    return false;
  } catch (error) {
    console.error('Push send failed', error);
    await markSubscriptionFailure(env.DB, subscription.id);
    return false;
  }
}

async function sendSlotReminder(
  env: Env,
  slot: Pick<SlotRow, 'id' | 'slot_date' | 'slot_label' | 'slot_time'>,
  subscription: SubscriptionRow,
): Promise<boolean> {
  return sendPush(env, subscription, {
    title: 'Mocha medication due',
    body: `${slot.slot_label} dose for ${slot.slot_date} is still waiting to be marked complete.`,
    tag: `slot-${slot.id}`,
    topic: slot.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 32),
    requireInteraction: true,
    renotify: true,
    url: '/',
  });
}

async function markSubscriptionFailure(db: D1Database, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE push_subscriptions
     SET failure_count = failure_count + 1,
         last_failure_at = ?1,
         updated_at = ?1
     WHERE id = ?2`,
  )
    .bind(now, id)
    .run();
}

async function disableSubscriptionById(db: D1Database, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE push_subscriptions
     SET disabled_at = ?1,
         updated_at = ?1
     WHERE id = ?2`,
  )
    .bind(now, id)
    .run();
}

/**
 * Keeps yesterday/today/tomorrow materialized. This runs on every cron tick, so
 * it must not write when the schedule is already settled — `ensureSlotsForRange`
 * skips dates that already have a full slot set, making the steady state three
 * reads and zero writes.
 */
async function ensureScheduleWindow(db: D1Database, now: Date, timezone: string): Promise<void> {
  await ensureSlotsForRange(
    db,
    getOffsetLocalDate(now, timezone, -1),
    getOffsetLocalDate(now, timezone, 1),
  );
}

/**
 * Materializes slot rows for a date range in a fixed number of round trips.
 *
 * By default this only touches dates that are missing slots, so read paths can
 * call it freely without generating writes. Write paths that have just changed
 * an override or skip must pass `force` to re-apply the schedule to dates whose
 * rows already exist.
 */
async function ensureSlotsForRange(
  db: D1Database,
  startDate: string,
  endDate: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const rangeStart = startDate < TRACKING_START_DATE ? TRACKING_START_DATE : startDate;
  if (rangeStart > endDate) return;

  const [existing, overrideRows, skippedRows] = await Promise.all([
    db.prepare(
      `SELECT slot_date, COUNT(*) AS slot_count
       FROM slots
       WHERE slot_date >= ?1 AND slot_date <= ?2
       GROUP BY slot_date`,
    )
      .bind(rangeStart, endDate)
      .all<{ slot_date: string; slot_count: number }>(),
    db.prepare(
      'SELECT slot_date, slot_key, slot_time FROM schedule_overrides WHERE slot_date >= ?1 AND slot_date <= ?2',
    )
      .bind(rangeStart, endDate)
      .all<OverrideRow>(),
    db.prepare(
      'SELECT slot_date, slot_key, reason FROM skipped_slots WHERE slot_date >= ?1 AND slot_date <= ?2',
    )
      .bind(rangeStart, endDate)
      .all<SkippedRow>(),
  ]);

  const slotCounts = new Map(existing.results.map((row) => [row.slot_date, row.slot_count]));
  const staleDates = enumerateDateRange(rangeStart, endDate).filter(
    (date) => options.force || (slotCounts.get(date) ?? 0) < SLOT_DEFINITIONS.length,
  );
  if (!staleDates.length) return;

  const overrides = new Map(
    overrideRows.results.map((row) => [`${row.slot_date}:${row.slot_key}`, row.slot_time]),
  );
  const skipped = new Set(skippedRows.results.map((row) => `${row.slot_date}:${row.slot_key}`));
  const now = new Date().toISOString();

  const statements = staleDates.flatMap((slotDate) =>
    SLOT_DEFINITIONS.map((slot) => {
      const id = `${slotDate}:${slot.key}`;
      return db.prepare(SLOT_UPSERT_SQL).bind(
        id,
        slotDate,
        slot.key,
        slot.label,
        overrides.get(id) ?? slot.time,
        skipped.has(id) ? 'skipped' : 'pending',
        now,
      );
    }),
  );

  for (let i = 0; i < statements.length; i += SLOT_UPSERT_BATCH_SIZE) {
    await db.batch(statements.slice(i, i + SLOT_UPSERT_BATCH_SIZE));
  }
}

async function getDayData(db: D1Database, slotDate: string, timezone: string) {
  const rows = await db.prepare(
    `SELECT
      slots.id,
      slots.slot_date,
      slots.slot_key,
      slots.slot_label,
      slots.slot_time,
      slots.status,
      slots.completed_at,
      users.name AS completed_by_name,
      slots.last_notified_at
     FROM slots
     LEFT JOIN users ON users.id = slots.completed_by_user_id
     WHERE slots.slot_date = ?1
     ORDER BY slots.slot_time ASC`,
  )
    .bind(slotDate)
    .all<SlotRow>();

  const slots = rows.results.map((row) => mapSlotRow(row, timezone));
  return {
    date: slotDate,
    slots,
    stats: summarizeDay(slots),
  };
}

async function getOverdueSlots(db: D1Database, now: Date, timezone: string) {
  const local = getLocalDateTime(now, timezone);
  const rows = await db.prepare(
    `SELECT
      slots.id,
      slots.slot_date,
      slots.slot_key,
      slots.slot_label,
      slots.slot_time,
      slots.status,
      slots.completed_at,
      users.name AS completed_by_name,
      slots.last_notified_at
     FROM slots
     LEFT JOIN users ON users.id = slots.completed_by_user_id
     WHERE slots.status = 'pending'
       AND slots.slot_date >= ?1
       AND (slots.slot_date < ?2 OR (slots.slot_date = ?2 AND slots.slot_time < ?3))
     ORDER BY slots.slot_date DESC, slots.slot_time DESC
     LIMIT 12`,
  )
    .bind(TRACKING_START_DATE, local.date, local.time)
    .all<SlotRow>();

  return rows.results.map((row) => mapSlotRow(row, timezone));
}

function mapSlotRow(row: SlotRow, timezone: string) {
  const latenessMinutes = calculateLatenessMinutes(row, timezone);
  return {
    id: row.id,
    date: row.slot_date,
    key: row.slot_key,
    label: row.slot_label,
    time: row.slot_time,
    status: row.status,
    completedAt: row.completed_at,
    completedByName: row.completed_by_name,
    lastNotifiedAt: row.last_notified_at,
    latenessMinutes,
  };
}

function summarizeDay(
  slots: Array<{ status: 'pending' | 'completed' | 'skipped'; latenessMinutes: number | null }>,
): DayStats {
  const completed = slots.filter((slot) => slot.status === 'completed' && slot.latenessMinutes !== null);
  const deltas = completed.map((slot) => slot.latenessMinutes as number);

  return {
    completedCount: slots.filter((slot) => slot.status === 'completed').length,
    pendingCount: slots.filter((slot) => slot.status === 'pending').length,
    skippedCount: slots.filter((slot) => slot.status === 'skipped').length,
    averageLatenessMinutes: deltas.length ? Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length) : null,
    maxLatenessMinutes: deltas.length ? Math.max(...deltas) : null,
    minLatenessMinutes: deltas.length ? Math.min(...deltas) : null,
  };
}

function calculateLatenessMinutes(row: SlotRow, timezone: string): number | null {
  if (row.status !== 'completed' || !row.completed_at) return null;

  const actual = getLocalDateTime(new Date(row.completed_at), timezone);
  const scheduledDayIndex = dayIndex(row.slot_date);
  const actualDayIndex = dayIndex(actual.date);
  const dayDiff = actualDayIndex - scheduledDayIndex;

  return dayDiff * 1440 + parseTimeMinutes(actual.time) - parseTimeMinutes(row.slot_time);
}

async function listUsers(db: D1Database) {
  const rows = await db.prepare('SELECT id, name FROM users ORDER BY name ASC').all<UserRow>();
  return rows.results.map((user) => ({ id: user.id, name: user.name }));
}

async function getEffectiveSlotsForDate(db: D1Database, slotDate: string) {
  const [overrideRows, skippedRows] = await Promise.all([
    db.prepare('SELECT slot_date, slot_key, slot_time FROM schedule_overrides WHERE slot_date = ?1')
      .bind(slotDate)
      .all<OverrideRow>(),
    db.prepare('SELECT slot_date, slot_key, reason FROM skipped_slots WHERE slot_date = ?1')
      .bind(slotDate)
      .all<SkippedRow>(),
  ]);

  const overrides = new Map(overrideRows.results.map((row) => [row.slot_key, row.slot_time]));
  const skipped = new Map(skippedRows.results.map((row) => [row.slot_key, row.reason]));

  return SLOT_DEFINITIONS.map((slot) => ({
    key: slot.key,
    label: slot.label,
    defaultTime: slot.time,
    time: overrides.get(slot.key) ?? slot.time,
    skipped: skipped.has(slot.key),
    reason: skipped.get(slot.key) ?? null,
    hasOverride: overrides.has(slot.key),
  }));
}

async function getSettingsData(
  db: D1Database,
  slotDate: string,
  timezone: string,
  todayDate: string,
) {
  const effectiveSlots = await getEffectiveSlotsForDate(db, slotDate);
  const upcomingCustomizations = await db.prepare(
    `SELECT
      dates.slot_date,
      dates.slot_key,
      so.slot_time AS override_time,
      ss.reason AS skip_reason,
      ss.slot_key AS skip_key
     FROM (
       SELECT slot_date, slot_key FROM schedule_overrides
       UNION
       SELECT slot_date, slot_key FROM skipped_slots
     ) AS dates
     LEFT JOIN schedule_overrides so
       ON so.slot_date = dates.slot_date AND so.slot_key = dates.slot_key
     LEFT JOIN skipped_slots ss
       ON ss.slot_date = dates.slot_date AND ss.slot_key = dates.slot_key
     WHERE dates.slot_date >= ?1
     ORDER BY dates.slot_date ASC, dates.slot_key ASC`,
  )
    .bind(todayDate)
    .all<{ slot_date: string; slot_key: string; override_time: string | null; skip_reason: string | null; skip_key: string | null }>();

  return {
    date: slotDate,
    minDate: todayDate,
    timezone,
    slots: effectiveSlots.map((slot) => ({
      key: slot.key,
      label: slot.label,
      defaultTime: slot.defaultTime,
      effectiveTime: slot.time,
      overrideTime: slot.hasOverride ? slot.time : null,
      skipped: slot.skipped,
      reason: slot.reason,
    })),
    upcomingCustomizations: upcomingCustomizations.results.map((row) => ({
      date: row.slot_date,
      slotKey: row.slot_key,
      label: SLOT_DEFINITIONS.find((slot) => slot.key === row.slot_key)?.label ?? row.slot_key,
      overrideTime: row.override_time,
      skipped: row.skip_key !== null,
      reason: row.skip_reason,
    })),
  };
}

async function getStatsData(
  db: D1Database,
  timezone: string,
  startDate: string,
  endDate: string,
  todayDate: string,
  dayCursor: string | null,
  dayLimit: number,
) {
  await ensureSlotsForRange(db, startDate, endDate);

  const rows = await db.prepare(
    `SELECT
      slots.id,
      slots.slot_date,
      slots.slot_key,
      slots.slot_label,
      slots.slot_time,
      slots.status,
      slots.completed_at,
      users.name AS completed_by_name,
      slots.last_notified_at
     FROM slots
     LEFT JOIN users ON users.id = slots.completed_by_user_id
     WHERE slots.slot_date >= ?1 AND slots.slot_date <= ?2
     ORDER BY slots.slot_date ASC, slots.slot_time ASC`,
  )
    .bind(startDate, endDate)
    .all<SlotRow>();

  const mapped = rows.results.map((row) => mapSlotRow(row, timezone));
  const byDate = new Map<string, ReturnType<typeof mapSlotRow>[]>();
  for (const row of mapped) {
    const arr = byDate.get(row.date) ?? [];
    arr.push(row);
    byDate.set(row.date, arr);
  }

  const allDates = enumerateDateRange(startDate, endDate);

  // Only the most recent `dayLimit` days (older than `dayCursor`, when paging
  // back) are serialized; the summary below still covers the whole range.
  const pageEndDate = dayCursor && dayCursor < endDate ? dayCursor : endDate;
  const pageDates =
    pageEndDate < startDate ? [] : enumerateDateRange(startDate, pageEndDate).slice(-dayLimit);

  const perDay: StatsPoint[] = pageDates.map((date) => {
    const slots = byDate.get(date) ?? [];
    const stats = summarizeDay(slots);
    return {
      date,
      completedCount: stats.completedCount,
      pendingCount: stats.pendingCount,
      skippedCount: stats.skippedCount,
      averageLatenessMinutes: stats.averageLatenessMinutes,
    };
  });

  const oldestLoadedDate = pageDates[0] ?? null;
  const nextDayCursor =
    oldestLoadedDate && oldestLoadedDate > startDate ? addDays(oldestLoadedDate, -1) : null;

  const completedByUser = mapped
    .filter((slot) => slot.status === 'completed' && slot.completedByName)
    .reduce<Record<string, number>>((acc, slot) => {
      const key = slot.completedByName as string;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

  const allLateness = mapped
    .filter((slot) => slot.status === 'completed' && slot.latenessMinutes !== null)
    .map((slot) => slot.latenessMinutes as number);

  const totalCompleted = mapped.filter((slot) => slot.status === 'completed').length;
  const missedCount = mapped.filter(
    (slot) => slot.status === 'pending' && slot.date < todayDate,
  ).length;

  return {
    timezone,
    startDate,
    endDate,
    perDay,
    totalDays: allDates.length,
    nextDayCursor,
    userBreakdown: Object.entries(completedByUser)
      .map(([name, completedCount]) => ({ name, completedCount }))
      .sort((a, b) => b.completedCount - a.completedCount),
    summary: {
      totalCompleted,
      totalSkipped: mapped.filter((slot) => slot.status === 'skipped').length,
      missedCount,
      dueTotal: totalCompleted + missedCount,
      averageLatenessMinutes: allLateness.length
        ? Math.round(allLateness.reduce((sum, value) => sum + value, 0) / allLateness.length)
        : null,
      bestLatenessMinutes: allLateness.length ? Math.min(...allLateness) : null,
      worstLatenessMinutes: allLateness.length ? Math.max(...allLateness) : null,
    },
  };
}

async function applySlotSetting(
  db: D1Database,
  input: {
    slotDate: string;
    slotKey: string;
    baseTime: string;
    time: string | null;
    skipped: boolean;
    reason: string | null;
  },
) {
  const now = new Date().toISOString();

  if (input.time && input.time !== input.baseTime) {
    await db.prepare(
      `INSERT INTO schedule_overrides (slot_date, slot_key, slot_time, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(slot_date, slot_key) DO UPDATE SET
         slot_time = excluded.slot_time,
         updated_at = excluded.updated_at`,
    )
      .bind(input.slotDate, input.slotKey, input.time, now)
      .run();
  } else {
    await db.prepare('DELETE FROM schedule_overrides WHERE slot_date = ?1 AND slot_key = ?2')
      .bind(input.slotDate, input.slotKey)
      .run();
  }

  if (input.skipped) {
    await db.prepare(
      `INSERT INTO skipped_slots (slot_date, slot_key, reason, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(slot_date, slot_key) DO UPDATE SET
         reason = excluded.reason,
         updated_at = excluded.updated_at`,
    )
      .bind(input.slotDate, input.slotKey, input.reason, now)
      .run();
  } else {
    await db.prepare('DELETE FROM skipped_slots WHERE slot_date = ?1 AND slot_key = ?2')
      .bind(input.slotDate, input.slotKey)
      .run();
  }
}

async function readSession(request: Request, env: Env): Promise<SessionPayload | null> {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE_NAME];
  if (!token) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payloadPart = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expectedSignature = await signValue(payloadPart, env.SESSION_SECRET);
  if (signature !== expectedSignature) return null;

  const payload = safeJsonParse<SessionPayload>(decodeBase64Url(payloadPart));
  if (!payload) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function isPersonSession(
  session: SessionPayload | null,
): session is SessionPayload & { uid: string; name: string } {
  return !!session?.uid && !!session?.name;
}

async function createSessionToken(payload: SessionPayload, env: Env): Promise<string> {
  const payloadPart = encodeBase64Url(JSON.stringify(payload));
  const signature = await signValue(payloadPart, env.SESSION_SECRET);
  return `${payloadPart}.${signature}`;
}

async function signValue(value: string, secret: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
  return encodeBytesBase64Url(new Uint8Array(signature));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseCookies(header: string | null): Record<string, string> {
  const output: Record<string, string> = {};
  if (!header) return output;

  for (const part of header.split(/;\s*/)) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    output[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
  }

  return output;
}

function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax; Secure`;
}

function json(data: JsonValue | Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: jsonHeaders,
  });
}

function normalizeIdentity(value: string): string {
  return String(value).trim().toLowerCase();
}

function normalizeSubscription(
  value: (WebPushSubscription & { expirationTime?: number | null }) | null,
): WebPushSubscription | null {
  if (!value?.endpoint || !value?.keys?.p256dh || !value?.keys?.auth) {
    return null;
  }

  return {
    endpoint: String(value.endpoint),
    expirationTime: value.expirationTime ?? null,
    keys: {
      p256dh: String(value.keys.p256dh),
      auth: String(value.keys.auth),
    },
  };
}

function getTimezone(env: Env): string {
  return env.TIMEZONE || DEFAULT_TIMEZONE;
}

function getReminderIntervalMinutes(env: Env): number {
  const raw = Number(env.REMINDER_INTERVAL_MINUTES ?? DEFAULT_REMINDER_INTERVAL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REMINDER_INTERVAL_MINUTES;
}

function getReminderWindowHours(env: Env): number {
  const raw = Number(env.REMINDER_WINDOW_HOURS ?? DEFAULT_REMINDER_WINDOW_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REMINDER_WINDOW_HOURS;
}

function shouldSendReminder(lastSentAt: string | null, now: Date, intervalMs: number): boolean {
  if (!lastSentAt) return true;
  const last = Date.parse(lastSentAt);
  if (Number.isNaN(last)) return true;
  // Cron jitter means a run can land a few seconds before the full interval
  // elapses since the last send. Without slack, every other run is skipped and
  // the effective cadence doubles. Allow a grace window (capped at half the
  // interval) so an early-firing cron still counts.
  const grace = Math.min(90_000, intervalMs / 2);
  return now.getTime() - last >= intervalMs - grace;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getLocalDateTime(date: Date, timezone: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function getOffsetLocalDate(date: Date, timezone: string, offsetDays: number): string {
  const shifted = new Date(date.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return getLocalDateTime(shifted, timezone).date;
}

function parseTimeMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function dayIndex(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function enumerateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function encodeBase64Url(value: string): string {
  return encodeBytesBase64Url(new TextEncoder().encode(value));
}

function encodeBytesBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
