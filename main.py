from __future__ import annotations

import logging
import time
from typing import Optional

from trading_agent.binance_gateway import BinanceUSGateway
from trading_agent.config import Settings
from trading_agent.model import PriceDirectionModel, Signal
from trading_agent.paper_wallet import PaperWallet


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("binance-us-agent")


def _compute_buy_size(settings: Settings, quote_balance: float) -> float:
    return min(settings.max_usd_per_trade, quote_balance)


def _compute_sell_size(settings: Settings, base_balance: float, price: float) -> float:
    max_base_for_trade = settings.max_usd_per_trade / price
    return min(base_balance, max_base_for_trade)


def _log_wallet_snapshot(settings: Settings, quote_balance: float, base_balance: float) -> None:
    logger.info(
        "Balances | %s=%.6f | %s=%.2f",
        settings.base_asset,
        base_balance,
        settings.quote_asset,
        quote_balance,
    )


def _execute_signal(
    signal: Signal,
    gateway: BinanceUSGateway,
    settings: Settings,
    paper_wallet: Optional[PaperWallet],
) -> None:
    if settings.paper_trading:
        assert paper_wallet is not None
        quote_balance = paper_wallet.state.quote_balance
        base_balance = paper_wallet.state.base_balance
    else:
        quote_balance = gateway.get_free_balance(settings.quote_asset)
        base_balance = gateway.get_free_balance(settings.base_asset)

    _log_wallet_snapshot(settings, quote_balance, base_balance)
    logger.info(
        "Signal | action=%s confidence=%.3f price=%.2f",
        signal.action,
        signal.confidence,
        signal.price,
    )

    if signal.action == "BUY":
        buy_usd = _compute_buy_size(settings, quote_balance)
        if buy_usd < settings.min_trade_usd:
            logger.info("Skip BUY: trade size %.2f < MIN_TRADE_USD", buy_usd)
            return
        if settings.paper_trading:
            order = paper_wallet.buy(price=signal.price, quote_amount=buy_usd)
        else:
            order = gateway.place_market_buy(
                usd_amount=buy_usd,
                reference_price=signal.price,
            )
        logger.info("Executed BUY order: %s", order)
        return

    if signal.action == "SELL":
        sell_qty = _compute_sell_size(settings, base_balance, signal.price)
        sell_notional = sell_qty * signal.price
        if sell_notional < settings.min_trade_usd:
            logger.info("Skip SELL: notional %.2f < MIN_TRADE_USD", sell_notional)
            return
        if settings.paper_trading:
            order = paper_wallet.sell(price=signal.price, qty=sell_qty)
        else:
            order = gateway.place_market_sell(
                qty=sell_qty,
                reference_price=signal.price,
            )
        logger.info("Executed SELL order: %s", order)
        return

    logger.info("HOLD: no trade executed.")


def run() -> None:
    settings = Settings.load()
    logger.info(
        "Starting agent for %s interval=%s mode=%s",
        settings.symbol,
        settings.interval,
        "paper" if settings.paper_trading else "live",
    )
    if settings.paper_trading:
        logger.warning("Paper trading mode is ON. No real orders will be submitted.")
    else:
        logger.warning("Live trading mode is ON. Real orders can be submitted.")

    gateway = BinanceUSGateway(settings)
    paper_wallet = (
        PaperWallet(
            state_file=settings.paper_state_file,
            starting_quote_balance=settings.paper_starting_quote_balance,
        )
        if settings.paper_trading
        else None
    )
    model = PriceDirectionModel(min_train_rows=settings.min_train_rows)

    while True:
        try:
            klines = gateway.fetch_klines()
            signal = model.infer_signal(
                klines=klines,
                confidence_threshold=settings.model_confidence_threshold,
            )
            _execute_signal(
                signal=signal,
                gateway=gateway,
                settings=settings,
                paper_wallet=paper_wallet,
            )
        except Exception as exc:
            logger.exception("Agent loop error: %s", exc)

        time.sleep(settings.poll_seconds)


if __name__ == "__main__":
    run()
