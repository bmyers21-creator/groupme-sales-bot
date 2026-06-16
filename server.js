const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_ID = process.env.GROUPME_BOT_ID;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sales.json');

// Make sure the data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---- Date helpers ----
function getTodayKey(date = new Date()) {
  // YYYY-MM-DD in local time
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekKey(date = new Date()) {
  // Week key based on the Monday of the current week: YYYY-MM-DD (Monday's date)
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return getTodayKey(d);
}

function formatDateLabel(date = new Date()) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatWeekLabel(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${monday.toLocaleDateString('en-US', opts)} - ${sunday.toLocaleDateString('en-US', opts)}`;
}

// ---- Storage helpers ----
function loadData() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    raw = {};
  }

  // wrap old flat format { Name: {...} } into { agents: { Name: {...} } }
  let data = raw.agents ? raw : { agents: raw };
  if (!data.agents) data.agents = {};

  for (const name in data.agents) {
    const a = data.agents[name];
    if (typeof a === 'number') {
      data.agents[name] = { count: a, total: 0, lastSale: null, daily: {}, weekly: {} };
    } else {
      if (typeof a.count !== 'number') a.count = 0;
      if (typeof a.total !== 'number') a.total = 0;
      if (!('lastSale' in a)) a.lastSale = null;
      if (!a.daily) a.daily = {};
      if (!a.weekly) a.weekly = {};
    }
  }

  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---- GroupMe helper ----
async function postToGroupMe(text) {
  if (!BOT_ID) {
    console.error('GROUPME_BOT_ID is not set');
    return;
  }
  try {
    await axios.post('https://api.groupme.com/v3/bots/post', {
      bot_id: BOT_ID,
      text: text,
    });
  } catch (err) {
    console.error('Error posting to GroupMe:', err.message);
  }
}

// ---- Formatting ----
function formatMoney(amount) {
  return '$' + amount.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

// ---- Leaderboards ----
function buildLeaderboard(agents, periodKey, periodType, label) {
  const entries = Object.entries(agents)
    .map(([name, info]) => {
      const bucket = periodType === 'daily' ? info.daily : periodType === 'weekly' ? info.weekly : null;
      const total = bucket ? (bucket[periodKey]?.total || 0) : info.total;
      const count = bucket ? (bucket[periodKey]?.count || 0) : info.count;
      return [name, total, count];
    })
    .filter(([, total, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || b[2] - a[2]);

  const titleMap = {
    daily: `📅 TODAY'S SALES — ${label}`,
    weekly: `📈 THIS WEEK'S SALES — ${label}`,
    allTime: '🏆 ALL-TIME LEADERBOARD 🏆',
  };
  const title = titleMap[periodType];

  if (entries.length === 0) {
    return `${title}\n\nNo sales logged yet for this period.`;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = [title, ''];

  entries.forEach(([name, total, count], i) => {
    const rankMarker = medals[i] || `${i + 1}.`;
    const saleLabel = count === 1 ? 'sale' : 'sales';
    lines.push(`${rankMarker} ${name} — ${formatMoney(total)} (${count} ${saleLabel})`);
  });

  return lines.join('\n');
}

function buildAllTimeLeaderboard(agents) {
  return buildLeaderboard(agents, null, 'allTime', null);
}

function buildDailyLeaderboard(agents, date = new Date()) {
  return buildLeaderboard(agents, getTodayKey(date), 'daily', formatDateLabel(date));
}

function buildWeeklyLeaderboard(agents, date = new Date()) {
  return buildLeaderboard(agents, getWeekKey(date), 'weekly', formatWeekLabel(date));
}

// ---- Webhook ----
app.post('/callback', async (req, res) => {
  res.sendStatus(200); // GroupMe just needs a fast 200

  const msg = req.body;
  if (!msg || msg.sender_type === 'bot') return;

  const text = (msg.text || '').trim();
  const sender = msg.name || 'Unknown';

  const data = loadData();
  const agents = data.agents;

  // --- @sale  /  @sale 500  /  @sale Name  /  @sale Name 500 ---
  if (/^@sale\b/i.test(text)) {
    const rest = text.replace(/^@sale/i, '').trim();
    let targetName = sender;
    let amount = 0;

    if (rest) {
      const parts = rest.split(/\s+/);
      const lastPart = parts[parts.length - 1].replace(/[$,]/g, '');

      if (/^\d+(\.\d+)?$/.test(lastPart)) {
        amount = parseFloat(lastPart);
        parts.pop();
      }

      if (parts.length > 0) {
        targetName = parts.join(' ').replace(/^@/, '');
      }
    }

    if (!agents[targetName]) {
      agents[targetName] = { count: 0, total: 0, lastSale: null, daily: {}, weekly: {} };
    }
    const agent = agents[targetName];

    const now = new Date();
    const dayKey = getTodayKey(now);
    const weekKey = getWeekKey(now);

    if (!agent.daily[dayKey]) agent.daily[dayKey] = { count: 0, total: 0 };
    if (!agent.weekly[weekKey]) agent.weekly[weekKey] = { count: 0, total: 0 };

    agent.count += 1;
    agent.total += amount;
    agent.lastSale = { amount, dayKey, weekKey };

    agent.daily[dayKey].count += 1;
    agent.daily[dayKey].total += amount;
    agent.weekly[weekKey].count += 1;
    agent.weekly[weekKey].total += amount;

    saveData(data);

    const amountText = amount > 0 ? ` worth ${formatMoney(amount)}` : '';
    const todayInfo = agent.daily[dayKey];

    const message = [
      `✅ New sale for ${targetName}${amountText}!`,
      `Today: ${formatMoney(todayInfo.total)} (${todayInfo.count} sales) | All-time: ${formatMoney(agent.total)} (${agent.count} sales)`,
      '',
      buildDailyLeaderboard(agents, now),
    ].join('\n');

    await postToGroupMe(message);
    return;
  }

  // --- @undo  /  @undo Name ---
  if (/^@undo\b/i.test(text)) {
    const rest = text.replace(/^@undo/i, '').trim();
    const targetName = rest ? rest.replace(/^@/, '') : sender;
    const agent = agents[targetName];

    if (agent && agent.count > 0 && agent.lastSale) {
      const { amount, dayKey, weekKey } = agent.lastSale;

      agent.count -= 1;
      agent.total -= amount;
      if (agent.daily[dayKey]) {
        agent.daily[dayKey].count -= 1;
        agent.daily[dayKey].total -= amount;
      }
      if (agent.weekly[weekKey]) {
        agent.weekly[weekKey].count -= 1;
        agent.weekly[weekKey].total -= amount;
      }
      agent.lastSale = null;

      saveData(data);
      await postToGroupMe(
        `↩️ Removed last sale from ${targetName}. New all-time total: ${formatMoney(agent.total)} (${agent.count} sales)`
      );
    } else {
      await postToGroupMe(`⚠️ ${targetName} has no recent sale to undo.`);
    }
    return;
  }

  // --- @daily ---
  if (/^[@!]daily\b/i.test(text)) {
    await postToGroupMe(buildDailyLeaderboard(agents));
    return;
  }

  // --- @weekly ---
  if (/^[@!]weekly\b/i.test(text)) {
    await postToGroupMe(buildWeeklyLeaderboard(agents));
    return;
  }

  // --- @leaderboard or !leaderboard (all-time) ---
  if (/^[@!]leaderboard\b/i.test(text)) {
    await postToGroupMe(buildAllTimeLeaderboard(agents));
    return;
  }

  // --- @reset confirm (wipes everything) ---
  if (/^@reset confirm$/i.test(text)) {
    saveData({ agents: {} });
    await postToGroupMe('🔄 Leaderboard has been reset to zero for everyone.');
    return;
  }

  // --- @salehelp ---
  if (/^@salehelp\b/i.test(text)) {
    await postToGroupMe(
      '📋 Sales Bot Commands:\n' +
        '@sale — log a sale for yourself (no $ value)\n' +
        '@sale 500 — log a $500 sale for yourself\n' +
        '@sale Mike 500 — log a $500 sale for Mike\n' +
        '@undo — remove your last sale\n' +
        "@undo Mike — remove Mike's last sale\n" +
        "@daily — show today's standings\n" +
        '@weekly — show this week\'s standings\n' +
        '@leaderboard — show all-time standings\n' +
        '@reset confirm — reset ALL totals to zero'
    );
    return;
  }
});

// Simple health check page
app.get('/', (req, res) => {
  res.send('GroupMe Sales Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
