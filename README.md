<div align="center">

# 🌍 Eyes on Fire: FIRMS Constellation & Earth Intelligence Explorer

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FIRMS Active Fire Data](https://img.shields.io/badge/Data-FIRMS_MODIS_%2F_VIIRS-EA580C)](https://firms.modaps.eosdis.nasa.gov/)
[![Render Ready](https://img.shields.io/badge/Deploy-Render_Web_Service-46E3B7?logo=render&logoColor=0F172A)](render.yaml)
[![Canadian FWI](https://img.shields.io/badge/Fire_Danger-CFFDRS_FWI_System-FB923C)](engine/cffdrs_cffwis.py)

Interactive WebGL 3D Earth-observation explorer uniting **multi-satellite active-fire detections (MODIS & VIIRS)**, **verified historical wildfire documentaries**, **real-time & ERA5 atmospheric weather + wind vectors**, **Canadian FWI fire danger**, and **scientific readiness gates**.

</div>

---

## ✨ Key Capabilities

- **3D Orbital Earth & Retina Tile Zoom** (`public/js/globe3d.js`): Smooth 60 FPS WebGL globe with Terra, Aqua, NOAA-20, and NOAA-21 orbits, Night IR thermal mode, and spherical imagery streaming.
- **Earth Intelligence · Layers** (`+` next to **Earth from Orbit**):
  - **Satellite Observations**: Toggleable MODIS / VIIRS thermal detections *(explicitly labeled: thermal detection ≠ confirmed wildfire)* and orbit swaths.
  - **Atmospheric & Land Conditions**: Real-time ECMWF / GFS / ECCC NWP weather & Copernicus ERA5 reanalysis (`2m Temp`, `Humidity / VPD`, animated `10m Wind Vectors`, `Precipitation`, `Soil Moisture`, `Vegetation Stress`, `CAPE / Lightning`).
  - **Canadian FWI Fire Danger**: True Van Wagner (1987) CFFDRS codes (`FFMC`, `DMC`, `DC`, `ISI`, `BUI`, `FWI`) computed strictly as a physical weather danger index, never misrepresented as ignition probability.
- **Temporal Mode Switcher (`Historical` | `Live` | `Forecast`)**: Strict provenance enforcement separating ERA5-Land historical reanalysis, near-real-time observations/assimilations, and `+24h/+48h/+72h` NWP forecasts.
- **Curated Historical Fire Stories** (`public/js/fire_stories.js`): Event-pinned documentary chapters with broadcaster embeds and separately labeled narration audio tracks.
- **Science Lab & CORR-01..05 Hygiene**: Constellation subset analysis (`2^K - 1`), 1 km Haversine clustering (`M2c`), nadir-filtered FRP (`M4c`), `FEED_EMPTY_IN_RETRIEVAL` null-vs-zero detection (`CORR-03`), and **AMFI-02 Readiness Gates (`G1–G5`)**.

---

## 📁 Repository Structure

```text
├── server.py               # Portable multi-threaded Python HTTP + REST API server
├── render.yaml             # Render Web Service Blueprint (build/start/healthcheck)
├── requirements.txt        # numpy, scipy
├── Procfile                # Render/Heroku process definition
├── engine/
│   ├── analytics_engine.py # Constellation metrics, M2c 1 km clustering & CORR-01..05
│   ├── earth_intel_engine.py # Multi-source weather API, CFFDRS FWI & AMFI readiness
│   └── cffdrs_cffwis.py    # Canadian Forest Fire Weather Index equations (MIT)
├── data/
│   ├── amfi_readiness_matrix.csv
│   ├── amfi_px_rounds.csv
│   └── coverage_selection_experiment.json
├── datasets/               # Raw NASA FIRMS MODIS & VIIRS archival CSV observations
│   ├── firms_2026_global/  # 7-day & 24h global MODIS/VIIRS C2 pilot snapshots
│   ├── firms_2022_global/  # May 2022 independent replication window
│   └── firms_southern_africa/ # Regional MODIS/VIIRS & Suomi-NPP empty-feed benchmark
├── public/                 # Static WebGL 3D frontend, Fire Stories media & precomputed JSON
└── tests/
    └── test_standalone_deploy.py
```

---

## 📊 Included NASA FIRMS Observation Datasets

| Folder | Scope | Satellite Feeds Included | Notes |
|---|---|---|---|
| `datasets/firms_2026_global/` | Nov 2026 Clean Pilot Window | MODIS C6.1, NOAA-20 (J1), NOAA-21 (J2) | Cleaned under CORR-03 trailing partial UTC day quarantine |
| `datasets/firms_2022_global/` | May 2022 Replication Window | MODIS, NOAA-20 (J1) | 3-platform independent validation baseline |
| `datasets/firms_southern_africa/` | Regional High-Resolution Focus | MODIS, NOAA-20, NOAA-21, Suomi-NPP | Includes 112-byte header-only `SNPP_7d_Southern_Africa.csv` (`FEED_EMPTY_IN_RETRIEVAL`) |

---

## 🚀 Quickstart (Local)

```bash
pip install -r requirements.txt
python server.py
```
Open `http://localhost:8088/` in your browser, or run the automated test suite:

```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

---

## ☁️ Deploy on Render

1. On [Render Dashboard](https://dashboard.render.com/), choose **New +** → **Blueprint** (or **Web Service**) and connect this repository.
2. Render automatically reads `render.yaml`:
   - **Runtime:** Python 3 (`runtime.txt`)
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python server.py`
   - **Health Check:** `/api/health`

---

## 🤖 Use of Super Intelligence (SI) Disclosure

Super Intelligence (SI) tools were used to accelerate development, refactoring, and documentation for **Eyes on Fire**:

- **Code & Data Tooling:** SI assisted with structuring the Python analytics API (`server.py`, `engine/analytics_engine.py`, `engine/earth_intel_engine.py`), the WebGL 3D frontend overlays (`public/js/`), and the standalone verification test suite. All MODIS/VIIRS active-fire metrics, ERA5/NWP meteorological variables, and CFFDRS FWI equations remain strictly grounded in deterministic scientific sources with zero hallucinated predictions.
- **Audio Narration:** Chapter voiceovers inside `Fire Stories` (labeled `AI_GENERATED_NARRATION` in UI metadata) and walkthrough demo video voiceovers (`en-US-AndrewNeural`) were generated with SI neural speech synthesis strictly from cited historical and technical scripts.
- **Images & Videos:** Project demo walkthrough videos include a persistent top-right SI watermark (`SI-Assisted Demo | SI-Generated Audio & Visuals`) and matching MP4 container metadata. No official agency logos or mission insignia are modified or included in generated branding elements.
