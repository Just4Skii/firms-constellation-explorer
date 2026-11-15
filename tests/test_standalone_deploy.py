"""
Standalone verification suite for the isolated NASA FIRMS Constellation Explorer repository.
Ensures zero external workspace dependencies and full API/scientific correctness.
"""
from __future__ import annotations

import json
import os
import sys
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from engine.analytics_engine import (
    SOURCE_STATE_EMPTY_FEED,
    compute_geodesic_clusters_1km,
    utc_to_local_solar_time,
)
from engine.earth_intel_engine import (
    compute_cffdrs_fwi_bundle,
    get_amfi_intelligence_summary,
    get_weather_and_fwi_field,
)
from server import process_uploaded_csv


class TestStandaloneRepo(unittest.TestCase):
    def test_01_public_bundles_and_datasets_present(self):
        for rel in [
            "public/index.html",
            "public/data/firms_bundle.json",
            "public/data/fire_stories_bundle.json",
            "data/amfi_readiness_matrix.csv",
            "datasets/firms_2026_global/modis_7d.csv",
            "datasets/firms_2026_global/viirs_j1_7d.csv",
            "datasets/firms_2022_global/viirs_j1_7d_2022.csv",
            "datasets/firms_southern_africa/SNPP_7d_Southern_Africa.csv",
        ]:
            self.assertTrue(os.path.exists(os.path.join(REPO_ROOT, rel)), f"Missing {rel}")

    def test_02_corr03_header_only_snpp_empty_feed(self):
        snpp_path = os.path.join(REPO_ROOT, "datasets", "firms_southern_africa", "SNPP_7d_Southern_Africa.csv")
        with open(snpp_path, "r", encoding="utf-8") as f:
            raw = f.read()
        res = process_uploaded_csv("SNPP_7d_Southern_Africa.csv", raw, "Suomi-NPP")
        self.assertEqual(res["source_state"], SOURCE_STATE_EMPTY_FEED)
        self.assertIsNone(res["data_rows"])

    def test_03_cffdrs_fwi_not_ignition_probability(self):
        out = compute_cffdrs_fwi_bundle(34.0, 18.0, 35.0, 0.0, month=8)
        self.assertEqual(out["classification"], "FIRE_DANGER_INDEX")
        self.assertFalse(out["is_ignition_probability"])
        self.assertGreater(out["fwi"], 10.0)

    def test_04_earth_intel_modes_and_amfi_readiness(self):
        hist = get_weather_and_fwi_field(mode="historical", year=2021, allow_remote=False)
        self.assertIn("NOT a pre-fire forecast", hist["mode_notice"])
        self.assertEqual(hist["amfi_03_prospective_ignition"]["status"], "BLOCKED")

        amfi = get_amfi_intelligence_summary()
        self.assertEqual(amfi["campaigns"]["amfi_02"]["total_items"], 32)
        self.assertIsNone(amfi["campaigns"]["amfi_01"]["champion"])

    def test_05_math_sanity(self):
        self.assertAlmostEqual(utc_to_local_solar_time(12.0, 30.0), 14.0, places=5)
        clust = compute_geodesic_clusters_1km([(-24.5, 22.5, 10.0), (-24.502, 22.502, 15.0)])
        self.assertEqual(clust["cluster_count"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
