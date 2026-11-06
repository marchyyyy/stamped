# Stamped

Tonight's player props and team picks, checked against two sources and stamped only when they pass the rules.

- `index.html` — the app (a single page; installs to a phone home screen).
- `data.json` — today's verified data. Updated by scheduled runs several times a day. Never hand-edit a number.
- `icons/` — app icons.

Picks are for the current day only. Nothing here places a bet.

## NBA Live Intelligence (Paper)

NBA tab → **Live**. A separate section; the pregame Stamped picks and every existing rule are unchanged
(`live/test` checks the rule code against the `pre-live-v1` tag).

- `live/engine.js` — model, Monte Carlo simulation, pricing, selection rules, alerts, paper settlement. No DOM, no network.
- `live/espn.js` — ESPN adapter: normalizers plus the polling feed (rate limit, retries, backoff, dedup, stale detection).
- `live/ui.js`, `live/live.css` — the dashboard, game detail sheet, filters, alerts, paper record.
- `live/backtest.js` — historical replay; writes `live/backtest-results.json`, shown on the page.
- `live/test/` — automated tests (`node --test live/test`).

**How it runs.** While the page is open it polls ESPN directly from the browser (scoreboard 30 s, each live game's box score and play-by-play 20 s, DraftKings live odds via ESPN 30 s; 60 s when the tab is hidden). Nothing is written to `data.json`. Alerts fire only while the page is open.

**Model (live-1.2.0).** Pregame DraftKings total and spread set the baseline, centered so a pregame simulation lands on the line. Live scoring rate (points per minute) is blended with the pregame rate; live pace sets how the points arrive. Leads shrink slightly (comebacks, starters resting), Q4 blowouts slow down, and trailing teams foul late. 4,000 seeded possession-by-possession simulations per update give probabilities and 80% ranges for Q1–Q4, both halves and the full game, plus team totals. Q4 excludes overtime; 2H and full game include it. Completed periods show actual scores. Players: tonight's minutes and rates blended with their last 5 games from `data.json`, adjusted for fouls and blowouts.

**Selection.** Existing Stamped rules apply unchanged: −160 or worse is killed, +300 or longer is too long, and the edge over the no-vig price must be at least 3 points. Live-only rules: odds under 90 s old, feed not stale, scoreboard and box score agree, not inside the last 2:00 of Q4/OT, confidence Medium or better, and no edge above 10 points (against a live market that usually means missing information). Everything that passes is **Paper**: logged with sources, timestamps, model version and reasons, and graded at the final.

**Backtest.** `node live/backtest.js --days 21 --split 20261028` replays completed games from play-by-play, using only plays before each checkpoint. `--tune --grid '{"kRate":[48,192]}'` tunes on games before the split and reports on games after it. Downloads are cached in `live/.cache/` (gitignored).

**Limitations.**
- Only one live book (DraftKings via ESPN), and only full-game total, spread and moneyline. Quarter, half, team-total and live player-prop lines need a paid odds feed (The Odds API) plus a small proxy to keep the key private; until then those show projections and a "check a line from your book" calculator, with no edge claimed.
- Live data has one source (ESPN). The two-source rule cannot be met live, which is one reason live picks stay Paper.
- No historical live odds, so EV, closing line value and results after latency are not backtested. The paper record (per browser, in local storage) is the evidence going forward; treat picks as unvalidated until a few hundred settle with positive results.
- On 65 held-out games the model beats pregame-only totals from the end of Q1 on, and its win probabilities are reasonably calibrated, but quarter projections are no better than an even split of the pregame total.
- ESPN blocks headless browsers; normal browsers are fine.
