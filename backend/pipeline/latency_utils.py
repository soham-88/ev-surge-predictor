"""
Shared latency measurement utility for model benchmarking and training pipelines.

Standardized protocol:
  - Single sample (N=1)
  - 10 warm-up passes
  - 100 timed iterations
  - Returns MEDIAN latency in ms rounded to 2 decimal places.
"""

from __future__ import annotations

import time
from typing import Callable, Any
import numpy as np


def measure_inference_latency(
    predict_fn: Callable[[Any], Any],
    sample: Any,
    n_warmup: int = 10,
    n_iterations: int = 100,
) -> float:
    """Run standardized single-sample inference latency benchmark.

    Args:
        predict_fn: Callable that runs inference on a single sample.
        sample: Single sample input (shape with batch dimension 1).
        n_warmup: Number of un-timed warm-up iterations.
        n_iterations: Number of timed iterations.

    Returns:
        Median inference latency in milliseconds, rounded to 2 decimal places.
    """
    # 1. Warm-up passes
    for _ in range(n_warmup):
        predict_fn(sample)

    # 2. Timed iterations
    latencies_ms: list[float] = []
    for _ in range(n_iterations):
        t0 = time.perf_counter()
        predict_fn(sample)
        t1 = time.perf_counter()
        latencies_ms.append((t1 - t0) * 1000)

    median_ms = float(np.median(latencies_ms))
    return round(median_ms, 2)
