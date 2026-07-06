# Binance.US AI Crypto Trading Agent (Starter)

Lightweight Python trading agent for Binance.US with:

- Environment-variable API credentials (no hardcoded secrets)
- AI signal generation (Random Forest on recent candle features)
- Safety defaults (paper trading is enabled by default)
- Configurable risk controls (`MAX_USD_PER_TRADE`, confidence threshold, min trade)

## Important Safety Notes

- This code is educational starter code, not financial advice.
- Keep `PAPER_TRADING=true` while validating behavior.
- Never paste API keys into chat, source files, or commits.
- Use a restricted Binance.US API key (spot trading only, no withdrawal permission).

## 1) Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:

- Add your Binance.US credentials
- Keep `PAPER_TRADING=true` first
- Tune trade/risk settings

## 2) Run

```bash
python main.py
```

## 3) Live Trading (Only After Testing)

When you are confident after paper-trading checks:

1. Set `PAPER_TRADING=false` in `.env`
2. Confirm key permissions on Binance.US
3. Start with a very small `MAX_USD_PER_TRADE`

## Configuration Reference

| Variable | Purpose | Default |
|---|---|---|
| `BINANCE_API_KEY` | Binance.US API key | empty |
| `BINANCE_API_SECRET` | Binance.US API secret | empty |
| `SYMBOL` | Trading pair | `BTCUSDT` |
| `INTERVAL` | Candle interval | `1m` |
| `LOOKBACK_CANDLES` | Candles per cycle | `300` |
| `POLL_SECONDS` | Loop delay | `60` |
| `PAPER_TRADING` | Paper mode toggle | `true` |
| `MAX_USD_PER_TRADE` | Max quote per trade | `25` |
| `MIN_TRADE_USD` | Skip tiny orders | `10` |
| `MODEL_CONFIDENCE_THRESHOLD` | Buy/sell threshold | `0.58` |
| `MIN_TRAIN_ROWS` | Min rows before modeling | `120` |
| `PAPER_STARTING_QUOTE_BALANCE` | Simulated quote funds | `1000` |
| `PAPER_STATE_FILE` | Paper wallet persistence file | `paper_wallet_state.json` |

## Project Structure

- `main.py` — runtime loop and trade execution
- `trading_agent/config.py` — environment config + validation
- `trading_agent/binance_gateway.py` — Binance.US market/account/order API calls
- `trading_agent/features.py` — feature engineering for model input
- `trading_agent/model.py` — AI signal model
- `trading_agent/paper_wallet.py` — persistent paper-trading wallet
