# CLAUDE.md — Word Quest v1.0

Single source of truth for AI agents (the Stratos Games Factory daemon, your own Claude Code session, subagents) and human contributors working in this repo. Humans should also read `README.md` and `BUILD_SPEC.md`.

## Project

**Word Quest v1.0** — vanilla HTML/CSS/JS word-search puzzle game, wrapped with Capacitor for iOS + Android, also publishable to web (Poki / CrazyGames). Part of the [Stratos Games Factory](https://github.com/sahilmodi1965/stratos-games-factory).

The game's product spec, visual design system, architecture, level pipeline, monetization, store-listing copy, and acceptance criteria all live in **[`BUILD_SPEC.md`](./BUILD_SPEC.md)** at repo root. **That document wins over your priors. When in doubt, prefer it.**

## Repo layout (target — see `BUILD_SPEC.md` §3.1 for the full tree)

- `index.html` — entry point
- `src/engine/` — `eventBus`, `state`, `storage`, `audio`, `haptics`, `scheduler`, `router`
- `src/screens/` — `splash`, `menu`, `game`, `levelComplete`, `categories`, `customMode`, `storyMode`, `dailyCheckIn`, `shop`, `settings`, `howToPlay`
- `src/game/` — `grid`, `selector`, `pillRenderer`, `validator`, `generator`, `powerups`, `colors`
- `src/data/` — `classicLevels.json`, `categories.json`, `storyChapters.json`, `strings.json`
- `assets/` — `img/`, `sfx/`, `music/`
- `capacitor.config.json` (added when Capacitor wrap lands)

The architectural hard rule: **gameplay code must run identically in a plain browser** (open `index.html`, drag, play). Capacitor / native APIs are optional enhancements behind feature detection. See `BUILD_SPEC.md` §2 ("Crucial rule").

## Autonomous mode (when invoked by the factory daemon)

You are running headless under `claude -p`. The daemon hands you one GitHub issue and expects a clean PR back. Skipping any phase below is how broken PRs happen. Don't.

### Phase 1 — Explore (mandatory before any write)

1. Read this file and **`BUILD_SPEC.md`** end-to-end. Re-read mid-task if you forget.
2. **Watch the reference videos in order — Project1.MOV → Project2.MOV → Project3.MOV → Project4.MOV.** They are linked from the top of `BUILD_SPEC.md` and hosted at the `reference-videos-v1` GitHub Release. **Mandatory** for any issue touching gameplay feel, drag responsiveness, animation timing, audio cues, or visual chrome (anything in `src/screens/`, `src/game/`, or `src/styles/`). The videos are the source of truth for behavior + feel that spec text can only approximate. Fetch with `gh release download reference-videos-v1 --repo mody-sahariar1/Word-Quest-v1.0` and watch end-to-end before writing code. **Do not commit the files** — they are in `.gitignore`. If a video reveals a conflict with the spec, **refuse the issue and flag the gap** (per Phase 2 below); do not silently amend `BUILD_SPEC.md` — that document is hard-excluded for a reason.
3. Read **at least 3 files in the subsystem you're about to touch** (or, if the subsystem doesn't exist yet, read the matching section of `BUILD_SPEC.md` plus equivalent files in Bloxplode-Beta if the issue says "1:1 mirror" of a BX feature).
4. Trace at least one call path end-to-end. Don't guess at how data flows.

### Phase 2 — Sanity-check the issue's premise

Issue authors are play-testers + product owners, not engineers. Their bodies often suggest implementation details that **don't match this codebase or `BUILD_SPEC.md`**. **Match the existing pattern + the spec, or refuse and explain.** Inventing a parallel system on top of the real one is never correct.

If the issue conflicts with `BUILD_SPEC.md`, the spec wins — flag the conflict in your refusal.

### Phase 3 — Implement the smallest possible change

- ONE focused commit per logical change. Conventional commits (`fix:`, `feat:`, `chore:`, `refactor:`, `level:`, `content:`, `perf:`, `style:`, `docs:`).
- **Every commit message must reference `#<issue-number>`** so it auto-links.
- Do not refactor unrelated code. Do not "improve" naming. Do not add docstrings/comments/types to code you didn't change.
- Do not bump dependencies (`package.json` / `package-lock.json`) unless the issue authorizes it.

### Phase 4 — Verify (mandatory before you stop)

1. Run the build / dev server (per `BUILD_SPEC.md` §2). If anything is red, fix it.
2. Run any test suites the issue or `npm run validate` defines. Same rule.
3. Run `git status` and `git diff --stat HEAD`. Verify every file is intentional. **Use targeted `git add <named-files>` — never `git add -A` or `git add .`.**

## Hard exclusions (never edit, never stage)

- `BUILD_SPEC.md` — product source of truth. Only humans amend the spec.
- `node_modules/**`, `dist/**`, `build/**`.
- `package.json` / `package-lock.json` — no dependency changes without explicit issue authorization.
- `capacitor.config.json` — Capacitor settings touched only via explicit issue.

## When to refuse (refusing is a successful outcome)

Stop, leave the working tree clean, and explain in your final paragraph if any of:

- The issue is ambiguous and you'd have to guess what "good" looks like.
- The issue's premise contradicts `BUILD_SPEC.md` and you can't find a fitting interpretation.
- The fix requires touching a forbidden path.
- The fix requires a change to `BUILD_SPEC.md` (needs human sign-off).
- You cannot make the build / tests pass after multiple attempts.

The daemon will turn your explanation into an issue comment so a human can refine the request. A clean refusal is far more useful than a broken PR.

## Final-step checklist

- [ ] Read `CLAUDE.md` and `BUILD_SPEC.md` at the start.
- [ ] Read at least 3 files in the relevant subsystem (or the matching spec section + reference files) before writing.
- [ ] Every commit references `#<issue-number>`.
- [ ] No unauthorized changes to `BUILD_SPEC.md`, `package.json`, or `capacitor.config.json`.
- [ ] Build / tests pass.
- [ ] `git diff --stat HEAD` shows only files you intentionally touched.
- [ ] Final response is a single paragraph summary. Nothing else.

You have a generous reasoning budget and as many tool turns as you need. Use them.

## Direct contributor mode (Shahariar, Sahil, anyone using their own Claude Code Pro)

- Push small content / CSS / level / copy fixes directly to `main`.
- Use feature branches for game mechanics or UI structure changes.
- `git pull --rebase origin main` before starting.
- Conventional commits, reference issue numbers when applicable.
- **Never delete `auto/*` branches manually** — the daemon owns them; the cleanup workflow sweeps them weekly.
- If CI fails after your push, fix immediately or `git revert HEAD && git push`.
