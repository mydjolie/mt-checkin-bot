# MT Check-in Bot

A LINE-based employee check-in system built for **MotorTracks**, designed to replace manual attendance tracking with a mobile-first, GPS-verified check-in flow that employees use directly inside LINE.

## Problem

Field and shift-based employees needed a fast way to clock in/out without a dedicated mobile app, while the company needed location-verified attendance data without manual spreadsheet work.

## Solution

A LINE LIFF (LINE Front-end Framework) mini-app that employees open from a LINE chat. On check-in, the app captures GPS coordinates, validates them against approved work locations, and logs the event to Google Sheets via a Node.js backend on Render.

## Features

- **One-tap check-in** inside LINE — no separate app install required
- **GPS verification** — check-in is only accepted within an approved radius of the worksite
- **Duplicate prevention** — same user + same job + same day is blocked automatically
- **Thai language commands** — admin commands via LINE chat (สร้างงาน, ปิดงาน, ส่งออก, สรุปวันนี้, สรุปเดือนนี้)
- **Export to Google Sheets** — per-job check-in summary exported as a dedicated sheet tab with a shareable link
- **Admin via ENV or Config sheet** — admin LINE IDs from `ADMIN_LINE_IDS` env var with fallback to a Config sheet
- **Buddhist Era (พ.ศ.) date support** — handles both serial dates and BE string dates from Google Sheets

## Tech Stack

| Layer | Technology |
|---|---|
| Front-end (mini-app) | LINE LIFF (LIFF SDK, HTML/CSS/JavaScript) |
| Front-end hosting | GitHub Pages |
| Backend | Node.js + Express on Render |
| LINE integration | @line/bot-sdk v9 (webhook + Messaging API) |
| Data store | Google Sheets (via googleapis) |
| Location validation | Browser Geolocation API + server-side Haversine formula |
| Tests | Jest (unit + integration, 80% coverage threshold) |

## Architecture

```
LINE App
   │  opens LIFF mini-app
   ▼
GitHub Pages (index.html)
   │  sends check-in payload (userId, jobId, lat/lng, timestamp)
   ▼
Render (Node.js / Express)
   │  validates GPS radius, checks duplicates, writes record
   ▼
Google Sheets
   ├── Jobs       (job definitions: location, radius, dates)
   ├── CheckIn    (attendance log)
   └── Config     (admin IDs, settings)
```

## LINE Chat Commands

### All Users
| Command | Description |
|---|---|
| `เข้างาน` | Get a link to the check-in LIFF app |
| `ขอเป็นแอดมิน` | Request admin access (sends your LINE ID to all admins) |

### Admin Only
| Command | Description |
|---|---|
| `สร้างงาน` | Create a new job interactively |
| `ปิดงาน JOB001` | Archive a job |
| `ส่งออก JOB001` | Export check-in data for a job to a Google Sheets tab |
| `สรุปวันนี้` | Today's check-in summary |
| `สรุปเดือนนี้` | This month's check-in summary |
| `รายการงาน` | List all active jobs |
| `help` | Show admin command reference |

## How GPS Verification Works

1. The LIFF app requests the device's current coordinates via the browser Geolocation API.
2. Coordinates are sent to the `/checkin` endpoint along with the employee's LINE user ID and selected job.
3. The backend calculates the distance between the submitted coordinates and the job's registered location (Haversine formula).
4. Check-ins outside the approved radius are rejected with a distance message; valid check-ins are timestamped and logged to the CheckIn sheet.

## Setup

### Prerequisites
- A [LINE Developers](https://developers.line.biz/) account with a Messaging API channel
- A Google Cloud project with Sheets API enabled
- A Google Sheet with `Jobs`, `CheckIn`, and `Config` tabs
- [Render](https://render.com/) account (or any Node.js host)

### Environment Variables

| Variable | Description |
|---|---|
| `LINE_TOKEN` | LINE Messaging API channel access token |
| `LINE_SECRET` | LINE Messaging API channel secret |
| `GOOGLE_CREDENTIALS` | Google service account JSON (stringified) |
| `SHEET_ID` | Google Sheets spreadsheet ID |
| `LIFF_ID` | LINE LIFF app ID |
| `ADMIN_LINE_IDS` | Comma-separated LINE user IDs for admin access (optional) |

### Deploy

```bash
# 1. Clone the repo
git clone https://github.com/mydjolie/mt-checkin-bot.git
cd mt-checkin-bot
npm install

# 2. Run tests
npm test

# 3. Set environment variables on Render
# Add all variables from the table above in the Render dashboard

# 4. Deploy backend to Render
# Connect the repo and deploy from the main branch

# 5. Deploy front-end to GitHub Pages
# Enable GitHub Pages on the repo (Settings > Pages > main branch)
# Update the LIFF endpoint URL in LINE Developers Console

# 6. Configure LINE webhook
# Set webhook URL to: https://<your-render-app>.onrender.com/webhook
```

## Google Sheets Structure

### Jobs (A2:I)
| Column | Field |
|---|---|
| A | Job ID |
| B | Job Name |
| C | Latitude |
| D | Longitude |
| E | Radius (meters) |
| F | Start Date |
| G | End Date |
| H | Location Name |
| I | Status (Active/Archive) |

### CheckIn (A1:)
| Column | Field |
|---|---|
| A | Timestamp |
| B | LINE User ID |
| C | Display Name |
| D | Job ID |
| E | Latitude |
| F | Longitude |
| G | Distance (m) |

## Running Tests

```bash
npm test              # run tests with coverage
npx jest --verbose    # verbose output
```

## License

MIT
