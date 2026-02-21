import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(join(__dirname, 'public')));

/**
 * GET /api/meetings — upcoming meetings with attendees.
 * Uses gog CLI to fetch Google Calendar events.
 */
app.get('/api/meetings', (req, res) => {
  try {
    const raw = execSync('gog calendar events --from now --to tomorrow --json', {
      timeout: 10000,
      encoding: 'utf8',
    });
    const data = JSON.parse(raw);
    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const meetings = (data.events || [])
      .filter(e => {
        // Must have a dateTime start (not all-day)
        const start = e.start?.dateTime;
        if (!start) return false;
        const startDate = new Date(start);
        return startDate > now && startDate <= twoHoursFromNow;
      })
      .filter(e => e.attendees && e.attendees.length > 0)
      .map(e => ({
        title: e.summary || 'Untitled',
        start: e.start.dateTime,
        attendees: (e.attendees || [])
          .filter(a => !a.self)
          .map(a => ({
            name: a.displayName || a.email.split('@')[0],
            email: a.email,
          })),
      }))
      .filter(m => m.attendees.length > 0);

    res.json(meetings);
  } catch (err) {
    console.error('[meetings] Error:', err.message);
    res.json([]);
  }
});

app.listen(PORT, () => {
  console.log(`Smriti running at http://localhost:${PORT}`);
});
