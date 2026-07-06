from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

KNOWN_QUOTES = ("USDT", "USD", "USDC", "BUSD", "BTC", "ETH")


def _parse_bool(value: str, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_int(value: str, default: int) -> int:
    if value is None or value == "":
        return default
    return int(value)


def _parse_float(value: str, default: float) -> float:
    if value is None or value == "":
        return default
    return float(value)


def _split_symbol(symbol: str) -> tuple[str, str]:
    for quote in KNOWN_QUOTES:
        if symbol.endswith(quote):
            return symbol[: -len(quote)], quote
    raise ValueError(
        f"Could not infer base/quote assets from symbol '{symbol}'. "
        f"Use a symbol ending in one of {KNOWN_QUOTES}."
    )


@dataclass(frozen=True)
class Settings:
    api_key: str
    api_secret: str
    symbol: str
    interval: str
    lookback_candles: int
    poll_seconds: int
    paper_trading: bool
    max_usd_per_trade: float
    min_trade_usd: float
    model_confidence_threshold: float
    min_train_rows: int
    paper_starting_quote_balance: float
    paper_state_file: str
    base_asset: str
    quote_asset: str

    @classmethod
    def load(cls) -> "Settings":
        load_dotenv()
        symbol = os.getenv("SYMBOL", "BTCUSDT").upper().strip()
        base_asset, quote_asset = _split_symbol(symbol)
        settings = cls(
            api_key=os.getenv("BINANCE_API_KEY", "").strip(),
            api_secret=os.getenv("BINANCE_API_SECRET", "").strip(),
            symbol=symbol,
            interval=os.getenv("INTERVAL", "1m").strip(),
            lookback_candles=_parse_int(os.getenv("LOOKBACK_CANDLES"), 300),
            poll_seconds=_parse_int(os.getenv("POLL_SECONDS"), 60),
            paper_trading=_parse_bool(os.getenv("PAPER_TRADING"), True),
            max_usd_per_trade=_parse_float(os.getenv("MAX_USD_PER_TRADE"), 25.0),
            min_trade_usd=_parse_float(os.getenv("MIN_TRADE_USD"), 10.0),
            model_confidence_threshold=_parse_float(
                os.getenv("MODEL_CONFIDENCE_THRESHOLD"), 0.58
            ),
            min_train_rows=_parse_int(os.getenv("MIN_TRAIN_ROWS"), 120),
            paper_starting_quote_balance=_parse_float(
                os.getenv("PAPER_STARTING_QUOTE_BALANCE"), 1000.0
            ),
            paper_state_file=os.getenv("PAPER_STATE_FILE", "paper_wallet_state.json"),
            base_asset=base_asset,
            quote_asset=quote_asset,
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if self.max_usd_per_trade <= 0:
            raise ValueError("MAX_USD_PER_TRADE must be > 0.")
        if self.min_trade_usd <= 0:
            raise ValueError("MIN_TRADE_USD must be > 0.")
        if self.min_trade_usd > self.max_usd_per_trade:
            raise ValueError("MIN_TRADE_USD cannot exceed MAX_USD_PER_TRADE.")
        if not 0 < self.model_confidence_threshold < 1:
            raise ValueError("MODEL_CONFIDENCE_THRESHOLD must be in (0, 1).")
        if self.lookback_candles < 100:
            raise ValueError("LOOKBACK_CANDLES should be >= 100 for stable features.")
        if self.min_train_rows < 50:
            raise ValueError("MIN_TRAIN_ROWS should be >= 50.")
        if not self.paper_trading and (not self.api_key or not self.api_secret):
            raise ValueError(
                "Live trading requires BINANCE_API_KEY and BINANCE_API_SECRET."
            )
