# GroupMe Sales Tracker Bot

A simple bot for your GroupMe group chat. Agents log sales with `@sale`,
and the bot replies with an updated leaderboard automatically. Anyone can
also check standings on demand with `@leaderboard`.

## Commands

| Command | What it does |
|---|---|
| `@sale` | Logs +1 sale for the person who sent the message |
| `@sale Mike` | Logs +1 sale for "Mike" |
| `@sale Mike 3` | Logs +3 sales for "Mike" |
| `@undo` | Removes 1 sale from yourself (fixes a mistake) |
| `@undo Mike` | Removes 1 sale from "Mike" |
| `@leaderboard` or `!leaderboard` | Posts current standings |
| `@reset confirm` | Wipes all totals back to zero |
| `@salehelp` | Shows the command list in the chat |

After every `@sale`, the bot automatically posts the updated leaderboard,
so the group always sees fresh numbers.

---

## Step 1: Deploy the bot to Render (free)

1. Create a free account at [render.com](https://render.com).
2. Put this folder in a GitHub repo (or use Render's "Deploy from a Git
   repo" after pushing these files).
3. In Render, click **New > Web Service** and connect your repo.
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. You don't need to set the `GROUPME_BOT_ID` environment variable yet —
   come back and add it after Step 2.
6. Deploy. Once it's live, you'll get a URL like:
   `https://your-app-name.onrender.com`

> **Note on free tier:** Render's free web services spin down after periods
> of inactivity and spin back up when a request comes in (the GroupMe
> message itself triggers this — there may be a few seconds of delay on
> the first message after idle time). Sales data is stored in
> `data/sales.json` and persists between requests, but **will be wiped if
> you redeploy the service**. If you want totals to survive redeploys
> long-term, let me know and I can wire it up to a free database instead.

---

## Step 2: Create the GroupMe bot

1. Go to [dev.groupme.com/bots](https://dev.groupme.com/bots) and log in.
2. Click **Create Bot**.
3. Fill in:
   - **Name:** e.g. "Sales Tracker"
   - **Group:** select your work group chat
   - **Callback URL:** `https://your-app-name.onrender.com/callback`
     (use the URL from Step 1)
   - **Avatar:** optional
4. Click **Submit**. You'll get a **Bot ID** — copy it.

---

## Step 3: Connect the Bot ID to Render

1. Back in Render, go to your service → **Environment**.
2. Add an environment variable:
   - **Key:** `GROUPME_BOT_ID`
   - **Value:** (paste the Bot ID from Step 2)
3. Save — Render will redeploy automatically.

---

## Step 4: Test it

In your group chat, type:

```
@sale
```

The bot should reply with a confirmation and the leaderboard. Try
`@sale Mike 3`, `@undo`, and `@leaderboard` too.

---

## Running locally (optional)

```bash
npm install
GROUPME_BOT_ID=your_bot_id_here npm start
```

You'll need a tool like [ngrok](https://ngrok.com) to expose your local
server to the internet so GroupMe's callback can reach it.
