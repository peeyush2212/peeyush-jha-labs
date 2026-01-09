from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable

import httpx


@dataclass(frozen=True)
class SeriesDef:
    series_id: str
    name: str
    units: str
    frequency: str
    source: str
    description: str


# All series are **India-context** market/macro indicators.
# Data can be refreshed from FRED (CSV download link) but the app ships with a
# bundled offline snapshot so the UI works even without network.
SERIES_CATALOG: dict[str, SeriesDef] = {
    "DEXINUS": SeriesDef(
        series_id="DEXINUS",
        name="USD/INR spot (INR per 1 USD)",
        units="INR",
        frequency="Daily",
        source="FRED (series DEXINUS)",
        description="USD/INR spot exchange rate.",
    ),
    "INDIRLTLT01STM": SeriesDef(
        series_id="INDIRLTLT01STM",
        name="India 10Y govt bond yield",
        units="Percent",
        frequency="Monthly",
        source="FRED (series INDIRLTLT01STM; OECD MEI)",
        description="Long-term (10-year) government bond yield proxy.",
    ),
    "INDIR3TIB01STM": SeriesDef(
        series_id="INDIR3TIB01STM",
        name="India 3M interbank rate",
        units="Percent",
        frequency="Monthly",
        source="FRED (series INDIR3TIB01STM; OECD MEI)",
        description="Short-end rate proxy (3-month interbank).",
    ),
    "INDCPIALLMINMEI": SeriesDef(
        series_id="INDCPIALLMINMEI",
        name="India CPI index",
        units="Index",
        frequency="Monthly",
        source="FRED (series INDCPIALLMINMEI; OECD MEI)",
        description="Consumer price index (index level).",
    ),
}


def _macro_data_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "macro"


def bundled_path(series_id: str) -> Path:
    return _macro_data_dir() / "bundled" / f"{series_id}.csv"


def cache_path(series_id: str) -> Path:
    return _macro_data_dir() / "cache" / f"{series_id}.csv"


def _ensure_dirs() -> None:
    (_macro_data_dir() / "bundled").mkdir(parents=True, exist_ok=True)
    (_macro_data_dir() / "cache").mkdir(parents=True, exist_ok=True)


def parse_series_csv(path: Path, series_id: str) -> list[tuple[date, float]]:
    """Parse a FRED-style CSV file containing DATE and a single series column."""

    points: list[tuple[date, float]] = []
    if not path.exists():
        return points

    with path.open("r", newline="") as f:
        reader = csv.DictReader(f)
        if "DATE" not in (reader.fieldnames or []):
            return points

        # Column name is often the series id (but we fall back to 'value')
        value_col = series_id if series_id in (reader.fieldnames or []) else "value"
        for row in reader:
            raw_d = (row.get("DATE") or "").strip()
            raw_v = (row.get(value_col) or "").strip()
            if not raw_d:
                continue
            if not raw_v or raw_v == ".":
                continue
            try:
                d = date.fromisoformat(raw_d)
                v = float(raw_v)
            except Exception:
                continue
            points.append((d, v))

    points.sort(key=lambda x: x[0])
    return points


def latest_point(points: list[tuple[date, float]]) -> tuple[date, float] | None:
    if not points:
        return None
    return points[-1]


def load_series_points(series_id: str, *, prefer_cache: bool = True) -> list[tuple[date, float]]:
    """Load points from cache if available, otherwise bundled snapshot."""

    _ensure_dirs()

    if prefer_cache:
        cp = cache_path(series_id)
        pts = parse_series_csv(cp, series_id)
        if pts:
            return pts

    return parse_series_csv(bundled_path(series_id), series_id)


def list_series(prefer_cache: bool = True) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for sid, sdef in SERIES_CATALOG.items():
        pts = load_series_points(sid, prefer_cache=prefer_cache)
        lp = latest_point(pts)
        out.append(
            {
                "series_id": sid,
                "name": sdef.name,
                "units": sdef.units,
                "frequency": sdef.frequency,
                "source": sdef.source,
                "description": sdef.description,
                "last_date": lp[0] if lp else None,
                "last_value": lp[1] if lp else None,
            }
        )
    return out




def get_series_meta(series_id: str, *, prefer_cache: bool = True) -> dict[str, object] | None:
    """Return metadata for a single macro series.

    Notes
    -----
    The `series_id` here refers to the IDs used in `SERIES_CATALOG` (which match
    the underlying FRED series ids), e.g.:

    - ``DEXINUS`` (USD/INR)
    - ``INDIR3TIB01STM`` (India 3M interbank)
    - ``INDIRLTLT01STM`` (India 10Y)
    - ``INDCPIALLMINMEI`` (India CPI)

    The API uses these ids end-to-end so that the UI can request a specific
    series without needing an additional mapping layer.
    """

    sdef = SERIES_CATALOG.get(series_id)
    if not sdef:
        return None

    pts = load_series_points(series_id, prefer_cache=prefer_cache)
    lp = latest_point(pts)

    return {
        "series_id": series_id,
        "name": sdef.name,
        "units": sdef.units,
        "frequency": sdef.frequency,
        "source": sdef.source,
        "description": sdef.description,
        "last_date": lp[0] if lp else None,
        "last_value": lp[1] if lp else None,
    }


def get_series_points(series_id: str, *, prefer_cache: bool = True) -> list[dict[str, object]]:
    """Return a series as JSON-ready points for the API layer."""

    if series_id not in SERIES_CATALOG:
        return []
    pts = load_series_points(series_id, prefer_cache=prefer_cache)
    return [{"date": d, "value": v} for d, v in pts]

def month_key(d: date) -> tuple[int, int]:
    return (d.year, d.month)


def to_monthly_last(points: Iterable[tuple[date, float]]) -> dict[tuple[int, int], tuple[date, float]]:
    """Downsample (or normalize) into month buckets by taking the latest value within the month."""

    out: dict[tuple[int, int], tuple[date, float]] = {}
    for d, v in points:
        k = month_key(d)
        prev = out.get(k)
        if prev is None or d >= prev[0]:
            out[k] = (d, v)
    return out


def build_combined_timeline(months: int = 36, *, prefer_cache: bool = True) -> list[dict[str, object]]:
    """Return a monthly combined timeline for key India-context series."""

    months = max(6, min(120, int(months)))

    fx_pts = load_series_points("DEXINUS", prefer_cache=prefer_cache)
    r3_pts = load_series_points("INDIR3TIB01STM", prefer_cache=prefer_cache)
    y10_pts = load_series_points("INDIRLTLT01STM", prefer_cache=prefer_cache)
    cpi_pts = load_series_points("INDCPIALLMINMEI", prefer_cache=prefer_cache)

    fx_m = to_monthly_last(fx_pts)
    r3_m = to_monthly_last(r3_pts)
    y10_m = to_monthly_last(y10_pts)
    cpi_m = to_monthly_last(cpi_pts)

    # Determine latest month across the core series
    all_months = set(fx_m.keys()) | set(r3_m.keys()) | set(y10_m.keys()) | set(cpi_m.keys())
    if not all_months:
        return []
    latest_y, latest_mo = max(all_months)

    # Build months-back list
    months_list: list[tuple[int, int]] = []
    y, m = latest_y, latest_mo
    for _ in range(months):
        months_list.append((y, m))
        m -= 1
        if m == 0:
            y -= 1
            m = 12
    months_list.reverse()

    # Forward-fill values within the window
    last_fx: float | None = None
    last_r3: float | None = None
    last_y10: float | None = None
    last_cpi: float | None = None

    cpi_hist: dict[tuple[int, int], float] = {}
    out: list[dict[str, object]] = []
    for ym in months_list:
        fx = fx_m.get(ym)
        r3 = r3_m.get(ym)
        y10 = y10_m.get(ym)
        cpi = cpi_m.get(ym)

        if fx is not None:
            last_fx = fx[1]
        if r3 is not None:
            last_r3 = r3[1]
        if y10 is not None:
            last_y10 = y10[1]
        if cpi is not None:
            last_cpi = cpi[1]

        if last_cpi is not None:
            cpi_hist[ym] = last_cpi

        # CPI YoY from index level (if available)
        yoy: float | None = None
        if last_cpi is not None:
            y2, m2 = ym
            y2 -= 1
            cpi_12 = cpi_hist.get((y2, m2))
            if cpi_12 and cpi_12 > 0:
                yoy = (last_cpi / cpi_12 - 1.0) * 100.0

        # Curve slope in bps (10Y - 3M)
        slope: float | None = None
        if last_y10 is not None and last_r3 is not None:
            slope = (last_y10 - last_r3) * 100.0

        month_date = date(ym[0], ym[1], 1)
        out.append(
            {
                "month": month_date,
                "usdinr": last_fx,
                "rate_3m_pct": last_r3,
                "rate_10y_pct": last_y10,
                "cpi_index": last_cpi,
                "cpi_yoy_pct": yoy,
                "curve_slope_bps": slope,
            }
        )

    return out


def fred_download_url(series_id: str, *, cosd: date | None = None, coed: date | None = None) -> str:
    """Build a FRED CSV download URL.

    We intentionally use the graph CSV endpoint so we don't need an API key.
    """

    base = "https://fred.stlouisfed.org/graph/fredgraph.csv"
    params = [f"id={series_id}"]
    if cosd is not None:
        params.append(f"cosd={cosd.isoformat()}")
    if coed is not None:
        params.append(f"coed={coed.isoformat()}")
    return base + "?" + "&".join(params)


def refresh_from_fred(series_id: str, *, cosd: date | None = None, coed: date | None = None, timeout_s: float = 20.0) -> tuple[int, str]:
    """Fetch a series from FRED and cache it locally.

    Returns (rows_written, cache_path).
    """

    if series_id not in SERIES_CATALOG:
        raise ValueError(f"Unknown series_id: {series_id}")

    _ensure_dirs()
    url = fred_download_url(series_id, cosd=cosd, coed=coed)

    with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        content = r.text

    # Minimal validation
    if "DATE" not in content or series_id not in content:
        raise RuntimeError("Unexpected CSV payload")

    cp = cache_path(series_id)
    cp.write_text(content, encoding="utf-8")

    pts = parse_series_csv(cp, series_id)
    return (len(pts), str(cp))
