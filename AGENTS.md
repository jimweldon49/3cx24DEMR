# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single Python CLI product: a Binance.US AI crypto trading agent (`main.py` runs an
infinite loop). There is no web UI, database, or test suite.

### Running the agent

- The virtualenv lives at `.venv/` (created by the startup update script). Run with
  `.venv/bin/python main.py`. Standard setup/run steps are in `README.md`.
- `main.py` runs an **infinite loop** with a `POLL_SECONDS` delay (default 60). When running it
  interactively for a quick check, override with a short interval and a timeout, e.g.
  `POLL_SECONDS=3 timeout 20 .venv/bin/python main.py`.
- A `.env` file is **optional** for paper trading: `Settings.load()` falls back to sane defaults
  via `os.getenv`, so the agent runs without one. `PAPER_TRADING` defaults to `true`.

### Non-obvious behavior

- Even in paper mode the agent makes **public (unauthenticated) network calls to Binance.US**
  (`get_symbol_info`, `get_klines`). No API keys are required for paper mode; keys are only needed
  when `PAPER_TRADING=false`. If those calls fail, check outbound access to `api.binance.us`.
- The AI signal is data-driven, so a fresh run may emit `BUY`, `SELL`, or `HOLD`. A `SELL` is
  skipped when the wallet holds no base asset (notional below `MIN_TRADE_USD`). To reliably
  demonstrate a paper trade executing, seed `paper_wallet_state.json` with a non-zero
  `base_balance` and/or lower `MODEL_CONFIDENCE_THRESHOLD`.
- Paper wallet state persists to `PAPER_STATE_FILE` (`paper_wallet_state.json`, gitignored).
  Delete it to reset simulated balances between runs.

### Lint / test / build

- No linter or test framework is configured. Use `.venv/bin/python -m py_compile main.py trading_agent/*.py`
  as a syntax smoke check.
