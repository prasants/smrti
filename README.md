# SMRTi (स्मृति) v1.1

Spaced repetition flashcards for **Even Realities G2** smart glasses. Learn anything with FSRS v6-powered scheduling, displayed on your G2 HUD with R1 ring navigation.

Also works in a browser for testing without glasses.

## What's New in v1.1

### ☀ Ambient Mode
Instead of dedicated review sessions, push a single card at intervals throughout the day. Perfect for passive learning.

- Toggle from the stats screen
- Shows ONE card → think → tap to reveal → rate
- Card disappears, next appears after configurable interval (default: 15 min)
- Between cards: minimal "next in Xm" display
- Persists across reloads via localStorage

### 📋 Pre-Meeting Prep
Before meetings, surface contact cards for attendees from your people deck.

- Automatically detects meetings within 2 hours via Google Calendar
- Shows a banner on the stats screen: "Meeting in Xm: [title]"
- Tap to cycle through attendee cards (name, role, key facts)
- Uses `gog` CLI for calendar + Recall Engine people deck for contact cards

## Architecture

```
┌─────────────┐     HTTP      ┌────────────────┐
│  Recall      │◄────────────►│  SMRTi WebView  │
│  Engine      │  :7890       │  (Even Hub SDK) │
│  (FSRS v6)   │              └───────┬─────────┘
│  50+ cards   │                      │ Bridge
└─────────────┘              ┌────────▼────────┐
   ▲                         │  Even App (G2)   │
   │ /cards                  │  Display + Ring  │
   │                         └─────────────────┘
┌──┴────────────┐
│  SMRTi Server  │──► gog CLI ──► Google Calendar
│  :3000         │
└────────────────┘
```

## UX Flow

### Standard Review (G2)
1. **Stats** — Cards due, retention %, streak → "Start Review" / "Ambient Mode"
2. **Question** — Card front on HUD → Ring tap to "Reveal"
3. **Answer** — Card back → Rate: Again / Hard / Good / Easy
4. **Done** — Session summary

### Ambient Mode
1. Enable from stats screen
2. Single card appears → think → tap reveal → rate
3. Wait period (configurable, default 15m) → next card
4. Persists across reloads

### Pre-Meeting Prep
1. Meeting detected within 30 minutes → banner on stats
2. Tap "Prep: [title]" → cycle through attendee contact cards
3. Return to stats when done

## Setup

### 1. Start the Recall Engine

```bash
cd recall-engine
pip3 install -e .
python3 -m recall_engine.cli sync
python3 -m recall_engine.cli serve   # Port 7890
```

### 2. Start SMRTi

```bash
cd smrti
npm install
npm start                             # Port 3000
```

### 3. Browser Testing

Open http://localhost:3000. Keyboard: Space/Enter to reveal, 1-4 to rate.

### 4. G2 Glasses

Load SMRTi as an Even Hub plugin via the Even App.

## API

### Recall Engine (:7890)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/due` | GET | Next due card |
| `/review` | POST | Submit rating `{card_id, rating}` (1-4) |
| `/stats` | GET | Total, due, retention, streak |
| `/sync` | POST | Re-sync cards from Obsidian |
| `/cards` | GET | Search cards `?deck=&search=` |

### SMRTi Server (:3000)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/meetings` | GET | Upcoming meetings with attendees |

## G2 Display Layout (576×136px)

```
┌──────────────────────────────────────┐
│  Text: Question / Answer / Card      │  y:4  h:90
│  (up to ~5 lines)                    │
├──────────────────────────────────────┤
│  List: [Action] [Options]            │  y:96 h:36
└──────────────────────────────────────┘
```

## License

MIT
