"""
Core Scientific & Mathematical Engine for FIRMS Constellation Intelligence.
Enforces all five mandatory validation corrections (CORR-01 through CORR-05)
and implements tie-preserving top-day set algebra, 15-subset / 7-subset
platform x metric matrices, pivotal-subset influence (I_p), 1 km Haversine
geodesic clustering (M2c), Nadir-Filtered Total FRP (M4c), and D1/D2/D3
operational decision analysis.
"""
from __future__ import annotations

import math
from itertools import combinations
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

import numpy as np
from scipy.stats import spearmanr

# Explicit Source Completeness States (CORR-03)
SOURCE_STATE_AVAILABLE = "DATA_AVAILABLE"
SOURCE_STATE_EMPTY_FEED = "FEED_EMPTY_IN_RETRIEVAL"
SOURCE_STATE_FAILED = "RETRIEVAL_FAILED"
SOURCE_STATE_PARTIAL = "PARTIAL_DATA"
SOURCE_STATE_UNVERIFIED = "SOURCE_UNVERIFIED"

# Mandatory Sensitivity Classifications (Section 6)
CLASS_CONSTELLATION_INVARIANT = "CONSTELLATION_INVARIANT"
CLASS_SENSOR_SET_SENSITIVE = "SENSOR_SET_SENSITIVE"
CLASS_METRIC_SENSITIVE = "METRIC_SENSITIVE"
CLASS_PLATFORM_AND_METRIC_SENSITIVE = "PLATFORM_AND_METRIC_SENSITIVE"
CLASS_NO_SENSOR_CONSENSUS = "NO_SENSOR_CONSENSUS"
CLASS_POOLED_RANK_DISAGREEMENT = "POOLED_RANK_DISAGREEMENT"

# Validated Nadir Scan Thresholds (CORR-01: scan_i <= 1.3 * nadir)
NADIR_SCAN_LIMIT_KM = {
    "MODIS": 1.30,   # 1.3 * 1.0 km nadir
    "TERRA": 1.30,
    "AQUA": 1.30,
    "VIIRS": 0.49,   # 1.3 * 0.375 km nadir (~0.4875 km -> 0.49 km in FIRMS schema)
    "J1": 0.49,
    "NOAA-20": 0.49,
    "J2": 0.49,
    "NOAA-21": 0.49,
    "SNPP": 0.49,
    "S-NPP": 0.49,
}


def utc_to_local_solar_time(utc_hours: float, longitude_deg: float) -> float:
    """
    CORR-05: Convert UTC decimal hours and longitude (degrees East) to
    Local Solar Time (LST) in [0, 24) hours:
        LST = (UTC + longitude / 15.0) mod 24
    Never substitutes a single fixed national civil timezone across a wide region.
    """
    return float((utc_hours + (longitude_deg / 15.0)) % 24.0)


def parse_acq_time_to_utc_hours(acq_time_str: str | int) -> float:
    """Convert FIRMS HHMM acquisition time string/int (e.g. '1345' or '0830') to decimal UTC hours."""
    s = str(acq_time_str).strip().zfill(4)
    hh = int(s[:2])
    mm = int(s[2:4])
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        raise ValueError(f"Invalid HHMM acq_time: {acq_time_str}")
    return hh + (mm / 60.0)


def classify_source_state(
    file_bytes: int,
    data_row_count: int,
    has_valid_header: bool = True,
    is_partial_trailing_day: bool = False,
) -> Dict[str, Any]:
    """
    CORR-03: Classify a FIRMS retrieval file or date slice without ever treating
    a header-only empty retrieval (e.g. 112-byte S-NPP CSV) as 0 fires or spacecraft failure.
    """
    if not has_valid_header or file_bytes <= 0:
        return {
            "source_state": SOURCE_STATE_FAILED,
            "data_rows": None,
            "is_usable": False,
            "explanation": "Retrieval failed or file lacks a valid FIRMS schema header.",
        }
    if data_row_count == 0 or file_bytes <= 128:
        return {
            "source_state": SOURCE_STATE_EMPTY_FEED,
            "data_rows": None,  # MANDATORY: null, never numerical 0
            "is_usable": False,
            "explanation": (
                "No observations were returned in this retrieval (header-only CSV). "
                "This does not establish zero fire activity or spacecraft hardware failure."
            ),
        }
    if is_partial_trailing_day:
        return {
            "source_state": SOURCE_STATE_PARTIAL,
            "data_rows": int(data_row_count),
            "is_usable": False,
            "explanation": (
                "Partial trailing UTC download date quarantined automatically so incomplete "
                "daily coverage is never compared against complete 24-hour UTC dates."
            ),
        }
    return {
        "source_state": SOURCE_STATE_AVAILABLE,
        "data_rows": int(data_row_count),
        "is_usable": True,
        "explanation": "Complete validated daily observation coverage.",
    }


def quarantine_partial_trailing_days(
    date_to_records: Dict[str, Sequence[Dict[str, Any]]],
    expected_full_days: int = 7,
) -> Dict[str, Any]:
    """
    CORR-03: Detect and quarantine trailing partial UTC dates in rolling N-day exports
    (such as 2026-11-14 in the Nov 07-14 rolling export or 2022-05-29 in the May 22-29 export).
    """
    sorted_dates = sorted(date_to_records.keys())
    if not sorted_dates:
        return {"clean_dates": [], "quarantined_dates": [], "quarantine_details": {}}

    counts = [len(date_to_records[d]) for d in sorted_dates]
    median_count = float(np.median(counts)) if counts else 0.0

    clean_dates: List[str] = []
    quarantined_dates: List[str] = []
    quarantine_details: Dict[str, Any] = {}

    for idx, d in enumerate(sorted_dates):
        recs = date_to_records[d]
        cnt = len(recs)
        max_utc = max((parse_acq_time_to_utc_hours(r.get("acq_time", "0000")) for r in recs), default=0.0)
        is_trailing_extra = idx >= expected_full_days
        is_truncated_day = (idx == len(sorted_dates) - 1) and (
            is_trailing_extra or (max_utc < 20.0 and cnt < 0.35 * median_count)
        )
        if is_truncated_day:
            quarantined_dates.append(d)
            quarantine_details[d] = {
                "rows_quarantined": cnt,
                "max_utc_hour": round(max_utc, 2),
                "source_state": SOURCE_STATE_PARTIAL,
                "reason": (
                    f"Trailing UTC date {d} has incomplete observation window "
                    f"(max UTC {max_utc:.2f}h, {cnt} rows vs median {median_count:.0f})."
                ),
            }
        else:
            clean_dates.append(d)

    return {
        "clean_dates": clean_dates,
        "quarantined_dates": quarantined_dates,
        "quarantine_details": quarantine_details,
    }


def compute_top_day_set(
    day_to_value: Dict[str, float],
    rel_tol: float = 1e-9,
    abs_tol: float = 1e-9,
) -> List[str]:
    """
    Section 5 Mandatory Rule: Preserve every tied maximum.
    Never use numpy.argmax or single-index operations that discard ties.
    Uses a documented floating-point comparison tolerance:
        val >= max_val - max(abs_tol, rel_tol * abs(max_val))
    """
    valid = {d: float(v) for d, v in day_to_value.items() if v is not None and not math.isnan(float(v))}
    if not valid:
        return []
    max_val = max(valid.values())
    if max_val <= 0.0 and all(v == 0.0 for v in valid.values()):
        return []
    tol = max(abs_tol, rel_tol * abs(max_val))
    tied_top = sorted(d for d, v in valid.items() if v >= max_val - tol)
    return tied_top


def compute_tie_averaged_spearman(
    series_a: Sequence[float],
    series_b: Sequence[float],
) -> Optional[float]:
    """
    CORR-04: Compute exact tie-averaged Spearman rank correlation using scipy.stats.spearmanr.
    Never uses np.argsort(np.argsort(...)) which assigns arbitrary sequential ranks to ties.
    """
    a = np.asarray(series_a, dtype=float)
    b = np.asarray(series_b, dtype=float)
    if len(a) != len(b) or len(a) < 2:
        return None
    if np.all(a == a[0]) or np.all(b == b[0]):
        return None
    res = spearmanr(a, b)
    val = float(res.statistic if hasattr(res, "statistic") else res[0])
    if math.isnan(val):
        return None
    return round(val, 4)


def filter_nadir_frp_records(
    records: Iterable[Dict[str, Any]],
    default_platform: str = "VIIRS",
) -> Tuple[float, int]:
    """
    CORR-01: Validated M4c (NADIR_FILTERED_TOTAL_FRP).
    Sums extensive FRP (MW) over records satisfying scan_i <= 1.3 * nadir:
        - MODIS (Terra/Aqua): scan <= 1.30 km
        - VIIRS (NOAA-20/21/S-NPP): scan <= 0.49 km
    Never divides FRP by pixel area (scan * track).
    """
    total_frp = 0.0
    kept_count = 0
    for r in records:
        plat = str(r.get("platform", default_platform)).upper()
        limit = NADIR_SCAN_LIMIT_KM.get(plat, 0.49 if "VIIRS" in plat or "J" in plat or "NOAA" in plat else 1.30)
        scan_val = float(r.get("scan", 0.0))
        if scan_val <= limit + 1e-9:
            total_frp += float(r.get("frp", 0.0))
            kept_count += 1
    return round(total_frp, 4), kept_count


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle Haversine distance in kilometers between two WGS84 coordinates."""
    r_earth = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * r_earth * math.asin(min(1.0, math.sqrt(a)))


def compute_geodesic_clusters_1km(
    points: Sequence[Tuple[float, float, float]],
    radius_km: float = 1.0,
) -> Dict[str, Any]:
    """
    CORR-02 (M2c): 1 km Haversine geodesic connected-component clustering.
    Input: sequence of (lat, lon, frp) tuples for a single day/platform subset.
    Output: SPATIAL_DETECTION_CLUSTER_COUNT and cluster centroids.
    Uses a spatial hash bucket (cell size = radius_km / 111.0 deg) for fast O(N) neighbor lookup.
    """
    n = len(points)
    if n == 0:
        return {"cluster_count": 0, "clusters": []}

    cell_deg = max(radius_km / 110.574, 0.005)
    grid: Dict[Tuple[int, int], List[int]] = {}
    for i, (lat, lon, _) in enumerate(points):
        gx = int(math.floor(lat / cell_deg))
        gy = int(math.floor(lon / cell_deg))
        grid.setdefault((gx, gy), []).append(i)

    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            if ra < rb:
                parent[rb] = ra
            else:
                parent[ra] = rb

    for (gx, gy), idxs in grid.items():
        # Check within same cell and adjacent 8 cells
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nbrs = grid.get((gx + dx, gy + dy))
                if not nbrs:
                    continue
                for i in idxs:
                    lat1, lon1, _ = points[i]
                    for j in nbrs:
                        if j <= i:
                            continue
                        lat2, lon2, _ = points[j]
                        if abs(lat1 - lat2) * 111.32 > radius_km:
                            continue
                        if haversine_distance_km(lat1, lon1, lat2, lon2) <= radius_km:
                            union(i, j)

    comp_map: Dict[int, List[int]] = {}
    for i in range(n):
        comp_map.setdefault(find(i), []).append(i)

    clusters = []
    for root, member_idxs in comp_map.items():
        m_lats = [points[idx][0] for idx in member_idxs]
        m_lons = [points[idx][1] for idx in member_idxs]
        m_frps = [points[idx][2] for idx in member_idxs]
        clusters.append({
            "lat": round(float(np.mean(m_lats)), 4),
            "lon": round(float(np.mean(m_lons)), 4),
            "detection_count": len(member_idxs),
            "summed_frp_mw": round(float(np.sum(m_frps)), 2),
        })

    clusters.sort(key=lambda c: (-c["detection_count"], -c["summed_frp_mw"]))
    return {
        "cluster_count": len(clusters),
        "radius_km": radius_km,
        "metric_label": "SPATIAL_DETECTION_CLUSTER_COUNT",
        "clusters": clusters,
    }


def enumerate_non_empty_subsets(platforms: Sequence[str]) -> List[Tuple[str, ...]]:
    """
    Section 5: Enumerate all 2^K - 1 non-empty subsets in deterministic order
    (15 subsets for 4 platforms, 7 subsets for 3 platforms).
    """
    active = list(platforms)
    subsets: List[Tuple[str, ...]] = []
    for r in range(1, len(active) + 1):
        for comb in combinations(active, r):
            subsets.append(comb)
    return subsets


def compute_pivotal_subset_influence(
    subset_to_top_days: Dict[Tuple[str, ...], List[str]],
    active_platforms: Sequence[str],
) -> Dict[str, Dict[str, Any]]:
    """
    Section 7 — CouncilRise Pivotal-Subset Platform Influence Engine:
        I_p = #{S : p in S, |S| > 1, top(S) != top(S \\ {p})} / #{S : p in S, |S| > 1}
    Mandatory rules:
    1. Preserve ties (compares top-day sets as sorted lists/sets).
    2. Exclude singleton subsets (|S| > 1).
    3. Make numerator, denominator, and tested coalitions explicit.
    """
    platforms = list(active_platforms)
    canonical_tops: Dict[FrozenSet[str], Tuple[str, ...]] = {
        frozenset(k): tuple(sorted(v)) for k, v in subset_to_top_days.items()
    }
    full_set = frozenset(platforms)
    results: Dict[str, Dict[str, Any]] = {}

    for p in platforms:
        eligible_coalitions = []
        pivotal_coalitions = []
        non_pivotal_coalitions = []

        for r in range(2, len(platforms) + 1):
            for comb in combinations(platforms, r):
                s_set = frozenset(comb)
                if p not in s_set:
                    continue
                without_p = s_set - {p}
                top_with = canonical_tops.get(s_set, ())
                top_without = canonical_tops.get(without_p, ())
                entry = {
                    "coalition": list(comb),
                    "coalition_without_p": sorted(without_p),
                    "top_with_p": list(top_with),
                    "top_without_p": list(top_without),
                    "changed": top_with != top_without,
                }
                eligible_coalitions.append(entry)
                if top_with != top_without:
                    pivotal_coalitions.append(entry)
                else:
                    non_pivotal_coalitions.append(entry)

        denom = len(eligible_coalitions)
        numer = len(pivotal_coalitions)
        ip_val = round(numer / denom, 4) if denom > 0 else 0.0

        # Also check Leave-One-Out from the full active constellation
        loo_changed = False
        if len(platforms) > 1:
            loo_changed = canonical_tops.get(full_set, ()) != canonical_tops.get(full_set - {p}, ())

        results[p] = {
            "platform": p,
            "I_p": ip_val,
            "numerator": numer,
            "denominator": denom,
            "fraction_label": f"{numer}/{denom}",
            "leave_one_out_flips_pooled": loo_changed,
            "pivotal_coalitions": pivotal_coalitions,
            "non_pivotal_coalitions": non_pivotal_coalitions,
        }

    return results


def analyze_constellation_and_metrics(
    days: Sequence[str],
    platform_daily_count: Dict[str, Sequence[float]],
    platform_daily_frp: Dict[str, Sequence[float]],
    active_platforms: Sequence[str],
    selected_platforms: Optional[Sequence[str]] = None,
    platform_daily_nadir_frp: Optional[Dict[str, Sequence[float]]] = None,
    platform_daily_clusters: Optional[Dict[str, Sequence[float]]] = None,
) -> Dict[str, Any]:
    """
    Master analytical function for Sections 3, 5, 6, and 7:
    - Enumerates all non-empty subsets of active_platforms.
    - Computes exact tie-preserving top-day sets for Detection Count and Summed Observed FRP.
    - Builds the 2D Platform Subset x Metric Matrix and Top-Day Union.
    - Evaluates all 6 mandatory Sensitivity Classifications (CORR-04 compliant).
    - Computes Pivotal-Subset Platform Influence (I_p) for both Count and FRP.
    """
    avail = [p for p in active_platforms if p in platform_daily_count]
    sel = [p for p in (selected_platforms or avail) if p in avail]
    if not sel and avail:
        sel = list(avail)

    subsets = enumerate_non_empty_subsets(avail)
    subset_rows: List[Dict[str, Any]] = []
    count_tops_map: Dict[Tuple[str, ...], List[str]] = {}
    frp_tops_map: Dict[Tuple[str, ...], List[str]] = {}
    nadir_tops_map: Dict[Tuple[str, ...], List[str]] = {}

    union_count_days: Set[str] = set()
    union_frp_days: Set[str] = set()
    union_all_days: Set[str] = set()

    for sub in subsets:
        sub_count = np.zeros(len(days), dtype=float)
        sub_frp = np.zeros(len(days), dtype=float)
        sub_nadir = np.zeros(len(days), dtype=float)
        sub_clust = np.zeros(len(days), dtype=float)

        for p in sub:
            sub_count += np.asarray(platform_daily_count[p], dtype=float)
            sub_frp += np.asarray(platform_daily_frp[p], dtype=float)
            if platform_daily_nadir_frp and p in platform_daily_nadir_frp:
                sub_nadir += np.asarray(platform_daily_nadir_frp[p], dtype=float)
            if platform_daily_clusters and p in platform_daily_clusters:
                sub_clust += np.asarray(platform_daily_clusters[p], dtype=float)

        c_dict = {days[i]: float(sub_count[i]) for i in range(len(days))}
        f_dict = {days[i]: float(sub_frp[i]) for i in range(len(days))}
        n_dict = {days[i]: float(sub_nadir[i]) for i in range(len(days))} if platform_daily_nadir_frp else {}
        cl_dict = {days[i]: float(sub_clust[i]) for i in range(len(days))} if platform_daily_clusters else {}

        top_c = compute_top_day_set(c_dict)
        top_f = compute_top_day_set(f_dict)
        top_n = compute_top_day_set(n_dict) if n_dict else []
        top_cl = compute_top_day_set(cl_dict) if cl_dict else []

        count_tops_map[sub] = top_c
        frp_tops_map[sub] = top_f
        if top_n:
            nadir_tops_map[sub] = top_n

        union_count_days.update(top_c)
        union_frp_days.update(top_f)
        union_all_days.update(top_c)
        union_all_days.update(top_f)

        rho_cf = compute_tie_averaged_spearman(sub_count.tolist(), sub_frp.tolist())

        subset_rows.append({
            "subset": list(sub),
            "subset_key": "+".join(sub),
            "subset_size": len(sub),
            "is_singleton": len(sub) == 1,
            "is_full_constellation": len(sub) == len(avail),
            "is_currently_selected": tuple(sel) == sub,
            "total_detections": int(round(float(np.sum(sub_count)))),
            "summed_frp_mw": round(float(np.sum(sub_frp)), 2),
            "daily_count": [int(round(x)) for x in sub_count.tolist()],
            "daily_frp": [round(float(x), 2) for x in sub_frp.tolist()],
            "top_count_days": top_c,
            "top_frp_days": top_f,
            "top_nadir_frp_days": top_n,
            "top_cluster_days": top_cl,
            "metrics_agree": top_c == top_f,
            "spearman_count_vs_frp": rho_cf,
        })

    # Sensitivity Classifications (Section 6 & CORR-04)
    distinct_count_sets = {tuple(v) for v in count_tops_map.values() if v}
    distinct_frp_sets = {tuple(v) for v in frp_tops_map.values() if v}

    sensor_sensitive_count = len(distinct_count_sets) > 1
    sensor_sensitive_frp = len(distinct_frp_sets) > 1
    sensor_set_sensitive = sensor_sensitive_count or sensor_sensitive_frp
    constellation_invariant = not sensor_set_sensitive

    sel_tuple = tuple(sel)
    sel_top_count = count_tops_map.get(sel_tuple, [])
    sel_top_frp = frp_tops_map.get(sel_tuple, [])
    metric_sensitive_selected = sel_top_count != sel_top_frp
    metric_sensitive_any = any(count_tops_map[s] != frp_tops_map[s] for s in subsets)
    metric_sensitive = metric_sensitive_selected or metric_sensitive_any

    platform_and_metric_sensitive = sensor_set_sensitive and metric_sensitive

    # CORR-04: No sensor consensus uses singleton tops[(p,)] for each metric, never hardcoded raw
    singleton_count_tops = [tuple(count_tops_map[(p,)]) for p in avail if (p,) in count_tops_map]
    singleton_frp_tops = [tuple(frp_tops_map[(p,)]) for p in avail if (p,) in frp_tops_map]

    no_consensus_count = len(avail) > 1 and len(set(singleton_count_tops)) == len(avail)
    no_consensus_frp = len(avail) > 1 and len(set(singleton_frp_tops)) == len(avail)

    full_tuple = tuple(avail)
    pooled_disagrees_count = any(
        count_tops_map.get(full_tuple) != count_tops_map.get((p,)) for p in avail
    )
    pooled_disagrees_frp = any(
        frp_tops_map.get(full_tuple) != frp_tops_map.get((p,)) for p in avail
    )

    if platform_and_metric_sensitive:
        primary_class = CLASS_PLATFORM_AND_METRIC_SENSITIVE
    elif sensor_set_sensitive:
        primary_class = CLASS_SENSOR_SET_SENSITIVE
    elif metric_sensitive:
        primary_class = CLASS_METRIC_SENSITIVE
    else:
        primary_class = CLASS_CONSTELLATION_INVARIANT

    active_flags = []
    if constellation_invariant and not metric_sensitive:
        active_flags.append(CLASS_CONSTELLATION_INVARIANT)
    if sensor_set_sensitive:
        active_flags.append(CLASS_SENSOR_SET_SENSITIVE)
    if metric_sensitive:
        active_flags.append(CLASS_METRIC_SENSITIVE)
    if platform_and_metric_sensitive:
        active_flags.append(CLASS_PLATFORM_AND_METRIC_SENSITIVE)
    if no_consensus_count or no_consensus_frp:
        active_flags.append(CLASS_NO_SENSOR_CONSENSUS)
    if pooled_disagrees_count or pooled_disagrees_frp:
        active_flags.append(CLASS_POOLED_RANK_DISAGREEMENT)

    influence_count = compute_pivotal_subset_influence(count_tops_map, avail)
    influence_frp = compute_pivotal_subset_influence(frp_tops_map, avail)

    return {
        "available_platforms": avail,
        "selected_platforms": sel,
        "subset_count": len(subsets),
        "subset_matrix": subset_rows,
        "selected_summary": next((r for r in subset_rows if r["is_currently_selected"]), subset_rows[-1] if subset_rows else None),
        "top_day_union": {
            "count_union": sorted(union_count_days),
            "frp_union": sorted(union_frp_days),
            "joint_union": sorted(union_all_days),
            "union_size": len(union_all_days),
            "is_single_stable_date": len(union_all_days) == 1,
        },
        "classifications": {
            "primary": primary_class,
            "active_badges": active_flags,
            "CONSTELLATION_INVARIANT": constellation_invariant and not metric_sensitive,
            "SENSOR_SET_SENSITIVE": sensor_set_sensitive,
            " SENSOR_SET_SENSITIVE_COUNT": sensor_sensitive_count,
            "SENSOR_SET_SENSITIVE_FRP": sensor_sensitive_frp,
            "METRIC_SENSITIVE": metric_sensitive,
            "METRIC_SENSITIVE_SELECTED": metric_sensitive_selected,
            "PLATFORM_AND_METRIC_SENSITIVE": platform_and_metric_sensitive,
            "NO_SENSOR_CONSENSUS_COUNT": no_consensus_count,
            "NO_SENSOR_CONSENSUS_FRP": no_consensus_frp,
            "POOLED_RANK_DISAGREEMENT_COUNT": pooled_disagrees_count,
            "POOLED_RANK_DISAGREEMENT_FRP": pooled_disagrees_frp,
        },
        "platform_influence": {
            "detection_count": influence_count,
            "summed_frp": influence_frp,
        },
    }


def compute_d3_trajectory(
    days: Sequence[str],
    daily_values: Sequence[float],
    metric_name: str = "OBSERVED DETECTION COUNT",
) -> Dict[str, Any]:
    """
    Section 11 — Operational Decision D3 (Multi-Day Trajectory).
    Computes early-window vs late-window change with explicit comparison windows,
    numerator, denominator, and OLS linear slope.
    """
    vals = [float(v) for v in daily_values]
    n = len(vals)
    if n < 4:
        return {"status": "INSUFFICIENT_WINDOW", "days": list(days)}

    # Standard 3d vs 3d for 7-day window
    early_days = list(days[:3])
    late_days = list(days[-3:])
    early_sum = float(np.sum(vals[:3]))
    late_sum = float(np.sum(vals[-3:]))
    pct_3d = round(((late_sum - early_sum) / early_sum) * 100.0, 2) if early_sum > 0 else None

    # 2d vs 2d sensitivity check
    early_2d = float(np.sum(vals[:2]))
    late_2d = float(np.sum(vals[-2:]))
    pct_2d = round(((late_2d - early_2d) / early_2d) * 100.0, 2) if early_2d > 0 else None

    # OLS daily slope
    x = np.arange(n, dtype=float)
    slope = float(np.polyfit(x, np.asarray(vals, dtype=float), 1)[0])

    direction = "DECLINING" if (pct_3d is not None and pct_3d < 0) else ("INCREASING" if (pct_3d and pct_3d > 0) else "FLAT")
    return {
        "metric": metric_name,
        "early_window_days": early_days,
        "late_window_days": late_days,
        "early_window_sum": round(early_sum, 2),
        "late_window_sum": round(late_sum, 2),
        "numerator_delta": round(late_sum - early_sum, 2),
        "denominator_early_sum": round(early_sum, 2),
        "pct_change_3d_vs_3d": pct_3d,
        "pct_change_2d_vs_2d": pct_2d,
        "ols_daily_slope": round(slope, 2),
        "direction": direction,
        "missing_days_count": 0,
    }
