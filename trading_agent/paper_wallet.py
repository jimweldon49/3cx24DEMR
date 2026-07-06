from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class PaperWalletState:
    base_balance: float
    quote_balance: float


class PaperWallet:
    def __init__(self, state_file: str, starting_quote_balance: float) -> None:
        self.path = Path(state_file)
        self.state = self._load_or_init(starting_quote_balance)

    def _load_or_init(self, starting_quote_balance: float) -> PaperWalletState:
        if self.path.exists():
            with self.path.open("r", encoding="utf-8") as file:
                data = json.load(file)
            return PaperWalletState(
                base_balance=float(data["base_balance"]),
                quote_balance=float(data["quote_balance"]),
            )
        state = PaperWalletState(base_balance=0.0, quote_balance=starting_quote_balance)
        self._save(state)
        return state

    def _save(self, state: PaperWalletState) -> None:
        with self.path.open("w", encoding="utf-8") as file:
            json.dump(asdict(state), file, indent=2)

    def buy(self, price: float, quote_amount: float) -> dict:
        if quote_amount > self.state.quote_balance:
            raise ValueError("Insufficient paper quote balance.")
        qty = quote_amount / price
        self.state.base_balance += qty
        self.state.quote_balance -= quote_amount
        self._save(self.state)
        return {
            "mode": "paper",
            "side": "BUY",
            "price": price,
            "quantity": qty,
            "quote_spent": quote_amount,
        }

    def sell(self, price: float, qty: float) -> dict:
        if qty > self.state.base_balance:
            raise ValueError("Insufficient paper base balance.")
        quote_received = qty * price
        self.state.base_balance -= qty
        self.state.quote_balance += quote_received
        self._save(self.state)
        return {
            "mode": "paper",
            "side": "SELL",
            "price": price,
            "quantity": qty,
            "quote_received": quote_received,
        }
