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

// ---- Storage helpers ----
function loadData() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    data = {};
  }

  // Migrate from old format (plain number = sale count) to new format
  for (const name in data) {
    if (typeof data[name] === 'number') {
      data[name] = { count: data[name], total: 0, lastSale: null };
    } else {
      if (typeof data[name].count !== 'number') data[name].count = 0;
      if (typeof data[name].total !== 'number') data[name].total = 0;
      if (!('lastSale' in data[name])) data[name].lastSale = null;
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

// ---- Leaderboard ----
function buildLeaderboard(data) {
  const entries = Object.entries(data).sort((a, b) => {
    return b[1].total - a[1].total || b[1].count - a[1].count;
  });

  if (entries.length === 0) {
    return "📊 No sales logged yet. Type '@sale' to log your first sale!";
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = ['🏆 SALES LEADERBOARD 🏆', ''];

  entries.forEach(([name, info], i) => {
    const rankMarker = medals[i] || `${i + 1}.`;
    const saleLabel = info.count === 1 ? 'sale' : 'sales';
    lines.push(`${rankMarker} ${name} — ${formatMoney(info.total)} (${info.count} ${saleLabel})`);
  });

  return lines.join('\n');
}

// ---- Webhook ----
app.post('/callback', async (req, res) => {
  // Respond right away - GroupMe just needs a 200
  res.sendStatus(200);

  const msg = req.body;
  if (!msg || msg.sender_type === 'bot') return; // don't react to ourselves

  const text = (msg.text || '').trim();
  const sender = msg.name || 'Unknown';

  const data = loadData();

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

    if (!data[targetName]) {
      data[targetName] = { count: 0, total: 0, lastSale: null };
    }

    data[targetName].count += 1;
    data[targetName].total += amount;
    data[targetName].lastSale = amount;
    saveData(data);

    const amountText = amount > 0 ? ` worth ${formatMoney(amount)}` : '';
    await postToGroupMe(
      `✅ New sale for ${targetName}${amountText}! Total: ${formatMoney(data[targetName].total)} (${data[targetName].count} sales)\n\n${buildLeaderboard(data)}`
    );
    return;
  }

  // --- @undo  /  @undo Name ---
  if (/^@undo\b/i.test(text)) {
    const rest = text.replace(/^@undo/i, '').trim();
    const targetName = rest ? rest.replace(/^@/, '') : sender;

    if (data[targetName] && data[targetName].count > 0) {
      const lastAmount = data[targetName].lastSale || 0;
      data[targetName].count -= 1;
      data[targetName].total -= lastAmount;
      data[targetName].lastSale = null; // only the most recent sale can be undone
      saveData(data);
      await postToGroupMe(
        `↩️ Removed last sale from ${targetName}. New total: ${formatMoney(data[targetName].total)} (${data[targetName].count} sales)\n\n${buildLeaderboard(data)}`
      );
    } else {
      await postToGroupMe(`⚠️ ${targetName} has no sales to undo.`);
    }
    return;
  }

  // --- @leaderboard or !leaderboard ---
  if (/^[@!]leaderboard\b/i.test(text)) {
    await postToGroupMe(buildLeaderboard(data));
    return;
  }

  // --- @reset confirm (wipes everything) ---
  if (/^@reset confirm$/i.test(text)) {
    saveData({});
    await postToGroupMe('🔄 Leaderboard has been reset to zero for everyone.');
    return;
  }

  // --- @salehelp ---
  if (/^@salehelp\b/i.test(text)) {
    await postToGroupMe(
      '📋 Sales Bot Commands:\n' +
        '@sale — log a sale for yourself (no $ value)\n' +
        '@sale 500 — log a sale worth $500 for yourself\n' +
        '@sale Mike 500 — log a $500 sale for Mike\n' +
        '@undo — remove your last sale\n' +
        "@undo Mike — remove Mike's last sale\n" +
        '@leaderboard — show current standings\n' +
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
