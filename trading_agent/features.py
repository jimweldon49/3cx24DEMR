from __future__ import annotations

import pandas as pd
import numpy as np


def _rsi(series: pd.Series, window: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(window=window).mean()
    loss = (-delta.clip(upper=0)).rolling(window=window).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def build_feature_frame(klines: pd.DataFrame) -> pd.DataFrame:
    df = klines.copy()
    df["ret_1"] = df["close"].pct_change(1)
    df["ret_3"] = df["close"].pct_change(3)
    df["ret_6"] = df["close"].pct_change(6)
    df["vol_zscore"] = (
        (df["volume"] - df["volume"].rolling(20).mean()) / df["volume"].rolling(20).std()
    )
    df["ma_fast"] = df["close"].rolling(9).mean()
    df["ma_slow"] = df["close"].rolling(21).mean()
    df["ma_ratio"] = df["ma_fast"] / df["ma_slow"]
    df["rsi_14"] = _rsi(df["close"], 14)
    df["hl_spread"] = (df["high"] - df["low"]) / df["close"]
    df["next_up"] = (df["close"].shift(-1) > df["close"]).astype(int)
    return df.dropna().reset_index(drop=True)
