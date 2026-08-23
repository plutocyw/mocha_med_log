import { type ReactNode, useEffect, useMemo, useState } from 'react';

type View = 'home' | 'stats' | 'settings' | 'health';

const STATS_DAY_PAGE_SIZE = 7;

const STATS_PRESETS: Array<{ id: string; label: string; days: number | null }> = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: 'all', label: 'All', days: null },
];

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
  totalDays: number;
  nextDayCursor: string | null;
  summary: {
    totalCompleted: number;
    totalSkipped: number;
    missedCount: number;
    dueTotal: number;
    averageLatenessMinutes: number | null;
    bestLatenessMinutes: number | null;
    worstLatenessMinutes: number | null;
  };
};

type SeizureEvent = {
  id: string;
  date: string;
  time: string | null;
  notes: string | null;
  loggedByName: string | null;
  createdAt: string;
};

type SeizuresData = {
  medicationStartDate: string;
  events: SeizureEvent[];
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
  const [statsPreset, setStatsPreset] = useState<string>('all');
  const [statsCustomOpen, setStatsCustomOpen] = useState(false);
  const [statsStale, setStatsStale] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [appError, setAppError] = useState('');
  const [password, setPassword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [seizures, setSeizures] = useState<SeizuresData | null>(null);
  const [newSeizureDate, setNewSeizureDate] = useState('');
  const [newSeizureTime, setNewSeizureTime] = useState('');
  const [newSeizureNotes, setNewSeizureNotes] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    if (!bootstrap) return;
    void refreshPushState(bootstrap.vapidPublicKey);
  }, [bootstrap]);

  useEffect(() => {
    if (!appError) return;
    const timer = setTimeout(() => setAppError(''), 8000);
    return () => clearTimeout(timer);
  }, [appError]);

  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(null), 2200);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  const nextPending = useMemo(() => {
    if (!bootstrap || !day || day.date !== bootstrap.todayDate) return null;
    return day.slots.find((slot) => slot.status === 'pending') ?? null;
  }, [bootstrap, day]);

  const overdueOpenCount = useMemo(
    () => bootstrap?.overdue.filter((slot) => slot.status === 'pending').length ?? 0,
    [bootstrap],
  );

  const adherence = stats
    ? { missedCount: stats.summary.missedCount, dueTotal: stats.summary.dueTotal }
    : null;

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

  async function fetchStats(
    startDate: string,
    endDate: string,
    dayCursor?: string | null,
  ): Promise<StatsData> {
    const params = new URLSearchParams({
      start: startDate,
      end: endDate,
      dayLimit: String(STATS_DAY_PAGE_SIZE),
    });
    if (dayCursor) params.set('dayCursor', dayCursor);
    const response = await fetch(`/api/stats?${params.toString()}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to load stats.');
    return (await response.json()) as StatsData;
  }

  async function fetchSeizures(): Promise<SeizuresData> {
    const response = await fetch('/api/seizures', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Failed to load seizure history.');
    return (await response.json()) as SeizuresData;
  }

  async function loadSeizures() {
    if (seizures !== null) return;
    setActionBusy('seizures-load');
    try {
      const data = await fetchSeizures();
      setSeizures(data);
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to load seizure history.');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleLogSeizure(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionBusy('seizure-log');
    try {
      const response = await fetch('/api/seizures', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: newSeizureDate, time: newSeizureTime || null, notes: newSeizureNotes || null }),
      });
      if (!response.ok) throw new Error('Failed to log seizure.');
      const data = (await response.json()) as SeizuresData;
      setSeizures(data);
      setNewSeizureTime('');
      setNewSeizureNotes('');
      setSavedNotice('seizure-log');
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to log seizure.');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDeleteSeizure(id: string) {
    setActionBusy(`seizure-delete-${id}`);
    try {
      const response = await fetch(`/api/seizures/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete seizure.');
      const data = (await response.json()) as SeizuresData;
      setSeizures(data);
      setConfirmDeleteId(null);
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to delete that entry.');
    } finally {
      setActionBusy(null);
    }
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
    setNewSeizureDate(data.todayDate);
    setStats(null);
    setStatsStale(true);
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
    setStatsStale(true);
    setStatsRange({ startDate: '', endDate: '' });
    setSeizures(null);
    setNewSeizureDate('');
    setNewSeizureTime('');
    setNewSeizureNotes('');
    setSavedNotice(null);
    setConfirmDeleteId(null);
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
    await changeSlotStatus(slotId, 'complete', 'Unable to mark that dose complete.');
  }

  async function handleUncomplete(slotId: string) {
    await changeSlotStatus(slotId, 'uncomplete', 'Unable to undo that completion.');
  }

  async function changeSlotStatus(slotId: string, action: 'complete' | 'uncomplete', errorMessage: string) {
    if (!bootstrap) return;
    setActionBusy(slotId);
    try {
      const response = await fetch(`/api/slots/${encodeURIComponent(slotId)}/${action}`, { method: 'POST' });
      if (!response.ok) throw new Error(`Failed to ${action} slot.`);
      const { slot } = (await response.json()) as { slot: Slot };
      const dayResponse = await fetchDay(selectedDate || bootstrap.todayDate);
      setDay(dayResponse.day);
      setBootstrap((prev) => prev ? { ...prev, overdue: prev.overdue.map((s) => (s.id === slot.id ? slot : s)) } : prev);
      setStatsStale(true);
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError(errorMessage);
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

  async function applyStatsRange(startDate: string, endDate: string, preset: string) {
    if (!startDate || !endDate) return;
    setStatsRange({ startDate, endDate });
    setStatsPreset(preset);
    setActionBusy('stats');
    try {
      const data = await fetchStats(startDate, endDate);
      setStats(data);
      setStatsStale(false);
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to load stats for that range.');
    } finally {
      setActionBusy(null);
    }
  }

  async function loadStats() {
    if (!bootstrap) return;
    if (stats && !statsStale) return;
    if (actionBusy === 'stats') return;
    const startDate = statsRange.startDate || bootstrap.startDate;
    const endDate = statsRange.endDate || bootstrap.todayDate;
    setActionBusy('stats');
    try {
      const data = await fetchStats(startDate, endDate);
      setStats(data);
      setStatsStale(false);
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to load stats.');
    } finally {
      setActionBusy(null);
    }
  }

  async function loadMoreStatsDays() {
    if (!stats || !stats.nextDayCursor) return;
    setActionBusy('stats-more');
    try {
      const data = await fetchStats(stats.startDate, stats.endDate, stats.nextDayCursor);
      setStats((prev) =>
        prev ? { ...data, perDay: [...data.perDay, ...prev.perDay] } : data,
      );
      setAppError('');
    } catch (error) {
      console.error(error);
      setAppError('Unable to load more days.');
    } finally {
      setActionBusy(null);
    }
  }

  function applyStatsPreset(preset: { id: string; days: number | null }) {
    if (!bootstrap) return;
    const end = bootstrap.todayDate;
    let start = preset.days === null ? bootstrap.startDate : isoMinusDays(end, preset.days - 1);
    if (start < bootstrap.startDate) start = bootstrap.startDate;
    void applyStatsRange(start, end, preset.id);
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
      setSavedNotice('settings-batch');
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
          <h1>Every dose, on time.</h1>
          <p>Medication tracking for Mocha, with push reminders that repeat until someone logs the dose. Unlock with the shared password, then pick whether this is Johnny or Pai.</p>
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
        <div className="eyebrow">Mocha Med Log</div>
        <div className="app-bar-title">
          {view === 'home'
            ? selectedDate === bootstrap.todayDate
              ? nextPending
                ? `${formatTime12(nextPending.time)} next up`
                : 'All done today'
              : formatWeekdayLabel(selectedDate)
            : view[0].toUpperCase() + view.slice(1)}
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
                <button
                  className="ghost icon-button"
                  type="button"
                  aria-label="Previous day"
                  disabled={actionBusy === 'home-date' || !selectedDate || selectedDate <= bootstrap.startDate}
                  onClick={() => void handleDayChange(isoMinusDays(selectedDate, 1))}
                >
                  ‹
                </button>
                <input aria-label="Select date" type="date" value={selectedDate} min={bootstrap.startDate} max={bootstrap.todayDate} onChange={(event) => void handleDayChange(event.target.value)} />
                <button
                  className="ghost icon-button"
                  type="button"
                  aria-label="Next day"
                  disabled={actionBusy === 'home-date' || !selectedDate || selectedDate >= bootstrap.todayDate}
                  onClick={() => void handleDayChange(isoMinusDays(selectedDate, -1))}
                >
                  ›
                </button>
              </div>
              <div className="day-stats-row">
                <span className="stat-pill stat-pill-done">{day.stats.completedCount} done</span>
                <span className="stat-pill stat-pill-pending">
                  {day.stats.pendingCount} {selectedDate === bootstrap.todayDate ? 'pending' : 'missed'}
                </span>
                <span className="stat-pill stat-pill-skipped">{day.stats.skippedCount} skipped</span>
              </div>
              <div className="slots">
                {day.slots.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} busy={actionBusy === slot.id} onComplete={() => void handleComplete(slot.id)} onUncomplete={() => void handleUncomplete(slot.id)} />
                ))}
              </div>
            </section>
          ) : null}

          {bootstrap.overdue.length > 0 ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Overdue</h2>
                <span>{overdueOpenCount} missed dose{overdueOpenCount === 1 ? '' : 's'}</span>
              </div>
              <div className="slots">
                {bootstrap.overdue.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} showDate busy={actionBusy === slot.id} onComplete={() => void handleComplete(slot.id)} onUncomplete={() => void handleUncomplete(slot.id)} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {view === 'stats' && stats ? (
        <>
          <section className="panel">
            <div className="panel-head compact-head">
              <h2>Stats</h2>
              <span>{formatDateRange(stats.startDate, stats.endDate)}</span>
            </div>
            <div className="chip-row">
              {STATS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={statsPreset === preset.id ? 'chip chip-active' : 'chip'}
                  disabled={actionBusy === 'stats'}
                  onClick={() => { setStatsCustomOpen(false); applyStatsPreset(preset); }}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className={statsPreset === 'custom' ? 'chip chip-active' : statsCustomOpen ? 'chip chip-open' : 'chip'}
                onClick={() => setStatsCustomOpen((open) => !open)}
              >
                Custom
              </button>
            </div>
            {statsCustomOpen ? (
              <div className="range-grid">
                <label className="settings-field">
                  Start
                  <input type="date" value={statsRange.startDate} min={bootstrap.startDate} max={bootstrap.todayDate} onChange={(event) => void applyStatsRange(event.target.value, statsRange.endDate, 'custom')} />
                </label>
                <label className="settings-field">
                  End
                  <input type="date" value={statsRange.endDate} min={statsRange.startDate || bootstrap.startDate} max={bootstrap.todayDate} onChange={(event) => void applyStatsRange(statsRange.startDate, event.target.value, 'custom')} />
                </label>
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Summary</h2></div>
            {adherence && adherence.dueTotal > 0 ? (
              <p className="adherence-line">
                <strong>{Math.round((stats.summary.totalCompleted / adherence.dueTotal) * 100)}%</strong> adherence · {stats.summary.totalCompleted} of {adherence.dueTotal} due doses
              </p>
            ) : null}
            <div className="day-stats-row">
              <span className="stat-pill stat-pill-done">{stats.summary.totalCompleted} completed</span>
              {adherence && adherence.missedCount > 0 ? <span className="stat-pill stat-pill-pending">{adherence.missedCount} missed</span> : null}
              <span className="stat-pill stat-pill-skipped">{stats.summary.totalSkipped} skipped</span>
            </div>
            {stats.summary.averageLatenessMinutes !== null ? (
              <p className="summary-line">
                Avg {formatDuration(stats.summary.averageLatenessMinutes)}
                {stats.summary.bestLatenessMinutes !== null ? <> · best {formatDuration(stats.summary.bestLatenessMinutes)}</> : null}
                {stats.summary.worstLatenessMinutes !== null ? <> · worst {formatDuration(stats.summary.worstLatenessMinutes)}</> : null}
              </p>
            ) : null}
            {stats.userBreakdown.length > 0 ? (
              <p className="summary-line">Logged by {stats.userBreakdown.map((item) => `${item.name}: ${item.completedCount}`).join(' · ')}</p>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>By Day</h2>
              <span>
                {stats.perDay.length} of {stats.totalDays} days · latest first
              </span>
            </div>
            <div className="activity">
              {buildByDayRows(stats.perDay).map((row) => {
                if (row.kind === 'empty') {
                  return (
                    <div className="activity-row activity-row-empty" key={`empty-${row.startDate}`}>
                      <div><strong>{formatDateRange(row.startDate, row.endDate)}</strong></div>
                      <span className="muted">No doses</span>
                    </div>
                  );
                }
                const point = row.point;
                const isToday = point.date === bootstrap.todayDate;
                return (
                  <div className="activity-row" key={point.date}>
                    <div><strong>{formatWeekdayLabel(point.date)}</strong></div>
                    <div className="perday-pills">
                      {point.completedCount > 0 && <span className="stat-pill stat-pill-done">{point.completedCount} done</span>}
                      {point.pendingCount > 0 && (
                        <span className="stat-pill stat-pill-pending">{point.pendingCount} {isToday ? 'pending' : 'missed'}</span>
                      )}
                      {point.skippedCount > 0 && <span className="stat-pill stat-pill-skipped">{point.skippedCount} skipped</span>}
                      {point.averageLatenessMinutes !== null && <span className="stat-pill stat-pill-lateness">avg {formatDuration(point.averageLatenessMinutes)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {stats.nextDayCursor ? (
              <button
                type="button"
                className="load-more-button"
                disabled={actionBusy === 'stats-more'}
                onClick={() => void loadMoreStatsDays()}
              >
                {actionBusy === 'stats-more' ? 'Loading…' : `Load ${STATS_DAY_PAGE_SIZE} more days`}
              </button>
            ) : null}
          </section>
        </>
      ) : null}

      {view === 'stats' && !stats ? (
        <section className="panel">
          <div className="panel-head"><h2>Stats</h2></div>
          <p className="muted">Loading…</p>
        </section>
      ) : null}

      {view === 'settings' && settings ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Notifications</h2>
              <span>{pushState.subscribed ? 'On' : 'Off'}</span>
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
              <h2>Schedule</h2>
              <span>{formatDateRange(settingsRange.startDate, settingsRange.endDate)}</span>
            </div>
            <p className="small settings-step-note">Set dose times for a range of dates, or skip a slot (boarding, vet stay). Changing the start date loads that day's current schedule.</p>
            <div className="range-grid">
              <label className="settings-field">
                From
                <input type="date" value={settingsRange.startDate} min={settings.minDate} onChange={(event) => void handleSettingsDateChange(event.target.value)} />
              </label>
              <label className="settings-field">
                To
                <input type="date" value={settingsRange.endDate} min={settingsRange.startDate || settings.minDate} onChange={(event) => setSettingsRange((current) => ({ ...current, endDate: event.target.value }))} />
              </label>
            </div>
            <div className="settings-slots">
              {settingsDrafts.map((slot) => (
                <div className="settings-slot-card" key={slot.key}>
                  <div className="slot-edit-row">
                    <label className="settings-field">
                      <span className="slot-edit-label"><strong>{slot.label}</strong> <span className="muted small">· default {formatTime12(slot.defaultTime)}</span></span>
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
                      Skip
                    </label>
                  </div>
                  {slot.skipped ? (
                    <label className="settings-field">
                      Reason
                      <input
                        type="text"
                        value={slot.reason}
                        onChange={(event) => setSettingsDrafts((current) => current.map((item) => item.key === slot.key ? { ...item, reason: event.target.value } : item))}
                        placeholder="Boarding, vet stay, etc."
                      />
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
            <button className="primary" type="button" onClick={() => void handleBatchSave()} disabled={actionBusy === 'settings-batch'}>
              {actionBusy === 'settings-batch' ? 'Saving…' : savedNotice === 'settings-batch' ? 'Saved ✓' : 'Save schedule'}
            </button>
          </section>

          <section className="panel">
            <div className="panel-head compact-head">
              <h2>Upcoming changes</h2>
              <span>{settings.upcomingCustomizations.length}</span>
            </div>
            <div className="activity">
              {settings.upcomingCustomizations.length === 0 ? (
                <div className="muted">No upcoming changes — defaults apply every day.</div>
              ) : (
                settings.upcomingCustomizations.map((item) => (
                  <button className="activity-row activity-row-button" type="button" key={`${item.date}:${item.slotKey}`} onClick={() => void handleSettingsDateChange(item.date)}>
                    <div><strong>{formatDayLabel(item.date)}</strong> · {item.label}</div>
                    <div className="status">
                      {item.skipped ? `Skipped${item.reason ? `: ${item.reason}` : ''}` : item.overrideTime ? `→ ${formatTime12(item.overrideTime)}` : 'Changed'}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Account</h2>
              <span>{bootstrap.me.name}</span>
            </div>
            <button className="ghost" type="button" onClick={() => void handleLogout()} disabled={actionBusy === 'logout'}>
              {actionBusy === 'logout' ? 'Signing out…' : 'Sign out'}
            </button>
          </section>
        </>
      ) : null}

      {view === 'health' ? (
        seizures ? (
          <>
            <section className="panel">
              <div className="panel-head">
                <h2>Mocha's Health</h2>
              </div>
              <p className="health-milestone">Medication started {formatFullDate(seizures.medicationStartDate)}</p>
              <div className="day-stats-row" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                {seizures.events.length > 0 ? (
                  <span className="stat-pill stat-pill-done">{daysBetween(seizures.events[0].date, bootstrap.todayDate)}d since last seizure</span>
                ) : null}
                <span className="stat-pill stat-pill-lateness">{daysBetween(seizures.medicationStartDate, bootstrap.todayDate)}d on medication</span>
                <span className="stat-pill stat-pill-skipped">{seizures.events.length} total seizures</span>
              </div>
            </section>

            <form className="panel" onSubmit={(e) => void handleLogSeizure(e)}>
              <div className="panel-head compact-head"><h2>Log a seizure</h2></div>
              <div className="settings-slots" style={{ marginTop: '0.9rem' }}>
                <div className="range-grid">
                  <label className="settings-field">
                    Date
                    <input type="date" value={newSeizureDate} max={bootstrap.todayDate} onChange={(e) => setNewSeizureDate(e.target.value)} required />
                  </label>
                  <label className="settings-field">
                    Time <span className="muted">(optional)</span>
                    <input type="time" value={newSeizureTime} onChange={(e) => setNewSeizureTime(e.target.value)} />
                  </label>
                </div>
                <label className="settings-field">
                  Notes <span className="muted">(optional)</span>
                  <textarea rows={2} value={newSeizureNotes} placeholder="Duration, behavior, etc." onChange={(e) => setNewSeizureNotes(e.target.value)} />
                </label>
              </div>
              <button className="primary" style={{ marginTop: '0.75rem' }} type="submit" disabled={actionBusy === 'seizure-log'}>
                {actionBusy === 'seizure-log' ? 'Saving…' : savedNotice === 'seizure-log' ? 'Logged ✓' : 'Log seizure'}
              </button>
            </form>

            <section className="panel">
              <div className="panel-head">
                <h2>History</h2>
                <span>{seizures.events.length} episodes</span>
              </div>
              <div className="activity">
                {seizures.events.length === 0 ? (
                  <div className="muted">No episodes logged yet.</div>
                ) : (
                  seizures.events.map((evt, index) => {
                    const previous = seizures.events[index + 1] ?? null;
                    const gapDays = previous ? daysBetween(previous.date, evt.date) : null;
                    const meta = [
                      gapDays === null ? null : gapDays === 0 ? 'same day as previous' : `${gapDays} days after previous`,
                      evt.loggedByName ? `logged by ${evt.loggedByName}` : null,
                    ].filter(Boolean).join(' · ');
                    return (
                      <div className="activity-row" key={evt.id}>
                        <div>
                          <strong>{formatFullDate(evt.date)}</strong>
                          {evt.time ? <span className="muted"> · {formatTime12(evt.time)}</span> : null}
                          {evt.notes ? <div className="event-sub">{evt.notes}</div> : null}
                          {meta ? <div className="event-sub">{meta}</div> : null}
                        </div>
                        <button
                          className={confirmDeleteId === evt.id ? 'ghost small-button event-delete danger-button' : 'ghost small-button event-delete'}
                          type="button"
                          disabled={actionBusy === `seizure-delete-${evt.id}`}
                          onClick={() => {
                            if (confirmDeleteId === evt.id) {
                              void handleDeleteSeizure(evt.id);
                            } else {
                              setConfirmDeleteId(evt.id);
                            }
                          }}
                        >
                          {actionBusy === `seizure-delete-${evt.id}` ? 'Deleting…' : confirmDeleteId === evt.id ? 'Confirm delete' : 'Delete'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </>
        ) : (
          <div className="panel muted">Loading…</div>
        )
      ) : null}

      {appError ? (
        <div className="toast" role="alert">
          <span>{appError}</span>
          <button className="toast-close" type="button" aria-label="Dismiss error" onClick={() => setAppError('')}>✕</button>
        </div>
      ) : null}

      <nav className="bottom-nav">
        <button className={view === 'home' ? 'bottom-nav-button active' : 'bottom-nav-button'} type="button" onClick={() => setView('home')}>
          <HomeIcon />
          <span>Home</span>
        </button>
        <button className={view === 'stats' ? 'bottom-nav-button active' : 'bottom-nav-button'} type="button" onClick={() => { setView('stats'); void loadStats(); }}>
          <StatsIcon />
          <span>Stats</span>
        </button>
        <button className={view === 'health' ? 'bottom-nav-button active' : 'bottom-nav-button'} type="button" onClick={() => { setView('health'); void loadSeizures(); }}>
          <HealthIcon />
          <span>Health</span>
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
  showDate = false,
  onComplete,
  onUncomplete,
}: {
  slot: Slot;
  busy: boolean;
  showDate?: boolean;
  onComplete: () => void;
  onUncomplete?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = `slot-details-${slot.id}`;
  const slotName = `${showDate ? `${formatDayLabel(slot.date)} ` : ''}${formatTime12(slot.time)}`;

  function toggleDetails() {
    setDetailsOpen((current) => !current);
  }

  return (
    <article className={`slot checklist-slot ${slot.status} ${detailsOpen ? 'expanded' : ''}`}>
      <div className="slot-check-row">
        <button className="slot-toggle" type="button" aria-label={`${detailsOpen ? 'Hide' : 'Show'} details for ${slotName}`} aria-expanded={detailsOpen} aria-controls={detailsId} onClick={toggleDetails}>
          <span className="slot-disclosure" aria-hidden="true" />
          <span className="slot-toggle-text">
            {showDate ? <span className="slot-date">{formatDayLabel(slot.date)}</span> : null}
            <span className="slot-time">{formatTime12(slot.time)}</span>
          </span>
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
          {slot.status === 'completed' && onUncomplete ? (
            <button className="ghost small-button slot-undo-button" type="button" disabled={busy} onClick={onUncomplete}>
              {busy ? 'Undoing…' : 'Undo completion'}
            </button>
          ) : null}
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

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDayLabel(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1]) return iso;
  return `${MONTH_ABBR[parts[1] - 1]} ${parts[2]}`;
}

function formatWeekdayLabel(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1]) return iso;
  const weekday = WEEKDAY_ABBR[new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()];
  return `${weekday} ${formatDayLabel(iso)}`;
}

function formatTime12(hhmm: string): string {
  const [hour, minute] = hhmm.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return hhmm;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

type ByDayRow =
  | { kind: 'day'; point: StatsData['perDay'][number] }
  | { kind: 'empty'; startDate: string; endDate: string };

function buildByDayRows(perDay: StatsData['perDay']): ByDayRow[] {
  const rows: ByDayRow[] = [];
  for (let i = perDay.length - 1; i >= 0; i -= 1) {
    const point = perDay[i];
    const isEmpty = point.completedCount === 0 && point.pendingCount === 0 && point.skippedCount === 0;
    if (isEmpty) {
      const last = rows[rows.length - 1];
      if (last && last.kind === 'empty') {
        last.startDate = point.date;
      } else {
        rows.push({ kind: 'empty', startDate: point.date, endDate: point.date });
      }
    } else {
      rows.push({ kind: 'day', point });
    }
  }
  return rows;
}

function formatDateRange(start: string, end: string): string {
  if (!start || !end) return '';
  if (start === end) return formatDayLabel(start);
  return `${formatDayLabel(start)} – ${formatDayLabel(end)}`;
}

function isoMinusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function formatFullDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1]) return iso;
  return `${MONTH_ABBR[parts[1] - 1]} ${parts[2]}, ${parts[0]}`;
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

function formatDuration(minutes: number): string {
  if (minutes === 0) return 'on time';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const hm = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  return `${hm} ${minutes > 0 ? 'late' : 'early'}`;
}

function formatDelta(value: number | null): string {
  if (value === null) return 'Not logged';
  if (value === 0) return 'On time';
  return formatDuration(value);
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

function HealthIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 16.5l-1.4-1.28C4.4 11.4 2 9.3 2 6.5 2 4.42 3.58 3 5.5 3c1.24 0 2.44.57 3.5 1.76C10.06 3.57 11.26 3 12.5 3 14.42 3 16 4.42 16 6.5c0 2.8-2.4 4.9-6.6 8.72L10 16.5z"/>
    </svg>
  );
}

function isStandaloneMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
