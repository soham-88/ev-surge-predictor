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
