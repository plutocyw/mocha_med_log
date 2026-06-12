import { type ReactNode, useEffect, useMemo, useState } from 'react';

type View = 'home' | 'stats' | 'settings';

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

type StatsData = {
  timezone: string;
  startDate: string;
  endDate: string;
  perDay: Array<{
    date: string;
    completedCount: number;
    pendingCount: number;
    skippedCount: number;
    averageLatenessMinutes: number | null;
  }>;
  userBreakdown: Array<{
    name: string;
    completedCount: number;
  }>;
  summary: {
    totalCompleted: number;
    totalSkipped: number;
    averageLatenessMinutes: number | null;
    bestLatenessMinutes: number | null;
    worstLatenessMinutes: number | null;
  };
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
  day?: DayData;
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
  const [view, setView] = useState<View>('home');
  const [loading, setLoading] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [authState, setAuthState] = useState<AuthState>({ stage: 'password' });
  const [pushState, setPushState] = useState<PushState>(initialPushState);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [settingsDrafts, setSettingsDrafts] = useState<SettingsSlotDraft[]>([]);
  const [settingsRange, setSettingsRange] = useState({ startDate: '', endDate: '' });
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsRange, setStatsRange] = useState({ startDate: '', endDate: '' });
  const [loginError, setLoginError] = useState('');
  const [appError, setAppError] = useState('');
  const [password, setPassword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    if (!bootstrap) return;
    void refreshPushState(bootstrap.vapidPublicKey);
  }, [bootstrap]);

  const nextPending = useMemo(() => {
    if (!bootstrap || !day) return null;
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
        await loadBootstrapAndViews();
      }
    } catch (error) {
      console.error(error);
      setAppError('Unable to load the app right now.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchAuthState(): Promise<AuthState> {
    const response = await fetch('/api/auth/state', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Failed to load auth state.');
    return (await response.json()) as AuthState;
  }

  async function fetchDay(date: string): Promise<DayResponse> {
    const response = await fetch(`/api/day?date=${encodeURIComponent(date)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to load day.');
    return (await response.json()) as DayResponse;
  }

  async function fetchSettings(date: string): Promise<SettingsData> {
    const response = await fetch(`/api/settings?date=${encodeURIComponent(date)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to load settings.');
    return (await response.json()) as SettingsData;
  }

  async function fetchStats(startDate: string, endDate: string): Promise<StatsData> {
    const response = await fetch(
      `/api/stats?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) throw new Error('Failed to load stats.');
    return (await response.json()) as StatsData;
  }

  async function loadBootstrapAndViews() {
    const response = await fetch('/api/bootstrap', { headers: { accept: 'application/json' } });
    if (response.status === 401) {
      const state = await fetchAuthState();
      resetAuthedState(state);
      return;
    }
    if (!response.ok) throw new Error('Failed to load dashboard.');

    const data = (await response.json()) as BootstrapData;
    setBootstrap(data);
    setAuthState({ stage: 'ready', me: data.me });
    setDay(data.day);
    setSelectedDate(data.todayDate);
    setSettings(data.settings);
    setSettingsDrafts(makeSettingsDrafts(data.settings));
    setSettingsRange({
      startDate: data.settings.date,
      endDate: data.settings.date,
    });
    setStatsRange({
      startDate: data.startDate,
      endDate: data.todayDate,
    });
    const statsData = await fetchStats(data.startDate, data.todayDate);
    setStats(statsData);
    setAppError('');
  }

  function resetAuthedState(state: AuthState) {
    setAuthState(state);
    setBootstrap(null);
    setDay(null);
    setSettings(null);
    setSettingsDrafts([]);
    setSettingsRange({ startDate: '', endDate: '' });
    setStats(null);
    setStatsRange({ startDate: '', endDate: '' });
    setPushState(initialPushState);
    setSelectedDate('');
    setView('home');
    if (state.stage === 'identity') {
      setSelectedUserId(state.users[0]?.id ?? '');
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
      if (state.stage === 'identity') setSelectedUserId(state.users[0]?.id ?? '');
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
      await loadBootstrapAndViews();
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
      resetAuthedState({ stage: 'password' });
      setPassword('');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleComplete(slotId: string) {
    if (!bootstrap) return;
    setActionBusy(slotId);
    try {
      const response = await fetch(`/api/slots/${encodeURIComponent(slotId)}/complete`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to complete slot.');
      const dayResponse = await fetchDay(selectedDate || bootstrap.todayDate);
      setDay(dayResponse.day);
      setBootstrap((prev) => prev ? { ...prev, overdue: prev.overdue.filter((s) => s.id !== slotId) } : prev);
      const statsData = await fetchStats(statsRange.startDate, statsRange.endDate);
      setStats(statsData);
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to mark that dose complete.');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDayChange(nextDate: string) {
    if (!nextDate) return;
    setActionBusy('home-date');
    try {
      const dayResponse = await fetchDay(nextDate);
      setDay(dayResponse.day);
      setSelectedDate(dayResponse.selectedDate);
    } catch (error) {
      console.error(error);
      setAppError('Unable to load that day.');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleStatsRefresh() {
    if (!statsRange.startDate || !statsRange.endDate) return;
    setActionBusy('stats');
    try {
      const data = await fetchStats(statsRange.startDate, statsRange.endDate);
      setStats(data);
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to load stats for that range.');
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
      setSettingsDrafts(makeSettingsDrafts(nextSettings));
      setSettingsRange({ startDate: nextSettings.date, endDate: nextSettings.date });
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to load settings for that date.');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleBatchSave() {
    if (!settingsRange.startDate || !settingsRange.endDate) return;
    setActionBusy('settings-batch');
    try {
      const response = await fetch('/api/settings/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startDate: settingsRange.startDate,
          endDate: settingsRange.endDate,
          slots: settingsDrafts.map((slot) => ({
            slotKey: slot.key,
            time: slot.time,
            skipped: slot.skipped,
            reason: slot.reason || null,
          })),
        }),
      });
      if (!response.ok) throw new Error('Failed to save batch settings.');
      const data = (await response.json()) as SettingsResponse;
      if (data.settings) {
        setSettings(data.settings);
        setSettingsDrafts(makeSettingsDrafts(data.settings));
      } else {
        const refreshed = await fetchSettings(settingsRange.startDate);
        setSettings(refreshed);
        setSettingsDrafts(makeSettingsDrafts(refreshed));
      }
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to save batch settings.');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleTestPush() {
    setActionBusy('test-push');
    setAppError('');
    try {
      const response = await fetch('/api/push/test', { method: 'POST' });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setAppError(data.error ?? 'Test push failed.');
      }
    } catch {
      setAppError('Test push failed.');
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
      const existing = await registration.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToArrayBuffer(bootstrap.vapidPublicKey),
      });
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
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const existingKey = subscription.options.applicationServerKey;
      const expectedKey = base64UrlToArrayBuffer(vapidPublicKey);
      if (!existingKey || !uint8ArraysEqual(new Uint8Array(existingKey), new Uint8Array(expectedKey))) {
        await subscription.unsubscribe().catch(() => undefined);
        subscription = null;
      }
    }
    if (permission === 'granted' && !subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToArrayBuffer(vapidPublicKey),
      }).catch(() => null);
    }
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

  if (loading && !bootstrap) {
    return <Shell><div className="panel muted">Loading…</div></Shell>;
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
              <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} required>
                {authState.stage === 'identity' ? authState.users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                )) : null}
              </select>
            </label>
            <div className="inline-actions">
              <button className="ghost" type="button" onClick={() => setAuthState({ stage: 'password' })}>Back</button>
              <button className="primary" type="submit" disabled={loginBusy}>{loginBusy ? 'Opening…' : 'Continue'}</button>
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
      <section className="panel app-bar">
        <div className="app-bar-top">
          <div>
            <div className="eyebrow">Mocha Med Log</div>
            <div className="app-bar-title">
              {view === 'home' && nextPending ? `${nextPending.label} next up` : view[0].toUpperCase() + view.slice(1)}
            </div>
          </div>
          <button className="ghost small-button" type="button" onClick={handleLogout} disabled={actionBusy === 'logout'}>Sign out</button>
        </div>
        <div className="app-bar-subtitle">
          Signed in as <strong>{bootstrap.me.name}</strong>
        </div>
      </section>

      {view === 'home' ? (
        <>
          {day ? (
            <section className="panel compact-day-panel">
              <div className="home-date-row">
                <input aria-label="Select date" type="date" value={selectedDate} min={bootstrap.startDate} max={bootstrap.todayDate} onChange={(event) => void handleDayChange(event.target.value)} />
              </div>
              <div className="day-stats-row">
                <span className="stat-pill stat-pill-done">{day.stats.completedCount} done</span>
                <span className="stat-pill stat-pill-pending">{day.stats.pendingCount} pending</span>
                <span className="stat-pill stat-pill-skipped">{day.stats.skippedCount} skipped</span>
              </div>
              <div className="slots">
                {day.slots.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} busy={actionBusy === slot.id} onComplete={() => void handleComplete(slot.id)} />
                ))}
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
                  <SlotCard key={slot.id} slot={slot} busy={actionBusy === slot.id} onComplete={() => void handleComplete(slot.id)} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {view === 'stats' && stats ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Stats Range</h2>
              <button className="primary small-button" type="button" onClick={() => void handleStatsRefresh()} disabled={actionBusy === 'stats'}>{actionBusy === 'stats' ? 'Loading…' : 'Refresh'}</button>
            </div>
            <div className="range-grid">
              <label className="settings-field">
                Start
                <input type="date" value={statsRange.startDate} min={bootstrap.startDate} max={bootstrap.todayDate} onChange={(event) => setStatsRange((current) => ({ ...current, startDate: event.target.value }))} />
              </label>
              <label className="settings-field">
                End
                <input type="date" value={statsRange.endDate} min={bootstrap.startDate} max={bootstrap.todayDate} onChange={(event) => setStatsRange((current) => ({ ...current, endDate: event.target.value }))} />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Summary</h2>
              <span>{stats.startDate} to {stats.endDate}</span>
            </div>
            <div className="day-stats-row">
              <span className="stat-pill stat-pill-done">{stats.summary.totalCompleted} completed</span>
              <span className="stat-pill stat-pill-skipped">{stats.summary.totalSkipped} skipped</span>
              {stats.summary.averageLatenessMinutes !== null && (
                <span className="stat-pill stat-pill-lateness">avg {formatDeltaShort(stats.summary.averageLatenessMinutes)}</span>
              )}
              {stats.summary.bestLatenessMinutes !== null && (
                <span className="stat-pill stat-pill-lateness">best {formatDeltaShort(stats.summary.bestLatenessMinutes)}</span>
              )}
              {stats.summary.worstLatenessMinutes !== null && (
                <span className="stat-pill stat-pill-lateness">worst {formatDeltaShort(stats.summary.worstLatenessMinutes)}</span>
              )}
            </div>
          </section>

          <section className="settings-grid">
            <article className="panel">
              <div className="panel-head">
                <h2>Daily Accuracy</h2>
                <span>Average lateness by day</span>
              </div>
              <BarChart
                items={stats.perDay.map((point) => ({
                  label: point.date.slice(5),
                  value: point.averageLatenessMinutes ?? 0,
                }))}
                emptyLabel="No completed doses in this range."
                valueFormatter={(value) => `${value}m`}
              />
            </article>

            <article className="panel">
              <div className="panel-head">
                <h2>User Breakdown</h2>
                <span>Who logged medication</span>
              </div>
              <BarChart
                items={stats.userBreakdown.map((item) => ({
                  label: item.name,
                  value: item.completedCount,
                }))}
                emptyLabel="No completed doses in this range."
                valueFormatter={(value) => `${value}`}
              />
            </article>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Per-Day Detail</h2>
              <span>{stats.perDay.length} days</span>
            </div>
            <div className="activity">
              {stats.perDay.map((point) => (
                <div className="activity-row" key={point.date}>
                  <div><strong>{point.date}</strong></div>
                  <div className="perday-pills">
                    <span className="stat-pill stat-pill-done">{point.completedCount} done</span>
                    {point.skippedCount > 0 && <span className="stat-pill stat-pill-skipped">{point.skippedCount} skipped</span>}
                    {point.averageLatenessMinutes !== null && <span className="stat-pill stat-pill-lateness">avg {formatDeltaShort(point.averageLatenessMinutes)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {view === 'settings' && settings ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Notifications</h2>
              <span>{pushState.subscribed ? 'Active' : 'Setup'}</span>
            </div>
            <p className="small compact-copy">{pushState.message}</p>
            <div className="inline-actions">
              <button className="primary compact-button" type="button" onClick={() => void enableNotifications()} disabled={actionBusy === 'notifications' || !pushState.supported}>
                {actionBusy === 'notifications' ? 'Saving…' : pushState.subscribed ? 'Refresh subscription' : 'Enable notifications'}
              </button>
              <button className="ghost compact-button" type="button" onClick={() => void handleTestPush()} disabled={actionBusy === 'test-push' || !pushState.subscribed}>
                {actionBusy === 'test-push' ? 'Sending…' : 'Send test'}
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head compact-head">
              <h2>Date Overrides</h2>
            </div>
            <div className="settings-step">
              <div className="settings-step-label">1 · Preview a date</div>
              <label className="settings-field">
                Date
                <input type="date" value={settings.date} min={settings.minDate} onChange={(event) => void handleSettingsDateChange(event.target.value)} />
              </label>
              <p className="small settings-step-note">Changing this resets any edits you've made to the slot cards below.</p>
            </div>
            <div className="settings-step">
              <div className="settings-step-label">2 · Apply to a date range</div>
              <div className="range-grid">
                <label className="settings-field">
                  Start
                  <input type="date" value={settingsRange.startDate} min={settings.minDate} onChange={(event) => setSettingsRange((current) => ({ ...current, startDate: event.target.value }))} />
                </label>
                <label className="settings-field">
                  End
                  <input type="date" value={settingsRange.endDate} min={settings.minDate} onChange={(event) => setSettingsRange((current) => ({ ...current, endDate: event.target.value }))} />
                </label>
              </div>
              <button className="primary" type="button" onClick={() => void handleBatchSave()} disabled={actionBusy === 'settings-batch'}>
                {actionBusy === 'settings-batch' ? 'Saving…' : 'Apply to Range'}
              </button>
            </div>
          </section>

          <section className="settings-grid">
            <article className="panel settings-column">
              <div className="panel-head compact-head">
                <h2>Range Template</h2>
                <span>{settingsRange.startDate} to {settingsRange.endDate}</span>
              </div>
              <div className="settings-slots">
                {settingsDrafts.map((slot) => (
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
                        disabled={slot.skipped}
                        onChange={(event) => setSettingsDrafts((current) => current.map((item) => item.key === slot.key ? { ...item, time: event.target.value } : item))}
                      />
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={slot.skipped}
                        onChange={(event) => setSettingsDrafts((current) => current.map((item) => item.key === slot.key ? { ...item, skipped: event.target.checked } : item))}
                      />
                      Skip this slot for the range
                    </label>
                    <label className="settings-field">
                      Reason
                      <input
                        type="text"
                        value={slot.reason}
                        onChange={(event) => setSettingsDrafts((current) => current.map((item) => item.key === slot.key ? { ...item, reason: event.target.value } : item))}
                        placeholder="Boarding, vet stay, etc."
                      />
                    </label>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel settings-column">
              <div className="panel-head compact-head">
                <h2>Upcoming Overrides</h2>
                <span>{settings.upcomingCustomizations.length} entries</span>
              </div>
              <div className="activity">
                {settings.upcomingCustomizations.length === 0 ? (
                  <div className="muted">No future exceptions set.</div>
                ) : (
                  settings.upcomingCustomizations.map((item) => (
                    <div className="activity-row" key={`${item.date}:${item.slotKey}`}>
                      <div><strong>{item.date}</strong> · {item.label}</div>
                      <div className="status">
                        {item.skipped ? `Skipped${item.reason ? `: ${item.reason}` : ''}` : `Time override: ${item.overrideTime}`}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>
        </>
      ) : null}

      {appError ? <div className="toast">{appError}</div> : null}

      <nav className="bottom-nav">
        <button className={view === 'home' ? 'bottom-nav-button active' : 'bottom-nav-button'} type="button" onClick={() => setView('home')}>
          <HomeIcon />
          <span>Home</span>
        </button>
        <button className={view === 'stats' ? 'bottom-nav-button active' : 'bottom-nav-button'} type="button" onClick={() => setView('stats')}>
          <StatsIcon />
          <span>Stats</span>
        </button>
        <button className={view === 'settings' ? 'bottom-nav-button active' : 'bottom-nav-button'} type="button" onClick={() => setView('settings')}>
          <SettingsIcon />
          <span>Settings</span>
        </button>
      </nav>
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = `slot-details-${slot.id}`;

  function toggleDetails() {
    setDetailsOpen((current) => !current);
  }

  return (
    <article className={`slot checklist-slot ${slot.status} ${detailsOpen ? 'expanded' : ''}`}>
      <div className="slot-check-row">
        <button className="slot-toggle" type="button" aria-label={`${detailsOpen ? 'Hide' : 'Show'} details for ${slot.time}`} aria-expanded={detailsOpen} aria-controls={detailsId} onClick={toggleDetails}>
          <span className="slot-disclosure" aria-hidden="true" />
          <span className="slot-time">{slot.time}</span>
        </button>
        <div className="slot-check-action">
          {slot.status === 'pending' ? (
            <button className="primary slot-complete-button" type="button" disabled={busy} onClick={onComplete}>{busy ? 'Saving…' : 'Mark complete'}</button>
          ) : slot.status === 'skipped' ? (
            <button className="pill skipped slot-status-button" type="button" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={toggleDetails}>Skipped</button>
          ) : (
            <button className="pill done slot-status-button" type="button" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={toggleDetails}>Complete</button>
          )}
        </div>
      </div>
      {detailsOpen ? (
        <div className="slot-details" id={detailsId}>
          <p>{formatSlotDetail(slot)}</p>
        </div>
      ) : null}
    </article>
  );
}

function formatSlotDetail(slot: Slot): string {
  if (slot.status === 'completed') {
    return `${slot.completedByName ?? 'Someone'} · ${formatTimestamp(slot.completedAt)} · ${formatDelta(slot.latenessMinutes)}`;
  }
  if (slot.status === 'skipped') return 'Skipped for this date.';
  return 'Not logged yet.';
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BarChart({
  items,
  emptyLabel,
  valueFormatter,
}: {
  items: Array<{ label: string; value: number }>;
  emptyLabel: string;
  valueFormatter: (value: number) => string;
}) {
  const max = Math.max(...items.map((item) => item.value), 0);
  if (!items.length || max === 0) {
    return <div className="muted">{emptyLabel}</div>;
  }

  return (
    <div className="bar-chart">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-meta">
            <span>{item.label}</span>
            <strong>{valueFormatter(item.value)}</strong>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
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

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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

function formatDeltaShort(value: number): string {
  if (value === 0) return 'on time';
  if (value > 0) return `+${value}m`;
  return `${value}m`;
}

function formatDelta(value: number | null): string {
  if (value === null) return 'Not logged';
  if (value === 0) return 'On time';
  if (value > 0) return `${value} min late`;
  return `${Math.abs(value)} min early`;
}

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 2.5L2 9V18h5.5v-5h5v5H18V9L10 2.5z"/>
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="2" y="11" width="4" height="7" rx="1"/>
      <rect x="8" y="7" width="4" height="11" rx="1"/>
      <rect x="14" y="3" width="4" height="15" rx="1"/>
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="10" cy="10" r="2.8"/>
      <path d="M17.2 11.2l1.4-1.1-1.4-2.4-1.8.7a6.6 6.6 0 00-1.8-1l-.3-1.9H10l-.3 1.9a6.6 6.6 0 00-1.8 1l-1.8-.7-1.4 2.4 1.4 1.1a6.5 6.5 0 000 2.4l-1.4 1.1 1.4 2.4 1.8-.7a6.6 6.6 0 001.8 1l.3 1.9h3.3l.3-1.9a6.6 6.6 0 001.8-1l1.8.7 1.4-2.4-1.4-1.1a6.5 6.5 0 000-2.4z"/>
    </svg>
  );
}

function isStandaloneMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
