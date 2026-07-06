from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from sklearn.ensemble import RandomForestClassifier

from trading_agent.features import build_feature_frame

FEATURE_COLUMNS = [
    "ret_1",
    "ret_3",
    "ret_6",
    "vol_zscore",
    "ma_ratio",
    "rsi_14",
    "hl_spread",
]


@dataclass
class Signal:
    action: str
    confidence: float
    price: float


class PriceDirectionModel:
    def __init__(self, min_train_rows: int) -> None:
        self.min_train_rows = min_train_rows
        self._clf = RandomForestClassifier(
            n_estimators=200,
            random_state=7,
            class_weight="balanced_subsample",
            min_samples_leaf=3,
            n_jobs=1,
        )

    def infer_signal(self, klines: pd.DataFrame, confidence_threshold: float) -> Signal:
        feature_frame = build_feature_frame(klines)
        if len(feature_frame) < self.min_train_rows:
            latest_price = float(klines["close"].iloc[-1])
            return Signal(action="HOLD", confidence=0.0, price=latest_price)

        train = feature_frame.iloc[:-1]
        latest = feature_frame.iloc[-1:]
        x_train = train[FEATURE_COLUMNS]
        y_train = train["next_up"]
        if y_train.nunique() < 2:
            latest_price = float(klines["close"].iloc[-1])
            return Signal(action="HOLD", confidence=0.0, price=latest_price)
        self._clf.fit(x_train, y_train)

        latest_price = float(klines["close"].iloc[-1])
        prob_up = float(self._clf.predict_proba(latest[FEATURE_COLUMNS])[0][1])
        if prob_up >= confidence_threshold:
            return Signal(action="BUY", confidence=prob_up, price=latest_price)
        if (1.0 - prob_up) >= confidence_threshold:
            return Signal(action="SELL", confidence=1.0 - prob_up, price=latest_price)
        return Signal(action="HOLD", confidence=max(prob_up, 1.0 - prob_up), price=latest_price)
