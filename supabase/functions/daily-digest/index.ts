// ============================================================
// supabase/functions/daily-digest/index.ts
//
// Sends a personalised daily email digest to each user.
// Triggered by pg_cron — see scheduling SQL below.
//
// Deploy:  supabase functions deploy daily-digest
// Secrets: supabase secrets set RESEND_API_KEY=re_...
//          supabase secrets set FROM_EMAIL=hello@yourdomain.com
// ============================================================

import { createClient }  from 'npm:@supabase/supabase-js@2';
import { Resend }        from 'npm:resend@3';

const sb     = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
const FROM   = Deno.env.get('FROM_EMAIL') ?? 'focus@yourdomain.com';

// ── Entry point ───────────────────────────────────────────────
Deno.serve(async (req) => {
  // Allow invocation from pg_cron or manual HTTP call (with service key)
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const results: string[] = [];

  // ── Fetch all users who have notifications enabled ─────────
  const { data: profiles, error: profilesError } = await sb
    .from('profiles')
    .select('id, full_name, notify_email')
    .eq('notify_email', true);

  if (profilesError) {
    console.error('profiles fetch error:', profilesError);
    return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
  }

  // ── Get auth users for emails ──────────────────────────────
  const { data: { users }, error: usersError } = await sb.auth.admin.listUsers();
  if (usersError) {
    console.error('listUsers error:', usersError);
    return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
  }
  const emailMap = Object.fromEntries(users.map(u => [u.id, u.email]));

  // ── Process each user ──────────────────────────────────────
  for (const profile of profiles ?? []) {
    try {
      const email = emailMap[profile.id];
      if (!email) continue;

      const digest = await buildDigest(profile.id, today);
      if (!digest.hasSomething) continue; // skip empty digests

      const html = renderEmail(profile.full_name ?? 'there', digest, today);

      const { error: sendError } = await resend.emails.send({
        from: FROM,
        to:   email,
        subject: `☀️ Your Focus digest — ${formatDate(today)}`,
        html,
      });

      if (sendError) {
        console.error(`Failed to send to ${email}:`, sendError);
        results.push(`FAIL ${email}: ${sendError.message}`);
      } else {
        results.push(`OK ${email}`);
      }
    } catch (err) {
      results.push(`ERROR ${profile.id}: ${err}`);
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// ── Build digest data for one user ────────────────────────────
async function buildDigest(userId: string, today: string) {
  const [tasksRes, habitsRes, logsRes, eventsRes] = await Promise.all([
    sb.from('tasks')
      .select('text, tag, due, done')
      .eq('user_id', userId)
      .eq('done', false)
      .order('created_at'),

    sb.from('habits')
      .select('id, name')
      .eq('user_id', userId),

    // Logs from the last 7 days to compute streaks
    sb.from('habit_logs')
      .select('habit_id, logged_date')
      .eq('user_id', userId)
      .gte('logged_date', offsetDate(today, -6)),

    sb.from('calendar_events')
      .select('name, event_time, duration')
      .eq('user_id', userId)
      .eq('event_date', today)
      .order('event_time'),
  ]);

  const pendingTasks = tasksRes.data ?? [];
  const habits       = habitsRes.data ?? [];
  const logs         = logsRes.data ?? [];
  const todayEvents  = eventsRes.data ?? [];

  // Compute habit streaks
  const habitsWithStreaks = habits.map(h => {
    const hLogs = logs
      .filter(l => l.habit_id === h.id)
      .map(l => l.logged_date)
      .sort()
      .reverse();
    let streak = 0;
    let cursor = today;
    for (const log of hLogs) {
      if (log === cursor) { streak++; cursor = offsetDate(cursor, -1); }
      else break;
    }
    const doneToday = hLogs[0] === today;
    return { ...h, streak, doneToday };
  });

  const atRiskHabits = habitsWithStreaks.filter(h => h.streak > 0 && !h.doneToday);

  return {
    hasSomething: pendingTasks.length > 0 || todayEvents.length > 0 || atRiskHabits.length > 0,
    pendingTasks,
    todayEvents,
    habitsWithStreaks,
    atRiskHabits,
  };
}

// ── Render HTML email ─────────────────────────────────────────
function renderEmail(name: string, digest: Awaited<ReturnType<typeof buildDigest>>, today: string): string {
  const taskRows = digest.pendingTasks.slice(0, 8).map(t =>
    `<tr>
       <td style="padding:7px 0;font-size:13px;color:#2a2722;border-bottom:1px solid #e6e2da">${escHtml(t.text)}</td>
       <td style="padding:7px 0;text-align:right;font-size:11px;color:#7a746a;border-bottom:1px solid #e6e2da">${t.tag} · ${t.due ?? ''}</td>
     </tr>`
  ).join('');

  const eventRows = digest.todayEvents.map(e =>
    `<div style="padding:8px 12px;margin-bottom:6px;background:#f4f1ec;border-left:3px solid #7aa4c9;border-radius:3px;font-size:12px">
       <strong>${escHtml(e.name)}</strong>
       ${e.event_time ? `<span style="color:#7a746a;font-size:11px"> · ${e.event_time}${e.duration?' ('+e.duration+')':''}</span>` : ''}
     </div>`
  ).join('');

  const habitRows = digest.habitsWithStreaks.map(h =>
    `<tr>
       <td style="padding:6px 0;font-size:12px;color:#2a2722;border-bottom:1px solid #e6e2da">${escHtml(h.name)}</td>
       <td style="padding:6px 0;text-align:center;font-size:11px;border-bottom:1px solid #e6e2da">
         ${h.doneToday
           ? '<span style="color:#2a7a44">✓ Done</span>'
           : h.streak > 0
             ? `<span style="color:#c9901a">⚡ ${h.streak} day streak — do it today!</span>`
             : '<span style="color:#a09a8e">Not started</span>'
         }
       </td>
     </tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:'Georgia',serif;background:#f4f1ec;margin:0;padding:0">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">

  <!-- Header -->
  <div style="text-align:center;margin-bottom:32px">
    <div style="display:inline-flex;align-items:center;gap:8px;margin-bottom:8px">
      <div style="width:28px;height:28px;border:2px solid #2a2722;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">F</div>
      <span style="font-size:18px;font-weight:300">Focus</span>
    </div>
    <div style="font-size:26px;font-weight:300;font-style:italic;color:#2a2722;margin-bottom:4px">Good morning, ${escHtml(name)}.</div>
    <div style="font-size:12px;color:#7a746a">${formatDate(today)}</div>
  </div>

  ${digest.todayEvents.length > 0 ? `
  <!-- Today's schedule -->
  <div style="background:#edeae3;border:1.5px solid #c9c4b8;border-radius:8px;padding:20px 24px;margin-bottom:20px">
    <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#7a746a;margin-bottom:12px">Today's Schedule</div>
    ${eventRows}
  </div>` : ''}

  ${digest.pendingTasks.length > 0 ? `
  <!-- Pending tasks -->
  <div style="background:#edeae3;border:1.5px solid #c9c4b8;border-radius:8px;padding:20px 24px;margin-bottom:20px">
    <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#7a746a;margin-bottom:12px">Pending Tasks (${digest.pendingTasks.length})</div>
    <table style="width:100%;border-collapse:collapse">${taskRows}</table>
    ${digest.pendingTasks.length > 8 ? `<div style="font-size:11px;color:#a09a8e;margin-top:8px">+ ${digest.pendingTasks.length-8} more tasks in your dashboard</div>` : ''}
  </div>` : ''}

  ${digest.habitsWithStreaks.length > 0 ? `
  <!-- Habits -->
  <div style="background:#edeae3;border:1.5px solid #c9c4b8;border-radius:8px;padding:20px 24px;margin-bottom:20px">
    <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#7a746a;margin-bottom:12px">Habit Tracker</div>
    <table style="width:100%;border-collapse:collapse">${habitRows}</table>
  </div>` : ''}

  ${digest.atRiskHabits.length > 0 ? `
  <!-- At-risk streak alert -->
  <div style="background:#f0eadc;border:1.5px solid #c9b87a;border-radius:8px;padding:16px 24px;margin-bottom:20px">
    <div style="font-size:12px;color:#7a5a1a">
      ⚡ <strong>${digest.atRiskHabits.map(h=>h.name).join(', ')}</strong> — your streak${digest.atRiskHabits.length>1?'s are':' is'} at risk! Log ${digest.atRiskHabits.length>1?'them':'it'} today.
    </div>
  </div>` : ''}

  <!-- CTA -->
  <div style="text-align:center;margin-top:28px">
    <a href="${Deno.env.get('APP_URL') ?? '#'}/dashboard.html"
       style="display:inline-block;background:#2a2722;color:#f4f1ec;padding:12px 28px;border-radius:5px;font-size:12px;text-decoration:none;letter-spacing:.06em">
      Open Dashboard →
    </a>
  </div>

  <!-- Footer -->
  <div style="text-align:center;margin-top:32px;font-size:10px;color:#a09a8e">
    Focus · Productivity Dashboard<br>
    <a href="${Deno.env.get('APP_URL') ?? '#'}/settings.html" style="color:#a09a8e">Manage notification preferences</a>
  </div>

</div></body></html>`;
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function offsetDate(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// SCHEDULING — run this SQL in Supabase SQL Editor:
// ============================================================
//
// select cron.schedule(
//   'daily-digest',
//   '0 8 * * *',          -- every day at 08:00 UTC
//   $$
//   select net.http_post(
//     url    := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/daily-digest',
//     headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}',
//     body   := '{}'
//   );
//   $$
// );
//
// To check scheduled jobs:  select * from cron.job;
// To remove:                select cron.unschedule('daily-digest');
