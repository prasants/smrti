/**
 * app.js — SMRTi v1.1: Spaced repetition flashcards
 * Features: Standard Review, Ambient Mode, Pre-Meeting Prep
 */

import { G2Bridge } from './g2.js';

// All API calls go through the Express server's /recall proxy
// This avoids macOS firewall blocking Flask on a separate port
const API = `${window.location.origin}/recall`;
const SERVER = window.location.origin;

// ─── State ─────────────────────────────────────────────────────────
let state = 'loading'; // loading | stats | question | answer | done | ambient-wait | ambient-question | ambient-answer | meeting-prep
let currentCard = null;
let stats = null;
let reviewCount = 0;
let g2 = null;
let isG2 = false;

// Ambient mode
let ambientConfig = { enabled: false, interval: 15 }; // interval in minutes
let ambientTimer = null;
let ambientNextTime = null;
let ambientCountdownInterval = null;

// Meeting prep
let upcomingMeetings = [];
let meetingPrepAttendees = [];
let meetingPrepIndex = 0;
let meetingPrepTitle = '';

const RATING_MAP = { 'Again': 1, 'Hard': 2, 'Good': 3, 'Easy': 4 };

// ─── API ───────────────────────────────────────────────────────────
async function apiGet(path, base = API) {
  try {
    const res = await fetch(`${base}${path}`);
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`API ${path} failed:`, err);
    return null;
  }
}

async function apiDelete(path) {
  try {
    await fetch(`${API}${path}`, { method: 'DELETE' });
  } catch (err) {
    console.error(`API DELETE ${path} failed:`, err);
  }
}

async function apiPost(path, body) {
  try {
    await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`API POST ${path} failed:`, err);
  }
}

// ─── Ambient Storage ───────────────────────────────────────────────
async function loadAmbientConfig() {
  if (isG2 && g2) {
    const saved = await g2.load('smrti_ambient');
    if (saved) ambientConfig = saved;
  } else {
    const saved = localStorage.getItem('smrti_ambient');
    if (saved) ambientConfig = JSON.parse(saved);
  }
}

async function saveAmbientConfig() {
  if (isG2 && g2) {
    await g2.store('smrti_ambient', ambientConfig);
  } else {
    localStorage.setItem('smrti_ambient', JSON.stringify(ambientConfig));
  }
}

// ─── State Machine ─────────────────────────────────────────────────
async function enterStats() {
  state = 'stats';
  stats = await apiGet('/stats');
  if (!stats) {
    render('error', 'Cannot reach Recall Engine.\nIs it running on port 7890?');
    return;
  }

  // Check for upcoming meetings
  try {
    const meetings = await apiGet('/api/meetings', SERVER);
    upcomingMeetings = meetings || [];
  } catch { upcomingMeetings = []; }

  render('stats');
}

async function enterQuestion() {
  const data = await apiGet('/due');
  if (!data || !data.card) {
    state = 'done';
    render('done');
    return;
  }
  currentCard = data.card;
  state = 'question';
  render('question');
}

function enterAnswer() {
  state = 'answer';
  render('answer');
}

async function submitRating(rating) {
  if (!currentCard) return;
  await apiPost('/review', { card_id: currentCard.card_id, rating });
  reviewCount++;

  if (isG2 && g2) {
    await g2.store('smrti_session', { reviewCount, lastReview: new Date().toISOString() });
  }

  // If in ambient mode, go to wait state instead of next card
  if (ambientConfig.enabled) {
    enterAmbientWait();
    return;
  }

  await enterQuestion();
}

async function deleteCurrentCard() {
  if (!currentCard) return;
  await apiDelete(`/cards/${currentCard.card_id}`);
  currentCard = null;
  // Move to next card or back to stats
  if (ambientConfig.enabled) {
    enterAmbientWait();
    return;
  }
  await enterQuestion();
}

// ─── Ambient Mode ──────────────────────────────────────────────────
async function toggleAmbient() {
  ambientConfig.enabled = !ambientConfig.enabled;
  await saveAmbientConfig();

  if (ambientConfig.enabled) {
    enterAmbientQuestion();
  } else {
    clearAmbientTimers();
    await enterStats();
  }
}

function clearAmbientTimers() {
  if (ambientTimer) { clearTimeout(ambientTimer); ambientTimer = null; }
  if (ambientCountdownInterval) { clearInterval(ambientCountdownInterval); ambientCountdownInterval = null; }
  ambientNextTime = null;
}

async function enterAmbientQuestion() {
  const data = await apiGet('/due');
  if (!data || !data.card) {
    state = 'ambient-wait';
    render('ambient-no-cards');
    return;
  }
  currentCard = data.card;
  state = 'ambient-question';
  render('ambient-question');
}

function enterAmbientAnswer() {
  state = 'ambient-answer';
  render('ambient-answer');
}

function enterAmbientWait() {
  state = 'ambient-wait';
  clearAmbientTimers();

  const waitMs = ambientConfig.interval * 60 * 1000;
  ambientNextTime = new Date(Date.now() + waitMs);

  ambientTimer = setTimeout(() => {
    enterAmbientQuestion();
  }, waitMs);

  // Update countdown every 30s
  ambientCountdownInterval = setInterval(() => {
    if (state === 'ambient-wait') render('ambient-wait');
  }, 30000);

  render('ambient-wait');
}

// ─── Meeting Prep ──────────────────────────────────────────────────
async function enterMeetingPrep(meetingIndex) {
  const meeting = upcomingMeetings[meetingIndex];
  if (!meeting) return;

  meetingPrepTitle = meeting.title;
  meetingPrepAttendees = [];
  meetingPrepIndex = 0;

  // Look up each attendee in the people deck
  for (const attendee of meeting.attendees) {
    const result = await apiGet(`/cards?deck=people&search=${encodeURIComponent(attendee.name)}`);
    if (result && result.cards && result.cards.length > 0) {
      meetingPrepAttendees.push({ ...attendee, card: result.cards[0] });
    } else {
      // Try email prefix
      const prefix = attendee.email.split('@')[0].replace(/[._]/g, ' ');
      const result2 = await apiGet(`/cards?deck=people&search=${encodeURIComponent(prefix)}`);
      if (result2 && result2.cards && result2.cards.length > 0) {
        meetingPrepAttendees.push({ ...attendee, card: result2.cards[0] });
      } else {
        meetingPrepAttendees.push({ ...attendee, card: null });
      }
    }
  }

  state = 'meeting-prep';
  render('meeting-prep');
}

function nextMeetingPrepCard() {
  meetingPrepIndex++;
  if (meetingPrepIndex >= meetingPrepAttendees.length) {
    enterStats();
    return;
  }
  render('meeting-prep');
}

// ─── G2 Event Handler ──────────────────────────────────────────────
function handleG2Select(itemName) {
  switch (state) {
    case 'stats':
      if (itemName === 'Start Review') enterQuestion();
      else if (itemName === 'Ambient Mode') toggleAmbient();
      else if (itemName.startsWith('Prep:')) {
        const idx = upcomingMeetings.findIndex(m => itemName.includes(m.title.slice(0, 20)));
        if (idx >= 0) enterMeetingPrep(idx);
      }
      break;
    case 'question':
      if (itemName === 'Reveal') enterAnswer();
      break;
    case 'answer':
      if (itemName === 'Delete') deleteCurrentCard();
      else if (RATING_MAP[itemName]) submitRating(RATING_MAP[itemName]);
      break;
    case 'done':
      if (itemName === 'Exit') g2.exit();
      break;
    case 'ambient-question':
      if (itemName === 'Reveal') enterAmbientAnswer();
      break;
    case 'ambient-answer':
      if (itemName === 'Delete') deleteCurrentCard();
      else if (RATING_MAP[itemName]) submitRating(RATING_MAP[itemName]);
      break;
    case 'ambient-wait':
      if (itemName === 'Stop') { ambientConfig.enabled = false; saveAmbientConfig(); clearAmbientTimers(); enterStats(); }
      break;
    case 'meeting-prep':
      if (itemName === 'Next') nextMeetingPrepCard();
      else if (itemName === 'Done') enterStats();
      break;
  }
}

// ─── Render ────────────────────────────────────────────────────────
function render(screen, errorMsg) {
  if (isG2) renderG2(screen, errorMsg);
  renderBrowser(screen, errorMsg);
}

function renderG2(screen, errorMsg) {
  if (!g2) return;

  switch (screen) {
    case 'error':
      g2.showPage(errorMsg || 'Error', ['Retry']);
      break;
    case 'stats': {
      const s = stats;
      const text = `${s.due_today} cards due | ${s.total_cards} total\n${s.retention_rate}% retention | ${s.streak_days} day streak`;
      const actions = [];
      if (s.due_today > 0) actions.push('Start Review');
      actions.push('Ambient Mode');
      for (const m of upcomingMeetings.slice(0, 1)) {
        const mins = Math.round((new Date(m.start) - new Date()) / 60000);
        actions.push(`Prep: ${m.title.slice(0, 15)}`);
      }
      g2.showPage(text, actions);
      break;
    }
    case 'question': {
      const c = currentCard;
      const label = c.deck ? `${c.deck}` : '';
      g2.showPage(label ? `${label}\n\n${c.front}` : c.front, ['Reveal']);
      break;
    }
    case 'answer':
      g2.showPage(currentCard.back, ['Again', 'Hard', 'Good', 'Easy', 'Delete']);
      break;
    case 'done':
      g2.showPage(`All done! 🎉\n${reviewCount} cards reviewed`, ['Exit']);
      break;
    case 'ambient-question': {
      const c = currentCard;
      g2.showPage(`☀ ${c.deck || ''}\n\n${c.front}`, ['Reveal']);
      break;
    }
    case 'ambient-answer':
      g2.showPage(currentCard.back, ['Again', 'Hard', 'Good', 'Easy', 'Delete']);
      break;
    case 'ambient-wait': {
      const mins = ambientNextTime ? Math.max(0, Math.round((ambientNextTime - Date.now()) / 60000)) : '?';
      g2.showPage(`SMRTi · next in ${mins}m`, ['Stop']);
      break;
    }
    case 'ambient-no-cards':
      g2.showPage('SMRTi · no cards due\nAmbient mode paused', ['Stop']);
      break;
    case 'meeting-prep': {
      const a = meetingPrepAttendees[meetingPrepIndex];
      const num = `${meetingPrepIndex + 1}/${meetingPrepAttendees.length}`;
      const text = a.card
        ? `${a.name}\n${a.card.back.slice(0, 200)}`
        : `${a.name}\n${a.email}\n(no card found)`;
      const isLast = meetingPrepIndex >= meetingPrepAttendees.length - 1;
      g2.showPage(`📋 ${meetingPrepTitle} ${num}\n${text}`, [isLast ? 'Done' : 'Next']);
      break;
    }
  }
}

// ─── Browser UI ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function renderBrowser(screen, errorMsg) {
  const statusEl = $('status');
  const statsEl = $('stats-area');
  const cardArea = $('card-area');
  const doneEl = $('done');
  const ambientEl = $('ambient-area');
  const meetingEl = $('meeting-area');

  if (!statusEl) return;

  // Hide all
  for (const el of [statusEl, statsEl, cardArea, doneEl, ambientEl, meetingEl]) {
    if (el) el.classList.add('hidden');
  }

  switch (screen) {
    case 'error':
      statusEl.textContent = errorMsg || 'Error';
      statusEl.classList.remove('hidden');
      break;
    case 'stats': {
      if (!statsEl) break;
      const s = stats;
      $('stats-due').textContent = s.due_today;
      $('stats-total').textContent = s.total_cards;
      $('stats-retention').textContent = `${s.retention_rate}%`;
      $('stats-streak').textContent = s.streak_days;
      $('start-btn').classList.toggle('hidden', s.due_today === 0);

      // Meeting banner
      const meetingBanner = $('meeting-banner');
      if (meetingBanner) {
        if (upcomingMeetings.length > 0) {
          const m = upcomingMeetings[0];
          const mins = Math.round((new Date(m.start) - new Date()) / 60000);
          meetingBanner.innerHTML = upcomingMeetings.map((m, i) => {
            const mins = Math.round((new Date(m.start) - new Date()) / 60000);
            return `<div class="meeting-banner-item" onclick="startMeetingPrep(${i})">
              📋 Meeting in ${mins}m: ${m.title} (${m.attendees.length} attendees) → Prep
            </div>`;
          }).join('');
          meetingBanner.classList.remove('hidden');
        } else {
          meetingBanner.classList.add('hidden');
        }
      }

      statsEl.classList.remove('hidden');
      break;
    }
    case 'question': {
      const c = currentCard;
      cardArea.classList.remove('hidden');
      $('deck-info').textContent = c.deck || '';
      $('question').textContent = c.front;
      $('answer').classList.add('hidden');
      $('reveal-btn').classList.remove('hidden');
      $('ratings').classList.add('hidden');
      break;
    }
    case 'answer': {
      cardArea.classList.remove('hidden');
      $('deck-info').textContent = currentCard.deck || '';
      $('question').textContent = currentCard.front;
      $('answer').textContent = currentCard.back;
      $('answer').classList.remove('hidden');
      $('reveal-btn').classList.add('hidden');
      $('ratings').classList.remove('hidden');
      break;
    }
    case 'done':
      doneEl.classList.remove('hidden');
      $('done-count').textContent = reviewCount;
      break;
    case 'ambient-question': {
      if (!ambientEl) break;
      ambientEl.classList.remove('hidden');
      $('ambient-status').textContent = '☀ Ambient Mode';
      $('ambient-card').textContent = currentCard.front;
      $('ambient-deck').textContent = currentCard.deck || '';
      $('ambient-reveal-btn').classList.remove('hidden');
      $('ambient-answer').classList.add('hidden');
      $('ambient-ratings').classList.add('hidden');
      $('ambient-countdown').classList.add('hidden');
      break;
    }
    case 'ambient-answer': {
      if (!ambientEl) break;
      ambientEl.classList.remove('hidden');
      $('ambient-status').textContent = '☀ Ambient Mode';
      $('ambient-card').textContent = currentCard.front;
      $('ambient-deck').textContent = currentCard.deck || '';
      $('ambient-answer').textContent = currentCard.back;
      $('ambient-answer').classList.remove('hidden');
      $('ambient-reveal-btn').classList.add('hidden');
      $('ambient-ratings').classList.remove('hidden');
      $('ambient-countdown').classList.add('hidden');
      break;
    }
    case 'ambient-wait': {
      if (!ambientEl) break;
      ambientEl.classList.remove('hidden');
      const mins = ambientNextTime ? Math.max(0, Math.round((ambientNextTime - Date.now()) / 60000)) : '?';
      $('ambient-status').textContent = '☀ Ambient Mode';
      $('ambient-card').textContent = '';
      $('ambient-deck').textContent = '';
      $('ambient-answer').classList.add('hidden');
      $('ambient-reveal-btn').classList.add('hidden');
      $('ambient-ratings').classList.add('hidden');
      $('ambient-countdown').textContent = `Next card in ${mins} minutes`;
      $('ambient-countdown').classList.remove('hidden');
      break;
    }
    case 'ambient-no-cards': {
      if (!ambientEl) break;
      ambientEl.classList.remove('hidden');
      $('ambient-status').textContent = '☀ Ambient Mode — No cards due';
      $('ambient-card').textContent = '';
      $('ambient-deck').textContent = '';
      $('ambient-countdown').textContent = 'All caught up!';
      $('ambient-countdown').classList.remove('hidden');
      $('ambient-reveal-btn').classList.add('hidden');
      $('ambient-ratings').classList.add('hidden');
      $('ambient-answer').classList.add('hidden');
      break;
    }
    case 'meeting-prep': {
      if (!meetingEl) break;
      meetingEl.classList.remove('hidden');
      const a = meetingPrepAttendees[meetingPrepIndex];
      const num = `${meetingPrepIndex + 1}/${meetingPrepAttendees.length}`;
      $('meeting-title').textContent = `📋 ${meetingPrepTitle} — ${num}`;
      $('meeting-name').textContent = a.name;
      $('meeting-email').textContent = a.email;
      $('meeting-details').textContent = a.card ? a.card.back : '(no card in people deck)';
      const isLast = meetingPrepIndex >= meetingPrepAttendees.length - 1;
      $('meeting-next-btn').textContent = isLast ? 'Done' : 'Next →';
      break;
    }
  }
}

// ─── Browser Event Handlers ────────────────────────────────────────
window.startReview = () => enterQuestion();
window.reveal = () => enterAnswer();
window.rate = (rating) => submitRating(rating);
window.deleteCard = () => deleteCurrentCard();
window.toggleAmbient = () => toggleAmbient();
window.ambientReveal = () => enterAmbientAnswer();
window.ambientRate = (rating) => submitRating(rating);
window.stopAmbient = () => { ambientConfig.enabled = false; saveAmbientConfig(); clearAmbientTimers(); enterStats(); };
window.startMeetingPrep = (idx) => enterMeetingPrep(idx);
window.meetingNext = () => nextMeetingPrepCard();

document.addEventListener('keydown', (e) => {
  if (state === 'question' && (e.key === ' ' || e.key === 'Enter')) {
    enterAnswer();
  } else if (state === 'answer') {
    const r = parseInt(e.key);
    if (r >= 1 && r <= 4) submitRating(r);
  } else if (state === 'ambient-question' && (e.key === ' ' || e.key === 'Enter')) {
    enterAmbientAnswer();
  } else if (state === 'ambient-answer') {
    const r = parseInt(e.key);
    if (r >= 1 && r <= 4) submitRating(r);
  }
});

// ─── Boot ──────────────────────────────────────────────────────────
(async () => {
  g2 = new G2Bridge();
  isG2 = await g2.connect();

  if (isG2) {
    g2.onListSelect = handleG2Select;
    // System tap (ring/back-tap) — select the first/primary action
    g2.onSystemTap = (eventType) => {
      console.log('[SMRTi] System tap, eventType:', eventType);
      // Map system taps to the primary action for current state
      const primaryAction = {
        'stats': 'Start Review',
        'question': 'Reveal',
        'answer': 'Good',
        'done': 'Exit',
        'ambient-question': 'Reveal',
        'ambient-answer': 'Good',
        'ambient-wait': 'Stop',
        'meeting-prep': 'Next',
      };
      const action = primaryAction[state];
      if (action) handleG2Select(action);
    };
    console.log('[SMRTi] Running in G2 mode');
  } else {
    console.log('[SMRTi] Running in browser mode');
  }

  await loadAmbientConfig();

  // If ambient mode was enabled, resume it
  if (ambientConfig.enabled) {
    await enterAmbientQuestion();
  } else {
    await enterStats();
  }
})();
