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
  status: 'pending' | 'completed' | 'skipped';
  completedAt: string | null;
  completedByName: string | null;
  lastNotifiedAt: string | null;
  latenessMinutes: number | null;
};

type DayStats = {
  completedCount: number;
  pendingCount: number;
  skippedCount: number;
  averageLatenessMinutes: number | null;
  maxLatenessMinutes: number | null;
  minLatenessMinutes: number | null;
};

type DayData = {
  date: string;
  slots: Slot[];
  stats: DayStats;
};

type SettingsSlot = {
  key: string;
  label: string;
  defaultTime: string;
  effectiveTime: string;
  overrideTime: string | null;
  skipped: boolean;
  reason: string | null;
};

type SettingsData = {
  date: string;
  minDate: string;
  timezone: string;
  slots: SettingsSlot[];
  upcomingCustomizations: Array<{
    date: string;
    slotKey: string;
    label: string;
    overrideTime: string | null;
    skipped: boolean;
    reason: string | null;
  }>;
};

type SettingsSlotDraft = {
  key: string;
  label: string;
  defaultTime: string;
  time: string;
  skipped: boolean;
  reason: string;
};

type BootstrapData = {
  me: User;
  timezone: string;
  vapidPublicKey: string;
  reminderIntervalMinutes: number;
  generatedAt: string;
  startDate: string;
  todayDate: string;
  selectedDate: string;
  schedule: { key: string; label: string; time: string }[];
  day: DayData;
  overdue: Slot[];
  settings: SettingsData;
};

type AuthState =
  | { stage: 'password' }
  | { stage: 'identity'; users: User[] }
  | { stage: 'ready'; me: User };

type DayResponse = {
  me: User;
  selectedDate: string;
  day: DayData;
};

type SettingsResponse = {
  settings: SettingsData;
  day: DayData;
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
  const [day, setDay] = useState<DayData | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [settingsDrafts, setSettingsDrafts] = useState<SettingsSlotDraft[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [settingsDate, setSettingsDate] = useState('');
  const [authState, setAuthState] = useState<AuthState>({ stage: 'password' });
  const [pushState, setPushState] = useState<PushState>(initialPushState);
  const [loginError, setLoginError] = useState('');
  const [appError, setAppError] = useState('');
  const [password, setPassword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    if (!bootstrap) return;

    const interval = window.setInterval(() => {
      void loadAppData(selectedDate || bootstrap.todayDate, settingsDate || bootstrap.todayDate, { silent: true });
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [bootstrap, selectedDate, settingsDate]);

  useEffect(() => {
    if (!bootstrap) return;
    void refreshPushState(bootstrap.vapidPublicKey);
  }, [bootstrap]);

  const nextPending = useMemo(() => {
    if (!day || !bootstrap) return null;
    return [...bootstrap.overdue, ...day.slots].find((slot) => slot.status === 'pending') ?? null;
  }, [bootstrap, day]);

  async function initialize() {
    setLoading(true);
    setAppError('');

    try {
      const state = await fetchAuthState();
      setAuthState(state);

      if (state.stage === 'identity') {
        setSelectedUserId(state.users[0]?.id ?? '');
      }

      if (state.stage === 'ready') {
        await loadAppData(undefined, undefined, { silent: true });
      }
    } catch (error) {
      console.error(error);
      setAppError('Unable to load the app right now.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchAuthState(): Promise<AuthState> {
    const response = await fetch('/api/auth/state', {
      headers: { accept: 'application/json' },
    });

    if (!response.ok) throw new Error('Failed to load auth state.');
    return (await response.json()) as AuthState;
  }

  async function fetchDay(date: string): Promise<DayResponse> {
    const response = await fetch(`/api/day?date=${encodeURIComponent(date)}`, {
      headers: { accept: 'application/json' },
    });

    if (!response.ok) throw new Error('Failed to load selected day.');
    return (await response.json()) as DayResponse;
  }

  async function fetchSettings(date: string): Promise<SettingsData> {
    const response = await fetch(`/api/settings?date=${encodeURIComponent(date)}`, {
      headers: { accept: 'application/json' },
    });

    if (!response.ok) throw new Error('Failed to load settings.');
    return (await response.json()) as SettingsData;
  }

  async function loadAppData(viewDate?: string, nextSettingsDate?: string, options?: { silent?: boolean }) {
    if (!options?.silent) setLoading(true);

    try {
      const response = await fetch('/api/bootstrap', {
        headers: { accept: 'application/json' },
      });

      if (response.status === 401) {
        const state = await fetchAuthState();
        setAuthState(state);
        setBootstrap(null);
        setDay(null);
        setSettings(null);
        setSettingsDrafts([]);
        setPushState(initialPushState);
        setSelectedDate('');
        setSettingsDate('');
        if (state.stage === 'identity') {
          setSelectedUserId((current) => current || state.users[0]?.id || '');
        }
        return;
      }

      if (!response.ok) throw new Error('Failed to load dashboard.');

      const data = (await response.json()) as BootstrapData;
      setBootstrap(data);
      setAuthState({ stage: 'ready', me: data.me });

      const targetDate = viewDate && viewDate >= data.startDate && viewDate <= data.todayDate
        ? viewDate
        : data.todayDate;
      const targetSettingsDate = nextSettingsDate && nextSettingsDate >= data.settings.minDate
        ? nextSettingsDate
        : data.settings.date;

      if (targetDate === data.todayDate) {
        setDay(data.day);
        setSelectedDate(data.todayDate);
      } else {
        const dayResponse = await fetchDay(targetDate);
        setDay(dayResponse.day);
        setSelectedDate(dayResponse.selectedDate);
      }

      if (targetSettingsDate === data.settings.date) {
        setSettings(data.settings);
        setSettingsDate(data.settings.date);
        setSettingsDrafts(makeSettingsDrafts(data.settings));
      } else {
        const settingsResponse = await fetchSettings(targetSettingsDate);
        setSettings(settingsResponse);
        setSettingsDate(settingsResponse.date);
        setSettingsDrafts(makeSettingsDrafts(settingsResponse));
      }

      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to load the medication log right now.');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError('');

    try {
      const response = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setLoginError(data.error ?? 'Unable to unlock the app.');
        return;
      }

      const state = await fetchAuthState();
      setAuthState(state);
      if (state.stage === 'identity') {
        setSelectedUserId(state.users[0]?.id ?? '');
      }
    } catch (error) {
      console.error(error);
      setLoginError('Unable to unlock the app.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleIdentityLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setLoginError(data.error ?? 'Unable to continue.');
        return;
      }

      setPassword('');
      await loadAppData();
    } catch (error) {
      console.error(error);
      setLoginError('Unable to continue.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    setActionBusy('logout');
    try {
      await fetch('/api/logout', { method: 'POST' });
      setBootstrap(null);
      setDay(null);
      setSettings(null);
      setSettingsDrafts([]);
      setAuthState({ stage: 'password' });
      setPushState(initialPushState);
      setPassword('');
      setSelectedDate('');
      setSettingsDate('');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleComplete(slotId: string) {
    if (!bootstrap) return;

    setActionBusy(slotId);
    try {
      const response = await fetch(`/api/slots/${encodeURIComponent(slotId)}/complete`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to complete slot.');
      await loadAppData(selectedDate || bootstrap.todayDate, settingsDate || bootstrap.todayDate, { silent: true });
    } catch (error) {
      console.error(error);
      setAppError('Unable to mark that dose complete.');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDateChange(nextDate: string) {
    if (!bootstrap || !nextDate) return;
    setActionBusy('date');
    try {
      await loadAppData(nextDate, settingsDate || bootstrap.todayDate, { silent: true });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleSettingsDateChange(nextDate: string) {
    if (!nextDate) return;
    setActionBusy('settings-date');
    try {
      const nextSettings = await fetchSettings(nextDate);
      setSettings(nextSettings);
      setSettingsDate(nextSettings.date);
      setSettingsDrafts(makeSettingsDrafts(nextSettings));
    } catch (error) {
      console.error(error);
      setAppError('Unable to load settings for that date.');
    } finally {
      setActionBusy(null);
    }
  }

  async function saveSettingsSlotDraft(slotKey: string) {
    const draft = settingsDrafts.find((slot) => slot.key === slotKey);
    if (!draft || !settingsDate) return;

    setActionBusy(`settings-${slotKey}`);
    try {
      const response = await fetch('/api/settings/slot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date: settingsDate,
          slotKey: draft.key,
          time: draft.time,
          skipped: draft.skipped,
          reason: draft.reason || null,
        }),
      });

      if (!response.ok) throw new Error('Failed to save settings slot.');

      const data = (await response.json()) as SettingsResponse;
      setSettings(data.settings);
      setSettingsDrafts(makeSettingsDrafts(data.settings));

      if (selectedDate === settingsDate) {
        setDay(data.day);
      }

      if (bootstrap) {
        setBootstrap({
          ...bootstrap,
          settings: data.settings,
          day: selectedDate === settingsDate ? data.day : bootstrap.day,
        });
      }

      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to save that schedule setting.');
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
        : `Time-critical reminders repeat every ${bootstrap?.reminderIntervalMinutes ?? 5} minutes until someone logs the dose.`;

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

    void vapidPublicKey;
  }

  if (loading && !bootstrap && authState.stage === 'password') {
    return (
      <Shell>
        <div className="panel muted">Loading…</div>
      </Shell>
    );
  }

  if (!bootstrap) {
    return (
      <Shell>
        <section className="hero hero-login">
          <div className="eyebrow">Mocha Med Log</div>
          <h1>Medication tracking for Mocha with push reminders that do not stop until someone logs the dose.</h1>
          <p>First unlock the site with the shared password. After that, pick whether this is Johnny or Pai.</p>
        </section>

        {authState.stage === 'password' ? (
          <form className="panel login-form" onSubmit={handleUnlock}>
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
              {loginBusy ? 'Checking…' : 'Unlock'}
            </button>
            {loginError ? <p className="error">{loginError}</p> : null}
          </form>
        ) : (
          <form className="panel login-form" onSubmit={handleIdentityLogin}>
            <label>
              Who is using the app?
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                required
              >
                {authState.stage === 'identity'
                  ? authState.users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))
                  : null}
              </select>
            </label>
            <div className="inline-actions">
              <button className="ghost" type="button" onClick={() => setAuthState({ stage: 'password' })}>
                Back
              </button>
              <button className="primary" type="submit" disabled={loginBusy}>
                {loginBusy ? 'Opening…' : 'Continue'}
              </button>
            </div>
            {loginError ? <p className="error">{loginError}</p> : null}
          </form>
        )}

        {appError ? <div className="toast">{appError}</div> : null}
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="hero">
        <div className="eyebrow">Mocha Med Log</div>
        <div className="hero-row">
          <div>
            <h1>{nextPending ? `${nextPending.label} still needs to be logged.` : 'Today is fully logged.'}</h1>
            <p>
              Signed in as <strong>{bootstrap.me.name}</strong>. The app always opens on today&apos;s date, and you can review history back to {bootstrap.startDate}.
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
            <h2>Date</h2>
            <button
              className="ghost small-button"
              type="button"
              onClick={() => void handleDateChange(bootstrap.todayDate)}
              disabled={selectedDate === bootstrap.todayDate || actionBusy === 'date'}
            >
              Today
            </button>
          </div>
          <div className="date-controls">
            <input
              type="date"
              value={selectedDate}
              min={bootstrap.startDate}
              max={bootstrap.todayDate}
              onChange={(event) => void handleDateChange(event.target.value)}
            />
            <p className="small">Open the current day by default, then use the date picker to review older records.</p>
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

      {day ? (
        <section className="panel">
          <div className="panel-head">
            <h2>{day.date === bootstrap.todayDate ? 'Today' : day.date}</h2>
            <span>{day.stats.completedCount} of {day.slots.length} logged</span>
          </div>
          <div className="stat-grid">
            <StatCard label="Completed" value={String(day.stats.completedCount)} />
            <StatCard label="Pending" value={String(day.stats.pendingCount)} />
            <StatCard label="Skipped" value={String(day.stats.skippedCount)} />
            <StatCard label="Average delta" value={formatDelta(day.stats.averageLatenessMinutes)} />
            <StatCard label="Worst delta" value={formatDelta(day.stats.maxLatenessMinutes)} />
          </div>
          <div className="slots">
            {day.slots.map((slot) => (
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

      {settings ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Settings</h2>
            <span>Future time overrides and boarding skips</span>
          </div>
          <div className="settings-grid">
            <div className="settings-column">
              <div className="date-controls">
                <label className="login-form label-inline">
                  Settings date
                  <input
                    type="date"
                    value={settingsDate}
                    min={settings.minDate}
                    onChange={(event) => void handleSettingsDateChange(event.target.value)}
                  />
                </label>
                <p className="small">Pick a future date, then adjust slot times or skip specific doses for boarding days.</p>
              </div>
              <div className="settings-slots">
                {settingsDrafts.map((slot) => {
                  const busy = actionBusy === `settings-${slot.key}`;
                  return (
                    <div className="settings-slot-card" key={slot.key}>
                      <div className="slot-title">
                        <strong>{slot.label}</strong>
                        <span>Default {slot.defaultTime}</span>
                      </div>
                      <label className="settings-field">
                        Time
                        <input
                          type="time"
                          value={slot.time}
                          onChange={(event) =>
                            setSettingsDrafts((current) =>
                              current.map((item) =>
                                item.key === slot.key ? { ...item, time: event.target.value } : item,
                              ),
                            )
                          }
                          disabled={slot.skipped}
                        />
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={slot.skipped}
                          onChange={(event) =>
                            setSettingsDrafts((current) =>
                              current.map((item) =>
                                item.key === slot.key ? { ...item, skipped: event.target.checked } : item,
                              ),
                            )
                          }
                        />
                        Skip this slot
                      </label>
                      <label className="settings-field">
                        Reason
                        <input
                          type="text"
                          value={slot.reason}
                          onChange={(event) =>
                            setSettingsDrafts((current) =>
                              current.map((item) =>
                                item.key === slot.key ? { ...item, reason: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Boarding, vet stay, etc."
                        />
                      </label>
                      <div className="inline-actions">
                        <button
                          className="ghost"
                          type="button"
                          onClick={() =>
                            setSettingsDrafts((current) =>
                              current.map((item) =>
                                item.key === slot.key
                                  ? { ...item, time: item.defaultTime, skipped: false, reason: '' }
                                  : item,
                              ),
                            )
                          }
                        >
                          Reset
                        </button>
                        <button
                          className="primary"
                          type="button"
                          disabled={busy}
                          onClick={() => void saveSettingsSlotDraft(slot.key)}
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="settings-column">
              <div className="panel-head compact-head">
                <h2>Upcoming custom dates</h2>
                <span>{settings.upcomingCustomizations.length} entries</span>
              </div>
              <div className="activity">
                {settings.upcomingCustomizations.length === 0 ? (
                  <div className="muted">No future exceptions set.</div>
                ) : (
                  settings.upcomingCustomizations.map((item) => (
                    <div className="activity-row" key={`${item.date}:${item.slotKey}`}>
                      <div>
                        <strong>{item.date}</strong> · {item.label}
                      </div>
                      <div className="status">
                        {item.skipped
                          ? `Skipped${item.reason ? `: ${item.reason}` : ''}`
                          : `Time override: ${item.overrideTime}`}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {bootstrap.overdue.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Overdue</h2>
            <span>{bootstrap.overdue.length} open slots</span>
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
            : slot.status === 'skipped'
              ? 'Skipped for this date. No reminder will fire for this slot.'
              : 'Waiting for either person to log this dose.'}
        </p>
        {slot.status === 'completed' ? (
          <p className="delta-line">Difference from schedule: {formatDelta(slot.latenessMinutes)}</p>
        ) : null}
      </div>
      {slot.status === 'pending' ? (
        <button className="primary" type="button" disabled={busy} onClick={onComplete}>
          {busy ? 'Saving…' : 'Mark complete'}
        </button>
      ) : slot.status === 'skipped' ? (
        <div className="pill skipped">Skipped</div>
      ) : (
        <div className="pill done">Complete</div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function makeSettingsDrafts(settings: SettingsData): SettingsSlotDraft[] {
  return settings.slots.map((slot) => ({
    key: slot.key,
    label: slot.label,
    defaultTime: slot.defaultTime,
    time: slot.overrideTime ?? slot.defaultTime,
    skipped: slot.skipped,
    reason: slot.reason ?? '',
  }));
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

function formatDelta(value: number | null): string {
  if (value === null) return 'Not logged';
  if (value === 0) return 'On time';
  if (value > 0) return `${value} min late`;
  return `${Math.abs(value)} min early`;
}

function isStandaloneMode(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
