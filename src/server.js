import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const RECALL_PORT = 7890;

app.use(express.static(join(__dirname, 'public')));
app.use(express.static(join(__dirname, '..', 'dist')));

// Reverse proxy: /recall/* → localhost:7890/*
// This avoids macOS firewall issues (Flask only needs localhost, Express handles LAN)
app.use('/recall', (req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: RECALL_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${RECALL_PORT}` },
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxy.on('error', (err) => {
    console.error('[proxy] Recall Engine error:', err.message);
    res.status(502).json({ error: 'Cannot reach Recall Engine on localhost:7890' });
  });

  req.pipe(proxy, { end: true });
});

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
