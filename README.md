# SMRTi (स्मृति)

Spaced repetition flashcards for **Even Realities G2** smart glasses. Learn anything with FSRS v6-powered scheduling, displayed on your G2 HUD with R1 ring navigation.

Also works in a browser for testing without glasses.

## Architecture

```
┌─────────────┐     HTTP      ┌────────────────┐
│  Recall      │◄────────────►│  SMRTi WebView  │
│  Engine      │  :7890       │  (Even Hub SDK) │
│  (FSRS v6)   │              └───────┬─────────┘
│  50+ cards   │                      │ Bridge
└─────────────┘              ┌────────▼────────┐
                             │  Even App (G2)   │
                             │  Display + Ring  │
                             └─────────────────┘
```

- **Recall Engine** — Python backend with FSRS v6 scheduling. Syncs cards from Obsidian vault.
- **SMRTi** — WebView plugin loaded in Even App. Communicates with G2 display and R1 ring via Even Hub SDK.

## UX Flow (G2)

1. **Stats** — Cards due, total, retention %, streak → "Start Review"
2. **Question** — Card front displayed on HUD → Ring tap to "Reveal"
3. **Answer** — Card back displayed → Rate: Again / Hard / Good / Easy
4. **Done** — Session summary → Exit

## Setup

### 1. Start the Recall Engine

```bash
cd recall-engine
pip3 install -e .
python3 -m recall_engine.cli sync    # Scan Obsidian vault for cards
python3 -m recall_engine.cli serve   # Start API on port 7890
```

### 2. Start SMRTi

```bash
cd smrti
npm install
npm start                             # Serves on port 3000
```

### 3. Browser Testing

Open http://localhost:3000. Keyboard shortcuts: Space/Enter to reveal, 1-4 to rate.

### 4. G2 Glasses

Load SMRTi as an Even Hub plugin via the Even App (TestFlight build 602+).

## Card Format

Cards live in your Obsidian vault under `Recall/`. Each markdown file can contain multiple cards:

```markdown
---
type: recall-card
deck: languages
tags: [spanish, basics]
created: 2026-02-20
---

? la casa
= the house

? el libro
= the book
```

## Decks

| Deck | Cards | Description |
|------|-------|-------------|
| languages | 20 | Vocabulary (any language) |
| people | 20 | Names, roles, context |
| finance | 10 | Financial terms and concepts |

## API (Recall Engine)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/due` | GET | Next due card |
| `/review` | POST | Submit rating `{card_id, rating}` (1-4) |
| `/stats` | GET | Total, due, retention, streak |
| `/sync` | POST | Re-sync cards from Obsidian |

## G2 Display Layout (576×136px)

```
┌──────────────────────────────────────┐
│  Text: Question / Answer             │  y:4  h:90
│  (up to ~5 lines)                    │
├──────────────────────────────────────┤
│  List: [Again] [Hard] [Good] [Easy]  │  y:96 h:36
└──────────────────────────────────────┘
```

## Tech Stack

- **Even Hub SDK** v0.0.7 — G2 display, R1 ring input, device status
- **FSRS v6** — Free Spaced Repetition Scheduler (state of the art)
- **Express** — Local server for browser fallback
- **Obsidian** — Card source (plain markdown)

## License

MIT
