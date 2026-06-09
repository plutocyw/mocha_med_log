import { type ReactNode, useEffect, useMemo, useState } from 'react';

type User = {
  id: string;
  name: string;
};

type Slot = {
  id: string;
  date: string;
  key: string;
  label: string;
  time: string;
  status: 'pending' | 'completed';
  completedAt: string | null;
  completedByName: string | null;
  lastNotifiedAt: string | null;
};

type BootstrapData = {
  me: User;
  timezone: string;
  vapidPublicKey: string;
  reminderIntervalMinutes: number;
  generatedAt: string;
  schedule: { key: string; label: string; time: string }[];
  today: Slot[];
  overdue: Slot[];
  recent: Slot[];
};

type AuthOptions = {
  users: User[];
};

type PushState = {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  message: string;
};

const initialPushState: PushState = {
  supported: false,
  permission: 'unsupported',
  subscribed: false,
  message: 'Notifications are not available on this browser.',
};

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [pushState, setPushState] = useState<PushState>(initialPushState);
  const [authOptions, setAuthOptions] = useState<AuthOptions | null>(null);
  const [loginError, setLoginError] = useState('');
  const [appError, setAppError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    void loadAuthOptions();
    void loadBootstrap();
  }, []);

  useEffect(() => {
    if (!bootstrap) return;

    const interval = window.setInterval(() => {
      void loadBootstrap({ silent: true });
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [bootstrap]);

  useEffect(() => {
    if (!bootstrap) return;
    void refreshPushState(bootstrap.vapidPublicKey);
  }, [bootstrap]);

  const nextPending = useMemo(() => {
    if (!bootstrap) return null;
    return [...bootstrap.overdue, ...bootstrap.today].find((slot) => slot.status === 'pending') ?? null;
  }, [bootstrap]);

  async function loadAuthOptions() {
    try {
      const response = await fetch('/api/auth/options', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error('Failed to load people');
      }
      const data = (await response.json()) as AuthOptions;
      setAuthOptions(data);
      setSelectedUserId((current) => current || data.users[0]?.id || '');
    } catch (error) {
      console.error(error);
      setLoginError('Unable to load the people list.');
    }
  }

  async function loadBootstrap(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }

    try {
      const response = await fetch('/api/bootstrap', {
        headers: { accept: 'application/json' },
      });

      if (response.status === 401) {
        setBootstrap(null);
        setAppError('');
        if (!authOptions) {
          void loadAuthOptions();
        }
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load dashboard.');
      }

      const data = (await response.json()) as BootstrapData;
      setBootstrap(data);
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to load the medication log right now.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId, password }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setLoginError(data.error ?? 'Unable to sign in.');
        return;
      }

      setPassword('');
      await loadBootstrap();
    } catch (error) {
      console.error(error);
      setLoginError('Unable to sign in.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    setActionBusy('logout');
    try {
      await fetch('/api/logout', { method: 'POST' });
      setBootstrap(null);
      setPushState(initialPushState);
    } finally {
      setActionBusy(null);
    }
  }

  async function handleComplete(slotId: string) {
    setActionBusy(slotId);
    try {
      const response = await fetch(`/api/slots/${encodeURIComponent(slotId)}/complete`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to complete slot');
      }

      await loadBootstrap({ silent: true });
    } catch (error) {
      console.error(error);
      setAppError('Unable to mark that dose complete.');
    } finally {
      setActionBusy(null);
    }
  }

  async function enableNotifications() {
    if (!bootstrap) return;
    setActionBusy('notifications');
    setAppError('');

    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setPushState({
          supported: false,
          permission: 'unsupported',
          subscribed: false,
          message: 'This browser does not support Web Push notifications.',
        });
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushState({
          supported: true,
          permission,
          subscribed: false,
          message: permission === 'denied' ? 'Notification permission is blocked.' : 'Notification permission was not granted.',
        });
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToArrayBuffer(bootstrap.vapidPublicKey),
        });
      }

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });

      await refreshPushState(bootstrap.vapidPublicKey);
    } catch (error) {
      console.error(error);
      setAppError('Unable to enable notifications on this device.');
    } finally {
      setActionBusy(null);
    }
  }

  async function refreshPushState(vapidPublicKey: string) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPushState(initialPushState);
      return;
    }

    const permission = Notification.permission;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (permission === 'granted' && subscription) {
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      }).catch(() => undefined);
    }

    const standalone = isStandaloneMode();
    const guidance =
      /iPhone|iPad|iPod/i.test(navigator.userAgent) && !standalone
        ? 'On iPhone and iPad, notifications only work after Add to Home Screen.'
        : `When a dose is overdue, reminders repeat every ${bootstrap?.reminderIntervalMinutes ?? 30} minutes until someone marks it complete.`;

    setPushState({
      supported: true,
      permission,
      subscribed: !!subscription,
      message:
        permission === 'granted' && subscription
          ? guidance
          : permission === 'denied'
            ? 'Notification permission is blocked for this browser.'
            : guidance,
    });

    // Keep TypeScript from complaining if the key is unused during a no-op refresh.
    void vapidPublicKey;
  }

  if (loading && !bootstrap) {
    return <Shell><div className="panel muted">Loading…</div></Shell>;
  }

  if (!bootstrap) {
    return (
      <Shell>
        <section className="hero hero-login">
          <div className="eyebrow">Mocha Med Log</div>
          <h1>Two-person medication tracker with reminders that keep going until someone marks the dose.</h1>
          <p>
            Sign in with your own account. Every dose records who completed it and the exact time.
            Enter the shared site password first, then choose who is using the app.
          </p>
        </section>

        <form className="panel login-form" onSubmit={handleLogin}>
          <label>
            Person
            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              required
            >
              {(authOptions?.users ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Site password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </label>
          <button className="primary" type="submit" disabled={loginBusy}>
            {loginBusy ? 'Signing in…' : 'Sign in'}
          </button>
          {loginError ? <p className="error">{loginError}</p> : null}
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="hero">
        <div className="eyebrow">Mocha Med Log</div>
        <div className="hero-row">
          <div>
            <h1>{nextPending ? `${nextPending.label} still needs to be marked.` : 'All scheduled doses are complete.'}</h1>
            <p>
              Signed in as <strong>{bootstrap.me.name}</strong>. Schedule is fixed at 8:30 AM, 4:30 PM, and 11:30 PM in {bootstrap.timezone}.
            </p>
          </div>
          <button className="ghost" type="button" onClick={handleLogout} disabled={actionBusy === 'logout'}>
            Sign out
          </button>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-head">
            <h2>Today</h2>
            <span>{bootstrap.today.length} doses</span>
          </div>
          <div className="slots">
            {bootstrap.today.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                busy={actionBusy === slot.id}
                onComplete={() => void handleComplete(slot.id)}
              />
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>Notifications</h2>
            <span>{pushState.subscribed ? 'Active on this device' : 'Needs setup'}</span>
          </div>
          <p className="small">{pushState.message}</p>
          <button
            className="primary"
            type="button"
            onClick={() => void enableNotifications()}
            disabled={actionBusy === 'notifications' || !pushState.supported}
          >
            {pushState.subscribed ? 'Refresh device subscription' : 'Enable notifications'}
          </button>
        </article>
      </section>

      {bootstrap.overdue.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Overdue</h2>
            <span>{bootstrap.overdue.length} still open</span>
          </div>
          <div className="slots">
            {bootstrap.overdue.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                busy={actionBusy === slot.id}
                onComplete={() => void handleComplete(slot.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>Recent activity</h2>
          <span>Latest 12 slots</span>
        </div>
        <div className="activity">
          {bootstrap.recent.map((slot) => (
            <div className="activity-row" key={slot.id}>
              <div>
                <strong>{slot.date}</strong> · {slot.label}
              </div>
              <div className={slot.status === 'completed' ? 'status done' : 'status wait'}>
                {slot.status === 'completed'
                  ? `Completed by ${slot.completedByName ?? 'someone'} at ${formatTimestamp(slot.completedAt)}`
                  : 'Waiting to be marked'}
              </div>
            </div>
          ))}
        </div>
      </section>

      {appError ? <div className="toast">{appError}</div> : null}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="shell">
      <div className="chrome" />
      <div className="content">{children}</div>
    </main>
  );
}

function SlotCard({
  slot,
  busy,
  onComplete,
}: {
  slot: Slot;
  busy: boolean;
  onComplete: () => void;
}) {
  return (
    <div className={`slot ${slot.status}`}>
      <div>
        <div className="slot-title">
          <strong>{slot.label}</strong>
          <span>{slot.time}</span>
        </div>
        <p>
          {slot.status === 'completed'
            ? `Completed by ${slot.completedByName ?? 'someone'} at ${formatTimestamp(slot.completedAt)}`
            : 'Waiting for either person to mark this dose complete.'}
        </p>
      </div>
      {slot.status === 'pending' ? (
        <button className="primary" type="button" disabled={busy} onClick={onComplete}>
          {busy ? 'Saving…' : 'Mark complete'}
        </button>
      ) : (
        <div className="pill done">Complete</div>
      )}
    </div>
  );
}

function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function isStandaloneMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
