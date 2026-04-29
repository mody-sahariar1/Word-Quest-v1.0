# Word Search — Full Build Specification

**Target:** A production-quality HTML/CSS/JS word search puzzle game, wrapped with Capacitor for iOS + Android, also publishable to web (Poki / CrazyGames).
**Primary developer:** Shahariar @ Stratos Games, vibe-coding with Claude Opus 4.7 in Claude Code.
**Reference:** A widely-played mobile word search game (analyzed frame-by-frame from screen recordings). Design is generic to the genre; we're building our own assets, our own copy, and our own level packs. We do **not** clone proprietary art, branded categories (e.g. "Drake Songs", "Beyoncé Knowles"), or copyrighted icons.

This document is the single source of truth. When in doubt, prefer this spec over your priors. If something here conflicts with intuition, this doc wins — it was written from frame-by-frame video analysis of the live reference game.

---

## 0. How to read this spec

Every section is self-contained. You do not need to read top-to-bottom — Claude Code can be pointed at individual sections. But the **Architecture (§3)** and **Visual Design System (§4)** sections must be internalized before writing any UI code, because they encode dozens of small decisions that will otherwise drift.

Conventions:
- "Spec" = required behavior. Don't deviate without asking.
- "Suggest" = our preference but you have leeway.
- "**Better-than touch**" = an improvement over the reference game we're explicitly adding.
- Coordinates are `(row, col)` zero-indexed unless stated.
- Px values assume a 1640×2360 design canvas (matches reference screen-record resolution); use rem/% in actual code.

---

## 1. Game Overview

**Genre:** Word search puzzle. Players drag/swipe across a grid of letters to find theme-related words.

**Core loop (one level):**
1. Player sees a grid (4×4 to 8×8) of capital letters and a list of 3–8 themed words (e.g. theme "AT THE BEACH" → SAND, SHELL, SUN, TAN, YACHT).
2. Player presses on the first letter of a target word and drags through to the last letter. Words can be horizontal, vertical, diagonal, **and reversed in any of those directions** — 8 directions total.
3. On valid release: the cells get a colored "pill" highlight, the word gets struck through in the list, the progress counter increments, and a satisfying sound + haptic plays.
4. When all words are found: level complete screen → +25 coins → occasional power-up reward → "NEXT LEVEL" button.
5. Player advances. Difficulty (grid size, word count, word length, diagonals/reverses frequency) ramps gradually.

**Meta loop:**
- Coins accumulate; spent in Shop on extra power-ups, themes, hints, ad removal.
- Power-ups (3 types) are earned at level milestones and from daily check-in.
- Multiple modes: Classic (linear levels), Story Mode, Categories (themed packs), Custom (user-supplied words), Daily Check-In.
- Settings let users mute SFX, mute music, toggle haptics, toggle ads (toggle is paid-only — see §15).

**Session length target:** 90 seconds to 4 minutes per level. Commercial casual game pacing.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Vanilla HTML5 + CSS3 + ES2022 JS | No frameworks. Stays under 200KB gzipped, plays nicely with Capacitor & Poki. |
| Build | None initially. Plain `<script type="module">`. | Add Vite later only if needed. |
| Mobile wrap | Capacitor 6 | Existing Bloxplode pipeline. |
| Native plugins | `@capacitor/haptics`, `@capacitor/preferences` (storage), `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/app` | All optional — game must work in plain browser too. |
| Audio | Howler.js OR plain Web Audio API | Howler if multiple overlapping SFX get tricky. |
| Analytics | Firebase Analytics (post-MVP, via Capacitor plugin) | Per Stratos pipeline. |
| Ads | AppLovin MAX (post-MVP, via Ripon's native SDK) | Banner + interstitial + rewarded. |
| MMP | LinkRunner (post-MVP) | Per team decision. |

**Crucial rule:** All gameplay code must run identically in a plain browser (open `index.html`, drag, play). Capacitor / native APIs are optional enhancements behind feature detection.

```js
// Pattern used everywhere:
import { Haptics } from '@capacitor/haptics';
const hapticTick = () => {
  if (window.Capacitor?.isNativePlatform()) Haptics.selectionStart();
  // else no-op (or web-vibration fallback)
};
```

---

## 3. Architecture

This game inherits the proven Bloxplode pattern: **EventBus + Scheduler + screen routing + data-driven levels**. Do not invent a new architecture.

### 3.1 File layout

```
wordsearch/
├── index.html
├── manifest.webmanifest
├── capacitor.config.json
├── assets/
│   ├── img/          ← icons, banner ribbons, button frames (SVG preferred)
│   ├── sfx/          ← wav/mp3 sound effects
│   └── music/        ← optional bg music loops
├── src/
│   ├── main.js                  ← boot, screen router, splash
│   ├── engine/
│   │   ├── eventBus.js          ← pub/sub
│   │   ├── state.js             ← single source of truth (coins, level, powerups, settings, etc.)
│   │   ├── storage.js           ← localStorage / Capacitor Preferences abstraction
│   │   ├── audio.js             ← SFX + music manager
│   │   ├── haptics.js           ← haptic feedback wrapper
│   │   ├── scheduler.js         ← throttled VFX queue (re-use from Bloxplode)
│   │   └── router.js            ← screen show/hide, transitions
│   ├── screens/
│   │   ├── splash.js
│   │   ├── howToPlay.js
│   │   ├── menu.js              ← side drawer
│   │   ├── game.js              ← main puzzle screen
│   │   ├── levelComplete.js
│   │   ├── categories.js
│   │   ├── customMode.js
│   │   ├── storyMode.js
│   │   ├── dailyCheckIn.js
│   │   ├── shop.js
│   │   └── settings.js
│   ├── game/
│   │   ├── grid.js              ← grid model + DOM render
│   │   ├── selector.js          ← drag input → cell path
│   │   ├── pillRenderer.js      ← SVG pills for active drag + found words
│   │   ├── validator.js         ← path → word match check
│   │   ├── generator.js         ← word placement + filler fill
│   │   ├── powerups.js          ← wand / lightning / hint logic
│   │   └── colors.js            ← pastel palette cycle
│   └── data/
│       ├── classicLevels.json
│       ├── categories.json
│       ├── storyChapters.json
│       └── strings.json         ← all UI copy (i18n-ready)
└── styles/
    ├── tokens.css               ← CSS custom properties (colors, spacing, fonts)
    ├── base.css                 ← reset + body
    ├── screens.css              ← all screen layouts
    ├── game.css                 ← grid, pills, word list, top bar
    └── components.css           ← buttons, ribbons, modals, drawer
```

### 3.2 State model

One global state object, mutated only via reducer-style functions in `state.js`. EventBus publishes on every change so screens re-render. **Do not put state on DOM elements.**

```js
// state.js exports
export const state = {
  // Persistent
  coins: 200,                    // starts at 200
  classicLevel: 1,               // current level index in classic mode
  storyProgress: { chapter: 0, level: 0 },
  unlockedCategories: ['animals', 'food', 'nature'],  // free packs
  ownedCategories: [],            // purchased PLUS packs
  powerups: { wand: 0, lightning: 0, hint: 1 },  // start with 1 hint
  powerupTutorialsSeen: { wand: false, lightning: false, hint: false },
  settings: { sfx: true, music: true, haptics: true, adsEnabled: true },
  dailyCheckIn: { lastClaim: null, streak: 0 },
  hasSeenHowToPlay: false,

  // Transient (per-game, not persisted)
  currentLevel: null,            // { theme, words, grid, foundWords, ... }
  activeDrag: null,              // { startCell, currentCell, path }
};
```

`storage.js` saves the persistent slice (everything except `currentLevel` and `activeDrag`) on every change, debounced 300ms.

### 3.3 Routing

Single-page app. Each screen is a function exported from `screens/<name>.js` that takes a mount point and returns a teardown function. Router shows one at a time; transitions are CSS `opacity` + `transform: translateY(8px)` over 220ms.

```js
router.go('game', { mode: 'classic', level: 7 });
// internally: teardown current screen, mount 'game' with payload
```

Back-button (Android hardware) is wired via Capacitor's `App.addListener('backButton')` and routes to the previous screen or opens the menu drawer.

### 3.4 EventBus events (canonical names)

| Event | Payload | Emitter |
|---|---|---|
| `game:start` | `{ level }` | router on entering game screen |
| `drag:begin` | `{ cell }` | selector |
| `drag:move` | `{ path }` | selector |
| `drag:end` | `{ path, matched: word|null }` | selector |
| `word:found` | `{ word, color, path }` | validator |
| `word:rejected` | `{ path }` | validator (invalid drag) |
| `level:complete` | `{ level, coinsEarned, powerupsEarned }` | game |
| `coins:change` | `{ delta, total }` | state |
| `powerup:use` | `{ type }` | powerups |
| `powerup:earn` | `{ type, count }` | level complete handler |
| `settings:change` | `{ key, value }` | settings screen |

Subscribe defensively (always return an unsubscribe in the screen teardown).

---

## 4. Visual Design System

This section is design tokens. Every screen/component pulls from here.

### 4.1 Color tokens (`styles/tokens.css`)

```css
:root {
  /* Backgrounds */
  --bg-primary:        #1B3550;   /* deep navy — main bg */
  --bg-elevated:       #1F3D5C;   /* slightly lighter — cards on bg */
  --bg-overlay:        rgba(11, 22, 36, 0.78);  /* modal scrim */

  /* Game card */
  --card-bg:           linear-gradient(180deg, #FFFFFF 0%, #E8ECEF 100%);
  --card-radius:       28px;
  --card-shadow:       0 8px 24px rgba(0,0,0,0.25);

  /* Theme banner / list strip */
  --theme-banner-bg:   #1A6388;   /* dark teal-blue */
  --theme-banner-text: #FFFFFF;
  --wordlist-bg:       linear-gradient(180deg, #FFFFFF 0%, #E2E6EB 100%);
  --wordlist-text:     #1B3550;

  /* Top bar */
  --topbar-pill-bg:    #133048;       /* darker pill behind mode/level */
  --topbar-text:       #FFFFFF;
  --hamburger-bg:      #2BA1E2;       /* light blue square */
  --hamburger-icon:    #FFFFFF;

  /* Coin */
  --coin-gold:         #F2C73B;
  --coin-gold-dark:    #C49419;
  --coin-bg-pill:      #133048;

  /* Buttons */
  --btn-primary:       linear-gradient(180deg, #4ED068 0%, #2DAE49 100%);  /* green */
  --btn-primary-press: linear-gradient(180deg, #3CB857 0%, #1F8E3A 100%);
  --btn-add-coin:      linear-gradient(180deg, #4ED068 0%, #2DAE49 100%);
  --btn-disabled:      #6E8194;

  /* Progress bar */
  --progress-track:    #102A40;
  --progress-fill:     linear-gradient(180deg, #FFE17A 0%, #F2C73B 100%);
  --progress-glow:     0 0 6px rgba(242,199,59,0.6);

  /* Power-up buttons */
  --pwr-bg:            linear-gradient(180deg, #4FB7E8 0%, #2B8FC4 100%);
  --pwr-bg-press:      linear-gradient(180deg, #3FA0D0 0%, #1F75A8 100%);
  --pwr-badge:         #E84545;        /* red notification dot */
  --pwr-icon:          #FFFFFF;

  /* Ribbon (LEVEL N COMPLETE!) */
  --ribbon-gold:       linear-gradient(180deg, #FFD24D 0%, #E8A41A 100%);
  --ribbon-shadow:     #B26F00;
  --ribbon-text:       #8C2A12;        /* deep red-brown */

  /* Found-word pill palette — cycles through these in order */
  --pill-1: #BFA6F0;   /* lavender */
  --pill-2: #9CE0CC;   /* mint */
  --pill-3: #F4B8C7;   /* rose pink */
  --pill-4: #E8A977;   /* peach */
  --pill-5: #B8E07A;   /* lime */
  --pill-6: #87C7E8;   /* sky */
  --pill-7: #DDB8E0;   /* lilac */
  --pill-active: rgba(155, 220, 130, 0.55);  /* in-progress drag (semi-transparent green) */

  /* Letters */
  --letter-color:      #1A1A1A;       /* near-black */
  --letter-faded:      rgba(26,26,26,0.22);  /* magic-wand-removed fillers */

  /* Typography */
  --font-display:      'Fredoka', 'Baloo 2', system-ui, sans-serif;  /* rounded, bold */
  --font-body:         'Inter', system-ui, sans-serif;
  --font-mono:         'JetBrains Mono', monospace;  /* grid letters */
}
```

> **Pill palette use:** when a word is found, assign the next color in the cycle (mod 7). Persist the assignment for that level so re-renders match.

### 4.2 Typography scale

| Token | Size (mobile) | Weight | Use |
|---|---|---|---|
| `--fs-display-xl` | 44px | 800 | "LEVEL N COMPLETE!" ribbon |
| `--fs-display-l`  | 32px | 700 | "WORDS FOUND", "HOW TO PLAY" |
| `--fs-display-m`  | 22px | 700 | Theme name, modal titles |
| `--fs-letter`     | 36–44px | 700 | Grid letters (responsive to grid size) |
| `--fs-body-l`     | 18px | 600 | Word list entries, button labels |
| `--fs-body-m`     | 15px | 500 | Tooltips, level subtitle |
| `--fs-body-s`     | 13px | 500 | Coin count, badge numbers |

Use a single web-font family for display + body where possible. Suggest: **Fredoka** (Google Fonts, free, friendly rounded — close match to reference). Self-host the WOFF2 file so it works offline in Capacitor builds.

### 4.3 Spacing & shape

- Base unit: 4px
- Card border-radius: 28px (outer), 16px (inner cells), 9999px (pills, buttons)
- Touch targets: min 44×44px (iOS HIG); buttons usually 56–72px tall
- Safe area: respect `env(safe-area-inset-*)` on all four sides — particularly bottom for iPhones with home indicator

### 4.4 Shadows & elevation

- Card shadow: `0 8px 24px rgba(0,0,0,0.25)`
- Button shadow (resting): `0 4px 0 rgba(0,0,0,0.18)` (chunky stacked look)
- Button shadow (pressed): `0 1px 0 rgba(0,0,0,0.18)` + `transform: translateY(3px)`
- Modal shadow: `0 16px 48px rgba(0,0,0,0.45)`

### 4.5 Animation timing

| Action | Duration | Easing |
|---|---|---|
| Screen fade in/out | 220ms | ease-out |
| Pill draw (found word) | 320ms | cubic-bezier(0.34, 1.3, 0.64, 1) (slight overshoot) |
| Strikethrough draw | 260ms | ease-out |
| Coin counter tick | 600ms total, 30ms/digit | linear |
| Ribbon drop (level complete) | 480ms | cubic-bezier(0.5, 1.6, 0.5, 1) (bounce) |
| Button press | 90ms | ease-out |
| Drawer slide | 280ms | cubic-bezier(0.4, 0, 0.2, 1) |
| Letter "blow away" (wand) | 600ms stagger | ease-in |
| Hint shimmer | 1.2s loop | ease-in-out |

---

## 5. Screens — full specifications

### 5.1 Splash screen

**Trigger:** App launch. Shown once per cold start.

**Layout:**
- Full-screen `--bg-primary`
- Centered logo: "**WORD**" big, gold-gradient, with a coin replacing the "O". Below it "**SEARCH**" in a smaller dark pill.
- Subtle blurred letter shapes drifting in the background (see §11.4 for the parallax effect — **better-than touch**).
- Loading bar at bottom: 280px wide × 8px tall, `--progress-track` background, `--progress-fill` foreground, fills 0→100% over 1.0s as assets preload.

**Behavior:**
- Preload font, SFX, JSON data.
- Min display 1.0s (don't flash). Max 3.0s (timeout: route forward anyway).
- After splash → if `state.hasSeenHowToPlay === false`, route to `howToPlay` then `game` (level 1). Else route to last-played mode/level.

**Asset:** Logo as a single SVG file `assets/img/logo.svg`. Don't rasterize.

### 5.2 How to Play tutorial

**Trigger:** First launch only (or from Settings > Tutorial).

**Layout** (modal over a dimmed bg):
- Gold ribbon header: "**HOW TO PLAY**"
- Card 1: title "SWIPE TO FIND WORDS". Mini animated grid showing a finger dragging across letters that spell "WORD" — the drag pill animates from the start letter to end letter, looping every 2.5s.
- Card 2: title "SOME WORDS ARE REVERSED". Mini grid showing "DROW" being swiped (left-to-right) and revealing it's "WORD" backwards.
- Big green "**PLAY NOW!**" button at bottom.

**Behavior:**
- Tap PLAY NOW → set `hasSeenHowToPlay = true`, route to game level 1.
- The mini-grid animations use the same SVG pill renderer as the main game (don't make a separate animator).

**Better-than touch:** Add a third card "**TAP POWER-UPS WHEN STUCK**" with tiny animated icons of the wand/lightning/bulb — sets player expectation early so they're not confused when buttons appear at level 5+.

### 5.3 Game screen (the main puzzle screen)

This is the most important screen. Get it right.

#### 5.3.1 Layout (top to bottom)

```
┌─────────────────────────────────────────────┐
│ [≡]  CLASSIC      LEVEL 7      🪙 225 [+]   │  ← top bar (60px)
│      ████████████████░░░░░░░░░ 5/7          │  ← progress bar (44px)
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │                                       │  │
│  │   L  E  A  D  S  B                    │  │
│  │   H  Z  I  N  C  R                    │  │
│  │   A  K  O  R  H  Y                    │  │  ← grid card (square-ish)
│  │   R  W  I  C  E  D                    │  │
│  │   H  N  J  Z  E  C                    │  │
│  │   Q  G  L  A  S  S                    │  │
│  │   B  U  T  T  E  R                    │  │
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │         THINGS THAT MELT              │  │  ← theme banner
│  │  BUTTER  CHEESE  GLASS  ICE           │  │  ← word list
│  │       LEAD  SNOW  ZINC                │  │
│  └───────────────────────────────────────┘  │
│                                             │
│         [🪄1]    [⚡1]    [💡1]              │  ← power-up bar
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │           AD BANNER                   │  │  ← optional, only if ads on
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

#### 5.3.2 Top bar — detailed

- **Hamburger button**: 56×56 rounded square (12px radius), `--hamburger-bg`, three white horizontal bars (2px wide, 4px gap). Tap → open side drawer (§5.4).
- **Mode + level pill**: dark pill `--topbar-pill-bg`, rounded 9999px, height 44px. Two text labels split: left half is mode in white caps ("CLASSIC"), right half is "LEVEL N". White vertical separator at center.
- **Coin counter**: rounded pill, gold coin icon (28px) + count (e.g. "225") + small green "+" button (40×40). Tap "+" → Shop screen.

#### 5.3.3 Progress bar

- Track: full-width minus 16px side margin, 44px tall, `--progress-track` color, rounded ends.
- Fill: `--progress-fill` gradient. Width = `(foundCount / totalCount) * 100%`. Animate width changes over 320ms ease-out.
- Center label: white text "X/Y" — e.g. "5/7". Crossfade when value changes.
- **During an active drag**: replace the X/Y label with a pill containing the currently-dragged letters in caps, e.g. "BU", "BUT", "BUTT", "BUTTE", "BUTTER" — letters update on every cell entered. The pill has its own subtle border (1px white at 40% alpha) and matches the drag color (semi-transparent green by default).

> **Better-than touch:** Add a tiny sparkle (✨) particle that flies along the progress bar's filling edge each time a word is found. Reuse Bloxplode's Scheduler so we don't tank perf.

#### 5.3.4 Grid card

- White rounded card, `--card-radius` outer corners, `--card-shadow`.
- Inner padding: 4% of card width on all sides.
- Grid is laid out via CSS Grid: `display: grid; grid-template-columns: repeat(N, 1fr); aspect-ratio: N/M;` where N is columns and M is rows.
- Each cell is a `<div class="cell" data-row="r" data-col="c">` containing a `<span class="letter">`. Cell has `position: relative` so pills can absolutely position behind letters.
- Letter font: `--font-display`, `--fs-letter`, weight 700, color `--letter-color`.

**Sizing rules:**
- Grid card max-width: `min(92vw, 520px)`.
- Letters auto-shrink as grid grows: `font-size: clamp(22px, 5.5vw, 44px)`. Test at 4×4 (level 1, big letters), 6×6 (mid), 8×8 (late game, smaller).

#### 5.3.5 Word list card (theme card)

- Two-part: dark teal banner header (height 56px) with theme name centered in white caps, e.g. "**THINGS THAT MELT**". Banner has same 28px outer radius as card top.
- Body: white gradient `--wordlist-bg`, contains words wrapped in flex-wrap, centered, gap 16px horizontal & 8px vertical.
- Words: `--wordlist-text` color, font-display weight 600, `--fs-body-l`, padding 4px 12px, height 32px.
- **Found state**: a brief 600ms colored pill background (matching the grid pill color for that word) flashes behind the word, then fades to a strikethrough line. Strikethrough remains permanently. Don't keep the pill on word list — just the strikethrough.
- **Power-up "lightning" first-letter reveal**: the relevant word in the list gets a small colored circle (matching its assigned reveal-color) wrapped around just the first letter — e.g. <span style="background:lavender;border-radius:50%">T</span>ENT. The circle stays until the word is fully found.

#### 5.3.6 Power-up bar

- Three circular buttons in a horizontal row, 64px diameter, gap 32px between, centered horizontally, 16px below the word list.
- Each button: `--pwr-bg` gradient, drop shadow, white centered icon (28px SVG):
  - Wand: 🪄 (custom SVG: a wand with a star at the tip)
  - Lightning: ⚡ (custom SVG: a thunderbolt)
  - Bulb: 💡 (custom SVG: a lightbulb)
- Top-right corner: red badge `--pwr-badge` with white count text. Hide badge if count is 0 and grey out the button (`--btn-disabled`).
- Tap behavior: see §6.

**Visibility rules** (progressive unlock):
| Level reached | Buttons shown |
|---|---|
| 1–2 | None |
| 3–4 | Bulb only |
| 5–6 | Bulb + Lightning |
| 7+ | All three |

When a power-up is **first unlocked**, after the level-complete screen on the level *before* the unlock, show a tooltip on the next game screen pointing down at the button: "Tap to reveal the first letter of 3 random words!" (or analogous text). Tooltip is a dark rounded rectangle with a downward arrow. Tapping anywhere or the button dismisses it.

#### 5.3.7 Ad banner (optional)

- Bottom of screen, full-width, 50px tall (standard mobile banner size).
- Only renders if `state.settings.adsEnabled === true` AND we're on a real device (skip in browser dev).
- Implemented via AppLovin MAX plugin (post-MVP). For now, leave a `<div id="ad-banner-slot">` placeholder.

### 5.4 Side menu drawer

**Trigger:** Tap hamburger.

**Layout:**
- Slides in from the left, takes 70% of screen width (max 380px), full height.
- Background: `--bg-primary` (matches main bg).
- Backdrop: `--bg-overlay` covering the rest of the screen. Tap backdrop → close drawer.
- Vertical list of menu items, 64px tall each, with a 48×48 colorful icon on the left, big bold label.

**Items (in order):**

| # | Label | Icon | Route | Notes |
|---|---|---|---|---|
| 1 | CLASSIC | colorful dots circle | `game?mode=classic` | Active item highlighted in gold text. |
| 2 | STORY MODE | book with star | `storyMode` | |
| 3 | CATEGORIES | 4-square grid | `categories` | |
| 4 | CUSTOM | pencil | `customMode` | |
| 5 | DAILY CHECK IN | green check | `dailyCheckIn` | Shows red badge if today's reward unclaimed. |
| 6 | SHOP | storefront | `shop` | |
| 7 | SETTINGS | gear | `settings` | |
| 8 | ADVERTISEMENTS | (no icon) | toggle inline | Toggles `state.settings.adsEnabled`. |

The "ADVERTISEMENTS" toggle is a switch (not a route). When user tries to turn off ads, show a paywall: "Remove ads for $4.99" or "Watch 5 rewarded ads to remove ads for 24h" (copy is post-MVP).

### 5.5 Level Complete screen

**Trigger:** All words in current level found.

**Layout** (modal, takes full screen in front of dimmed game):
- Top: gold ribbon, "**LEVEL N COMPLETE!**", drops in with bounce animation.
- Middle: dark blue card titled "**WORDS FOUND**", listing all words in caps, 2 lines, comma-separated, e.g. "BEE, ROCKET, CLOUD, DUST, KITE, BIRD".
- Reward block: small gold "+25" pill with coin icon. Animates: coin icon flies from the pill toward the top-bar coin counter (500ms), counter ticks up.
- If a power-up is awarded: a small floating power-up icon appears (e.g. lightning bolt + "+1") with a subtle pulse.
- Big green "**NEXT LEVEL**" button at bottom.

**Behavior:**
- On mount: emit `coins:change { delta: +25 }`. If level milestone (every 5 levels for wand, every 3 for lightning, every 2 for hint — see §7.4), award power-up.
- "NEXT LEVEL" → increment `state.classicLevel`, route back to `game`.
- iOS: Apple Store rating prompt (`SKStoreReviewController`) may pop up here naturally; don't fight it. Wire via Capacitor's `@capacitor-community/in-app-review` plugin, call no more than once per 6 levels and never before level 5.

**Better-than touch:** Brief (1s) confetti burst from behind the ribbon. Cheap canvas-based confetti — keep particle count under 80.

### 5.6 Categories screen

**Header:** Dark teal bar, white back arrow on left, "CATEGORIES" title centered.

**Below header:**
- Search input: rounded pill, magnifying-glass icon button on the right.
- "SORT ALPHABETICALLY" button on the right with a tiny up-arrow indicator.

**Category cards** (vertical stack):
- Each card: 100% width, ~200px tall.
- Card header (color-coded): light blue for unlocked free packs (e.g. ANIMALS), purple gradient for premium PLUS packs.
- Header contents: 48×48 themed emoji/icon on left, big bold category name, "PLAY" or "PLUS" button on right.
- Card body (white, slight gradient): list of ≤5 sub-themes with chevron arrows on the right, each tappable.

**Free packs to ship at launch (no IP risk):**
ANIMALS, FOOD & DRINK, NATURE, AROUND THE HOUSE, SPORTS, BODY PARTS, COLORS, JOBS, WEATHER, MUSIC GENRES, TOOLS, KITCHEN, GARDEN, OFFICE, EMOTIONS, HOLIDAYS

**PLUS packs (paywalled, $1.99 each or $9.99 all-access):**
SCIENCE, GEOGRAPHY, MOVIES (no titles — types/genres only), MYTHOLOGY, HISTORY (eras, not people)

> **IP rule (firm):** Do NOT include packs of real celebrity names, song titles, branded products, or franchise content. The reference game's "Drake Songs"/"Beyoncé Knowles" packs are a publicity-rights and store-rejection risk. Stick to generic taxonomies. If we ever want a "Famous Scientists" pack, restrict to people deceased >70 years (Newton, Darwin, etc.) and consult before publishing.

**Sub-theme tap → game screen** with that sub-theme's word list. Each sub-theme is one level (no nested progression inside categories).

### 5.7 Custom mode

User enters their own theme + words; the generator builds a level on the fly.

**Layout:**
- Title "CUSTOM PUZZLE"
- Text input: theme name (max 40 chars)
- Text area: words list (one per line, or comma-separated, max 10 words, 3–10 letters each)
- Difficulty selector: Easy (4×4, no diagonals) / Medium (6×6, no reverses) / Hard (8×8, all directions)
- "GENERATE & PLAY" button

**Validation:**
- Reject words <3 chars or >10 chars
- Reject if total letter count > grid capacity × 0.7 (else generator may fail)
- Strip non-A-Z chars, uppercase everything

### 5.8 Story Mode

Levels grouped into "chapters" with a narrative theme (e.g. Chapter 1: "The Ocean Voyage" → 8 levels with sea/ship/fish themes).

**Layout:**
- Chapter list view: vertical scroll of chapter cards. Each card has a chapter image (illustrated), name, "X/8 levels" progress, and a star count showing 3-star ratings earned.
- Tap chapter → level select view with 8 numbered nodes connected by a path (think Candy-Crush-lite). Locked levels are greyed; unlocked have a star count.
- Tap a level node → game screen with that level's data.

**Star ratings (better-than touch):**
- 1 star: completed
- 2 stars: completed without using power-ups
- 3 stars: completed under target time (~90s for small grids, scales up)

Story Mode adds replayability vs the reference game's straight-Classic linearity. **Ship Classic + Categories + Custom in MVP; add Story Mode in Phase 2.**

### 5.9 Daily Check-In

**Layout:**
- Title "DAILY CHECK-IN"
- 7-day grid: each day shows a reward icon (coins + occasional power-up). Today is highlighted with a pulse.
- Streak counter at top: "Day X of 7"
- Big green "CLAIM!" button (only enabled if today's reward is unclaimed AND last claim was yesterday or earlier)
- Reset rule: missing a day resets streak to 1. (Soft option: allow "freeze" with watching a rewarded ad — Phase 2.)

**Reward schedule:**
| Day | Reward |
|---|---|
| 1 | +25 coins |
| 2 | +50 coins |
| 3 | +1 hint |
| 4 | +75 coins |
| 5 | +1 lightning |
| 6 | +100 coins |
| 7 | +1 wand + 200 coins (jackpot) |

### 5.10 Shop

**Layout:**
- Title "SHOP"
- Section: COINS — buy coins with real money
  - "100 coins — $0.99"
  - "500 coins + 50 bonus — $3.99"
  - "1500 coins + 300 bonus — $9.99"
- Section: POWER-UPS — buy with coins
  - 5× hints — 100 coins
  - 5× lightning — 200 coins
  - 5× wand — 300 coins
  - "Mega bundle" 10 of each — 800 coins
- Section: PREMIUM
  - Remove ads — $4.99
  - All categories unlock — $9.99
  - VIP bundle (no ads + all categories + 2000 coins) — $14.99

In-app purchases via Capacitor plugin (e.g. `@capacitor-community/in-app-purchases`). Stub for MVP.

### 5.11 Settings

Toggles: SFX, Music, Haptics, Show power-up tooltips.
Buttons: Restore Purchases, Replay How-to-Play tutorial, Privacy Policy (web link), Terms (web link), About (version + credits).
Reset progress button (with double-confirm modal): wipes localStorage. Useful for QA, hidden behind a 7-tap on the version number for production.

---

## 6. Game Mechanics — deep dive

### 6.1 Drag input (selector.js)

This is THE most critical interaction. Get it perfect.

**Inputs:** `pointerdown` / `pointermove` / `pointerup` on the grid card. Use Pointer Events API (works for touch, mouse, stylus).

**State machine:**

```
IDLE
  → on pointerdown over a cell: emit drag:begin, go to ACTIVE
ACTIVE
  → on pointermove: compute current cell from pointer position
                    validate path is straight from start in 1 of 8 directions
                    if valid: extend/shrink path, emit drag:move, redraw pill
                    if invalid: keep last valid path (don't break the line)
  → on pointerup: validate path against word list
                  if matches an unfound word: word:found, animate pill, lock cells
                  else: word:rejected, fade out drag pill (220ms)
                  go to IDLE
```

**"Path must be straight" rule:**
Given start `(r0, c0)` and current `(r1, c1)`, compute `dr = r1-r0`, `dc = c1-c0`. Path is valid if `dr == 0 || dc == 0 || abs(dr) == abs(dc)`. The implied direction is `(sign(dr), sign(dc))`. Cells along the path are `start + k*(sign_dr, sign_dc)` for k = 0..max(abs(dr), abs(dc)).

**Snapping:**
- The pointer position rarely lands exactly on a cell center. Use the cell whose **center is closest** to the pointer, weighted slightly toward staying on the current path (so a small wiggle doesn't jump direction).
- Once a direction is locked (path length ≥ 2), don't switch directions on tiny diagonal wobbles. Direction unlocks when user backs up to the start cell.

**Reversibility:**
- Dragging back along the same path shrinks the selection (like a snake retracting).
- Releasing on the start cell with path length 1 = no-op (no rejection animation).

**Live word check (better-than touch):**
- As user drags, check if the current path letters spell any **prefix** of an unfound word. If yes, the drag pill turns brighter green (full saturation, `rgba(155, 220, 130, 0.9)`). If no, dim it (50% alpha). This gives subtle "you're on the right track" feedback without cheating — the player still has to commit by lifting their finger.

**Mobile-specific:**
- `touch-action: none` on the grid to prevent scroll/zoom hijacking.
- Wrap the entire game screen in `user-select: none` and `-webkit-tap-highlight-color: transparent`.
- Pointer up MUST be wired with `setPointerCapture(e.pointerId)` so the user can drag *outside* the grid card and still have it tracked.

### 6.2 Pill rendering (pillRenderer.js)

**Two pill layers**, both inside the grid card:
1. **Active drag pill** (one at a time, behind letters). Color `--pill-active`. Updates on every drag:move.
2. **Found-word pills** (N pills, one per found word). Each has its own color from the palette.

**Implementation: SVG**, not CSS. Reasons:
- Need to draw a stadium/pill shape between two arbitrary cells (including diagonals).
- Need exact rounded ends.
- Need to handle overlaps cleanly (z-index per pill, semi-transparent fills).
- SVG scales perfectly with the responsive grid.

**Pill geometry:**
Each pill is a single `<path>` that traces a stadium between the start and end cell centers. Stadium = rectangle with two semicircular caps. Width perpendicular to drag direction = 0.78 × cell size.

```js
// Pseudocode — produce SVG path string
function pillPath(startXY, endXY, halfWidth) {
  const [sx, sy] = startXY, [ex, ey] = endXY;
  const dx = ex - sx, dy = ey - sy;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return circlePath(sx, sy, halfWidth);
  // unit perpendicular
  const px = -dy / len * halfWidth;
  const py = dx / len * halfWidth;
  // four corner points (before rounding)
  const p1 = [sx + px, sy + py];
  const p2 = [ex + px, ey + py];
  const p3 = [ex - px, ey - py];
  const p4 = [sx - px, sy - py];
  // M p1 → L p2 → arc with radius halfWidth to p3 → L p4 → arc to p1 close
  return `M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} A ${halfWidth} ${halfWidth} 0 0 1 ${p3[0]} ${p3[1]} L ${p4[0]} ${p4[1]} A ${halfWidth} ${halfWidth} 0 0 1 ${p1[0]} ${p1[1]} Z`;
}
```

The SVG layer is sized to match the grid exactly (`<svg viewBox="0 0 cols rows">`) using cell coordinates 0..cols, 0..rows. That way pill code stays in cell-space and CSS handles the actual pixel scaling.

**Found-word pill animation:**
- Pill draws from start cell center, expands toward the end cell center over 320ms (animate the SVG path's `d` via JS, or use a stroke-dashoffset trick on a thick line, or just animate the end-XY of the path with `requestAnimationFrame`).
- Alpha fades in from 0 → 0.55 over the same 320ms.
- After draw, no further animation — pill stays put for the rest of the level.

### 6.3 Word placement (generator.js)

This runs once per level (when the level is loaded from JSON or generated for Custom mode).

**Inputs:** target grid size `(rows, cols)`, list of words, allowed direction set (subset of 8).

**Algorithm:**

```js
function buildLevel(rows, cols, words, allowedDirs) {
  // Sort words longest-first — placing big words first leaves more room
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const grid = makeEmpty(rows, cols);   // null = empty
  const placements = [];                // {word, startRow, startCol, dir}

  for (const word of sorted) {
    if (!tryPlace(grid, word, allowedDirs, placements)) {
      // Could not place — for classic levels this means the level data is bad,
      // throw an error. For custom mode, retry with a bigger grid.
      throw new Error(`Cannot place ${word}`);
    }
  }

  // Fill remaining empties with random letters,
  // weighted to NOT accidentally form any word in the dictionary
  fillRandom(grid, words);

  return { grid, placements };
}

function tryPlace(grid, word, allowedDirs, placements) {
  const candidates = [];
  for (const dir of allowedDirs) {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (canPlace(grid, word, r, c, dir)) {
          candidates.push({ r, c, dir });
        }
      }
    }
  }
  if (candidates.length === 0) return false;
  // Prefer placements that overlap with existing letters (creates richer puzzles)
  candidates.sort((a, b) => overlapCount(grid, word, b) - overlapCount(grid, word, a));
  // Among top-tier overlaps, pick randomly to avoid same-feeling layouts
  const topTier = candidates.filter(c => overlapCount(grid, word, c) === overlapCount(grid, word, candidates[0]));
  const chosen = topTier[Math.floor(Math.random() * topTier.length)];
  applyPlacement(grid, word, chosen);
  placements.push({ word, ...chosen });
  return true;
}
```

**Direction set per difficulty:**
- Levels 1–3: H + V only (4 dirs counting reverses)
- Levels 4–9: H + V + diagonal-down-right + diagonal-down-left (no reverses) — 4 dirs
- Levels 10+: All 8 directions

**Filler letter strategy:**
Naive random A–Z gives accidental valid words sometimes. To minimize: when picking each filler, sample from a frequency-weighted English letter distribution (E,T,A,O,I,N,S... heavy) and reject if it accidentally completes a word from the level's word list when scanned in any direction. Cap retries at 5 — if no clean letter found, just take a random one (rare).

### 6.4 Validator (validator.js)

On `drag:end`, given the path's letter string, check if it matches any unfound word in `state.currentLevel.words`. Match must be **exact and full**, in either direction (so the user can drag W→O→R→D or D→R→O→W to find "WORD"). Update state, emit `word:found` or `word:rejected`.

```js
function validate(pathLetters, words, foundSet) {
  const candidate = pathLetters.join('');
  const reversed = pathLetters.slice().reverse().join('');
  for (const w of words) {
    if (foundSet.has(w)) continue;
    if (w === candidate || w === reversed) return w;
  }
  return null;
}
```

---

## 7. Power-ups (powerups.js)

### 7.1 Hint bulb 💡

**Function:** Reveal one random unfound word entirely.
**UX:** A pill is drawn across the word's cells (in a unique "hint" color, e.g. soft yellow `#FFE17A`), the word is struck through in the list, the foundCount increments by 1.
**Cost:** 1 hint.
**Reward eligibility:** awarded every 2 levels and from daily check-in.

### 7.2 Lightning ⚡

**Function:** Reveal the first letter of 3 random unfound words.
**UX:** Each chosen first-letter cell gets a small filled circle (40% alpha, color from pill palette) underneath the letter. The corresponding word in the list gets a circle around its first letter in the same color. Both stay until the player finds the word.
**Cost:** 1 lightning.
**Reward eligibility:** awarded every 3 levels.
**Tutorial first-show text:** "Tap to reveal the first letter of 3 random words!"

### 7.3 Magic wand 🪄

**Function:** Fade out half (rounded down) of the "filler" letters — letters that don't belong to any unfound word. The faded letters become unselectable (still visible at 22% alpha so the grid layout isn't jarring).
**UX:** All eligible filler cells fade simultaneously over 600ms with a subtle stagger (rand 0–150ms each), accompanied by a "whoosh" SFX.
**Cost:** 1 wand.
**Reward eligibility:** awarded every 5 levels.
**Tutorial first-show text:** "Tap to blow away half the filler letters!"

> **Implementation note:** A "filler letter" is a cell that is NOT part of any word's placement (including found words — once found, those cells should remain bright). Compute this from `placements` minus any `unfound` overlap.

### 7.4 Power-up unlock + reward schedule

| Level cleared | Reward |
|---|---|
| 1 | — |
| 2 | +1 hint |
| 3 | +1 lightning, **lightning UNLOCKS** (first-time tutorial pops on level 4 game screen) |
| 4 | — |
| 5 | +1 hint, +1 lightning |
| 6 | — |
| 7 | +1 wand, **wand UNLOCKS** (tutorial on level 8) |
| 8+ | hint every 2, lightning every 3, wand every 5 |

Tune by playtesting. The shape: ramp generosity early to teach the systems, throttle later to push purchases.

---

## 8. Level data structure

`data/classicLevels.json`:

```json
[
  {
    "id": 1,
    "theme": "LET'S EXPLORE",
    "rows": 4,
    "cols": 4,
    "words": ["FUN", "PLAY", "WIN"],
    "allowedDirs": ["H", "V", "D1"],
    "fixedGrid": null
  },
  {
    "id": 2,
    "theme": "COLORS",
    "rows": 5,
    "cols": 5,
    "words": ["RED", "BLUE", "PINK", "GOLD"],
    "allowedDirs": ["H", "V"],
    "fixedGrid": null
  },
  ...
]
```

Direction codes: `H` (horizontal L→R), `V` (vertical T→B), `D1` (diag down-right), `D2` (diag down-left), and add `R` suffix for reversed: `HR`, `VR`, `D1R`, `D2R`.

`fixedGrid`: optional 2D array of letters. If non-null, generator skips placement and uses this grid (for hand-tuned puzzles, e.g. tutorial level).

Ship 50 hand-curated classic levels at MVP. Themes should be varied: animals, food, jobs, weather, body parts, colors, sports, kitchen, music, tools, garden, beach, weather, holidays, emotions, etc. Word lists should be 3–8 words, 3–8 letters each.

`data/categories.json`: similar structure but grouped:

```json
{
  "animals": {
    "name": "Animals",
    "icon": "🐾",
    "color": "blue",
    "subThemes": [
      { "name": "Types of Cat", "words": ["TABBY", "PERSIAN", "SIAMESE", "MAINECOON", "RAGDOLL"] },
      { "name": "Types of Dog", "words": ["LABRADOR", "POODLE", "BEAGLE", "BULLDOG", "HUSKY"] },
      ...
    ]
  },
  "food": { ... }
}
```

---

## 9. Audio & Haptics

### 9.1 SFX list (all under 100KB total)

| File | When |
|---|---|
| `tick.wav` | Each new cell entered during drag (super short 30ms blip, pitch rises with path length) |
| `success.wav` | Word found (cheery 2-note chime) |
| `fail.wav` | Word rejected (soft thud) |
| `levelComplete.wav` | Level complete fanfare (1.5s) |
| `coin.wav` | Coin reward |
| `powerup.wav` | Power-up activated |
| `wand.wav` | Letters blowing away |
| `tap.wav` | Generic UI tap |
| `pop.wav` | Modal open |

Pitch rising on the tick gives the "you're building up" feel — load 8 versions (or one base sample + Web Audio's `playbackRate`).

### 9.2 Music (optional, off by default)

- `bgloop.mp3`: light, non-distracting puzzle-game loop. ~30s, seamless. Volume 0.4.
- Toggle in settings. Default OFF (mobile users overwhelmingly mute games).

### 9.3 Haptics

| Event | Native (iOS/Android) | Web fallback |
|---|---|---|
| Cell enter | `Haptics.selectionChanged()` | `navigator.vibrate(8)` |
| Word found | `Haptics.notificationSuccess()` | `vibrate([20, 40, 30])` |
| Word rejected | `Haptics.notificationWarning()` | `vibrate(40)` |
| Level complete | `Haptics.impactHeavy()` | `vibrate([30, 60, 30, 60, 100])` |
| Power-up | `Haptics.impactMedium()` | `vibrate(20)` |

Wrap behind `state.settings.haptics`.

---

## 10. Storage & Persistence

`storage.js` exposes:

```js
get(key)        // → JSON-parsed value, or null
set(key, value) // JSON-stringifies
remove(key)
clear()
```

Implementation: `Capacitor.Preferences` if available (survives app uninstall? no, but survives data clear better than localStorage on Android), else `window.localStorage`. Check at boot.

**Persisted keys:**
- `ws.coins` (number)
- `ws.classicLevel` (number)
- `ws.storyProgress` (object)
- `ws.unlockedCategories` (string[])
- `ws.ownedCategories` (string[])
- `ws.powerups` (object)
- `ws.powerupTutorialsSeen` (object)
- `ws.settings` (object)
- `ws.dailyCheckIn` (object)
- `ws.hasSeenHowToPlay` (bool)

Auto-save: subscribe to `coins:change`, `level:complete`, `settings:change`, `powerup:earn`, `powerup:use` and write the relevant slice. Debounce 300ms.

---

## 11. Better-than-the-reference touches

These are explicit improvements over the reference game. Build them.

1. **Live drag prefix feedback** (§6.1): drag pill brightens when path matches a word prefix.
2. **Sparkle on progress bar** (§5.3.3) when each word is found.
3. **Confetti on level complete** (§5.5).
4. **Subtle parallax letters** on the splash background — drifting, blurred giant letters in 4% alpha. Use a single `<canvas>` or even pure CSS `transform: translate3d` keyframes.
5. **Star-rating system in Story Mode** (§5.8) for replayability.
6. **3-card How-to-Play** (§5.2) including power-up preview card.
7. **Smarter filler letters** (§6.3) — frequency-weighted, no accidental words.
8. **Per-level color palette persistence**: re-entering a completed level shows the same colored pills it was completed with (small, but feels polished).
9. **Snake-tail-style drag retraction**: dragging backward shrinks the pill smoothly (not a hard cut).
10. **Theme-mode dark/light toggle** in Settings (Phase 2): keep the dark navy as default but offer a soft cream light theme. Niche request but loved by people who play in bed.
11. **Word definitions on tap** (Phase 2): after a level, tapping a found word in the list shows its dictionary definition. Educational, increases dwell time, and is a true differentiator for the parent audience.
12. **Accessibility**:
    - High-contrast mode toggle (cell pills become solid, letter contrast bumped to 21:1)
    - VoiceOver labels on every interactive element
    - Min font size override respected
    - Optional larger touch targets in settings

---

## 12. Phased build plan

### Phase 1 — Playable MVP (target 1 week)
- Splash, How-to-Play, Game screen, Level Complete
- Classic mode, levels 1–20 hand-authored
- Drag input + pill rendering + word validation
- Hint power-up only
- Coins counter (no shop yet)
- localStorage persistence
- SFX + haptics
- Side menu drawer (other items lead to "Coming Soon" placeholders)
- Plain browser only — no Capacitor yet

**Definition of done:** Open `index.html` on desktop and on a mobile browser, play 20 levels start-to-finish, all words findable, no jank.

### Phase 2 — Full feature set (target 2 weeks)
- All 3 power-ups + unlock schedule
- 50 classic levels
- Categories screen + 6 free packs (animals, food, nature, sports, kitchen, garden)
- Custom mode
- Daily check-in
- Settings screen with all toggles
- Shop screen UI (in-app purchases stubbed)
- Capacitor wrap, build for Android Studio + Xcode
- AppLovin MAX banner ads (handed off to Ripon for native compile)

### Phase 3 — Launch polish (target 1 week)
- Story Mode (Phase 2 better-than item)
- 5 PLUS category packs
- IAP wired
- Firebase Analytics events: `level_start`, `level_complete`, `level_fail`, `powerup_use`, `purchase`, `ad_impression`
- LinkRunner MMP integration
- ASO-optimized screenshots, app icon, store description (per Bloxplode pipeline)
- Full QA pass: 30 levels played on real iPhone + Android device

### Phase 4 — Post-launch
- Story Mode chapters 2 & 3
- Definitions feature (better-than item 11)
- Theme toggle (better-than item 10)
- Live-ops: weekly themed mini-events ("Halloween Words!" with limited-time pack)

---

## 13. Capacitor wrap

```bash
npm i -D @capacitor/cli @capacitor/core
npx cap init wordsearch com.stratos.wordsearch --web-dir=.
npx cap add ios
npx cap add android
npm i @capacitor/haptics @capacitor/preferences @capacitor/status-bar @capacitor/splash-screen @capacitor/app
```

`capacitor.config.json`:
```json
{
  "appId": "com.stratos.wordsearch",
  "appName": "Word Search",
  "webDir": ".",
  "server": { "androidScheme": "https" },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 1500,
      "backgroundColor": "#1B3550",
      "androidScaleType": "CENTER_CROP",
      "showSpinner": false
    },
    "StatusBar": { "style": "DARK", "backgroundColor": "#1B3550" }
  },
  "ios": { "contentInset": "always" },
  "android": { "allowMixedContent": false, "captureInput": true }
}
```

WebView quirks to watch for (recall the Bloxplode PNG transparency fix):
- Add `backface-visibility: hidden;` and `transform: translateZ(0);` on cells/pills if you see rendering glitches on Android WebView.
- Disable user-scalable in viewport: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`.
- Wrap audio init behind a first user gesture (mobile autoplay policy).

---

## 14. Asset checklist

Before you start coding, create or commission:
- App icon (1024×1024 master, all iOS + Android sizes)
- Splash screen (1284×2778 master + Android scaled)
- Logo SVG (for in-game splash)
- Hamburger icon SVG
- Coin icon SVG (gold with shine, recolorable via `<use>`)
- Power-up icons SVG: wand, lightning bolt, lightbulb
- Menu item icons SVG: classic-dots, story-book, categories-grid, custom-pencil, daily-check, shop-store, settings-gear
- Ribbon SVG (for level complete, supports stretching to fit text)
- Category cover icons (one per pack)

All icons should be solid SVGs (no rasters), in white where they'll be tinted via CSS `filter` or SVG `currentColor`. Lucide and Heroicons are reliable starting points but custom hand-drawn icons feel more premium for this genre — budget 1–2 days for an illustrator pass.

---

## 15. Monetization specifics

- **Banner ads**: 50px bottom strip, AppLovin MAX, served when `state.settings.adsEnabled === true`. Hide on Level Complete + tutorial screens.
- **Interstitial ads**: shown between levels (not every level — every 3rd level cap). Skip if user used a power-up that level (don't punish active players).
- **Rewarded ads**: opt-in. Watch ad → +1 hint. Place a "Watch ad for free hint!" CTA when user has 0 hints and taps the bulb.
- **IAP**: see §5.10 Shop. Use Capacitor IAP plugin; stub for MVP.
- **Remove ads**: $4.99 one-time. Sets `settings.adsEnabled = false` permanently.

---

## 16. Definition of "done" — MVP shipping bar

- [ ] Plays end-to-end in plain Chrome on a 6.1" iPhone simulator with no console errors
- [ ] Plays end-to-end after `npx cap run ios` and `npx cap run android` on real devices
- [ ] All 20 classic levels solvable; no impossible word placements
- [ ] Drag input feels responsive — no perceptible lag, no missed taps near cell edges
- [ ] Found word pills render correctly for H, V, both diagonals, and reversed for each
- [ ] Two adjacent words sharing a letter render correctly (overlapping pills with proper z-ordering)
- [ ] Coins persist across app close/reopen
- [ ] Settings (sfx/music/haptics) persist and take effect immediately
- [ ] No text overflow on the smallest supported device (iPhone SE, 1334×750)
- [ ] App size under 15 MB installed
- [ ] Cold launch under 2.5s on a mid-tier Android (Pixel 4a baseline)
- [ ] Crash-free rate >99.5% in first 100 sessions

---

## 17. Things to ASK Shahariar before coding

If anything in this spec is ambiguous, surface it before writing code. Common ones likely to come up:
1. Final game name? "Word Search" is generic — Stratos likely wants something brandable for ASO (e.g. "Word Search Explorer" per planning docs).
2. Bundle ID — confirm `com.stratos.wordsearch` is correct for both stores.
3. Apple Developer team ID (Sahil manages this).
4. Whether to ship Story Mode in MVP or defer to Phase 2 (recommended: defer).
5. Confirm the 7 free + 5 PLUS category split — Shahariar may want different cuts based on competitor research from AppMagic.
6. Initial coin balance (200 in reference; we should match unless there's a reason).

---

End of spec.
