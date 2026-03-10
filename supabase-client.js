// ============================================================
// supabase-client.js
// Import this in dashboard.html via:
//   <script type="module" src="supabase-client.js"></script>
// Or inline in a <script type="module"> block.
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ── CONFIG — replace with your project values ───────────────
// Find these in: Supabase Dashboard → Project Settings → API
export const SUPABASE_URL     = 'https://YOUR_PROJECT_ID.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,        // stores session in localStorage
    autoRefreshToken: true,      // silently refreshes JWTs
    detectSessionInUrl: true,    // handles OAuth redirect
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

// ── Auth helpers ─────────────────────────────────────────────

/** Get the current authenticated user, or null */
export async function getUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

/** Fetch the profile row for the current user */
export async function getProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) console.error('getProfile:', error);
  return data;
}

/** Sign out and redirect to auth page */
export async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'auth.html';
}

// ── Tasks ─────────────────────────────────────────────────────

export async function fetchTasks(userId) {
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createTask(userId, { text, tag = 'Work', due = 'soon' }) {
  const { data, error } = await sb
    .from('tasks')
    .insert({ user_id: userId, text, tag, due })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, updates) {
  const { data, error } = await sb
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await sb.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// ── Notes ────────────────────────────────────────────────────

export async function fetchNotes(userId) {
  const { data, error } = await sb
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function upsertNote(userId, note) {
  const payload = note.id
    ? { ...note, updated_at: new Date().toISOString() }
    : { user_id: userId, ...note };
  const { data, error } = await sb
    .from('notes')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteNote(id) {
  const { error } = await sb.from('notes').delete().eq('id', id);
  if (error) throw error;
}

// ── Habits ────────────────────────────────────────────────────

export async function fetchHabitsWithLogs(userId) {
  // Fetch habits + this week's logs in parallel
  const weekStart = getWeekStart();
  const [habitsRes, logsRes] = await Promise.all([
    sb.from('habits').select('*').eq('user_id', userId).order('created_at'),
    sb.from('habit_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('logged_date', weekStart),
  ]);
  if (habitsRes.error) throw habitsRes.error;
  if (logsRes.error)   throw logsRes.error;
  // Attach cells array [Mon..Sun] to each habit
  return habitsRes.data.map(h => ({
    ...h,
    cells: buildWeekCells(logsRes.data.filter(l => l.habit_id === h.id)),
  }));
}

export async function createHabit(userId, name) {
  const { data, error } = await sb
    .from('habits').insert({ user_id: userId, name }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteHabit(id) {
  const { error } = await sb.from('habits').delete().eq('id', id);
  if (error) throw error;
}

export async function toggleHabitLog(userId, habitId, dayOffset) {
  const date = getWeekDayDate(dayOffset);
  // Try to delete first (toggle off); if no rows deleted, insert (toggle on)
  const { count } = await sb
    .from('habit_logs')
    .delete({ count: 'exact' })
    .eq('habit_id', habitId)
    .eq('logged_date', date);
  if (count === 0) {
    await sb.from('habit_logs').insert({ user_id: userId, habit_id: habitId, logged_date: date });
  }
}

// ── Goals ────────────────────────────────────────────────────

export async function fetchGoals(userId) {
  const { data, error } = await sb
    .from('goals')
    .select('*, goal_milestones(*)')
    .eq('user_id', userId)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function createGoal(userId, { title, tag, description }) {
  const { data, error } = await sb
    .from('goals').insert({ user_id: userId, title, tag, description }).select().single();
  if (error) throw error;
  return data;
}

export async function toggleMilestone(milestoneId, done) {
  const { error } = await sb
    .from('goal_milestones').update({ done }).eq('id', milestoneId);
  if (error) throw error;
}

// ── Calendar Events ───────────────────────────────────────────

export async function fetchEvents(userId, year, month) {
  const from = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const to   = `${year}-${String(month+1).padStart(2,'0')}-31`;
  const { data, error } = await sb
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .gte('event_date', from)
    .lte('event_date', to);
  if (error) throw error;
  return data;
}

export async function createEvent(userId, { name, event_date, event_time, duration, color }) {
  const { data, error } = await sb
    .from('calendar_events')
    .insert({ user_id: userId, name, event_date, event_time, duration, color })
    .select().single();
  if (error) throw error;
  return data;
}

// ── Focus Sessions ────────────────────────────────────────────

export async function logFocusSession(userId, durationMinutes) {
  const { error } = await sb
    .from('focus_sessions')
    .insert({ user_id: userId, duration_minutes: durationMinutes });
  if (error) console.error('logFocusSession:', error);
}

export async function fetchTodayFocusMinutes(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('focus_sessions')
    .select('duration_minutes')
    .eq('user_id', userId)
    .gte('started_at', today);
  if (error) return 0;
  return data.reduce((sum, s) => sum + s.duration_minutes, 0);
}

// ── Real-time subscriptions ───────────────────────────────────

/**
 * Subscribe to live task changes.
 * callback receives { eventType, new: row, old: row }
 */
export function subscribeToTasks(userId, callback) {
  return sb
    .channel(`tasks:${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'tasks',
      filter: `user_id=eq.${userId}`,
    }, callback)
    .subscribe();
}

/** Unsubscribe from a channel */
export function unsubscribe(channel) {
  sb.removeChannel(channel);
}

// ── Push Notification subscription ───────────────────────────

export async function savePushSubscription(userId, subscription) {
  const { endpoint, keys: { p256dh, auth: authKey } } = subscription.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: userId, endpoint, p256dh, auth_key: authKey,
  }, { onConflict: 'endpoint' });
  if (error) console.error('savePushSubscription:', error);
}

// ── Utility helpers ───────────────────────────────────────────

function getWeekStart() {
  const d = new Date();
  const day = d.getDay() || 7; // Mon=1 … Sun=7
  d.setDate(d.getDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

function getWeekDayDate(dayOffset) {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - (day - 1) + dayOffset);
  return d.toISOString().slice(0, 10);
}

function buildWeekCells(logs) {
  const cells = [0, 0, 0, 0, 0, 0, 0];
  const weekStart = new Date(getWeekStart());
  logs.forEach(log => {
    const logDate = new Date(log.logged_date);
    const diff = Math.round((logDate - weekStart) / 86400000);
    if (diff >= 0 && diff < 7) cells[diff] = 1;
  });
  return cells;
}
