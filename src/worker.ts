import { buildPushHTTPRequest, type PushSubscription } from '@pushforge/builder';

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
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

type SessionPayload = {
  uid: string;
  name: string;
  exp: number;
};

type UserRow = {
  id: string;
  username: string;
  name: string;
};

type SlotRow = {
  id: string;
  slot_date: string;
  slot_key: string;
  slot_label: string;
  slot_time: string;
  status: 'pending' | 'completed';
  completed_at: string | null;
  completed_by_name: string | null;
  last_notified_at: string | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  expiration_time: number | null;
  p256dh: string;
  auth: string;
  failure_count: number;
};

const COOKIE_NAME = 'mocha_med_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const DEFAULT_REMINDER_INTERVAL_MINUTES = 30;
const SLOT_DEFINITIONS = [
  { key: 'morning', label: '8:30 AM', time: '08:30' },
  { key: 'afternoon', label: '4:30 PM', time: '16:30' },
  { key: 'night', label: '11:30 PM', time: '23:30' },
] as const;

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
    if (request.method === 'GET' && url.pathname === '/api/auth/options') {
      return authOptions(env);
    }

    if (request.method === 'POST' && url.pathname === '/api/login') {
      return login(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/logout') {
      return logout();
    }

    const session = await readSession(request, env);

    if (!session) {
      return json({ error: 'Authentication required.' }, 401);
    }

    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      return bootstrap(env, session);
    }

    if (request.method === 'POST' && url.pathname === '/api/push/subscribe') {
      return savePushSubscription(request, env, session);
    }

    if (request.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
      return disablePushSubscription(request, env);
    }

    const completeMatch = url.pathname.match(/^\/api\/slots\/([^/]+)\/complete$/);
    if (request.method === 'POST' && completeMatch) {
      return completeSlot(env, session, decodeURIComponent(completeMatch[1]));
    }

    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: 'Internal server error.' }, 500);
  }
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<{ userId?: string; password?: string }>()
    .catch(() => null);
  const userId = normalizeIdentity(body?.userId ?? '');
  const password = String(body?.password ?? '');

  if (!userId || !password) {
    return json({ error: 'Password and person are required.' }, 400);
  }

  const row = await env.DB.prepare(
    'SELECT id, username, name FROM users WHERE id = ?1 LIMIT 1',
  )
    .bind(userId)
    .first<UserRow>();

  if (!row) {
    return json({ error: 'Invalid person selected.' }, 401);
  }

  if (!timingSafeEqual(password, env.SITE_PASSWORD)) {
    return json({ error: 'Incorrect site password.' }, 401);
  }

  const token = await createSessionToken(
    {
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

async function authOptions(env: Env): Promise<Response> {
  const users = await env.DB.prepare(
    'SELECT id, username, name FROM users ORDER BY name ASC',
  ).all<UserRow>();

  return json({
    users: users.results.map((user) => ({
      id: user.id,
      name: user.name,
    })),
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

async function bootstrap(env: Env, session: SessionPayload): Promise<Response> {
  const now = new Date();
  const timezone = getTimezone(env);
  await ensureScheduleWindow(env.DB, now, timezone);
  const dashboard = await getDashboard(env.DB, now, timezone);
  const reminderIntervalMinutes = getReminderIntervalMinutes(env);

  const payload = {
    me: { id: session.uid, name: session.name },
    timezone,
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    reminderIntervalMinutes,
    schedule: SLOT_DEFINITIONS,
    generatedAt: now.toISOString(),
    ...dashboard,
  };

  return json(payload);
}

async function savePushSubscription(
  request: Request,
  env: Env,
  session: SessionPayload,
): Promise<Response> {
  const body = await request.json<PushSubscription & { expirationTime?: number | null }>().catch(() => null);
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

  await env.DB.prepare(
    'UPDATE push_subscriptions SET disabled_at = ?1, updated_at = ?1 WHERE endpoint = ?2',
  )
    .bind(new Date().toISOString(), endpoint)
    .run();

  return json({ ok: true });
}

async function completeSlot(
  env: Env,
  session: SessionPayload,
  slotId: string,
): Promise<Response> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE slots
      SET status = 'completed',
          completed_at = ?1,
          completed_by_user_id = ?2,
          updated_at = ?1
      WHERE id = ?3 AND status = 'pending'`,
  )
    .bind(now, session.uid, slotId)
    .run();

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

  return json({ slot: mapSlotRow(slot) });
}

async function runReminderSweep(env: Env, now: Date): Promise<void> {
  const timezone = getTimezone(env);
  await ensureScheduleWindow(env.DB, now, timezone);

  const local = getLocalDateTime(now, timezone);
  const dueSlots = await env.DB.prepare(
    `SELECT id, slot_date, slot_key, slot_label, slot_time, status, completed_at, NULL AS completed_by_name, last_notified_at
     FROM slots
     WHERE status = 'pending'
       AND (slot_date < ?1 OR (slot_date = ?1 AND slot_time <= ?2))
     ORDER BY slot_date ASC, slot_time ASC`,
  )
    .bind(local.date, local.time)
    .all<SlotRow>();

  if (!dueSlots.results.length) {
    return;
  }

  const activeSubscriptions = await env.DB.prepare(
    `SELECT id, user_id, endpoint, expiration_time, p256dh, auth, failure_count
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
      await env.DB.prepare(
        'UPDATE slots SET last_notified_at = ?1, updated_at = ?1 WHERE id = ?2',
      )
        .bind(sentAt, slot.id)
        .run();
    }
  }
}

async function sendSlotReminder(
  env: Env,
  slot: Pick<SlotRow, 'id' | 'slot_date' | 'slot_label' | 'slot_time'>,
  subscription: SubscriptionRow,
): Promise<boolean> {
  try {
    const payload = {
      title: `Mocha medication due`,
      body: `${slot.slot_label} dose for ${slot.slot_date} is still waiting to be marked complete.`,
      tag: `slot-${slot.id}`,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      requireInteraction: true,
      renotify: true,
      data: {
        slotId: slot.id,
        url: '/',
      },
    };

    const { endpoint, headers, body } = await buildPushHTTPRequest({
      privateJWK: env.VAPID_PRIVATE_KEY,
      subscription: {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      message: {
        payload,
        adminContact: env.VAPID_SUBJECT,
        options: {
          ttl: 60 * 60,
          urgency: 'high',
          topic: `slot-${slot.id}`,
        },
      },
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
    });

    if (response.ok) {
      await env.DB.prepare(
        `UPDATE push_subscriptions
         SET failure_count = 0, last_success_at = ?1, updated_at = ?1
         WHERE id = ?2`,
      )
        .bind(new Date().toISOString(), subscription.id)
        .run();
      return true;
    }

    if (response.status === 404 || response.status === 410) {
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

async function ensureScheduleWindow(db: D1Database, now: Date, timezone: string): Promise<void> {
  const current = getLocalDateTime(now, timezone).date;
  const dates = [
    getOffsetLocalDate(now, timezone, -1),
    current,
    getOffsetLocalDate(now, timezone, 1),
  ];

  for (const slotDate of dates) {
    await ensureSlotsForDate(db, slotDate);
  }
}

async function ensureSlotsForDate(db: D1Database, slotDate: string): Promise<void> {
  const now = new Date().toISOString();
  await db.batch(
    SLOT_DEFINITIONS.map((slot) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO slots (
            id, slot_date, slot_key, slot_label, slot_time, status, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)`,
        )
        .bind(`${slotDate}:${slot.key}`, slotDate, slot.key, slot.label, slot.time, now),
    ),
  );
}

async function getDashboard(db: D1Database, now: Date, timezone: string) {
  const local = getLocalDateTime(now, timezone);

  const [todayRows, overdueRows, recentRows] = await Promise.all([
    db
      .prepare(
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
      .bind(local.date)
      .all<SlotRow>(),
    db
      .prepare(
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
          AND (slots.slot_date < ?1 OR (slots.slot_date = ?1 AND slots.slot_time < ?2))
        ORDER BY slots.slot_date DESC, slots.slot_time DESC
        LIMIT 6`,
      )
      .bind(local.date, local.time)
      .all<SlotRow>(),
    db
      .prepare(
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
        ORDER BY slots.slot_date DESC, slots.slot_time DESC
        LIMIT 12`,
      )
      .all<SlotRow>(),
  ]);

  return {
    today: todayRows.results.map(mapSlotRow),
    overdue: overdueRows.results.map(mapSlotRow),
    recent: recentRows.results.map(mapSlotRow),
  };
}

function mapSlotRow(row: SlotRow) {
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
  };
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

function normalizeUsername(value: string): string {
  return String(value).trim().toLowerCase();
}

function normalizeIdentity(value: string): string {
  return normalizeUsername(value);
}

function normalizeSubscription(
  value: (PushSubscription & { expirationTime?: number | null }) | null,
): PushSubscription | null {
  if (!value?.endpoint || !value?.keys?.p256dh || !value?.keys?.auth) {
    return null;
  }

  return {
    endpoint: String(value.endpoint),
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

function shouldSendReminder(lastSentAt: string | null, now: Date, intervalMs: number): boolean {
  if (!lastSentAt) return true;
  const last = Date.parse(lastSentAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= intervalMs;
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
