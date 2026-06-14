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
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
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

// ---- Leaderboard ----
function buildLeaderboard(data) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return "📊 No sales logged yet. Type '@sale' to log your first sale!";
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = ['🏆 SALES LEADERBOARD 🏆', ''];

  entries.forEach(([name, count], i) => {
    const rankMarker = medals[i] || `${i + 1}.`;
    const saleLabel = count === 1 ? 'sale' : 'sales';
    lines.push(`${rankMarker} ${name} — ${count} ${saleLabel}`);
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

  // --- @sale  /  @sale Name  /  @sale Name 3 ---
  if (/^@sale\b/i.test(text)) {
    const rest = text.replace(/^@sale/i, '').trim();
    let targetName = sender;
    let amount = 1;

    if (rest) {
      const parts = rest.split(/\s+/);
      const lastPart = parts[parts.length - 1];

      if (/^\d+$/.test(lastPart)) {
        amount = parseInt(lastPart, 10);
        parts.pop();
      }

      if (parts.length > 0) {
        targetName = parts.join(' ').replace(/^@/, '');
      }
    }

    if (amount <= 0) {
      await postToGroupMe('⚠️ Sale amount must be a positive number.');
      return;
    }

    data[targetName] = (data[targetName] || 0) + amount;
    saveData(data);

    const saleLabel = amount === 1 ? 'sale' : 'sales';
    await postToGroupMe(
      `✅ +${amount} ${saleLabel} for ${targetName}! Total: ${data[targetName]}\n\n${buildLeaderboard(data)}`
    );
    return;
  }

  // --- @undo  /  @undo Name ---
  if (/^@undo\b/i.test(text)) {
    const rest = text.replace(/^@undo/i, '').trim();
    const targetName = rest ? rest.replace(/^@/, '') : sender;

    if (data[targetName] && data[targetName] > 0) {
      data[targetName] -= 1;
      saveData(data);
      await postToGroupMe(
        `↩️ Removed 1 sale from ${targetName}. New total: ${data[targetName]}\n\n${buildLeaderboard(data)}`
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
        '@sale — log 1 sale for yourself\n' +
        '@sale Name — log 1 sale for Name\n' +
        '@sale Name 3 — log 3 sales for Name\n' +
        '@undo — remove your last sale\n' +
        '@undo Name — remove a sale from Name\n' +
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
