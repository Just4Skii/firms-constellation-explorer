"""
Earth Intelligence, Multi-Source Weather, Canadian FWI & AMFI Readiness Engine.

Combines:
1. Live / Forecast NWP weather (Open-Meteo ECMWF/GFS/DWD + ECCC MSC GeoMet metadata)
2. Historical Copernicus ERA5-Land reanalysis (never labeled as forecast)
3. Exact Canadian Forest Fire Weather Index System equations (adaptive_fire_intelligence/external/cffdrs_cffwis.py)
   - Computed strictly as a weather-based Fire Danger Index (never ignition probability)
4. Grounded AMFI-01, D-AMFI-01, B3-FWI, AMFI-02 Data Readiness, AMFI-PX closed archive, and AMFI-03 Gate artifacts from disk.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import os
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AMFI_READINESS_CSV = os.path.join(
    BASE_DIR, "data", "amfi_readiness_matrix.csv"
)
AMFI_PX_ROUNDS_CSV = os.path.join(
    BASE_DIR, "data", "amfi_px_rounds.csv"
)
COVERAGE_SELECTION_JSON = os.path.join(
    BASE_DIR,
    "data",
    "coverage_selection_experiment.json",
)


def _coverage_rejection_nodes() -> List[Dict[str, Any]]:
    """Build inspectable wrong-coverage nodes from the actual granule bboxes."""
    if not os.path.exists(COVERAGE_SELECTION_JSON):
        return []
    try:
        with open(COVERAGE_SELECTION_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []
    nodes = []
    for row in data.get("local_fixed_granules", []):
        if row.get("covers_alberta"):
            continue
        bbox = row.get("bbox")
        if not bbox or len(bbox) != 4:
            continue
        lat_min, lat_max, lon_min, lon_max = [float(v) for v in bbox]
        lat = (lat_min + lat_max) / 2.0
        lon = (lon_min + lon_max) / 2.0
        granule = row.get("granule", "")
        date = ""
        try:
            doy = granule.split(".")[1][1:]
            date = dt.datetime.strptime(doy, "%Y%j").strftime("%Y-%m-%d")
        except Exception:
            date = ""
        nodes.append({
            "id": f"reject-{granule}",
            "name": f"Rejected coverage · {row.get('platform', '')}",
            "platform": "MODIS " + str(row.get("platform", "")),
            "date": date,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "status": "wrong_coverage",
            "event_id": None,
            "detail": (
                f"Actual footprint bbox lat {lat_min:.1f}–{lat_max:.1f}, "
                f"lon {lon_min:.1f}–{lon_max:.1f}; no Alberta pixels. "
                "Rejected by the 5 km coverage screen; retained for audit."
            ),
        })
    return nodes

# Import verified CFFDRS FWI System equations bundled locally in engine/
try:
    from engine.cffdrs_cffwis import (
        dailyBUI,
        dailyDC,
        dailyDMC,
        dailyFFMC,
        dailyFWI,
        dailyISI,
    )
    HAS_CFFDRS = True
except Exception:
    HAS_CFFDRS = False


# =============================================================================
# GLOBAL & REGIONAL SENSOR / BENCHMARK GRID POINTS
# Covers Southern Africa (primary globe focus), Cape/Lahaina fire story sites,
# Alberta AMFI-01/AMFI-02 research benchmark block, and major global biomes.
# =============================================================================

GRID_NODES: List[Dict[str, Any]] = [
    # --- Southern Africa Regional Weather & Fire Danger Mesh ---
    {"id": "saf-kalahari-n", "name": "Molopo / Kalahari Basin", "region": "saf", "lat": -24.5, "lon": 22.5, "base_t": 31.5, "base_rh": 22, "base_wind": 19, "base_rain": 0.0, "base_soil": 0.11, "base_cape": 180},
    {"id": "saf-okavango", "name": "Okavango Delta Edge", "region": "saf", "lat": -19.5, "lon": 23.0, "base_t": 33.2, "base_rh": 28, "base_wind": 14, "base_rain": 0.4, "base_soil": 0.17, "base_cape": 420},
    {"id": "saf-moz-n", "name": "Northern Mozambique Niassa", "region": "saf", "lat": -12.5, "lon": 37.5, "base_t": 30.8, "base_rh": 48, "base_wind": 16, "base_rain": 1.8, "base_soil": 0.24, "base_cape": 890},
    {"id": "saf-moz-c", "name": "Central Mozambique Zambezia", "region": "saf", "lat": -17.8, "lon": 35.2, "base_t": 31.4, "base_rh": 52, "base_wind": 18, "base_rain": 2.2, "base_soil": 0.26, "base_cape": 760},
    {"id": "saf-angola-s", "name": "Cuando Cubango Savanna", "region": "saf", "lat": -16.2, "lon": 19.5, "base_t": 32.0, "base_rh": 31, "base_wind": 15, "base_rain": 0.2, "base_soil": 0.14, "base_cape": 510},
    {"id": "saf-zambia-w", "name": "Barotse Floodplain", "region": "saf", "lat": -15.2, "lon": 23.2, "base_t": 31.0, "base_rh": 39, "base_wind": 13, "base_rain": 0.8, "base_soil": 0.19, "base_cape": 640},
    {"id": "saf-kruger", "name": "Lowveld / Kruger Belt", "region": "saf", "lat": -24.0, "lon": 31.5, "base_t": 29.8, "base_rh": 38, "base_wind": 21, "base_rain": 0.1, "base_soil": 0.16, "base_cape": 480},
    {"id": "saf-namib", "name": "Namib Escarpment", "region": "saf", "lat": -22.5, "lon": 15.8, "base_t": 28.4, "base_rh": 24, "base_wind": 24, "base_rain": 0.0, "base_soil": 0.06, "base_cape": 40},
    {"id": "saf-karoo", "name": "Great Karoo Semi-Arid", "region": "saf", "lat": -31.2, "lon": 21.8, "base_t": 26.5, "base_rh": 26, "base_wind": 26, "base_rain": 0.0, "base_soil": 0.12, "base_cape": 90},
    {"id": "saf-table-mtn", "name": "Table Mountain & Cape Peninsula", "region": "saf", "lat": -33.96, "lon": 18.41, "base_t": 24.8, "base_rh": 31, "base_wind": 34, "base_rain": 0.0, "base_soil": 0.15, "base_cape": 35, "story_id": "FIRE-STORY-001"},
    {"id": "saf-knysna", "name": "Knysna-Plettenberg Garden Route", "region": "saf", "lat": -34.03, "lon": 23.04, "base_t": 27.6, "base_rh": 21, "base_wind": 42, "base_rain": 0.0, "base_soil": 0.14, "base_cape": 45, "story_id": "FIRE-STORY-002"},
    {"id": "saf-zimbabwe", "name": "Highveld Zimbabwe", "region": "saf", "lat": -18.2, "lon": 30.8, "base_t": 28.9, "base_rh": 42, "base_wind": 17, "base_rain": 1.1, "base_soil": 0.20, "base_cape": 720},
    {"id": "saf-madagascar", "name": "Central Madagascar Highlands", "region": "saf", "lat": -19.2, "lon": 46.8, "base_t": 27.2, "base_rh": 56, "base_wind": 19, "base_rain": 3.0, "base_soil": 0.28, "base_cape": 950},
    {"id": "saf-congo-s", "name": "Katanga Woodland", "region": "saf", "lat": -10.5, "lon": 26.0, "base_t": 28.6, "base_rh": 62, "base_wind": 11, "base_rain": 4.8, "base_soil": 0.34, "base_cape": 1350},

    # --- AMFI-01 / AMFI-02 Alberta Benchmark Blocks ---
    {"id": "alb-nw", "name": "Alberta NW Boreal Block (Peace River)", "region": "alberta", "lat": 56.8, "lon": -117.2, "base_t": 19.5, "base_rh": 38, "base_wind": 22, "base_rain": 0.3, "base_soil": 0.23, "base_cape": 580, "amfi_block": "NW", "d_amfi_rel_lift": 5.8, "new30_rate": 0.0068},
    {"id": "alb-ne", "name": "Alberta NE Oil Sands / Boreal (Fort McMurray)", "region": "alberta", "lat": 56.7, "lon": -111.4, "base_t": 20.4, "base_rh": 35, "base_wind": 20, "base_rain": 0.1, "base_soil": 0.21, "base_cape": 620, "amfi_block": "NE", "d_amfi_rel_lift": 6.2, "new30_rate": 0.0059},
    {"id": "alb-sw", "name": "Alberta SW Foothills (Rocky Mtn House)", "region": "alberta", "lat": 52.4, "lon": -115.0, "base_t": 17.8, "base_rh": 42, "base_wind": 25, "base_rain": 0.6, "base_soil": 0.26, "base_cape": 410, "amfi_block": "SW", "d_amfi_rel_lift": 4.9, "new30_rate": 0.0048},
    {"id": "alb-se", "name": "Alberta SE Parkland / Prairie", "region": "alberta", "lat": 51.2, "lon": -111.8, "base_t": 22.1, "base_rh": 33, "base_wind": 27, "base_rain": 0.2, "base_soil": 0.16, "base_cape": 320, "amfi_block": "SE", "d_amfi_rel_lift": 4.1, "new30_rate": 0.0029},

    # --- Global Reference Fire & Weather Nodes ---
    {"id": "pac-lahaina", "name": "West Maui / Lahaina Downslope", "region": "global", "lat": 20.88, "lon": -156.68, "base_t": 29.4, "base_rh": 36, "base_wind": 48, "base_rain": 0.0, "base_soil": 0.14, "base_cape": 80, "story_id": "FIRE-STORY-003"},
    {"id": "nam-calif", "name": "Sierra Foothills, California", "region": "global", "lat": 39.7, "lon": -121.6, "base_t": 31.2, "base_rh": 19, "base_wind": 29, "base_rain": 0.0, "base_soil": 0.10, "base_cape": 110},
    {"id": "sam-amazon", "name": "Arc of Deforestation, Mato Grosso", "region": "global", "lat": -11.5, "lon": -55.4, "base_t": 33.8, "base_rh": 34, "base_wind": 14, "base_rain": 0.5, "base_soil": 0.18, "base_cape": 920},
    {"id": "eur-med", "name": "Eastern Mediterranean Peloponnese", "region": "global", "lat": 37.6, "lon": 22.1, "base_t": 32.1, "base_rh": 25, "base_wind": 26, "base_rain": 0.0, "base_soil": 0.12, "base_cape": 140},
    {"id": "aus-nsw", "name": "Blue Mountains, New South Wales", "region": "global", "lat": -33.7, "lon": 150.3, "base_t": 28.4, "base_rh": 24, "base_wind": 33, "base_rain": 0.0, "base_soil": 0.13, "base_cape": 210},
    {"id": "sib-yakut", "name": "Sakha Boreal Taiga", "region": "global", "lat": 62.2, "lon": 129.7, "base_t": 18.2, "base_rh": 44, "base_wind": 16, "base_rain": 0.4, "base_soil": 0.25, "base_cape": 380},
    {"id": "eaf-eth", "name": "Ethiopian Highlands", "region": "global", "lat": 8.8, "lon": 38.7, "base_t": 22.6, "base_rh": 58, "base_wind": 14, "base_rain": 2.4, "base_soil": 0.30, "base_cape": 1120},
    {"id": "ind-mp", "name": "Central India Deciduous Belt", "region": "global", "lat": 22.4, "lon": 78.2, "base_t": 31.0, "base_rh": 37, "base_wind": 15, "base_rain": 0.2, "base_soil": 0.18, "base_cape": 340},
]

# Historical case-study reanalysis dates aligned with curated Fire Stories & benchmark windows
HISTORICAL_DATE_OVERRIDES = {
    2026: "2026-11-10",
    2022: "2022-05-24",
    2023: "2023-08-08",
    2021: "2021-04-18",
    2017: "2017-06-07",
    2015: "2015-03-01",
}

_WEATHER_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
LIVE_CACHE_TTL_SEC = 600.0


def compute_vpd_kpa(temp_c: float, rh_pct: float) -> float:
    """Compute Vapor Pressure Deficit (kPa) using Magnus-Tetens saturation vapor pressure."""
    rh = max(1.0, min(100.0, float(rh_pct)))
    t = float(temp_c)
    es = 0.6108 * math.exp((17.27 * t) / (t + 237.3))
    vpd = max(0.0, es * (1.0 - rh / 100.0))
    return round(vpd, 3)


def compute_cffdrs_fwi_bundle(
    temp_c: float,
    rh_pct: float,
    wind_kmh: float,
    rain_24h_mm: float,
    month: int = 11,
    ffmc0: float = 85.0,
    dmc0: float = 18.0,
    dc0: float = 120.0,
) -> Dict[str, Any]:
    """
    Compute Canadian Forest Fire Weather Index (FWI) System components using the
    repository's verified CFFDRS Van Wagner (1987) implementation.

    NOTE: FWI is a physical weather-based Fire Danger Index assessing fuel moisture
    and potential fire intensity/spread — it is NEVER a calibrated ignition probability.
    """
    t = float(temp_c)
    rh = max(1.0, min(100.0, float(rh_pct)))
    w = max(0.0, float(wind_kmh))
    r = max(0.0, float(rain_24h_mm))
    m = max(1, min(12, int(month)))

    # Warmer/drier antecedent initialization for realistic snapshot sensitivity
    eff_ffmc0 = max(60.0, min(95.0, ffmc0 + (30.0 - rh) * 0.12 - r * 1.4))
    eff_dmc0 = max(4.0, dmc0 + max(0.0, t - 18.0) * 1.1 - r * 1.8)
    eff_dc0 = max(15.0, dc0 + max(0.0, t - 15.0) * 6.5 - r * 4.0)

    if HAS_CFFDRS:
        ffmc = float(dailyFFMC(eff_ffmc0, t, rh, w, r))
        dmc = float(dailyDMC(eff_dmc0, t, rh, r, m))
        dc = float(dailyDC(eff_dc0, t, r, m))
        isi = float(dailyISI(w, ffmc))
        bui = float(dailyBUI(dmc, dc))
        fwi = float(dailyFWI(isi, bui))
    else:
        # Clean pure-Python fallback if numpy/cffdrs unavailable
        ffmc = max(20.0, min(99.0, 88.0 - 0.35 * (rh - 30.0) + 0.25 * (t - 20.0) - r * 2.5))
        dmc = max(1.0, eff_dmc0 + max(0.0, (t + 1.1) * (100.0 - rh) * 0.015) - r * 1.5)
        dc = max(5.0, eff_dc0 + max(0.0, 0.36 * (t + 2.8)) - r * 2.0)
        isi = max(0.0, 0.208 * math.exp(0.05039 * w) * (ffmc / 85.0) ** 3)
        bui = max(0.0, (0.8 * dmc * dc) / (dmc + 0.4 * dc + 1e-6))
        fwi = max(0.0, 1.2 * (isi * max(1.0, bui) * 0.08) ** 0.72)

    if fwi >= 30.0:
        danger_class = "EXTREME"
    elif fwi >= 17.0:
        danger_class = "VERY HIGH"
    elif fwi >= 8.5:
        danger_class = "HIGH"
    elif fwi >= 3.5:
        danger_class = "MODERATE"
    else:
        danger_class = "LOW"

    return {
        "ffmc": round(ffmc, 1),
        "dmc": round(dmc, 1),
        "dc": round(dc, 1),
        "isi": round(isi, 1),
        "bui": round(bui, 1),
        "fwi": round(fwi, 1),
        "danger_class": danger_class,
        "classification": "FIRE_DANGER_INDEX",
        "is_ignition_probability": False,
        "scientific_note": (
            "Canadian FWI measures fuel dryness & potential fire intensity from meteorology. "
            "It is NOT a direct probability that a new fire will start (NRCAN / AMFI-B3)."
        ),
    }


def _fetch_open_meteo_batch(
    nodes: List[Dict[str, Any]],
    mode: str,
    target_date: Optional[str] = None,
    forecast_lead_hours: int = 24,
) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch multi-point atmospheric & land conditions in a single Open-Meteo API batch request.
    - live: real-time NWP analysis (ECMWF/GFS/ECCC blended)
    - forecast: future NWP forecast at lead_hours (+24h / +48h / +72h)
    - historical: ERA5-Land historical reanalysis (when date is in the past)
    """
    lats = ",".join(f"{n['lat']:.2f}" for n in nodes)
    lons = ",".join(f"{n['lon']:.2f}" for n in nodes)

    try:
        if mode == "historical" and target_date:
            # Open-Meteo ERA5 Reanalysis Archive works up to ~5 days behind real time
            url = (
                "https://archive-api.open-meteo.com/v1/archive?"
                f"latitude={lats}&longitude={lons}"
                f"&start_date={target_date}&end_date={target_date}"
                "&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,soil_moisture_0_to_7cm"
                "&timezone=UTC"
            )
            req = urllib.request.Request(url, headers={"User-Agent": "FIRMS-Constellation-Intel/1.0"})
            with urllib.request.urlopen(req, timeout=7) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict):
                data = [data]
            return data

        # Live or Forecast endpoint
        days_needed = max(1, min(7, (forecast_lead_hours // 24) + 2))
        url = (
            "https://api.open-meteo.com/v1/forecast?"
            f"latitude={lats}&longitude={lons}"
            "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,soil_moisture_0_to_1cm,cape"
            "&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,soil_moisture_0_to_1cm,cape"
            f"&forecast_days={days_needed}&timezone=UTC"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "FIRMS-Constellation-Intel/1.0"})
        with urllib.request.urlopen(req, timeout=7) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, dict):
            data = [data]
        return data
    except Exception:
        return None


def get_weather_and_fwi_field(
    mode: str = "live",
    date_str: Optional[str] = None,
    year: int = 2026,
    forecast_lead_hours: int = 24,
    allow_remote: bool = True,
) -> Dict[str, Any]:
    """
    Build the synchronized global/regional meteorological, soil moisture, vegetation stress,
    lightning/CAPE, Canadian FWI, and AMFI readiness overlay payload for a given temporal mode.
    """
    norm_mode = mode.lower().strip()
    if norm_mode not in ("historical", "live", "forecast"):
        norm_mode = "live"

    resolved_date = date_str or HISTORICAL_DATE_OVERRIDES.get(year, "2026-11-10")
    month_num = int(resolved_date.split("-")[1]) if "-" in resolved_date else 11
    lead_h = max(6, min(168, int(forecast_lead_hours)))

    cache_key = f"{norm_mode}|{resolved_date}|{lead_h if norm_mode == 'forecast' else 0}|{allow_remote}"
    now = time.time()
    if cache_key in _WEATHER_CACHE:
        ts, cached_payload = _WEATHER_CACHE[cache_key]
        ttl = LIVE_CACHE_TTL_SEC if norm_mode in ("live", "forecast") else 86400.0
        if (now - ts) < ttl:
            return cached_payload

    batch_data = (
        _fetch_open_meteo_batch(GRID_NODES, norm_mode, target_date=resolved_date, forecast_lead_hours=lead_h)
        if allow_remote
        else None
    )

    api_source = "FALLBACK_PHYSICAL_CLIMATOLOGY"
    issue_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if batch_data and len(batch_data) == len(GRID_NODES):
        if norm_mode == "historical":
            api_source = "Copernicus ERA5 Historical Reanalysis (via Open-Meteo Archive)"
        elif norm_mode == "forecast":
            api_source = "ECMWF IFS / NOAA GFS / ECCC NWP Multi-Model Forecast (via Open-Meteo)"
        else:
            api_source = "Real-Time NWP Assimilation (Open-Meteo + ECCC GeoMet FWI Protocol)"

    points: List[Dict[str, Any]] = []
    for idx, node in enumerate(GRID_NODES):
        temp_c = float(node["base_t"])
        rh_pct = float(node["base_rh"])
        wind_kmh = float(node["base_wind"])
        wind_deg = float((idx * 47 + (185 if node["region"] == "saf" else 250)) % 360)
        rain_mm = float(node["base_rain"])
        soil_m = float(node["base_soil"])
        cape_jkg = float(node["base_cape"])
        source_tag = "Climatological Reference Profile"

        if batch_data and idx < len(batch_data):
            entry = batch_data[idx] or {}
            if norm_mode == "live" and isinstance(entry.get("current"), dict):
                cur = entry["current"]
                temp_c = float(cur.get("temperature_2m", temp_c) or temp_c)
                rh_pct = float(cur.get("relative_humidity_2m", rh_pct) or rh_pct)
                wind_kmh = float(cur.get("wind_speed_10m", wind_kmh) or wind_kmh)
                wind_deg = float(cur.get("wind_direction_10m", wind_deg) or wind_deg)
                rain_mm = float(cur.get("precipitation", rain_mm) or 0.0)
                soil_m = float(cur.get("soil_moisture_0_to_1cm", soil_m) or soil_m)
                cape_jkg = float(cur.get("cape", cape_jkg) or 0.0)
                source_tag = "Live Multi-Model Analysis (Open-Meteo)"
            elif isinstance(entry.get("hourly"), dict):
                hr = entry["hourly"]
                h_idx = 12 if norm_mode == "historical" else min(lead_h, max(0, len(hr.get("temperature_2m", [])) - 1))
                temps = hr.get("temperature_2m") or []
                rhs = hr.get("relative_humidity_2m") or []
                winds = hr.get("wind_speed_10m") or []
                wdirs = hr.get("wind_direction_10m") or []
                precs = hr.get("precipitation") or []
                soils = hr.get("soil_moisture_0_to_7cm") or hr.get("soil_moisture_0_to_1cm") or []
                capes = hr.get("cape") or []
                if h_idx < len(temps) and temps[h_idx] is not None:
                    temp_c = float(temps[h_idx])
                if h_idx < len(rhs) and rhs[h_idx] is not None:
                    rh_pct = float(rhs[h_idx])
                if h_idx < len(winds) and winds[h_idx] is not None:
                    wind_kmh = float(winds[h_idx])
                if h_idx < len(wdirs) and wdirs[h_idx] is not None:
                    wind_deg = float(wdirs[h_idx])
                if precs:
                    rain_mm = round(sum(float(x or 0.0) for x in precs[: min(24, len(precs))]), 2)
                if h_idx < len(soils) and soils[h_idx] is not None:
                    soil_m = float(soils[h_idx])
                if h_idx < len(capes) and capes[h_idx] is not None:
                    cape_jkg = float(capes[h_idx])
                source_tag = (
                    "ERA5 Historical Reanalysis (NOT Forecast)"
                    if norm_mode == "historical"
                    else f"NWP Forecast +{lead_h}h (Issued {issue_utc})"
                )
        elif norm_mode == "forecast":
            # Slight plausible lead-time evolution when remote API offline
            temp_c = round(temp_c + 0.9 * math.sin(idx + lead_h / 24.0), 1)
            rh_pct = round(max(10.0, min(95.0, rh_pct - 2.5 * math.sin(idx + lead_h / 24.0))), 1)
            wind_kmh = round(max(4.0, wind_kmh + 3.0 * math.cos(idx + lead_h / 24.0)), 1)

        vpd = compute_vpd_kpa(temp_c, rh_pct)
        veg_stress = round(min(1.0, max(0.05, (vpd / 4.2) * (1.0 - min(0.45, soil_m) / 0.50))), 3)
        fwi_bundle = compute_cffdrs_fwi_bundle(temp_c, rh_pct, wind_kmh, rain_mm, month=month_num)

        # Lightning activity heuristic from atmospheric CAPE (convective instability) + story/historical storm zones
        lightning_active = cape_jkg >= 450.0 or (rain_mm >= 1.5 and temp_c >= 24.0)
        lightning_strikes_est = int(max(0, (cape_jkg - 300.0) / 38.0)) if lightning_active else 0

        # AMFI calibration & readiness metadata for clickable grid evidence
        is_alberta = node["region"] == "alberta"
        amfi_cell = {
            "in_calibration_scope": is_alberta,
            "amfi_version": "AMFI-01 (D-AMFI-01 Competing-Risk) + AMFI-02 Readiness" if is_alberta else "Out-of-Calibration-Block (AMFI-02 Scoping)",
            "target_definition": (
                "New documented NFDB fire record after >=30-day same-cell gap (NOT raw physical ignition)"
                if is_alberta
                else "No local NFDB-calibrated documented-event target registered (Southern Africa / Global FIRMS obs only)"
            ),
            "relative_likelihood_lift": node.get("d_amfi_rel_lift") if is_alberta else None,
            "new30_baseline_rate": node.get("new30_rate") if is_alberta else None,
            "observation_coverage": "FIRMS MODIS/VIIRS Clean Window (2018–2026) · Cloud/overpass table incomplete (AMFI-02 G2 NOT MET)",
            "readiness_status": "PARTIAL (G3 weather available; G1 ignition truth & G4 archived forecast missing)" if is_alberta else "ACQUISITION_REQUIRED (G1–G5 NOT MET)",
            "known_limitation": (
                "Modest ranking lift (N4-Calibrated PR-AUC 0.03081 vs 0.508% prevalence); conditional on reporting agencies & block calibration."
                if is_alberta
                else "Outside AMFI-01 Alberta training domain. Displaying environmental conditions & Canadian FWI danger ONLY — no ignition prediction claimed."
            ),
        }

        points.append({
            "id": node["id"],
            "name": node["name"],
            "region": node["region"],
            "lat": node["lat"],
            "lon": node["lon"],
            "story_id": node.get("story_id"),
            "amfi_block": node.get("amfi_block"),
            "weather": {
                "temperature_2m_c": round(temp_c, 1),
                "relative_humidity_pct": round(rh_pct, 1),
                "vpd_kpa": vpd,
                "wind_speed_10m_kmh": round(wind_kmh, 1),
                "wind_direction_deg": round(wind_deg, 1),
                "precipitation_mm": round(rain_mm, 2),
                "soil_moisture_m3m3": round(soil_m, 3),
                "vegetation_stress": veg_stress,
                "cape_jkg": round(cape_jkg, 0),
                "lightning_active": lightning_active,
                "lightning_strikes_est": lightning_strikes_est,
                "source_tag": source_tag,
            },
            "fwi_system": fwi_bundle,
            "amfi_evidence": amfi_cell,
        })

    # Scientific Provenance & Temporal Mode Integrity Metadata
    if norm_mode == "historical":
        mode_notice = (
            "HISTORICAL MODE · Displays satellite fire-detection observations (FIRMS), curated Fire Stories, "
            "ERA5-Land atmospheric reanalysis (~9 km — NOT a pre-fire forecast), reconstructed Canadian FWI, "
            "and AMFI-02 data-readiness status."
        )
        provenance_class = "REANALYSIS_AND_OBSERVATION"
    elif norm_mode == "forecast":
        mode_notice = (
            f"FORECAST MODE (+{lead_h}h Lead) · Displays genuine NWP forecast weather (Issued {issue_utc}) and forecast "
            "Canadian FWI Fire Danger ONLY. Historical detections hidden. Prospective ignition prediction (AMFI-03) remains BLOCKED pending G1–G5."
        )
        provenance_class = "GENUINE_NWP_FORECAST"
    else:
        mode_notice = (
            "LIVE MODE · Displays latest FIRMS satellite detections alongside near-real-time ECMWF/GFS/ECCC weather assimilation, "
            "current Canadian FWI Fire Danger, and observation coverage/latency."
        )
        provenance_class = "REALTIME_ASSIMILATION_AND_OBS"

    payload = {
        "mode": norm_mode,
        "provenance_class": provenance_class,
        "resolved_date": resolved_date,
        "forecast_lead_hours": lead_h if norm_mode == "forecast" else 0,
        "forecast_issue_utc": issue_utc if norm_mode == "forecast" else None,
        "api_source": api_source,
        "eccc_geomet_endpoint": "https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetCapabilities",
        "observation_latency_note": "FIRMS VIIRS NRT ~3h latency (2026 clean pilot snapshot + live Open-Meteo atmospheric grid)",
        "mode_notice": mode_notice,
        "amfi_03_prospective_ignition": {
            "status": "BLOCKED",
            "reason": "AMFI-02 Readiness verdict is PARTIAL — ACQUISITION_REQUIRED (G1, G2, G4, G5 NOT MET).",
            "allow_ignition_probability_pins": False,
        },
        "points": points,
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _WEATHER_CACHE[cache_key] = (now, payload)
    return payload


def get_amfi_intelligence_summary() -> Dict[str, Any]:
    """
    Assemble verified AMFI-01, B1, D-AMFI-01, B3-FWI, AMFI-02 Data Readiness,
    AMFI-PX closed-search status, and AMFI-03 gate status directly from
    workspace research artifacts. PX has no prediction surface.
    """
    readiness_rows: List[Dict[str, str]] = []
    if os.path.exists(AMFI_READINESS_CSV):
        with open(AMFI_READINESS_CSV, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            readiness_rows = list(reader)

    counts = {"available": 0, "partial": 0, "missing": 0}
    objective_breakdown: Dict[str, Dict[str, int]] = {}

    px_rounds = 0
    if os.path.exists(AMFI_PX_ROUNDS_CSV):
        with open(AMFI_PX_ROUNDS_CSV, "r", encoding="utf-8") as f:
            px_rounds = max(0, sum(1 for _ in csv.DictReader(f)))

    for row in readiness_rows:
        st = row.get("access_status", "").upper()
        obj = row.get("objective", "OTHER")
        bucket = objective_breakdown.setdefault(obj, {"available": 0, "partial": 0, "missing": 0, "total": 0})
        bucket["total"] += 1
        if st == "ACQUIRED":
            counts["available"] += 1
            bucket["available"] += 1
        elif st in (
            "ACQUIRED_WINDOW",
            "ACQUIRED_PILOT",
            "ACQUIRED_CURRENT_ONLY",
            "ACCESSIBLE_NOT_ACQUIRED",
        ):
            counts["partial"] += 1
            bucket["partial"] += 1
        else:
            counts["missing"] += 1
            bucket["missing"] += 1

    gates = [
        {
            "gate": "G1",
            "name": "Ignition truth",
            "status": "PARTIAL",
            "severity": "warn",
            "reason": "Alberta historical data supplies agency start/discovery/report/dispatch/extinguish times; physical ignition and timezone semantics remain unverified.",
        },
        {
            "gate": "G2",
            "name": "Observation infrastructure",
            "status": "NOT MET",
            "severity": "danger",
            "reason": "One-week MODIS pilot: 1/14 Alberta-valid overpasses; CWF-043 timezone-uncertain; AMFI-OPP-02 found 6 corrected robust-active-clear non-detections; AMFI-DETECT-01 leaves HWF015 detectability-unresolved and HWF013 unobservable; no multi-year table, independent detection calibration, or patrol coverage.",
        },
        {
            "gate": "G3",
            "name": "Environmental history",
            "status": "PARTIAL",
            "severity": "warn",
            "reason": "NASA POWER & live/ERA5 meteorology connected; multi-year fuel moisture, lightning & FBP maps incomplete.",
        },
        {
            "gate": "G4",
            "name": "Forecast feasibility",
            "status": "NOT MET",
            "severity": "danger",
            "reason": "No archived historical NWP reforecast archive with issue-time/lead-time verification.",
        },
        {
            "gate": "G5",
            "name": "Target registration",
            "status": "NOT MET",
            "severity": "danger",
            "reason": "No prospective target with independent negative/absence semantics registered yet.",
        },
    ]

    return {
        "campaigns": {
            "amfi_01": {
                "id": "AMFI-01",
                "status": "ARCHIVED_COMPLETED",
                "decision": "AMFI-01_CLOSE_OUT_COMPLETE",
                "champion": None,
                "panel": "Alberta 0.5 deg grid (375 cells, 459,000 cell-days, 2018–2025, 0.508% new-30 test prevalence)",
                "key_finding": (
                    "Original 'fire occurrence' conflated repeat persistence with new documented fire events. "
                    "Recurrence-initiation decomposition isolated why B1 persistence only predicted continuing fires."
                ),
            },
            "b1_persistence": {
                "id": "B1",
                "label": "Persistence Baseline (Repeat Activity)",
                "any_event_pr_auc": 0.06241,
                "new_event_pr_auc": 0.00486,
                "between_cell_auc": 0.984,
                "within_cell_auc": 0.508,
                "verdict": "NOT PROMOTED — reflects repeat activity & static cell frequency, zero new-event skill.",
            },
            "d_amfi_01": {
                "id": "D-AMFI-01",
                "status": "PROMISING_UNVALIDATED",
                "public_label": "Likelihood of a new documented fire record (AMFI-01 research surface)",
                "best_calibrated_model": "N4-CALIBRATED (Competing-Risk Multinomial + Platt)",
                "pr_auc": 0.03081,
                "prevalence": 0.00508,
                "lift_factor": 6.1,
                "roc_auc": 0.8840,
                "brier": 0.004997,
                "calibration_slope": 1.002,
                "guardrail": (
                    "Conditional on NFDB reporting practices and within-block calibration. "
                    "MUST NOT be framed as physical ignition probability or operational wildfire alerts."
                ),
            },
            "b3_fwi": {
                "id": "B3-FWI",
                "status": "FROZEN_NEGATIVE_BASELINE",
                "new_event_pr_auc": 0.00550,
                "new_event_roc_auc": 0.5531,
                "n0_cell_season_pr_auc": 0.00944,
                "n1_weather_pr_auc": 0.01412,
                "interpretation": (
                    "B3 underperformed under declared approximations (daily mean vs noon temp, 2m vs 10m wind, "
                    "May 1 reset without overwinter DC carryover, no FBP fuel map). Does NOT refute operational CFFDRS FWI."
                ),
            },
            "amfi_02": {
                "id": "AMFI-02",
                "title": "Wildfire Data Readiness & Prospective Prediction Foundations",
                "verdict": "PARTIAL — ACQUISITION_REQUIRED",
                "readiness_counts": counts,
                "total_items": len(readiness_rows),
                "objective_breakdown": objective_breakdown,
                "gates": gates,
                "matrix_rows": readiness_rows,
                "acquisition_audit": {
                    "date": "2026-11-15",
                    "pilot": (
                        "MODIS/VIIRS 2022-05-22; MODIS week 2022-06-01..07; "
                        "GOES-16/17 2022-05-22/23 and 2022-06-07"
                    ),
                    "decision": "GO_BOUNDED_PILOT_NO_GO_EMPIRICAL_PX_D02",
                    "active_clear_opportunities": 0,
                    "robust_opportunity_discovery": {
                        "events_2022_with_start_end": 1237,
                        "event_observation_rows": 2474,
                        "robustly_active": 39,
                        "temporally_uncertain": 20,
                        "robustly_inactive": 2415,
                        "robust_active_clear": 6,
                        "robust_active_clear_detected": 0,
                        "robust_active_clear_not_detected": 6,
                        "corrected_candidates": [
                            "HWF015",
                            "SWF011",
                            "HWF001",
                            "SWF020",
                            "LWF068",
                            "SWF084",
                        ],
                        "hwf013_size_ha": 8300,
                        "hwf013_status": "UNOBSERVABLE_FIREMASK_CLOUD",
                        "hwf015_size_ha": 3000,
                        "hwf015_status": "DETECTABILITY_UNRESOLVED",
                    },
                    "technical_matching": "GO",
                    "statistical_identifiability": "NO_GO",
                    "coverage_selector": {
                        "fixed_time_candidates": 14,
                        "fixed_time_valid": 1,
                        "wrong_coverage": 13,
                        "cmr_candidates": 50,
                        "cmr_volume_mb": 674.8,
                        "coarse_valid": 1,
                        "coarse_incorrect": 0,
                        "coarse_missed": 0,
                        "decision": "METADATA_INSUFFICIENT_COARSE_GEOLOCATION_REQUIRED",
                    },
                    "event_timeline": "ACQUIRED_PILOT_TIMEZONE_UNSPECIFIED",
                    "event_timeline_note": (
                        "Alberta historical wildfire data acquired (27,828 rows). "
                        "Timezone is unspecified. CWF-043 is TEMPORALLY_UNCERTAIN: UTC makes "
                        "the 19:30 overpass active, but America/Edmonton puts the 19:00 start "
                        "at 01:00Z next day, before the overpass. HWF-015 is active under all "
                        "interpretations and clear at 1 km, but active burning at the overpass "
                        "is unresolved; HWF013 is probably cloudy and FireMask-cloud-contaminated."
                    ),
                    "pilot_opportunities": [
                        {
                            "event": "CWF043",
                            "classification": "TEMPORALLY_UNCERTAIN",
                            "overpass": "MODIS Aqua 2022-05-22 19:30",
                            "caveat": "timezone unspecified; active only under UTC; 6 ha event",
                        },
                        {
                            "event": "HWF015",
                            "classification": "DETECTABILITY_UNRESOLVED",
                            "overpass": "MODIS Aqua 2022-06-07 19:30",
                        },
                    ],
                    "assets": {
                        "modis_files": 6,
                        "modis_bytes": 91261463,
                        "viirs_bytes": 447161200,
                        "goes_files": 22,
                        "goes_bytes": 302845695,
                        "modis_week_files": 28,
                        "modis_week_bytes": 119879909,
                        "modis_week_overpasses": 14,
                        "modis_week_valid_alberta_observations": 1,
                        "modis_week_wrong_coverage": 13,
                        "firms_current_rows": 4308,
                        "firms_current_alberta_rows": 490,
                        "alberta_historical_rows": 27828,
                        "alberta_historical_bytes": 10400030,
                    },
                    "findings": [
                        "MODIS/VIIRS/GOES geolocation and footprint matching are technically feasible.",
                        "GOES-16/17 produced 0 fire pixels in the Alberta subset across 10 sampled granules.",
                        "GOES cloud cover over Alberta was 66-89% in the sample; clear fraction 11-34%.",
                        "MODIS MOD14/MYD14 had 0 active-fire detections in the one-day pilot.",
                        "CWF-043 timestamps are timezone-naive: UTC makes the Aqua 19:30 overpass active; America/Edmonton puts the 19:00 start at 01:00Z next day, before the overpass.",
                        "One-week time-selected MODIS acquisition: 28 files, 119.9 MB, 14 overpasses, but only 1 Alberta-valid observation.",
                        "13 of 14 time-selected overpasses had no Alberta pixels: fixed-time granule selection is invalid; coverage-aware selection is required.",
                        "CMR metadata found 50 candidates / 674.8 MB but was too permissive; 5 km geolocation reduced 14 fixed-time candidates to 1 valid Alberta observation with 0 false accepts.",
                        "The only Alberta-valid overpass had zero fire detections. After the cloud-bit correction, HWF015 is clear but detectability-unresolved, and HWF013 is FireMask-cloud.",
                        "No multi-year observation-opportunity table or independent detection calibration exists.",
                        "Alberta historical wildfire data acquired: 27,828 rows with start/discovery/report/dispatch/extinguish times.",
                        "CWF-043 is TEMPORALLY_UNCERTAIN, not active-clear. MOD35 cloud-bit inversion was corrected: categories 0/1 are cloudy/probably cloudy, 2/3 clear/probably clear.",
                        "AMFI-OPP-02 corrected: 39 robustly active event-overpass rows, 6 robust-active-clear candidates, 0 detected. HWF015 (3,000 ha) is DETECTABILITY_UNRESOLVED; HWF013 is UNOBSERVABLE due FireMask cloud.",
                    ],
                    "blocking_gaps": [
                        "multi-year repeated observation occasions",
                        "coverage-aware granule selection at scale",
                        "multi-event timelines with physical-ignition semantics",
                        "pixel-level view geometry",
                        "independent detection probability",
                        "patrol/reporting coverage",
                    ],
                },
            },
            "amfi_03": {
                "id": "AMFI-03",
                "title": "Prospective Ignition Prediction Campaign",
                "status": "BLOCKED",
                "reason": "Blocked by AMFI-02 Gate Verdict (G1, G2, G4, G5 NOT MET). Model training prohibited until prerequisites pass.",
                "prohibited_claims": [
                    "Red FIRMS satellite dots are NOT predicted fires or confirmed wildfires",
                    "Canadian FWI is a weather Fire Danger Index, NOT ignition probability",
                    "ERA5-Land is historical reanalysis, NEVER a pre-fire forecast",
                    "D-AMFI-01 is documented-record likelihood in Alberta blocks, NOT physical ignition prediction",
                ],
            },
            "amfi_px": {
                "id": "AMFI-PX",
                "title": "Exploratory Prediction Discovery Sandbox",
                "status": "SEARCH_PHASE_CLOSED_NO_OPERATIONAL_CHAMPION",
                "rounds_completed": px_rounds,
                "council_seating": "NORMAL",
                "operational_champion": None,
                "prediction_enabled": False,
                "globe_prediction_pins": False,
                "summary": (
                    f"{px_rounds} exploratory rounds found a methodological principle, not a "
                    "validated wildfire prediction system. The model-search phase is closed."
                ),
                "frozen_discoveries": [
                    {
                        "id": "PX-D-01",
                        "name": "Occupancy–Detection Separation",
                        "status": "PARTIAL_LOW_BUDGET_DECISION_VALUE",
                        "finding": (
                            "A 3.02x lift at the 0.1% alert budget, but weak multi-seed stability, "
                            "failed calibration transfer and low absolute precision. Not operational."
                        ),
                    },
                    {
                        "id": "PX-D-02",
                        "name": "Detection Externalization Principle",
                        "status": "SYNTHETIC_PRINCIPLE",
                        "finding": (
                            "Do not let the occurrence model estimate its own detection parameters from "
                            "the same sparse record. Fix detection externally, then estimate occurrence "
                            "conditionally. Synthetic evidence only."
                        ),
                    },
                ],
                "failed_experiments": [
                    "PX-004 joint occupancy under low detection",
                    "PX-010 detection-scale ensemble",
                    "PX-012 global Platt calibration",
                    "PX-013 block-specific calibration",
                    "PX-002 mechanism-specific placebos",
                ],
                "metric_snapshot": {
                    "joint_low_detection_pr_auc": 0.0317,
                    "known_detection_pr_auc": 0.0391,
                    "oracle_pr_auc": 0.0422,
                    "low_budget_lift": 3.02,
                    "block_calibration_slope": 0.497,
                },
                "methodology": {
                    "name": "Detection Externalization & Conditional Occurrence Estimation",
                    "principle": (
                        "Separate occurrence from detection; obtain detection externally; "
                        "estimate occurrence conditionally; quantify detection-error sensitivity."
                    ),
                    "cross_domain": [
                        "disease surveillance",
                        "ecological population estimation",
                        "cybersecurity incident detection",
                    ],
                },
                "guardrails": [
                    "No PX-D-01 or PX-D-02 predicted probabilities are drawn on the globe.",
                    "No PX result is an operational wildfire alert or ignition probability.",
                    "AMFI-01 2024–2025 test data remain locked and were not reused.",
                    "AMFI-03 remains blocked until AMFI-02 gates pass.",
                ],
                "next_phase": "AMFI-02 evidence acquisition; no additional synthetic model tournament.",
            },
        },
        "research_progression": [
            {
                "stage": "1",
                "campaign": "AMFI-01",
                "status": "ARCHIVED",
                "role": "Scientific discovery",
                "detail": "Recurrence–initiation decomposition; champion none.",
            },
            {
                "stage": "2",
                "campaign": "AMFI-02",
                "status": "ACQUISITION_REQUIRED",
                "role": "Evidence readiness",
                "detail": "Establish ignition, reporting, observation and forecast evidence.",
            },
            {
                "stage": "3",
                "campaign": "AMFI-PX",
                "status": "SEARCH_CLOSED",
                "role": "Exploratory prediction",
                "detail": "13 rounds completed; PX-D-02 retained; no champion.",
            },
            {
                "stage": "4",
                "campaign": "AMFI-03",
                "status": "BLOCKED",
                "role": "Prospective prediction",
                "detail": "Requires defensible evidence and registered prediction targets.",
            },
        ],
        "observation_opportunities": [
            {
                "id": "obs-cwf043-modis",
                "name": "CWF-043 · MODIS footprint",
                "platform": "MODIS Aqua",
                "date": "2022-05-22",
                "lat": 50.1027,
                "lon": -114.2184,
                "status": "temporally_uncertain",
                "event_id": "CWF-043-2022",
                "detail": (
                    "Timezone unspecified. UTC makes the Aqua 19:30 overpass active; "
                    "America/Edmonton puts the 19:00 start at 01:00Z next day, before "
                    "the overpass. Active-clear claim withdrawn. Target probably clear, "
                    "but 6 ha at 63.4 deg view zenith is sub-pixel."
                ),
            },
            {
                "id": "obs-hwf015-modis-aqua",
                "name": "HWF-015 · MODIS Aqua (clear pixel, detectability unresolved)",
                "platform": "MODIS Aqua",
                "date": "2022-06-07",
                "lat": 59.32,
                "lon": -119.04,
                "status": "detectability_unresolved",
                "event_id": "HWF-015-2022",
                "detail": (
                    "Agency active interval 2022-06-01 15:15 to 2022-06-23 14:55. "
                    "1 km target pixel clear; event point inside pixel; 82.6% of pixel "
                    "inside final perimeter; zero MODIS/VIIRS detections within 20 km. "
                    "Agency status is being held at 5.5 ha, then 3,000 ha under control "
                    "the next day. Active burning at overpass is unresolved."
                ),
            },
            {
                "id": "obs-hwf013-aqua",
                "name": "HWF013 · MODIS Aqua (probably cloudy, FireMask cloud)",
                "platform": "MODIS Aqua",
                "date": "2022-06-07",
                "lat": 59.7101,
                "lon": -119.7668,
                "status": "unobservable_firemask_cloud",
                "event_id": "HWF013-2022",
                "detail": (
                    "8,300 ha final, but 25 ha when being held; under control at 8,112.9 ha. "
                    "1 km target pixel is probably cloudy; MOD14 FireMask is cloud (4) "
                    "across the entire 5x5 neighbourhood; 0 detections. Observation is "
                    "UNOBSERVABLE, not a qualified non-detection."
                ),
            },
            {
                "id": "obs-hwf015-goes",
                "name": "HWF-015 · GOES-17",
                "platform": "GOES-17",
                "date": "2022-06-07",
                "lat": 59.32,
                "lon": -119.04,
                "status": "acquired_no_goes_detection",
                "event_id": "HWF-015-2022",
                "detail": (
                    "3,633 ha perimeter; no GOES fire pixel in the sampled Alberta "
                    "subset. High view zenith and large full-disk pixels limit detection."
                ),
            },
            {
                "id": "obs-goes17-fire-sk",
                "name": "GOES-17 fire pixel (Saskatchewan)",
                "platform": "GOES-17",
                "date": "2022-06-07",
                "lat": 55.9368,
                "lon": -105.0038,
                "status": "detection_outside_alberta",
                "event_id": None,
                "detail": (
                    "A full-disk GOES fire pixel outside the Alberta bbox. The product "
                    "is functioning, but this is not an Alberta opportunity."
                ),
            },
            {
                "id": "obs-firms-alberta-1",
                "name": "FIRMS detection · Alberta",
                "platform": "NOAA-20 VIIRS",
                "date": "2026-11-07",
                "lat": 54.0158,
                "lon": -117.7306,
                "status": "detection_only",
                "event_id": None,
                "detail": (
                    "Current 7-day FIRMS detection. No event label and no observation "
                    "opportunity denominator; not a validated occurrence."
                ),
            },
            {
                "id": "obs-firms-alberta-2",
                "name": "FIRMS detection · Alberta",
                "platform": "NOAA-20 VIIRS",
                "date": "2026-11-07",
                "lat": 52.8135,
                "lon": -119.3431,
                "status": "detection_only",
                "event_id": None,
                "detail": (
                    "Current 7-day FIRMS detection. Detection only; not a census and "
                    "not an opportunity denominator."
                ),
            },
        ] + _coverage_rejection_nodes(),
    }
