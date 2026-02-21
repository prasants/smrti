/**
 * app.js — SMRTi: Spaced repetition flashcards
 * Detects environment (Even App WebView vs browser) and drives the review flow.
 */

import { G2Bridge } from './g2.js';

// Use same hostname as the page (so it works from phone via LAN IP)
const API_HOST = window.location.hostname || 'localhost';
const API = `http://${API_HOST}:7890`;

// ─── State ─────────────────────────────────────────────────────────
let state = 'loading'; // loading | stats | question | answer | done
let currentCard = null;
let stats = null;
let reviewCount = 0;
let g2 = null;
let isG2 = false;

const RATING_MAP = { 'Again': 1, 'Hard': 2, 'Good': 3, 'Easy': 4 };

// ─── API ───────────────────────────────────────────────────────────
async function apiGet(path) {
  try {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`API ${path} failed:`, err);
    return null;
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

// ─── State Machine ─────────────────────────────────────────────────
async function enterStats() {
  state = 'stats';
  stats = await apiGet('/stats');
  if (!stats) {
    render('error', 'Cannot reach Recall Engine.\nIs it running on port 7890?');
    return;
  }
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
  // Save session stats to G2 localStorage
  if (g2 && isG2) {
    await g2.store('smrti_session', { reviewCount, lastReview: new Date().toISOString() });
  }
  await enterQuestion();
}

// ─── G2 Event Handler ──────────────────────────────────────────────
function handleG2Select(itemName) {
  if (state === 'stats' && itemName === 'Start Review') {
    enterQuestion();
  } else if (state === 'question' && itemName === 'Reveal') {
    enterAnswer();
  } else if (state === 'answer' && RATING_MAP[itemName]) {
    submitRating(RATING_MAP[itemName]);
  } else if (state === 'done' && itemName === 'Exit') {
    g2.exit();
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
      g2.showPage(text, s.due_today > 0 ? ['Start Review'] : ['All done!']);
      break;
    }
    case 'question': {
      const c = currentCard;
      const label = c.deck ? `${c.deck}` : '';
      const text = label ? `${label}\n\n${c.front}` : c.front;
      g2.showPage(text, ['Reveal']);
      break;
    }
    case 'answer': {
      const c = currentCard;
      g2.showPage(c.back, ['Again', 'Hard', 'Good', 'Easy']);
      break;
    }
    case 'done': {
      g2.showPage(`All done! 🎉\n${reviewCount} cards reviewed`, ['Exit']);
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

  if (!statusEl) return; // not in browser

  // Hide all
  statusEl.classList.add('hidden');
  if (statsEl) statsEl.classList.add('hidden');
  cardArea.classList.add('hidden');
  doneEl.classList.add('hidden');

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
      const c = currentCard;
      cardArea.classList.remove('hidden');
      $('deck-info').textContent = c.deck || '';
      $('question').textContent = c.front;
      $('answer').textContent = c.back;
      $('answer').classList.remove('hidden');
      $('reveal-btn').classList.add('hidden');
      $('ratings').classList.remove('hidden');
      break;
    }
    case 'done':
      doneEl.classList.remove('hidden');
      $('done-count').textContent = reviewCount;
      break;
  }
}

// ─── Browser Event Handlers ────────────────────────────────────────
window.startReview = () => enterQuestion();
window.reveal = () => enterAnswer();
window.rate = (rating) => submitRating(rating);

document.addEventListener('keydown', (e) => {
  if (state === 'question' && (e.key === ' ' || e.key === 'Enter')) {
    enterAnswer();
  } else if (state === 'answer') {
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
    console.log('[SMRTi] Running in G2 mode');
  } else {
    console.log('[SMRTi] Running in browser mode');
  }

  await enterStats();
})();
