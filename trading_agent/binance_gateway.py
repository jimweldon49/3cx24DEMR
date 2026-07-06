from __future__ import annotations

from decimal import Decimal, ROUND_DOWN

import pandas as pd
from binance.client import Client
from binance.exceptions import BinanceAPIException

from trading_agent.config import Settings


class BinanceUSGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = Client(
            api_key=settings.api_key,
            api_secret=settings.api_secret,
            tld="us",
        )
        self._symbol_filters = self._load_symbol_filters(settings.symbol)

    def fetch_klines(self) -> pd.DataFrame:
        raw = self.client.get_klines(
            symbol=self.settings.symbol,
            interval=self.settings.interval,
            limit=self.settings.lookback_candles,
        )
        frame = pd.DataFrame(
            raw,
            columns=[
                "open_time",
                "open",
                "high",
                "low",
                "close",
                "volume",
                "close_time",
                "quote_volume",
                "trade_count",
                "taker_buy_base",
                "taker_buy_quote",
                "ignore",
            ],
        )
        for col in ("open", "high", "low", "close", "volume"):
            frame[col] = frame[col].astype(float)
        return frame

    def get_free_balance(self, asset: str) -> float:
        try:
            info = self.client.get_asset_balance(asset=asset)
            if not info:
                return 0.0
            return float(info.get("free", 0.0))
        except BinanceAPIException:
            return 0.0

    def place_market_buy(self, usd_amount: float, reference_price: float | None = None) -> dict:
        price = reference_price or float(self.fetch_klines()["close"].iloc[-1])
        qty = usd_amount / price
        qty = self._quantize_qty(qty)
        if qty * price < self._symbol_filters["min_notional"]:
            raise ValueError("Order notional below exchange minimum notional.")
        return self.client.create_order(
            symbol=self.settings.symbol,
            side=Client.SIDE_BUY,
            type=Client.ORDER_TYPE_MARKET,
            quantity=qty,
        )

    def place_market_sell(self, qty: float, reference_price: float | None = None) -> dict:
        qty = self._quantize_qty(qty)
        price = reference_price or float(self.fetch_klines()["close"].iloc[-1])
        if qty * price < self._symbol_filters["min_notional"]:
            raise ValueError("Order notional below exchange minimum notional.")
        return self.client.create_order(
            symbol=self.settings.symbol,
            side=Client.SIDE_SELL,
            type=Client.ORDER_TYPE_MARKET,
            quantity=qty,
        )

    def _load_symbol_filters(self, symbol: str) -> dict:
        exchange_info = self.client.get_symbol_info(symbol)
        if not exchange_info:
            raise ValueError(f"Symbol '{symbol}' not found on Binance.US.")
        filters = {f["filterType"]: f for f in exchange_info["filters"]}
        return {
            "step_size": float(filters["LOT_SIZE"]["stepSize"]),
            "min_qty": float(filters["LOT_SIZE"]["minQty"]),
            "min_notional": float(
                filters.get("MIN_NOTIONAL", {}).get("minNotional", "0.0")
            ),
        }

    def _quantize_qty(self, qty: float) -> float:
        step = Decimal(str(self._symbol_filters["step_size"]))
        if step == 0:
            return qty
        quantized = (Decimal(str(qty)) / step).to_integral_value(
            rounding=ROUND_DOWN
        ) * step
        result = float(quantized)
        if result < self._symbol_filters["min_qty"]:
            raise ValueError("Order quantity below exchange minimum quantity.")
        return result
