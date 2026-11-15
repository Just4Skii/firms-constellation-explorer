"""
FIRMS Constellation Intelligence — Multi-Threaded HTTP & Scientific REST API Server.
Serves the interactive frontend from D:\\code randoms\\Counsil\\app\\public
and exposes live analytical, geodesic clustering, CSV ingestion (with CORR-03
partial-day quarantine & empty-feed detection), and reproducible export endpoints.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from engine.analytics_engine import (
    SOURCE_STATE_AVAILABLE,
    SOURCE_STATE_EMPTY_FEED,
    SOURCE_STATE_FAILED,
    SOURCE_STATE_PARTIAL,
    analyze_constellation_and_metrics,
    classify_source_state,
    compute_d3_trajectory,
    compute_geodesic_clusters_1km,
    filter_nadir_frp_records,
    parse_acq_time_to_utc_hours,
    quarantine_partial_trailing_days,
    utc_to_local_solar_time,
)
from engine.earth_intel_engine import (
    get_amfi_intelligence_summary,
    get_weather_and_fwi_field,
)

PUBLIC_DIR = os.path.join(BASE_DIR, "public")
BUNDLE_PATH = os.path.join(PUBLIC_DIR, "data", "firms_bundle.json")

_BUNDLE_CACHE = None


def get_bundle() -> dict:
    global _BUNDLE_CACHE
    if _BUNDLE_CACHE is None and os.path.exists(BUNDLE_PATH):
        with open(BUNDLE_PATH, "r", encoding="utf-8") as f:
            _BUNDLE_CACHE = json.load(f)
    return _BUNDLE_CACHE or {}


def process_uploaded_csv(filename: str, csv_content: str, platform_label: str = "VIIRS") -> dict:
    """
    Ingest a local FIRMS CSV file, compute SHA-256 provenance, enforce CORR-03
    (header-only empty feed -> FEED_EMPTY_IN_RETRIEVAL with data_rows = null;
    trailing partial UTC day -> quarantined as PARTIAL_DATA), and compute
    daily M1 Count, M2c 1km Geodesic Clusters, M3 Total FRP, M4c Nadir FRP, and LST.
    """
    raw_bytes = csv_content.encode("utf-8")
    file_bytes = len(raw_bytes)
    sha256_hex = hashlib.sha256(raw_bytes).hexdigest()

    lines = [ln for ln in csv_content.splitlines() if ln.strip()]
    if not lines:
        state = classify_source_state(0, 0, has_valid_header=False)
        return {"filename": filename, "sha256": sha256_hex, "file_bytes": file_bytes, **state}

    reader = csv.DictReader(io.StringIO(csv_content))
    fieldnames = reader.fieldnames or []
    required_cols = {"latitude", "longitude", "acq_date", "frp"}
    has_header = required_cols.issubset(set(fieldnames))

    if not has_header:
        state = classify_source_state(file_bytes, 0, has_valid_header=False)
        return {
            "filename": filename,
            "sha256": sha256_hex,
            "file_bytes": file_bytes,
            "columns_found": fieldnames,
            **state,
        }

    rows = list(reader)
    if len(rows) == 0:
        state = classify_source_state(file_bytes, 0, has_valid_header=True)
        return {
            "filename": filename,
            "sha256": sha256_hex,
            "file_bytes": file_bytes,
            "columns_found": fieldnames,
            **state,
        }

    # Group by acq_date and validate coordinates/timestamps
    date_to_recs = {}
    invalid_coords = 0
    lst_hours = []

    for r in rows:
        try:
            lat = float(r.get("latitude", 0.0))
            lon = float(r.get("longitude", 0.0))
            frp = float(r.get("frp", 0.0))
            scan = float(r.get("scan", 0.4))
            track = float(r.get("track", 0.4))
            d_str = str(r.get("acq_date", "")).strip()
            t_str = str(r.get("acq_time", "1200")).strip()
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0) or not d_str:
                invalid_coords += 1
                continue
            utc_h = parse_acq_time_to_utc_hours(t_str)
            lst_h = utc_to_local_solar_time(utc_h, lon)
            lst_hours.append(lst_h)
            rec = {
                "latitude": lat,
                "longitude": lon,
                "frp": frp,
                "scan": scan,
                "track": track,
                "acq_date": d_str,
                "acq_time": t_str,
                "utc_hour": round(utc_h, 3),
                "lst_hour": round(lst_h, 3),
                "platform": r.get("satellite") or platform_label,
            }
            date_to_recs.setdefault(d_str, []).append(rec)
        except Exception:
            invalid_coords += 1

    q_info = quarantine_partial_trailing_days(date_to_recs, expected_full_days=7)
    clean_dates = q_info["clean_dates"]
    daily_summary = []

    for d in clean_dates:
        d_recs = date_to_recs[d]
        cnt = len(d_recs)
        tot_frp = round(sum(x["frp"] for x in d_recs), 2)
        nadir_frp, nadir_cnt = filter_nadir_frp_records(d_recs, default_platform=platform_label)
        pts = [(x["latitude"], x["longitude"], x["frp"]) for x in d_recs[:2500]]
        clust = compute_geodesic_clusters_1km(pts, radius_km=1.0)
        daily_summary.append({
            "date": d,
            "observed_detection_count": cnt,
            "spatial_detection_cluster_count_1km": clust["cluster_count"],
            "summed_observed_frp_mw": tot_frp,
            "nadir_filtered_total_frp_mw": round(nadir_frp, 2),
            "nadir_retained_count": nadir_cnt,
        })

    return {
        "filename": filename,
        "sha256": sha256_hex,
        "file_bytes": file_bytes,
        "source_state": SOURCE_STATE_AVAILABLE,
        "total_raw_rows": len(rows),
        "clean_window_rows": sum(len(date_to_recs[d]) for d in clean_dates),
        "invalid_coordinate_rows": invalid_coords,
        "clean_dates": clean_dates,
        "quarantined_dates": q_info["quarantined_dates"],
        "quarantine_details": q_info["quarantine_details"],
        "median_lst_hour": round(float(sorted(lst_hours)[len(lst_hours) // 2]), 2) if lst_hours else None,
        "daily_summary": daily_summary,
    }


class FIRMSRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, format: str, *args) -> None:
        # Quiet concise logging
        pass

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            bundle = get_bundle()
            self._send_json({
                "status": "ok",
                "project": "FIRMS Constellation Intelligence",
                "validation_outcome": "GO — VALIDATED_WITH_CORRECTIONS",
                "bundle_loaded": bool(bundle),
                "windows_available": list(bundle.get("windows", {}).keys()),
                "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            return

        if parsed.path == "/api/bundle":
            self._send_json(get_bundle())
            return

        if parsed.path == "/api/earth-intelligence":
            qs = parse_qs(parsed.query)
            mode = qs.get("mode", ["live"])[0]
            date_str = qs.get("date", [None])[0]
            year_val = int(qs.get("year", ["2026"])[0] or 2026)
            lead_h = int(qs.get("lead_hours", ["24"])[0] or 24)
            allow_remote = qs.get("remote", ["1"])[0] != "0"
            payload = get_weather_and_fwi_field(
                mode=mode,
                date_str=date_str,
                year=year_val,
                forecast_lead_hours=lead_h,
                allow_remote=allow_remote,
            )
            self._send_json(payload)
            return

        if parsed.path == "/api/amfi-intel":
            self._send_json(get_amfi_intelligence_summary())
            return

        if parsed.path == "/api/export/csv":
            qs = parse_qs(parsed.query)
            window_id = qs.get("window", ["2026-11"])[0]
            region_id = qs.get("region", ["saf"])[0]
            bundle = get_bundle()
            win = bundle.get("windows", {}).get(window_id, {})
            reg = win.get("regions", {}).get(region_id, {})
            days = reg.get("days", [])
            platforms = reg.get("platforms", [])
            daily = reg.get("daily_by_platform", {})

            out = io.StringIO()
            out.write(f"# FIRMS CONSTELLATION INTELLIGENCE — REPRODUCIBLE DAILY AGGREGATION EXPORT\n")
            out.write(f"# Window: {window_id} | Region: {region_id} | Platforms: {','.join(platforms)}\n")
            out.write(f"# Coverage Status: DATA_AVAILABLE (Partial trailing UTC day quarantined per CORR-03)\n")
            out.write(f"# Generated UTC: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n")
            writer = csv.writer(out)
            writer.writerow([
                "date", "platform", "observed_detection_count",
                "summed_observed_frp_mw", "nadir_filtered_total_frp_mw", "spatial_occupancy_0p25_cells"
            ])
            for i, d in enumerate(days):
                for p in platforms:
                    writer.writerow([
                        d,
                        p,
                        daily.get("count", {}).get(p, [0] * len(days))[i],
                        daily.get("frp", {}).get(p, [0.0] * len(days))[i],
                        daily.get("nadir_frp", {}).get(p, [0.0] * len(days))[i],
                        daily.get("spatial_clusters", {}).get(p, [0] * len(days))[i],
                    ])
            csv_bytes = out.getvalue().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="firms_{window_id}_{region_id}_daily.csv"')
            self.send_header("Content-Length", str(len(csv_bytes)))
            self.end_headers()
            self.wfile.write(csv_bytes)
            return

        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            body = json.loads(raw_body)
        except Exception:
            self._send_json({"error": "Invalid JSON body"}, status=400)
            return

        if parsed.path == "/api/analyze":
            bundle = get_bundle()
            window_id = body.get("window_id", "2026-11")
            region_id = body.get("region_id", "saf")
            win = bundle.get("windows", {}).get(window_id, {})
            reg = win.get("regions", {}).get(region_id, {})
            if not reg:
                self._send_json({"error": f"Unknown window/region: {window_id}/{region_id}"}, status=404)
                return

            avail = body.get("active_platforms") or reg["platforms"]
            sel = body.get("selected_platforms") or avail
            res = analyze_constellation_and_metrics(
                days=reg["days"],
                platform_daily_count=reg["daily_by_platform"]["count"],
                platform_daily_frp=reg["daily_by_platform"]["frp"],
                active_platforms=avail,
                selected_platforms=sel,
                platform_daily_nadir_frp=reg["daily_by_platform"].get("nadir_frp"),
                platform_daily_clusters=reg["daily_by_platform"].get("spatial_clusters"),
            )
            self._send_json(res)
            return

        if parsed.path == "/api/ingest-csv":
            filename = body.get("filename", "uploaded_firms.csv")
            csv_content = body.get("csv_content", "")
            platform_label = body.get("platform", "VIIRS")
            res = process_uploaded_csv(filename, csv_content, platform_label=platform_label)
            self._send_json(res)
            return

        self._send_json({"error": f"Unknown endpoint {parsed.path}"}, status=404)


def run_server(port: int | None = None) -> None:
    bind_port = int(port if port is not None else os.environ.get("PORT", 8088))
    bind_host = os.environ.get("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((bind_host, bind_port), FIRMSRequestHandler)
    print(f"FIRMS Constellation Intelligence running at http://{bind_host}:{bind_port}/")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    port_arg = int(sys.argv[1]) if len(sys.argv) > 1 else None
    run_server(port_arg)
