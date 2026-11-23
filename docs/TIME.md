# Station-Local Time Handling

1. All cyclical time features (`hour_sin`, `hour_cos`, `day_sin`, `day_cos`) are computed in station-local time.
2. Training telemetry was synthesized with naive timestamps that represent station-local time (e.g. evening peak at 18:00 in Mumbai).
3. The station time zone comes from the `stations` table (`stations.timezone`, default `"Asia/Kolkata"`), falling back to `DEFAULT_STATION_TIMEZONE`.
4. Timezone-aware timestamps (such as ISO strings with `Z` or UTC offset sent by browser clients) are converted to station-local time using Python `zoneinfo`.
5. Naive timestamps without timezone information (such as historical batch CSV logs) are treated as already station-local and preserved without alteration.
6. The `to_station_local` helper handles scalar `datetime` objects, ISO timestamp strings, and pandas `Series` / `DatetimeIndex`.
7. Both `/api/v1/predict` and `/api/v1/explain` endpoints resolve timestamps identically to maintain strict prediction and attribution parity.
8. Day of week boundaries are evaluated in station-local time (e.g. Saturday 20:00 UTC converts to Sunday 01:30 IST, yielding day 6).
9. Batch inference preserves naive CSV timestamps exactly so that evaluation metrics on historical local datasets remain unchanged.
10. The `/api/v1/predict` response exposes an optional `station_local_time` ISO field so clients can verify the local time used for forecasting.

---

## Model v2 Time System Specifications

### 1. Cyclical Diurnal and Weekly Features
Model v2 extracts four cyclical features in station-local time (`Asia/Kolkata`, UTC+05:30):
$$\text{hour\_sin} = \sin\left(\frac{2\pi \cdot \text{hour}}{24}\right), \quad \text{hour\_cos} = \cos\left(\frac{2\pi \cdot \text{hour}}{24}\right)$$
$$\text{day\_sin} = \sin\left(\frac{2\pi \cdot \text{day\_of\_week}}{7}\right), \quad \text{day\_cos} = \cos\left(\frac{2\pi \cdot \text{day\_of\_week}}{7}\right)$$
Evaluating these in station-local time aligns the model's trigonometric encodings with actual human behavior (e.g., peak evening commute occurs at 18:00 IST, not 12:30 UTC).

### 2. Hour-of-Week Table Lookup (`hour_of_week_mean.joblib`)
To compute the `load_anomaly` feature, the model looks up the historical expected load for the current time step from an empirical $7 \times 24 = 168$-cell table:
$$\text{load\_anomaly} = \text{load\_lag\_15m} - \text{HoW\_Mean}(\text{day\_of\_week}_{\text{local}}, \text{hour}_{\text{local}})$$
Because this lookup key is $(day_{\text{local}}, hour_{\text{local}})$, any timezone offset mismatch would cause the model to query an incorrect time slice (e.g., matching a midday load against a nighttime baseline). Station-local resolution guarantees accurate indexing.

### 3. Scenario Payloads (+05:30 IST)
In the Control Center, scenario presets (Nominal Midday, Evening Rush, Summer Heatwave, Monsoon Lull) specify canonical station-local times (e.g., `12:00` or `18:00`). To prevent browser timezone skew from corrupting these tests, scenario payloads explicitly append `+05:30` (e.g., `2026-11-20T12:00:00+05:30`). The backend converts this timestamp using `to_station_local()`, guaranteeing identical feature vector construction across any client environment.

### 4. Parity Between Batch and Live Inferences
- **Batch Analysis (`POST /api/v1/predict/batch`)**: Ingests CSVs containing naive or ISO timestamps. Naive timestamps are treated as station-local, preventing unwanted UTC shifts during bulk historical auditing.
- **Live Inferences (`POST /api/v1/predict` and `POST /api/v1/explain`)**: If a client submits a UTC timestamp (`Z`), the backend converts it to `Asia/Kolkata` before computing time features or querying the Hour-of-Week table, guaranteeing identical mathematical inputs across both endpoints.
