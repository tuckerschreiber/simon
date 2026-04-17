# Setup — step by step

You don't install anything. You just copy-paste into a Google Sheet. Should take about 5 minutes the first time.

## Recommended: try the demo first

The **Run Demo** option uses 3 fake Ontario prospects (with realistic tech stacks and contacts) baked into the script. It skips Apollo entirely — you only need an Anthropic API key. Claude still generates real strategy docs and real draft emails, and they still land in your Google Drive. This is the fastest way to see what the tool actually produces.

**What you'll need for the demo:**

1. A Google account.
2. An **Anthropic API key** — from console.anthropic.com → API Keys. New accounts get ~$5 free credits — more than enough for many demo runs (each prospect costs ~$0.05).

**What you'll need for live runs (Apollo):**

3. An **Apollo API key** with API access — from apollo.io → Settings → Integrations → API. **Note:** Apollo's free tier does **not** include API access; you need a paid plan. If you don't have one, stick with the demo or replace the company-discovery step (we can rework the pipeline to accept a list of companies you provide).

Grab the keys you need before you start and keep them somewhere handy.

---

## Step 1 — Make a new Google Sheet

1. Go to https://sheets.google.com
2. Click the blank "+" to create a new sheet.
3. Name it anything, e.g. "PANW Prospect Scraper".

## Step 2 — Open the script editor

1. In your new sheet, click the menu: **Extensions → Apps Script**.
2. A new tab opens called "Apps Script". It will have a default file `Code.gs` with a one-line empty function.

## Step 3 — Paste the code

1. In the Apps Script tab, **select everything** in `Code.gs` and delete it.
2. Open the file `apps_script/Code.gs` from this repo (on GitHub, click into the file and click the "Copy raw contents" button at the top right — it looks like two overlapping squares).
3. Paste the whole thing into the empty `Code.gs` in Apps Script.
4. Click the **save icon** (the floppy-disk icon) or press `Ctrl/Cmd + S`.

## Step 4 — Set up the manifest (permissions)

1. In the Apps Script editor, click the **gear icon** on the left sidebar ("Project Settings").
2. Check the box **"Show appsscript.json manifest file in editor"**.
3. Go back to the **Editor** (the `<>` icon on the left sidebar). You should now see `appsscript.json` in the file list.
4. Click `appsscript.json`, select everything, delete it, and paste in the contents of `apps_script/appsscript.json` from this repo.
5. Save (`Ctrl/Cmd + S`).

## Step 5 — Reload the sheet

1. Go back to the browser tab with your Google Sheet.
2. Reload the page (F5 or Cmd+R).
3. After it loads, you'll see a new menu called **"Prospect Scraper"** at the top, right next to "Help".

If you don't see it, wait 10 seconds and reload again. First-time menu injection can lag.

## Step 6 — Initialize the sheets

1. Click **Prospect Scraper → Initialize sheets**.
2. Google will pop up a permissions dialog. Click through:
   - "Authorization required" → Continue
   - Choose your Google account
   - You'll see a warning "Google hasn't verified this app" — this is normal because it's your own code. Click **"Advanced"** → **"Go to (your project name) (unsafe)"**.
   - Review the permissions (it needs to read/write the current sheet, create Google Docs, and make internet requests to Apollo and Anthropic) → Allow.
3. You'll get a popup: "Sheets ready. Fill in your API keys..."

Two new tabs appear in your sheet: **Config** and **Results**.

## Step 7 — Fill in your API keys and settings

On the **Config** tab:

| Field | What to put |
|---|---|
| Apollo API Key | Paste your Apollo key in cell B1 — or leave blank for the demo |
| Anthropic API Key | Paste your Anthropic key in cell B2 — **required for both demo and live** |
| Location | `Ontario, Canada` (already filled in) |
| Max Employees | `1500` (already filled in) |
| Max Prospects Per Run | `3` (start small — increase once you trust it) |
| Output Folder ID (optional) | leave blank, or paste a Drive folder ID to save docs there |

**To get a folder ID:** make a folder in Google Drive, open it, look at the URL — the long string after `/folders/` is the ID.

## Step 8 — Run it

**For the demo (no Apollo key needed):**

1. Click **Prospect Scraper → Run Demo (no Apollo needed)**.
2. First run only: another permission dialog may appear for the Docs/Drive scopes. Allow it.
3. Wait ~2–3 minutes. Three fake prospects are processed in sequence; the tab will look frozen — that's normal.
4. Popup: "Demo done. 3 Google Docs generated."

**For a live run (Apollo key required):**

1. Click **Prospect Scraper → Run (live via Apollo)**.
2. Same permission dialog as above on first run.
3. Wait 2–4 minutes. Each prospect takes 30–90 seconds end-to-end.
4. Popup: "Done. Check the Results sheet for links."

## Step 9 — Open your docs

Click the **Results** tab. You'll see one row per prospect with a clickable link in the **Doc URL** column. Click any link to open the full account plan in Google Docs.

---

## Gotchas

- **"Exceeded maximum execution time" error** — Apps Script caps each click at 6 minutes. Lower `Max Prospects Per Run` to 2 or 3 and click Run again. The script will pick up fresh prospects each time.
- **"No prospects matched"** — your Apollo free tier may not have results for the competitor tech filter in Ontario. Try raising `Max Employees` or check your Apollo dashboard for remaining credits.
- **Claude error 400** — usually means your API key is wrong or your Anthropic account has no credits.
- **Apollo error 401** — API key wrong or missing.
- **Apollo error 429** — rate limited. The script waits 30 seconds and retries, but on the free tier you may just be out of credits for the month.

## Rerunning

- You can click **Run** as many times as you want. Each run appends new rows to the **Results** sheet.
- The script does not deduplicate across runs — if you run twice in a row with the same filters, you'll likely get docs for the same companies again. Narrow your filters or reduce runs to avoid burning credits.

## Updating the code

If I (or you) make changes to `Code.gs` later, repeat Step 3 (paste the new version, save). The `appsscript.json` only needs to change if we add new permissions.
