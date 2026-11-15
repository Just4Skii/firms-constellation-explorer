/**
 * FIRMS CONSTELLATION INTELLIGENCE — HISTORICAL & SATELLITE OBSERVATION POP-UP (fire_imagery.js)
 * Renders provenance-classified ground photographs alongside timestamped NASA GIBS,
 * Landsat-8, and Copernicus Sentinel-2 satellite observation imagery:
 *  - Mode 1 ('ground_photo'): VERIFIED_INCIDENT_PHOTO / ILLUSTRATIVE_BIOME_FIRE / SATELLITE_OBSERVATION_ONLY
 *  - Mode 2 ('true_color'):   INCIDENT_DATE_TRUE_COLOR / LANDSAT8_OLI_TRUE_COLOR / SENTINEL2_L2A_TRUE_COLOR / REPRESENTATIVE_REGIONAL_SWATH
 *  - Mode 3 ('swir_fire'):    SWIR_721_FALSE_COLOR_COMPOSITE
 *  - Mode 4 ('sensor_footprint'): MODIS ~1 km vs VIIRS ~375 m Pixel-Center Geometry
 */
(function (global) {
  'use strict';

  const ZONE_ASSETS = {
    kalahari_molopo: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/incidents/kalahari_2026_sat.jpg',
      swir: 'assets/incidents/kalahari_2026_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'INCIDENT_DATE_TRUE_COLOR',
      photoMeta: 'NASA EOSDIS GIBS Aqua MODIS · 2026-11-07 · Public domain (No verified on-ground photo attached)',
      satLabel: 'INCIDENT_DATE_TRUE_COLOR · NASA GIBS Aqua MODIS · 2026-11-07 Kalahari Smoke',
      caption: 'Molopo–Kalahari Detection Coordinate (-20.74°, 24.57°)',
    },
    central_kalahari_frp: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/incidents/kalahari_2026_sat.jpg',
      swir: 'assets/incidents/kalahari_2026_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'INCIDENT_DATE_TRUE_COLOR',
      photoMeta: 'NASA EOSDIS GIBS Aqua MODIS · 2026-11-07 · Public domain (Satellite observation only)',
      satLabel: 'INCIDENT_DATE_TRUE_COLOR · NASA GIBS Aqua MODIS · 2026-11-07 Kalahari Basin',
      caption: 'Central Kalahari Detection Coordinate (-23.72°, 22.25°)',
    },
    mozambique_zambezia: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/fires/mozambique_zambezia_tc.jpg',
      swir: 'assets/fires/mozambique_zambezia_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'REPRESENTATIVE_REGIONAL_SWATH',
      photoMeta: 'NASA VIIRS NOAA-20 · Regional thermal observation (No verified on-ground photo)',
      satLabel: 'REPRESENTATIVE_REGIONAL_SWATH · NASA VIIRS NOAA-20 · Niassa / Cabo Delgado',
      caption: 'Northern Mozambique Corridor (-11.42°, 39.18°)',
    },
    waf_sahel_belt: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/fires/waf_sahel_belt_tc.jpg',
      swir: 'assets/fires/waf_sahel_belt_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'REPRESENTATIVE_REGIONAL_SWATH',
      photoMeta: 'NASA VIIRS NOAA-20 · Sudano-Sahelian Belt (Satellite observation only)',
      satLabel: 'REPRESENTATIVE_REGIONAL_SWATH · NASA VIIRS NOAA-20 · Sudano-Sahelian Belt',
      caption: 'Sahel Belt (8.15°, 18.22°)',
    },
    car_bushfires_2025: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/incidents/car_2025_sat.jpg',
      swir: 'assets/incidents/car_2025_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'INCIDENT_DATE_TRUE_COLOR',
      photoMeta: 'NASA EOSDIS GIBS · 2025-12-18 · Public domain (Satellite observation only)',
      satLabel: 'INCIDENT_DATE_TRUE_COLOR · NASA GIBS Terra MODIS · 2025-12-18 Dry-Season Belt',
      caption: 'Central Africa Dec 2025 (7.45°, 21.85°)',
    },
    pringle_bay_2024: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/incidents/pringle_bay_2024_sat.jpg',
      swir: 'assets/incidents/pringle_bay_2024_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'LANDSAT8_OLI_TRUE_COLOR',
      photoMeta: 'USGS / NASA Landsat-8 OLI · 2024-01-31 · Public domain (30 m optical capture)',
      satLabel: 'LANDSAT8_OLI_TRUE_COLOR · 2024-01-31 Hangklip Active Front',
      caption: 'Pringle Bay 2024 (-34.35°, 18.83°)',
    },
    lahaina_2023: {
      hasVerifiedGroundPhoto: true,
      ground: 'assets/incidents/lahaina_2023_ground.jpg',
      groundAlt: 'assets/incidents/lahaina_2023_aftermath.jpg',
      sat: 'assets/incidents/lahaina_2023_sat.jpg',
      swir: 'assets/incidents/lahaina_2023_swir.jpg',
      photoClass: 'VERIFIED_INCIDENT_PHOTO',
      satProductType: 'INCIDENT_DATE_TRUE_COLOR',
      photoMeta: 'U.S. Coast Guard District 14 · 2023-08-08 · Public domain (Alt: U.S. Civil Air Patrol Front St)',
      groundLabel: 'VERIFIED_INCIDENT_PHOTO · Lahaina Harbor Fire Aug 8, 2023 (U.S. Coast Guard, Public Domain)',
      satLabel: 'INCIDENT_DATE_TRUE_COLOR · NASA GIBS Terra MODIS · 2023-08-09 West Maui Plume',
      caption: 'Lahaina, Maui 2023 (20.88°, -156.68°)',
    },
    chobe_okavango_2022: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/incidents/chobe_2022_sat.jpg',
      swir: 'assets/incidents/chobe_2022_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'INCIDENT_DATE_TRUE_COLOR',
      photoMeta: 'NASA EOSDIS GIBS Aqua MODIS · 2022-05-23 · Public domain (Satellite observation only)',
      satLabel: 'INCIDENT_DATE_TRUE_COLOR · NASA GIBS Aqua MODIS · 2022-05-23 Chobe–Zambezi',
      caption: 'Chobe 2022 Pixel-Center Peak (-17.96°, 24.33°)',
    },
    angola_zambia_miombo: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/fires/angola_zambia_miombo_tc.jpg',
      swir: 'assets/fires/angola_zambia_miombo_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'REPRESENTATIVE_REGIONAL_SWATH',
      photoMeta: 'NASA VIIRS NOAA-20 · Upper Zambezi May 2022 (Satellite observation only)',
      satLabel: 'REPRESENTATIVE_REGIONAL_SWATH · NASA VIIRS NOAA-20 · Upper Zambezi May 2022',
      caption: 'Upper Zambezi (-14.22°, 20.84°)',
    },
    table_mountain_2021: {
      hasVerifiedGroundPhoto: true,
      ground: 'assets/incidents/table_mountain_2021_ground2.jpg',
      groundAlt: 'assets/incidents/table_mountain_2021_uct_ground.jpg',
      sat: 'assets/incidents/table_mountain_2021_sat.jpg',
      swir: 'assets/incidents/table_mountain_2021_swir.jpg',
      photoClass: 'VERIFIED_INCIDENT_PHOTO',
      satProductType: 'INCIDENT_DATE_TRUE_COLOR',
      photoMeta: 'axxter99 · 2021-04-18 14:59 / 14:57 · CC BY-SA 4.0 (Table Mountain slopes)',
      groundLabel: 'VERIFIED_INCIDENT_PHOTO · Table Mtn April 18, 2021 Flames (axxter99, CC BY-SA 4.0)',
      satLabel: 'INCIDENT_DATE_TRUE_COLOR · NASA GIBS Terra MODIS · 2021-04-18 False Bay Plume',
      caption: 'Table Mountain & UCT 2021 (-33.95°, 18.46°)',
    },
    bejaia_algeria_2021: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/incidents/bejaia_algeria_2021_sat.jpg',
      swir: 'assets/incidents/bejaia_algeria_2021_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'SENTINEL2_L2A_TRUE_COLOR',
      photoMeta: 'Copernicus Sentinel-2 L2A · 2021-08-12 · Open Data (Satellite observation only)',
      satLabel: 'SENTINEL2_L2A_TRUE_COLOR · Copernicus Sentinel-2 · 2021-08-12 Béjaïa',
      caption: 'Béjaïa Kabylia 2021 (36.68°, 4.55°)',
    },
    kilimanjaro_2020: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/incidents/kilimanjaro_2020_sat.jpg',
      swir: 'assets/incidents/kilimanjaro_2020_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'SENTINEL2_L2A_TRUE_COLOR',
      photoMeta: 'Copernicus Sentinel-2 L2A · 2020-10-15 · Open Data (Satellite observation only)',
      satLabel: 'SENTINEL2_L2A_TRUE_COLOR · Copernicus Sentinel-2 · 2020-10-15 Mt. Kilimanjaro',
      caption: 'Kilimanjaro 2020 (-3.11°, 37.39°)',
    },
    aus_black_summer_2020: {
      hasVerifiedGroundPhoto: true,
      ground: 'assets/incidents/aus_black_summer_2020_ground.jpg',
      sat: 'assets/incidents/aus_black_summer_2020_sat.jpg',
      swir: 'assets/incidents/aus_black_summer_2020_swir.jpg',
      photoClass: 'VERIFIED_INCIDENT_PHOTO',
      satProductType: 'INCIDENT_DATE_TRUE_COLOR',
      photoMeta: 'Nick-D · 2020-01-28 · CC BY-SA 4.0 (Orroral Valley Fire glow, ACT Australia)',
      groundLabel: 'VERIFIED_INCIDENT_PHOTO · Orroral Valley Ridge Fire Jan 28, 2020 (Nick-D, CC BY-SA 4.0)',
      satLabel: 'INCIDENT_DATE_TRUE_COLOR · NASA GIBS Terra MODIS · 2020-01-01 NSW / Victoria',
      caption: 'Black Summer 2020 (-37.24°, 149.45°)',
    },
    knysna_2017: {
      hasVerifiedGroundPhoto: true,
      ground: 'assets/incidents/knysna_2017_ground.jpg',
      sat: 'assets/incidents/knysna_2017_sat.jpg',
      swir: 'assets/incidents/knysna_2017_swir.jpg',
      photoClass: 'VERIFIED_INCIDENT_PHOTO',
      satProductType: 'INCIDENT_DATE_TRUE_COLOR',
      photoMeta: 'Gbawden · 2017-07-31 · CC BY-SA 4.0 (Post-event Knysna burn scar)',
      groundLabel: 'VERIFIED_INCIDENT_PHOTO · Post-Fire Knysna Ridge (Gbawden, CC BY-SA 4.0)',
      satLabel: 'INCIDENT_DATE_TRUE_COLOR · NASA GIBS Terra MODIS · 2017-06-07 Garden Route Plume',
      caption: 'Knysna Disaster 2017 (-34.04°, 23.05°)',
    },
    muizenberg_2015: {
      hasVerifiedGroundPhoto: true,
      ground: 'assets/incidents/muizenberg_2015_night_ground.jpg',
      groundAlt: 'assets/incidents/muizenberg_2015_ground.jpg',
      sat: 'assets/incidents/muizenberg_2015_sat.jpg',
      swir: 'assets/incidents/muizenberg_2015_swir.jpg',
      photoClass: 'VERIFIED_INCIDENT_PHOTO',
      satProductType: 'INCIDENT_DATE_TRUE_COLOR',
      photoMeta: 'SkyPixels · 2015-03-03 / 03-04 · CC BY-SA 4.0 (Muizenberg / Peninsula fire)',
      groundLabel: 'VERIFIED_INCIDENT_PHOTO · Water Bomber Above Muizenberg (SkyPixels, CC BY-SA 4.0)',
      satLabel: 'INCIDENT_DATE_TRUE_COLOR · NASA GIBS Terra MODIS · 2015-03-02 Atlantic Plume',
      caption: 'Muizenberg / Tokai 2015 (-34.10°, 18.46°)',
    },
    detection_cell: {
      hasVerifiedGroundPhoto: false,
      ground: null,
      sat: 'assets/incidents/kalahari_2026_sat.jpg',
      swir: 'assets/incidents/kalahari_2026_swir.jpg',
      photoClass: 'SATELLITE_OBSERVATION_ONLY',
      satProductType: 'REPRESENTATIVE_REGIONAL_SWATH',
      photoMeta: 'FIRMS MODIS / VIIRS Detection Cell (No verified on-ground photograph attached)',
      satLabel: 'REPRESENTATIVE_REGIONAL_SWATH · Regional MODIS / VIIRS Detection Context',
      caption: 'FIRMS Detection Pixel Center',
    },
  };

  class FireSatelliteReconPopup {
    constructor() {
      this.popupEl = document.getElementById('fireReconPopup');
      this.canvas = document.getElementById('reconImageryCanvas');
      this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
      this.activeBand = 'ground_photo'; // 'ground_photo' | 'true_color' | 'swir_fire' | 'sensor_footprint'
      this.showAltGround = false;
      this.currentZone = null;
      this.currentDate = '2026-11-13';
      this.localPoints = [];
      this.zonesList = [];
      this.imageCache = new Map();
      this.onNavigateZone = null;
      this.onCloseZoomOut = null;
      this.onOpenFireStory = null;

      this._bindControls();
      this._preloadCoreAssets();
    }

    _preloadCoreAssets() {
      ['table_mountain_2021', 'knysna_2017', 'lahaina_2023', 'muizenberg_2015', 'kalahari_molopo'].forEach(k => {
        const spec = ZONE_ASSETS[k];
        if (!spec) return;
        if (spec.ground) this._getOrLoadImage(spec.ground);
        this._getOrLoadImage(spec.sat);
      });
    }

    _getOrLoadImage(src) {
      if (!src) return null;
      if (this.imageCache.has(src)) return this.imageCache.get(src);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (this.popupEl && this.popupEl.classList.contains('open')) {
          this.renderImagery();
        }
      };
      img.src = src;
      this.imageCache.set(src, img);
      return img;
    }

    _bindControls() {
      document.querySelectorAll('[data-recon-band]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.reconBand === 'ground_photo' && this.activeBand === 'ground_photo') {
            this.showAltGround = !this.showAltGround;
          } else {
            this.showAltGround = false;
          }
          this.activeBand = btn.dataset.reconBand;
          document.querySelectorAll('[data-recon-band]').forEach(b => b.classList.toggle('active', b === btn));
          this.renderImagery();
        });
      });

      const closeBtn = document.getElementById('closeReconPopupBtn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.hide(true));
      }

      const prevZoneBtn = document.getElementById('reconPrevZoneBtn');
      const nextZoneBtn = document.getElementById('reconNextZoneBtn');
      if (prevZoneBtn) prevZoneBtn.addEventListener('click', () => this._stepZone(-1));
      if (nextZoneBtn) nextZoneBtn.addEventListener('click', () => this._stepZone(1));

      const storyBtn = document.getElementById('reconOpenStoryBtn');
      if (storyBtn) {
        storyBtn.addEventListener('click', () => {
          if (this.currentZone && this.currentZone.storyId && typeof this.onOpenFireStory === 'function') {
            this.onOpenFireStory(this.currentZone.storyId);
          }
        });
      }
    }

    setZonesList(zones) {
      this.zonesList = zones || [];
    }

    _stepZone(dir) {
      if (!this.zonesList.length || !this.currentZone) return;
      const idx = this.zonesList.findIndex(z => z.id === this.currentZone.id);
      const safeIdx = idx >= 0 ? idx : 0;
      const nextIdx = (safeIdx + dir + this.zonesList.length) % this.zonesList.length;
      const nextZone = this.zonesList[nextIdx];
      if (typeof this.onNavigateZone === 'function') {
        this.onNavigateZone(nextZone);
      }
    }

    show(zone, dateStr, dayPoints, activePlatforms) {
      if (!this.popupEl || !zone) return;
      this.currentZone = zone;
      this.currentDate = zone.incidentDate || dateStr || '2026-11-13';
      this.showAltGround = false;

      const lat0 = zone.lat;
      const lon0 = zone.lon;
      const platSet = new Set(activePlatforms || ['Terra', 'Aqua', 'NOAA-20', 'NOAA-21']);
      this.localPoints = (dayPoints || []).filter(d =>
        platSet.has(d[0]) &&
        Math.abs(d[1] - lat0) <= 3.6 &&
        Math.abs(d[2] - lon0) <= 3.6
      );

      let totalObs = 0;
      let totalFrp = 0;
      let modisObs = 0;
      let viirsObs = 0;
      this.localPoints.forEach(d => {
        totalObs += d[3];
        totalFrp += d[4];
        if (d[0] === 'Terra' || d[0] === 'Aqua') modisObs += d[3];
        else viirsObs += d[3];
      });

      const dispObs = totalObs > 0 ? totalObs : (zone.clickedCell ? zone.clickedCell[3] : (zone.clusters1km || '—'));
      const dispFrp = totalFrp > 0 ? totalFrp : (zone.clickedCell ? zone.clickedCell[4] : (zone.maxFrpMw || 0));

      const setEl = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
      };

      setEl('reconZoneTitle', zone.title || 'Active Fire Swath Target');
      setEl('reconZoneSub', `${zone.regionName || 'Southern Africa Focus'} · (${lat0.toFixed(4)}°, ${lon0.toFixed(4)}°) · Event: ${this.currentDate}`);
      setEl('reconStatObs', typeof dispObs === 'number' ? dispObs.toLocaleString() : dispObs);
      setEl('reconStatFrp', `${Math.round(Number(dispFrp) || 0).toLocaleString()} MW`);
      setEl('reconStatRatio', modisObs + viirsObs > 0 ? `${modisObs} MODIS · ${viirsObs} VIIRS` : (zone.year ? `Year ${zone.year} Archive` : 'Archive Pass'));

      const assetSpec = ZONE_ASSETS[zone.id] || ZONE_ASSETS.detection_cell;
      const groundBtn = document.querySelector('[data-recon-band="ground_photo"]');
      if (groundBtn) {
        groundBtn.style.display = assetSpec.hasVerifiedGroundPhoto ? '' : 'none';
      }
      if (!assetSpec.hasVerifiedGroundPhoto && this.activeBand === 'ground_photo') {
        this.activeBand = 'true_color';
      } else if (assetSpec.hasVerifiedGroundPhoto && !this.popupEl.classList.contains('open')) {
        this.activeBand = 'ground_photo';
      }

      const provTag = this.activeBand === 'ground_photo'
        ? `${assetSpec.photoClass || 'PHOTOGRAPH'} · ${assetSpec.photoMeta || ''}`
        : `${assetSpec.satProductType || 'SATELLITE_OBSERVATION'} · Obs Date: ${this.currentDate}`;
      setEl('reconStatPeakNote', `${zone.subtitle || assetSpec.caption} · ${provTag}`);

      const storyBtn = document.getElementById('reconOpenStoryBtn');
      if (storyBtn) {
        if (zone.storyId) {
          storyBtn.style.display = 'inline-flex';
          storyBtn.textContent = `📜 Open Full Fire Story (${zone.year}) ›`;
        } else {
          storyBtn.style.display = 'none';
        }
      }

      // Sync active tab UI
      document.querySelectorAll('[data-recon-band]').forEach(b => b.classList.toggle('active', b.dataset.reconBand === this.activeBand));

      this.popupEl.classList.add('open');
      this.renderImagery();
    }

    hide(zoomOut = false) {
      if (this.popupEl) this.popupEl.classList.remove('open');
      if (zoomOut && typeof this.onCloseZoomOut === 'function') {
        this.onCloseZoomOut();
      }
    }

    _drawCoverImage(ctx, img, w, h) {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(img, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh);
    }

    renderImagery() {
      if (!this.canvas || !this.ctx || !this.currentZone) return;
      const w = 440;
      const h = 250;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }

      const ctx = this.ctx;
      const zone = this.currentZone;
      const assetSpec = ZONE_ASSETS[zone.id] || ZONE_ASSETS.detection_cell;
      const band = (!assetSpec.hasVerifiedGroundPhoto && this.activeBand === 'ground_photo')
        ? 'true_color'
        : this.activeBand;

      let chosenPath = assetSpec.sat;
      if (band === 'ground_photo' && assetSpec.hasVerifiedGroundPhoto) {
        chosenPath = (this.showAltGround && assetSpec.groundAlt) ? assetSpec.groundAlt : (assetSpec.ground || assetSpec.sat);
      } else if (band === 'swir_fire') {
        chosenPath = assetSpec.swir || assetSpec.sat;
      }

      const localImg = this._getOrLoadImage(chosenPath);

      ctx.fillStyle = '#070E1A';
      ctx.fillRect(0, 0, w, h);

      if (localImg && localImg.complete && localImg.naturalWidth > 0) {
        this._drawCoverImage(ctx, localImg, w, h);
      }

      if (band === 'sensor_footprint') {
        ctx.fillStyle = 'rgba(4, 10, 22, 0.52)';
        ctx.fillRect(0, 0, w, h);
      }

      // Overlay FIRMS Detections ONLY on satellite bands (keep actual news/ground photo crisp & clean!)
      if (band !== 'ground_photo') {
        const latSpan = 4.4;
        const lonSpan = 6.8;
        const mapPt = (lat, lon) => ({
          x: w * 0.5 + ((lon - zone.lon) / lonSpan) * w,
          y: h * 0.5 - ((lat - zone.lat) / latSpan) * h,
        });

        const ptsToPlot = this.localPoints.slice(0, 140);
        for (let i = 0; i < ptsToPlot.length; i++) {
          const d = ptsToPlot[i];
          const p = mapPt(d[1], d[2]);
          if (p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) continue;
          const plat = d[0];
          const isModis = plat === 'Terra' || plat === 'Aqua';
          const mag = Math.min(1.0, Math.log10((d[4] || d[3]) + 1) / 3.4);

          if (band === 'sensor_footprint') {
            if (isModis) {
              ctx.strokeStyle = 'rgba(56, 189, 248, 0.92)';
              ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
              ctx.lineWidth = 1.4;
              ctx.fillRect(p.x - 8, p.y - 8, 16, 16);
              ctx.strokeRect(p.x - 8, p.y - 8, 16, 16);
            } else {
              ctx.fillStyle = plat === 'NOAA-21' ? '#C084FC' : '#FACC15';
              ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
            }
          } else {
            ctx.fillStyle = 'rgba(250, 204, 21, 0.26)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4 + mag * 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(254, 240, 138, 0.88)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.5 + mag * 2, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // Target Crosshair for satellite modes
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w / 2 - 12, h / 2); ctx.lineTo(w / 2 + 12, h / 2);
        ctx.moveTo(w / 2, h / 2 - 12); ctx.lineTo(w / 2, h / 2 + 12);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(226, 232, 240, 0.30)';
      ctx.lineWidth = 1;
      ctx.strokeRect(8, 8, w - 16, h - 16);

      // Top badge with explicit photographic / satellite product classification
      const photoClass = assetSpec.photoClass || 'ILLUSTRATIVE_BIOME_FIRE';
      const satProduct = assetSpec.satProductType || 'INCIDENT_DATE_TRUE_COLOR';
      const badgeMap = {
        ground_photo: assetSpec.groundAlt ? `${photoClass} (CLICK TAB TO SWAP)` : photoClass,
        true_color: satProduct,
        swir_fire: 'SWIR_721_FALSE_COLOR_COMPOSITE',
        sensor_footprint: 'MODIS ~1 km BOX vs VIIRS ~375 m FOOTPRINT',
      };
      const badgeColor = band === 'ground_photo'
        ? (photoClass === 'VERIFIED_INCIDENT_PHOTO' ? '#34D399' : '#FBBF24')
        : (band === 'swir_fire' ? '#FCA5A5' : '#7DD3FC');
      ctx.fillStyle = 'rgba(2, 6, 23, 0.86)';
      ctx.fillRect(12, 12, 340, 20);
      ctx.font = '700 9.6px "JetBrains Mono", monospace';
      ctx.fillStyle = badgeColor;
      ctx.fillText(badgeMap[band] || '', 18, 25);

      // Bottom full provenance caption bar
      ctx.fillStyle = 'rgba(2, 6, 23, 0.86)';
      ctx.fillRect(12, h - 32, w - 24, 20);
      ctx.font = '600 9.2px "JetBrains Mono", monospace';
      ctx.fillStyle = '#E2E8F0';
      const bottomText = band === 'ground_photo'
        ? (assetSpec.photoMeta || assetSpec.groundLabel)
        : assetSpec.satLabel;
      ctx.fillText((bottomText || assetSpec.caption).slice(0, 68), 18, h - 18);
    }
  }

  global.FireSatelliteReconPopup = FireSatelliteReconPopup;
})(window);
