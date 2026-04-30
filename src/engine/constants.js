// Shared constants for the engine layer.
// Single source of truth for storage keys + canonical event names.
// Per BUILD_SPEC.md §3.4 (events) and §10 (storage); issue #3 rule 6.

// Storage key. Versioned so a future schema change can bump to v2 + migrate.
export const STORAGE_KEY = 'wordquest:state:v1';

// Debounce window for save() — per BUILD_SPEC.md §3.2 + §10.
export const SAVE_DEBOUNCE_MS = 300;

// Canonical EventBus event names — BUILD_SPEC.md §3.4.
// Defined now even though most are emitted by future game/UI layers,
// so all emitters/subscribers reference one source.
export const EVENTS = {
  // Engine layer (G1 — emitted now)
  STATE_CHANGE: 'state:change',
  STORAGE_LOADED: 'storage:loaded',

  // Router lifecycle — added in #4. Not in §3.4's table; the issue mandates
  // them and §3.4 is silent on screen lifecycle, so we extend the canonical
  // table here. Spec gap surfaced via observation routing (#8).
  SCREEN_ENTER: 'screen:enter',
  SCREEN_EXIT: 'screen:exit',

  // Grid lifecycle — added in #5. §3.4 silent on grid lifecycle; issue
  // body mandates `grid:ready` after renderGrid mounts. Spec gap routed
  // via #8 along with the screen:* additions from #4.
  GRID_READY: 'grid:ready',

  // Level lifecycle — added in #16. §3.4 silent on level:ready; issue
  // body mandates emit after generator runs so downstream consumers
  // (validator, HUD, theme banner) can subscribe to the same event.
  // Spec gap routed via #8 along with the earlier engine extensions.
  LEVEL_READY: 'level:ready',

  // Game/UI layers — placeholders, emitted in later issues (#4+)
  GAME_START: 'game:start',
  DRAG_BEGIN: 'drag:begin',
  DRAG_MOVE: 'drag:move',
  DRAG_END: 'drag:end',
  WORD_FOUND: 'word:found',
  WORD_REJECTED: 'word:rejected',
  LEVEL_COMPLETE: 'level:complete',
  COINS_CHANGE: 'coins:change',
  POWERUP_USE: 'powerup:use',
  POWERUP_EARN: 'powerup:earn',
  SETTINGS_CHANGE: 'settings:change',
};

// Canonical screen names — BUILD_SPEC.md §3.1.
// All 11 listed up front so subsequent screen issues don't have to amend
// this table; index.html only mounts the three needed for G1 boot.
export const SCREENS = {
  SPLASH: 'splash',
  HOW_TO_PLAY: 'howToPlay',
  MENU: 'menu',
  GAME: 'game',
  LEVEL_COMPLETE: 'levelComplete',
  CATEGORIES: 'categories',
  CUSTOM_MODE: 'customMode',
  STORY_MODE: 'storyMode',
  DAILY_CHECK_IN: 'dailyCheckIn',
  SHOP: 'shop',
  SETTINGS: 'settings',
};

// Persistent state keys (BUILD_SPEC.md §3.2 first block).
// Storage saves these; transient keys (currentLevel, activeDrag) are excluded.
export const PERSISTENT_KEYS = [
  'coins',
  'classicLevel',
  'storyProgress',
  'unlockedCategories',
  'ownedCategories',
  'powerups',
  'powerupTutorialsSeen',
  'settings',
  'dailyCheckIn',
  'hasSeenHowToPlay',
];
