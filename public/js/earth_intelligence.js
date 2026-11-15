/**
 * Earth Intelligence & AMFI Scientific Layer Controller
 *
 * Adds:
 * 1. "Earth intelligence · Layers" multi-layer selector from the "+" button next to Earth from Orbit
 * 2. Live, Historical (ERA5-Land Reanalysis), and Forecast (NWP + FWI) weather overlays on 3D & 2D globe
 * 3. Animated Wind Vectors, Thermal/VPD/Rain/Soil/Vegetation/FWI color ramps & Lightning strike markers
 * 4. Clickable Hexagonal Research & AMFI-02 Data-Readiness Evidence Inspector (never red prediction pins)
 * 5. AMFI-02 Data Readiness & AMFI Discovery/Evidence Science Lab drawers
 */
(function (global) {
  'use strict';

  const DEG2RAD = Math.PI / 180;
  const TWO_PI = Math.PI * 2;

  const LAYER_CATALOG = [
    // 1. Satellite Observations
    {
      id: 'obs_firms',
      group: 'observations',
      label: 'MODIS / VIIRS detections',
      sub: 'Satellite thermal pixels (≠ confirmed wildfire)',
      status: 'Available',
      badgeColor: '#38BDF8',
      defaultOn: true,
    },
    {
      id: 'obs_orbits',
      group: 'observations',
      label: 'Satellite orbit tracks',
      sub: 'Terra, Aqua, NOAA-20 & NOAA-21 swaths',
      status: 'Available',
      badgeColor: '#38BDF8',
      defaultOn: true,
    },

    // 2. Atmospheric & Land Intelligence
    {
      id: 'temp_2m',
      group: 'atmosphere',
      label: 'Temperature (2m Air)',
      sub: 'ERA5-Land / Live / Forecast °C thermal surface',
      status: 'Surface',
      badgeColor: '#F97316',
      scalarKey: 'temperature_2m_c',
      unit: '°C',
      minVal: 8,
      maxVal: 38,
      ramp: [
        [56, 189, 248],
        [52, 211, 153],
        [250, 204, 21],
        [249, 115, 22],
        [239, 68, 68],
      ],
    },
    {
      id: 'humidity_vpd',
      group: 'atmosphere',
      label: 'Humidity / VPD',
      sub: 'Atmospheric drying power (Vapor Pressure Deficit kPa)',
      status: 'Surface',
      badgeColor: '#FBBF24',
      scalarKey: 'vpd_kpa',
      unit: 'kPa',
      minVal: 0.4,
      maxVal: 4.5,
      ramp: [
        [59, 130, 246],
        [56, 189, 248],
        [250, 204, 21],
        [245, 158, 11],
        [244, 63, 94],
      ],
    },
    {
      id: 'wind_vectors',
      group: 'atmosphere',
      label: 'Wind vectors',
      sub: '10m speed & direction streamlines (km/h)',
      status: 'Vectors',
      badgeColor: '#67E8F9',
    },
    {
      id: 'precipitation',
      group: 'atmosphere',
      label: 'Precipitation',
      sub: 'Rainfall & 24h accumulated moisture (mm)',
      status: 'Surface',
      badgeColor: '#3B82F6',
      scalarKey: 'precipitation_mm',
      unit: 'mm',
      minVal: 0,
      maxVal: 12,
      ramp: [
        [15, 23, 42],
        [14, 116, 144],
        [56, 189, 248],
        [59, 130, 246],
        [168, 85, 247],
      ],
    },
    {
      id: 'soil_moisture',
      group: 'atmosphere',
      label: 'Soil moisture',
      sub: 'Top-layer land moisture (m³/m³)',
      status: 'Surface',
      badgeColor: '#10B981',
      scalarKey: 'soil_moisture_m3m3',
      unit: 'm³/m³',
      minVal: 0.05,
      maxVal: 0.42,
      ramp: [
        [180, 83, 9],
        [217, 119, 6],
        [132, 204, 22],
        [16, 185, 129],
        [6, 182, 212],
      ],
    },
    {
      id: 'veg_stress',
      group: 'atmosphere',
      label: 'Vegetation moisture / stress',
      sub: 'Combined fuel drying & moisture deficit',
      status: 'Surface',
      badgeColor: '#A3E635',
      scalarKey: 'vegetation_stress',
      unit: 'idx',
      minVal: 0.1,
      maxVal: 1.0,
      ramp: [
        [34, 197, 94],
        [163, 230, 53],
        [250, 204, 21],
        [249, 115, 22],
        [225, 29, 72],
      ],
    },
    {
      id: 'lightning',
      group: 'atmosphere',
      label: 'Lightning & CAPE',
      sub: 'Convective storm energy & strike corridors',
      status: 'Markers',
      badgeColor: '#C084FC',
    },

    // 3. Fire Danger (Separate from Ignition Prediction)
    {
      id: 'fwi_danger',
      group: 'danger',
      label: 'Canadian FWI Fire Danger',
      sub: 'Weather fuel-drying & spread index (≠ ignition prob.)',
      status: 'Danger',
      badgeColor: '#FB923C',
      scalarKey: 'fwi',
      unit: 'FWI',
      minVal: 0,
      maxVal: 45,
      ramp: [
        [52, 211, 153],
        [250, 204, 21],
        [249, 115, 22],
        [239, 68, 68],
        [190, 18, 60],
      ],
    },

    // 4. AMFI Research & Readiness (Strictly Hexagonal — Never Red Pins)
    {
      id: 'amfi_readiness',
      group: 'amfi',
      label: 'AMFI-02 Data Readiness Grid',
      sub: 'Clickable hex audit of gates G1–G5 & evidence gaps',
      status: 'Hex Grid',
      badgeColor: '#2DD4BF',
    },
    {
      id: 'amfi_d01_research',
      group: 'amfi',
      label: 'D-AMFI-01 Research Surface',
      sub: 'AMFI-01 gated research only; no PX prediction layer',
      status: 'Gated',
      badgeColor: '#A78BFA',
    },
    {
      id: 'obs_opportunities',
      group: 'amfi',
      label: 'Observation Opportunities (Pilot)',
      sub: 'Acquired / valid / matched — no prediction pins or probabilities',
      status: 'Audit',
      badgeColor: '#22D3EE',
    },
  ];

  function lerpColor(ramp, t) {
    const clamped = Math.max(0, Math.min(1, t));
    const seg = clamped * (ramp.length - 1);
    const i = Math.min(ramp.length - 2, Math.floor(seg));
    const f = seg - i;
    const a = ramp[i];
    const b = ramp[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ];
  }

  class EarthIntelligenceController {
    constructor(appState) {
      this.state = appState;
      this.mode = 'live'; // 'historical' | 'live' | 'forecast'
      this.forecastLeadHours = 24;
      this.activeLayers = new Set(['obs_firms', 'obs_orbits']);
      this.weatherField = null;
      this.amfiSummary = null;
      this.observationOpportunities = [];
      this.renderedObservationNodes = [];
      this.renderedHexNodes = [];
      this.selectedEvidencePoint = null;
      this._fetchSeq = 0;
    }

    init() {
      this._renderLayersPopover();
      this._bindControls();
      this._attachGlobeRenderer();
      this.fetchAmfiIntel();
      this.fetchWeatherField();
      this._syncLayerCounterUI();
    }

    _attachGlobeRenderer() {
      const g = this.state.globe3d;
      if (!g || g._earthIntelAttached) return;
      g._earthIntelAttached = true;

      // Wrap render so environmental layers & hex grids draw cleanly in Earth-surface space
      const origRender = g.render.bind(g);
      g.render = (now = performance.now()) => {
        // Respect obs_firms & Forecast rule for point/pin visibility before base draw
        const allowFirePoints = this.activeLayers.has('obs_firms') && this.mode !== 'forecast';
        g._suppressFirePoints = !allowFirePoints;
        origRender(now);
      };

      const origFirePass = g._renderFirePointsLOD3D.bind(g);
      g._renderFirePointsLOD3D = (ctx, cx, cy, baseRadius, sinPhi0, cosPhi0) => {
        this.renderOverlays3D(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, performance.now() * 0.001);
        if (!g._suppressFirePoints) {
          origFirePass(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0);
        } else {
          g.renderedScreenPoints = [];
        }
      };

      const origEventsPass = g._renderGlobeEventsFast.bind(g);
      g._renderGlobeEventsFast = (ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec) => {
        if (!g._suppressFirePoints) {
          origEventsPass(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec);
        } else {
          g.renderedEventPins = [];
        }
      };

      const orig2D = g._render2DMode.bind(g);
      g._render2DMode = (ctx, w, h) => {
        const allowFirePoints = this.activeLayers.has('obs_firms') && this.mode !== 'forecast';
        g._suppressFirePoints = !allowFirePoints;
        orig2D(ctx, w, h);
        this.renderOverlays2D(ctx, w, h, performance.now() * 0.001);
      };

      // Intercept globe clicks cleanly to inspect clickable hex/research grid cells when active
      const origClick = g._handleClick.bind(g);
      g._handleClick = (e) => {
        const rect = g.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Priority 0: observation-opportunity pilot nodes
        for (const o of this.renderedObservationNodes) {
          if (Math.hypot(o.x - mx, o.y - my) <= o.hitRadius) {
            this.openObservationPopup(o.observation);
            return;
          }
        }

        // Priority 1: FIRMS pins/clusters if visible (handled by origClick)
        // Check first if a hex evidence cell was clicked when hex/weather overlays are active
        for (const h of this.renderedHexNodes) {
          if (Math.hypot(h.x - mx, h.y - my) <= h.hitRadius) {
            this.openEvidencePopup(h.point);
            return;
          }
        }
        if (!g._suppressFirePoints) {
          origClick(e);
        }
      };

      // Extend hover tooltip for hex / weather grid probes
      const origHover = g._handleHover.bind(g);
      g._handleHover = (e) => {
        origHover(e);
        if (!g.tooltip || g.tooltip.style.display === 'block') return;
        const rect = g.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        for (const h of this.renderedHexNodes) {
          if (Math.hypot(h.x - mx, h.y - my) <= h.hitRadius) {
            const pt = h.point;
            g.canvas.style.cursor = 'pointer';
            g.tooltip.innerHTML = `
              <div style="font-weight:700;color:#2DD4BF;font-size:10.5px;text-transform:uppercase">🔬 CLICK GRID CELL FOR EVIDENCE</div>
              <div style="font-weight:700;color:#F8FAFC;font-size:12.5px;margin:2px 0">${pt.name}</div>
              <div class="mono" style="font-size:11px;color:#CBD5E1;line-height:1.4">
                T2m: <b>${pt.weather.temperature_2m_c}°C</b> · VPD: <b>${pt.weather.vpd_kpa} kPa</b> · Wind: <b>${pt.weather.wind_speed_10m_kmh} km/h</b><br>
                Canadian FWI: <b style="color:#FB923C">${pt.fwi_system.fwi} (${pt.fwi_system.danger_class})</b> · Not ignition prob.
              </div>
            `;
            g.tooltip.style.display = 'block';
            g.tooltip.style.left = Math.min(rect.width - 270, mx + 14) + 'px';
            g.tooltip.style.top = Math.max(14, my - 20) + 'px';
            return;
          }
        }
        for (const o of this.renderedObservationNodes) {
          if (Math.hypot(o.x - mx, o.y - my) <= o.hitRadius) {
            const obs = o.observation;
            g.canvas.style.cursor = 'pointer';
            g.tooltip.innerHTML = `
              <div style="font-weight:700;color:#22D3EE;font-size:10.5px;text-transform:uppercase">OBSERVATION PILOT · NO PREDICTION</div>
              <div style="font-weight:700;color:#F8FAFC;font-size:12.5px;margin:2px 0">${obs.name}</div>
              <div class="mono" style="font-size:11px;color:#CBD5E1;line-height:1.4">
                ${obs.platform} · ${obs.date}<br>
                Status: <b>${obs.status}</b>${obs.event_id ? `<br>Event: <b>${obs.event_id}</b>` : ''}<br>
                ${obs.detail}
              </div>
            `;
            g.tooltip.style.display = 'block';
            g.tooltip.style.left = Math.min(rect.width - 300, mx + 14) + 'px';
            g.tooltip.style.top = Math.max(14, my - 20) + 'px';
            return;
          }
        }
      };
    }

    _getScalarValue(pt, key) {
      if (key === 'fwi') return pt.fwi_system ? pt.fwi_system.fwi : 0;
      return pt.weather ? (pt.weather[key] ?? 0) : 0;
    }

    renderOverlays3D(ctx, cx, cy, baseRadius, sinPhi0, cosPhi0, elapsedSec) {
      const g = this.state.globe3d;
      if (!g || !this.weatherField || !Array.isArray(this.weatherField.points)) return;

      this.renderedHexNodes = [];
      this.renderedObservationNodes = [];
      const points = this.weatherField.points;
      const zoomScale = Math.sqrt(Math.max(0.8, g.zoom || 1));

      // Find active scalar overlay (prefer most specific if multiple selected)
      const scalarPriority = ['fwi_danger', 'temp_2m', 'humidity_vpd', 'precipitation', 'soil_moisture', 'veg_stress'];
      const activeScalars = scalarPriority
        .map(id => this.activeLayers.has(id) ? LAYER_CATALOG.find(l => l.id === id) : null)
        .filter(Boolean);

      const showWind = this.activeLayers.has('wind_vectors');
      const showLightning = this.activeLayers.has('lightning');
      const showReadiness = this.activeLayers.has('amfi_readiness');
      const showDamfi = this.activeLayers.has('amfi_d01_research');
      const showObs = this.activeLayers.has('obs_opportunities');
      const showWeatherProbeHex = activeScalars.length > 0 || showWind || showLightning;

      // 1. Scalar Heatmap Surfaces (Temperature, VPD, Rain, Soil, Vegetation, FWI Fire Danger)
      for (const layerMeta of activeScalars) {
        const splatBaseR = Math.max(22, Math.min(95, (baseRadius * 0.145) / Math.pow(zoomScale, 0.25)));
        for (const pt of points) {
          const p = g.projectFast3D(Math.sin(pt.lat * DEG2RAD), Math.cos(pt.lat * DEG2RAD), pt.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);
          if (!p.visible || p.z < 0.08) continue;

          const val = this._getScalarValue(pt, layerMeta.scalarKey);
          const norm = (val - layerMeta.minVal) / Math.max(0.001, layerMeta.maxVal - layerMeta.minVal);
          const [r, gr, b] = lerpColor(layerMeta.ramp, norm);
          const rad = splatBaseR * (0.85 + 0.45 * p.z);

          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
          grad.addColorStop(0, `rgba(${r}, ${gr}, ${b}, 0.56)`);
          grad.addColorStop(0.55, `rgba(${r}, ${gr}, ${b}, 0.28)`);
          grad.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0.0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad, 0, TWO_PI);
          ctx.fill();
        }
      }

      // 2. Animated Wind Vectors (Projected East/North tangent vectors on sphere)
      if (showWind) {
        ctx.save();
        for (const pt of points) {
          const p = g.projectFast3D(Math.sin(pt.lat * DEG2RAD), Math.cos(pt.lat * DEG2RAD), pt.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);
          if (!p.visible || p.z < 0.14) continue;

          const pEast = g.projectFast3D(Math.sin(pt.lat * DEG2RAD), Math.cos(pt.lat * DEG2RAD), pt.lon + 2.0, sinPhi0, cosPhi0, cx, cy, baseRadius);
          const pNorth = g.projectFast3D(Math.sin((pt.lat + 2.0) * DEG2RAD), Math.cos((pt.lat + 2.0) * DEG2RAD), pt.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);

          let ex = pEast.x - p.x;
          let ey = pEast.y - p.y;
          let nx = pNorth.x - p.x;
          let ny = pNorth.y - p.y;
          const eLen = Math.hypot(ex, ey) || 1;
          const nLen = Math.hypot(nx, ny) || 1;
          ex /= eLen; ey /= eLen;
          nx /= nLen; ny /= nLen;

          // Meteorological wind_direction_deg = direction wind blows FROM; arrow points TO (+180 deg)
          const toRad = ((pt.weather.wind_direction_deg + 180) % 360) * DEG2RAD;
          const u = Math.sin(toRad);
          const v = Math.cos(toRad);
          const vx = u * ex + v * nx;
          const vy = u * ey + v * ny;

          const speedNorm = Math.min(1.6, Math.max(0.5, pt.weather.wind_speed_10m_kmh / 26.0));
          const arrowLen = (14 + 12 * speedNorm) * Math.min(1.4, zoomScale);
          const phase = ((elapsedSec * 1.4 + pt.lon * 0.05) % 1 + 1) % 1;
          const driftX = (phase - 0.5) * arrowLen * 0.45 * vx;
          const driftY = (phase - 0.5) * arrowLen * 0.45 * vy;

          const x0 = p.x - vx * arrowLen * 0.45 + driftX;
          const y0 = p.y - vy * arrowLen * 0.45 + driftY;
          const x1 = x0 + vx * arrowLen;
          const y1 = y0 + vy * arrowLen;

          ctx.strokeStyle = pt.weather.wind_speed_10m_kmh >= 30 ? 'rgba(251, 191, 36, 0.92)' : 'rgba(103, 232, 249, 0.88)';
          ctx.lineWidth = pt.weather.wind_speed_10m_kmh >= 30 ? 2.1 : 1.6;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          // Arrowhead
          const headLen = 5.5;
          const angle = Math.atan2(vy, vx);
          ctx.lineTo(x1 - headLen * Math.cos(angle - 0.52), y1 - headLen * Math.sin(angle - 0.52));
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - headLen * Math.cos(angle + 0.52), y1 - headLen * Math.sin(angle + 0.52));
          ctx.stroke();
        }
        ctx.restore();
      }

      // 3. Lightning & Convective CAPE Markers
      if (showLightning) {
        ctx.save();
        for (const pt of points) {
          if (!pt.weather.lightning_active) continue;
          const p = g.projectFast3D(Math.sin(pt.lat * DEG2RAD), Math.cos(pt.lat * DEG2RAD), pt.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);
          if (!p.visible || p.z < 0.14) continue;

          const flash = 0.55 + 0.45 * Math.sin(elapsedSec * 5.2 + pt.lat);
          ctx.fillStyle = `rgba(192, 132, 252, ${0.26 * flash})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 16, 0, TWO_PI);
          ctx.fill();

          // Crisp bolt icon
          ctx.strokeStyle = '#E9D5FF';
          ctx.fillStyle = '#A855F7';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(p.x + 2, p.y - 8);
          ctx.lineTo(p.x - 4, p.y + 1);
          ctx.lineTo(p.x + 0.5, p.y + 1);
          ctx.lineTo(p.x - 2, p.y + 8);
          ctx.lineTo(p.x + 5, p.y - 1);
          ctx.lineTo(p.x + 0.5, p.y - 1);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // 4. Clickable Hexagonal Grid Nodes (AMFI-02 Readiness, D-AMFI-01, or Weather Probe Hexes)
      if (showReadiness || showDamfi || showWeatherProbeHex) {
        for (const pt of points) {
          const isAlberta = pt.region === 'alberta';
          if (showDamfi && !showReadiness && !showWeatherProbeHex && !isAlberta) continue;

          const p = g.projectFast3D(Math.sin(pt.lat * DEG2RAD), Math.cos(pt.lat * DEG2RAD), pt.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);
          if (!p.visible || p.z < 0.12) continue;

          const hexR = (showReadiness || showDamfi) ? 14 : 9;
          let strokeCol = 'rgba(56, 189, 248, 0.65)';
          let fillCol = 'rgba(56, 189, 248, 0.12)';
          let badgeText = '';

          if (showReadiness) {
            if (isAlberta) {
              strokeCol = '#F59E0B';
              fillCol = 'rgba(245, 158, 11, 0.24)';
              badgeText = `PARTIAL · ${pt.amfi_block}`;
            } else {
              strokeCol = '#FB7185';
              fillCol = 'rgba(244, 63, 94, 0.16)';
              badgeText = 'G1–G5 REQ';
            }
          } else if (showDamfi && isAlberta) {
            strokeCol = '#A78BFA';
            fillCol = 'rgba(167, 139, 250, 0.28)';
            badgeText = `${pt.amfi_evidence.relative_likelihood_lift}× REC`;
          } else if (activeScalars.length > 0) {
            const topScalar = activeScalars[0];
            const val = this._getScalarValue(pt, topScalar.scalarKey);
            strokeCol = 'rgba(226, 232, 240, 0.60)';
            fillCol = 'rgba(15, 23, 42, 0.42)';
            badgeText = `${val}`;
          }

          this._drawHexagon(ctx, p.x, p.y, hexR, strokeCol, fillCol);
          if (badgeText && (g.zoom >= 0.9 || showReadiness || (showDamfi && isAlberta))) {
            ctx.font = '600 9.5px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#E2E8F0';
            ctx.fillText(badgeText, p.x, p.y + hexR + 10);
            ctx.textAlign = 'left';
          }

          this.renderedHexNodes.push({
            x: p.x,
            y: p.y,
            hitRadius: Math.max(14, hexR + 4),
            point: pt,
          });
        }
      }

      // 5. Observation-opportunity pilot nodes (acquired / valid / matched / detection-only)
      if (showObs) {
        for (const obs of this.observationOpportunities) {
          if (typeof obs.lat !== 'number' || typeof obs.lon !== 'number') continue;
          const p = g.projectFast3D(Math.sin(obs.lat * DEG2RAD), Math.cos(obs.lat * DEG2RAD), obs.lon, sinPhi0, cosPhi0, cx, cy, baseRadius);
          if (!p.visible || p.z < 0.12) continue;
          const color = (obs.status === 'valid_no_detection' || obs.status === 'active_clear_no_detection') ? '#22D3EE'
            : (obs.status === 'acquired_no_goes_detection' || obs.status === 'active_target_cloudy' || obs.status === 'temporally_uncertain' || obs.status === 'robust_active_clear_not_detected') ? '#F59E0B'
            : obs.status === 'detection_outside_alberta' ? '#A78BFA'
            : '#FB7185';
          ctx.save();
          ctx.strokeStyle = color;
          ctx.fillStyle = color + '33';
          ctx.lineWidth = 1.8;
          const r = 6.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - r);
          ctx.lineTo(p.x + r, p.y);
          ctx.lineTo(p.x, p.y + r);
          ctx.lineTo(p.x - r, p.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 4, 0, TWO_PI);
          ctx.strokeStyle = color + '88';
          ctx.stroke();
          ctx.restore();
          this.renderedObservationNodes.push({
            x: p.x,
            y: p.y,
            hitRadius: 16,
            observation: obs,
          });
        }
      }
    }

    renderOverlays2D(ctx, w, h) {
      const g = this.state.globe3d;
      if (!g || !this.weatherField || !Array.isArray(this.weatherField.points)) return;
      this.renderedHexNodes = [];
      this.renderedObservationNodes = [];

      const scalarPriority = ['fwi_danger', 'temp_2m', 'humidity_vpd', 'precipitation', 'soil_moisture', 'veg_stress'];
      const activeScalar = scalarPriority
        .map(id => this.activeLayers.has(id) ? LAYER_CATALOG.find(l => l.id === id) : null)
        .find(Boolean);

      const showWind = this.activeLayers.has('wind_vectors');
      const showReadiness = this.activeLayers.has('amfi_readiness');
      const showDamfi = this.activeLayers.has('amfi_d01_research');
      const showObs = this.activeLayers.has('obs_opportunities');

      for (const pt of this.weatherField.points) {
        const proj = g.project2D(pt.lat, pt.lon, w, h);
        if (activeScalar) {
          const val = this._getScalarValue(pt, activeScalar.scalarKey);
          const norm = (val - activeScalar.minVal) / Math.max(0.001, activeScalar.maxVal - activeScalar.minVal);
          const [r, gr, b] = lerpColor(activeScalar.ramp, norm);
          const grad = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, 34);
          grad.addColorStop(0, `rgba(${r},${gr},${b},0.55)`);
          grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, 34, 0, TWO_PI);
          ctx.fill();
        }
        if (showWind) {
          const toRad = ((pt.weather.wind_direction_deg + 180) % 360) * DEG2RAD;
          const vx = Math.sin(toRad);
          const vy = -Math.cos(toRad);
          ctx.strokeStyle = '#67E8F9';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(proj.x - vx * 9, proj.y - vy * 9);
          ctx.lineTo(proj.x + vx * 9, proj.y + vy * 9);
          ctx.stroke();
        }
        if (showReadiness || showDamfi || activeScalar) {
          const hexR = showReadiness || showDamfi ? 10 : 7;
          this._drawHexagon(ctx, proj.x, proj.y, hexR, showDamfi ? '#A78BFA' : '#38BDF8', 'rgba(15,23,42,0.35)');
          this.renderedHexNodes.push({ x: proj.x, y: proj.y, hitRadius: 12, point: pt });
        }
      }

      if (showObs) {
        for (const obs of this.observationOpportunities) {
          if (typeof obs.lat !== 'number' || typeof obs.lon !== 'number') continue;
          const proj = g.project2D(obs.lat, obs.lon, w, h);
          const color = (obs.status === 'valid_no_detection' || obs.status === 'active_clear_no_detection') ? '#22D3EE'
            : (obs.status === 'acquired_no_goes_detection' || obs.status === 'active_target_cloudy' || obs.status === 'temporally_uncertain' || obs.status === 'robust_active_clear_not_detected') ? '#F59E0B'
            : obs.status === 'detection_outside_alberta' ? '#A78BFA'
            : '#FB7185';
          ctx.save();
          ctx.fillStyle = color + '44';
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(proj.x, proj.y - 6);
          ctx.lineTo(proj.x + 6, proj.y);
          ctx.lineTo(proj.x, proj.y + 6);
          ctx.lineTo(proj.x - 6, proj.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          this.renderedObservationNodes.push({ x: proj.x, y: proj.y, hitRadius: 14, observation: obs });
        }
      }
    }

    _drawHexagon(ctx, x, y, r, strokeStyle, fillStyle) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i - Math.PI / 6;
        const hx = x + r * Math.cos(ang);
        const hy = y + r * Math.sin(ang);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    async fetchWeatherField() {
      const seq = ++this._fetchSeq;
      const yr = this.state.selectedYear || 2026;
      const qs = new URLSearchParams({
        mode: this.mode,
        year: String(yr),
        lead_hours: String(this.forecastLeadHours),
      });
      if (
        this.mode === 'historical' &&
        (yr === 2026 || yr === 2022) &&
        this.state.selectedDateMode &&
        this.state.selectedDateMode !== 'ALL'
      ) {
        qs.set('date', this.state.selectedDateMode);
      }
      try {
        const resp = await fetch(`/api/earth-intelligence?${qs.toString()}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (seq !== this._fetchSeq) return;
        this.weatherField = data;
        this._updateHudProvenanceAndLegend();
      } catch (err) {
        console.warn('Earth intelligence fetch warning:', err);
      }
    }

    async fetchAmfiIntel() {
      try {
        const resp = await fetch('/api/amfi-intel');
        if (!resp.ok) return;
        this.amfiSummary = await resp.json();
        this.observationOpportunities = this.amfiSummary.observation_opportunities || [];
        this._renderAmfiDrawers();
      } catch (err) {
        console.warn('AMFI intel fetch warning:', err);
      }
    }

    setTemporalMode(newMode) {
      if (!['historical', 'live', 'forecast'].includes(newMode)) return;
      this.mode = newMode;

      document.querySelectorAll('.temporal-mode-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.temporalMode === newMode);
      });

      const leadWrap = document.getElementById('forecastLeadWrap');
      if (leadWrap) leadWrap.style.display = newMode === 'forecast' ? 'inline-flex' : 'none';

      // Auto-assist kids/students: in Forecast mode, make sure Canadian FWI / Temp are visible cleanly
      if (newMode === 'forecast') {
        const hasEnv = LAYER_CATALOG.some(l => (l.group === 'atmosphere' || l.group === 'danger') && this.activeLayers.has(l.id));
        if (!hasEnv) {
          this.activeLayers.add('fwi_danger');
          this.activeLayers.add('wind_vectors');
        }
      }

      this._renderLayersPopover();
      this._syncLayerCounterUI();
      this.fetchWeatherField();
    }

    toggleLayer(layerId) {
      if (layerId === 'obs_orbits') {
        const next = !this.activeLayers.has('obs_orbits');
        if (next) this.activeLayers.add('obs_orbits');
        else this.activeLayers.delete('obs_orbits');
        if (this.state.globe3d) {
          this.state.globe3d.showOrbits = next;
        }
        const orbitBtn = document.getElementById('eyesOrbitToggleBtn');
        const dockOrbitBtn = document.getElementById('bottomToggleOrbitsBtn');
        if (orbitBtn) orbitBtn.textContent = next ? 'Orbits: ON' : 'Orbits: OFF';
        if (dockOrbitBtn) dockOrbitBtn.classList.toggle('active', next);
      } else {
        if (this.activeLayers.has(layerId)) {
          this.activeLayers.delete(layerId);
        } else {
          this.activeLayers.add(layerId);
          // Fly smoothly to Alberta benchmark block when inspecting D-AMFI-01 if not zoomed elsewhere
          if (layerId === 'amfi_d01_research' && this.state.globe3d) {
            this.state.globe3d.flyTo(54.5, -114.0, 1.45);
          }
        }
      }
      this._renderLayersPopover();
      this._syncLayerCounterUI();
      this._updateHudProvenanceAndLegend();
    }

    _syncLayerCounterUI() {
      const count = this.activeLayers.size;
      const badgeEl = document.getElementById('selectedLayersCountPill');
      if (badgeEl) {
        badgeEl.textContent = `${count} layer${count === 1 ? '' : 's'}`;
      }
      const popCountEl = document.getElementById('earthIntelSelectedCount');
      if (popCountEl) popCountEl.textContent = String(count);
    }

    _updateHudProvenanceAndLegend() {
      const noticeBar = document.getElementById('earthIntelModeBanner');
      const legendEl = document.getElementById('earthIntelLegend');
      if (noticeBar && this.weatherField) {
        const modeTag = this.mode === 'historical'
          ? 'HISTORICAL · ERA5-LAND REANALYSIS (NOT FORECAST)'
          : this.mode === 'forecast'
            ? `FORECAST (+${this.forecastLeadHours}h NWP · AMFI-03 BLOCKED)`
            : 'LIVE ASSIMILATION · ECCC/ECMWF/FIRMS';
        noticeBar.innerHTML = `<span class="ei-mode-tag ei-mode-${this.mode}">${modeTag}</span> <span class="ei-mode-sub">${this.weatherField.api_source}</span>`;
        noticeBar.style.display = 'flex';
      }

      if (legendEl) {
        const scalarPriority = ['fwi_danger', 'temp_2m', 'humidity_vpd', 'precipitation', 'soil_moisture', 'veg_stress'];
        const activeScalar = scalarPriority
          .map(id => this.activeLayers.has(id) ? LAYER_CATALOG.find(l => l.id === id) : null)
          .find(Boolean);

        const parts = [];
        if (activeScalar) {
          const stops = activeScalar.ramp.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ');
          const extraNote = activeScalar.id === 'fwi_danger' ? ' · Fire Danger Index (≠ Ignition Prob.)' : '';
          parts.push(`
            <div class="ei-legend-row">
              <span class="ei-legend-title">${activeScalar.label}${extraNote}</span>
              <div class="ei-legend-bar" style="background:linear-gradient(90deg, ${stops})"></div>
              <div class="ei-legend-scale"><span>${activeScalar.minVal} ${activeScalar.unit}</span><span>${activeScalar.maxVal} ${activeScalar.unit}</span></div>
            </div>
          `);
        }
        if (this.activeLayers.has('wind_vectors')) {
          parts.push(`<div class="ei-legend-chip">💨 10m Wind Vectors (km/h)</div>`);
        }
        if (this.activeLayers.has('lightning')) {
          parts.push(`<div class="ei-legend-chip" style="color:#E9D5FF">⚡ CAPE &amp; Lightning Risk</div>`);
        }
        if (this.activeLayers.has('amfi_readiness')) {
          parts.push(`<div class="ei-legend-chip" style="color:#2DD4BF">⬡ AMFI-02 Readiness Hex (Click cell)</div>`);
        }
        if (this.activeLayers.has('amfi_d01_research')) {
          parts.push(`<div class="ei-legend-chip" style="color:#A78BFA">⬡ AMFI-01 Research (AB Only) · No PX Prediction Layer</div>`);
        }
        if (this.activeLayers.has('obs_opportunities')) {
          parts.push(`<div class="ei-legend-chip" style="color:#22D3EE">◆ Observation Opportunities (Pilot) · No Prediction</div>`);
        }

        if (parts.length > 0) {
          legendEl.innerHTML = parts.join('');
          legendEl.style.display = 'flex';
        } else {
          legendEl.style.display = 'none';
        }
      }
    }

    _renderLayersPopover() {
      const container = document.getElementById('earthIntelLayersBody');
      if (!container) return;

      const groups = [
        { key: 'observations', title: '1 · Satellite Observations' },
        { key: 'atmosphere', title: '2 · Atmospheric & Land Intelligence' },
        { key: 'danger', title: '3 · Fire Danger (Weather Index Only)' },
        { key: 'amfi', title: '4 · AMFI Research & Data Readiness' },
      ];

      container.innerHTML = groups.map(grp => {
        const items = LAYER_CATALOG.filter(l => l.group === grp.key);
        return `
          <div class="ei-layer-group">
            <div class="ei-layer-group-title">${grp.title}</div>
            ${items.map(item => {
              const isOn = this.activeLayers.has(item.id);
              const forecastDisabled = this.mode === 'forecast' && item.id === 'obs_firms';
              return `
                <button type="button" class="ei-layer-row ${isOn ? 'active' : ''} ${forecastDisabled ? 'muted' : ''}" data-layer-id="${item.id}">
                  <span class="ei-layer-check">${isOn ? '✓' : ''}</span>
                  <span class="ei-layer-text">
                    <span class="ei-layer-name">${item.label}</span>
                    <span class="ei-layer-sub">${forecastDisabled ? 'Hidden in Forecast mode (obs ≠ predictions)' : item.sub}</span>
                  </span>
                  <span class="ei-layer-pill" style="border-color:${item.badgeColor}40;color:${item.badgeColor}">${item.status}</span>
                </button>
              `;
            }).join('')}
          </div>
        `;
      }).join('');

      container.querySelectorAll('.ei-layer-row').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleLayer(btn.dataset.layerId);
        });
      });
    }

    openEvidencePopup(pt) {
      const pop = document.getElementById('intelEvidencePopup');
      const body = document.getElementById('intelEvidenceBody');
      const title = document.getElementById('intelEvidenceTitle');
      const sub = document.getElementById('intelEvidenceSub');
      if (!pop || !body) return;

      this.selectedEvidencePoint = pt;
      if (title) title.textContent = pt.name;
      if (sub) sub.textContent = `(${pt.lat.toFixed(2)}°, ${pt.lon.toFixed(2)}°) · ${pt.weather.source_tag}`;

      const fwi = pt.fwi_system;
      const wx = pt.weather;
      const amfi = pt.amfi_evidence;

      body.innerHTML = `
        <div class="ei-ev-banner ${this.mode === 'historical' ? 'warn' : 'info'}">
          ${this.weatherField ? this.weatherField.mode_notice : ''}
        </div>

        <div class="ei-ev-section-title">Atmospheric &amp; Land Conditions</div>
        <div class="ei-ev-grid">
          <div class="ei-ev-cell"><span>2m Temp</span><b>${wx.temperature_2m_c} °C</b></div>
          <div class="ei-ev-cell"><span>RH / VPD</span><b>${wx.relative_humidity_pct}% · ${wx.vpd_kpa} kPa</b></div>
          <div class="ei-ev-cell"><span>10m Wind</span><b>${wx.wind_speed_10m_kmh} km/h @ ${Math.round(wx.wind_direction_deg)}°</b></div>
          <div class="ei-ev-cell"><span>24h Precip</span><b>${wx.precipitation_mm} mm</b></div>
          <div class="ei-ev-cell"><span>Soil Moist.</span><b>${wx.soil_moisture_m3m3} m³/m³</b></div>
          <div class="ei-ev-cell"><span>Lightning/CAPE</span><b>${wx.cape_jkg} J/kg ${wx.lightning_active ? '⚡' : ''}</b></div>
        </div>

        <div class="ei-ev-section-title">Canadian FWI System <span style="color:#FB923C">(Fire Danger ≠ Ignition Probability)</span></div>
        <div class="ei-ev-grid">
          <div class="ei-ev-cell"><span>FWI (${fwi.danger_class})</span><b style="color:#FB923C">${fwi.fwi}</b></div>
          <div class="ei-ev-cell"><span>FFMC / ISI</span><b>${fwi.ffmc} · ${fwi.isi}</b></div>
          <div class="ei-ev-cell"><span>DMC / DC / BUI</span><b>${fwi.dmc} / ${fwi.dc} / ${fwi.bui}</b></div>
        </div>

        <div class="ei-ev-section-title">AMFI Research &amp; Readiness Inspection</div>
        <div class="ei-ev-doc mono">
          <div><b>Target definition:</b> ${amfi.target_definition}</div>
          <div><b>AMFI version:</b> ${amfi.amfi_version}</div>
          <div><b>Observation coverage:</b> ${amfi.observation_coverage}</div>
          <div><b>Data readiness:</b> ${amfi.readiness_status}</div>
          ${amfi.relative_likelihood_lift ? `<div><b>D-AMFI-01 Block Lift:</b> ${amfi.relative_likelihood_lift}× over ${((amfi.new30_baseline_rate || 0.005) * 100).toFixed(2)}% baseline (documented-record likelihood ONLY)</div>` : ''}
          <div style="color:#FDA4AF;margin-top:4px"><b>Known limitation:</b> ${amfi.known_limitation}</div>
        </div>
      `;

      pop.classList.add('open');
    }

    openObservationPopup(obs) {
      const pop = document.getElementById('intelEvidencePopup');
      const body = document.getElementById('intelEvidenceBody');
      const title = document.getElementById('intelEvidenceTitle');
      const sub = document.getElementById('intelEvidenceSub');
      if (!pop || !body) return;
      if (title) title.textContent = obs.name;
      if (sub) sub.textContent = `${obs.platform} · ${obs.date} · ${obs.status}`;
      body.innerHTML = `
        <div class="ei-ev-banner warn">
          AMFI-02 observation pilot · acquired / valid / opportunity / detection · no prediction probability
        </div>
        <div class="ei-ev-section-title">Observation record</div>
        <div class="ei-ev-grid">
          <div class="ei-ev-cell"><span>Status</span><b>${obs.status}</b></div>
          <div class="ei-ev-cell"><span>Platform</span><b>${obs.platform}</b></div>
          <div class="ei-ev-cell"><span>Date</span><b>${obs.date}</b></div>
          <div class="ei-ev-cell"><span>Event</span><b>${obs.event_id || 'unmatched'}</b></div>
          <div class="ei-ev-cell"><span>Location</span><b>${obs.lat.toFixed(3)}, ${obs.lon.toFixed(3)}</b></div>
        </div>
        <div class="ei-ev-section-title">Why this record exists</div>
        <div class="ei-ev-doc mono">${obs.detail}</div>
        <div class="ei-ev-section-title">Guardrail</div>
        <div class="ei-ev-doc mono">
          This is an observation-audit record, not an occurrence probability, not an ignition forecast,
          and not a detection-probability estimate. A missing detection is not absence.
        </div>
      `;
      pop.classList.add('open');
    }

    _bindControls() {
      const plusBtn = document.getElementById('hudOpenOverviewBtn');
      const pop = document.getElementById('earthIntelLayersPopover');
      const closePopBtn = document.getElementById('closeEarthIntelBtn');
      const pillCountBtn = document.getElementById('selectedLayersCountPill');

      const toggleLayersPopover = (e) => {
        if (e) e.stopPropagation();
        if (!pop) return;
        const willOpen = !pop.classList.contains('open');
        document.querySelectorAll('.science-lab-popover, .dock-popover, .nasa-layers-popover').forEach(el => el.classList.remove('open'));
        pop.classList.toggle('open', willOpen);
      };

      // User request specifically uses "+" next to "Earth from Orbit" for Earth intelligence · Layers
      if (plusBtn) {
        // Clone to replace legacy Mission Overview listener cleanly (Mission Guide still opens view-overview)
        const clone = plusBtn.cloneNode(true);
        plusBtn.parentNode.replaceChild(clone, plusBtn);
        clone.title = 'Open Earth Intelligence · Layers (Weather, Canadian FWI & AMFI Readiness)';
        clone.addEventListener('click', toggleLayersPopover);
      }
      if (pillCountBtn) pillCountBtn.addEventListener('click', toggleLayersPopover);
      if (closePopBtn && pop) {
        closePopBtn.addEventListener('click', () => pop.classList.remove('open'));
      }

      document.addEventListener('click', (e) => {
        if (pop && pop.classList.contains('open')) {
          if (!e.target.closest('#earthIntelLayersPopover, #hudOpenOverviewBtn, #selectedLayersCountPill')) {
            pop.classList.remove('open');
          }
        }
      });

      // Temporal Mode Selector (Historical | Live | Forecast)
      document.querySelectorAll('.temporal-mode-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetMode = btn.dataset.temporalMode;
          const isPastContext = (this.state.selectedYear || 2026) < 2026 ||
            (this.state.selectedDateMode && this.state.selectedDateMode !== '2026-11-13');
          if ((targetMode === 'live' || targetMode === 'forecast') && isPastContext && typeof this.state._restoreLivePresent === 'function') {
            this.state._restoreLivePresent();
          }
          this.setTemporalMode(targetMode);
        });
      });

      const leadSel = document.getElementById('forecastLeadSelect');
      if (leadSel) {
        leadSel.addEventListener('change', () => {
          this.forecastLeadHours = Number(leadSel.value) || 24;
          this.fetchWeatherField();
        });
      }

      const closeEvBtn = document.getElementById('closeIntelEvidenceBtn');
      const evPop = document.getElementById('intelEvidencePopup');
      if (closeEvBtn && evPop) {
        closeEvBtn.addEventListener('click', () => evPop.classList.remove('open'));
      }

      const openReadinessBtn = document.getElementById('eiOpenReadinessDrawerBtn');
      if (openReadinessBtn) {
        openReadinessBtn.addEventListener('click', () => {
          if (pop) pop.classList.remove('open');
          const readinessNav = document.querySelector('[data-view="readiness"]');
          if (readinessNav) readinessNav.click();
        });
      }
    }

    _renderAmfiDrawers() {
      if (!this.amfiSummary || !this.amfiSummary.campaigns) return;
      const c = this.amfiSummary.campaigns;

      // 1. AMFI-02 Data Readiness Drawer
      const amfi02 = c.amfi_02;
      const kpiEl = document.getElementById('readinessKpiRow');
      if (kpiEl && amfi02) {
        kpiEl.innerHTML = `
          <div class="kpi-box">
            <div class="label">CAMPAIGN VERDICT</div>
            <div class="value" style="font-size:17px;color:#FBBF24">${amfi02.verdict}</div>
            <div class="sub">AMFI-03 Prospective Prediction: <b style="color:#FB7185">${c.amfi_03.status}</b></div>
          </div>
          <div class="kpi-box">
            <div class="label">AVAILABLE SOURCES</div>
            <div class="value positive">${amfi02.readiness_counts.available}</div>
            <div class="sub">of ${amfi02.total_items} audited items (NFDB catalog, POWER, FIRMS window)</div>
          </div>
          <div class="kpi-box">
            <div class="label">PARTIAL / ACCESSIBLE</div>
            <div class="value" style="color:#38BDF8">${amfi02.readiness_counts.partial}</div>
            <div class="sub">Overpass/cloud tables &amp; ERA5 hourly require multi-year staging</div>
          </div>
          <div class="kpi-box">
            <div class="label">MISSING / UNVERIFIED</div>
            <div class="value negative">${amfi02.readiness_counts.missing}</div>
            <div class="sub">Ignition truth, patrol coverage, reforecast archive &amp; absence census</div>
          </div>
        `;
      }

      const gatesBody = document.getElementById('readinessGatesBody');
      if (gatesBody && amfi02) {
        gatesBody.innerHTML = amfi02.gates.map(g => `
          <tr>
            <td class="mono"><b>${g.gate}</b></td>
            <td>${g.name}</td>
            <td><span class="badge badge-${g.severity}">${g.status}</span></td>
            <td>${g.reason}</td>
          </tr>
        `).join('');
      }

      const matrixBody = document.getElementById('readinessMatrixBody');
      if (matrixBody && amfi02 && Array.isArray(amfi02.matrix_rows)) {
        matrixBody.innerHTML = amfi02.matrix_rows.map(r => {
          const st = (r.access_status || '').toUpperCase();
          const bCls = st === 'ACQUIRED' ? 'badge-ok' : (st.includes('ACQUIRED') ? 'badge-warn' : 'badge-danger');
          return `
            <tr>
              <td class="mono"><b>${r.readiness_id}</b></td>
              <td class="mono">${r.objective}</td>
              <td>${r.data_need}</td>
              <td>${r.candidate_source}</td>
              <td><span class="badge ${bCls}">${r.access_status}</span></td>
              <td style="color:#CBD5E1;font-size:11.5px">${r.notes}</td>
            </tr>
          `;
        }).join('');
      }

      // 2. Acquisition audit (actual files, source limits, matching feasibility)
      const auditEl = document.getElementById('acquisitionAuditContainer');
      if (auditEl && amfi02 && amfi02.acquisition_audit) {
        const a = amfi02.acquisition_audit;
        const mb = n => `${(Number(n) / 1048576).toFixed(1)} MB`;
        auditEl.innerHTML = `
          <div class="card" style="margin-top:14px">
            <div class="card-header">
              <div>
                <h3 class="card-title">Observation Acquisition Audit — ${a.date}</h3>
                <div class="card-subtitle">${a.pilot}</div>
              </div>
              <span class="badge ${a.statistical_identifiability === 'NO_GO' ? 'badge-danger' : 'badge-warn'}">${a.decision}</span>
            </div>
            <div class="kpi-grid-4" style="margin-bottom:12px">
              <div class="kpi-box"><div class="label">TECHNICAL MATCHING</div><div class="value positive">${a.technical_matching}</div><div class="sub">geolocation &amp; footprints</div></div>
              <div class="kpi-box"><div class="label">EMPIRICAL PX-D-02</div><div class="value negative">${a.statistical_identifiability}</div><div class="sub">0 accepted active-clear opportunities</div></div>
              <div class="kpi-box"><div class="label">GOES PILOT</div><div class="value">${a.assets.goes_files}</div><div class="sub">files · ${mb(a.assets.goes_bytes)}</div></div>
              <div class="kpi-box"><div class="label">MODIS WEEK</div><div class="value">${a.assets.modis_week_valid_alberta_observations}/${a.assets.modis_week_overpasses}</div><div class="sub">Alberta-valid overpasses · ${a.assets.modis_week_wrong_coverage} wrong coverage</div></div>
            </div>
            <div class="grid-2">
              <div>
                <div class="mono" style="font-size:11px;color:#94A3B8;margin-bottom:6px">ACTUAL FINDINGS</div>
                <ul style="font-size:12px;color:#CBD5E1;margin:0 0 0 18px;line-height:1.6">
                  ${(a.findings || []).map(x => `<li>${x}</li>`).join('')}
                </ul>
              </div>
              <div>
                <div class="mono" style="font-size:11px;color:#94A3B8;margin-bottom:6px">BLOCKING GAPS</div>
                <ul style="font-size:12px;color:#FDA4AF;margin:0 0 0 18px;line-height:1.6">
                  ${(a.blocking_gaps || []).map(x => `<li>${x}</li>`).join('')}
                </ul>
              </div>
            </div>
            <div class="mono" style="font-size:11px;color:#94A3B8;margin-top:10px">PILOT OBSERVATION RECORDS</div>
            <div class="table-wrap" style="margin-top:6px">
              <table class="data-table">
                <thead><tr><th>Record</th><th>Platform</th><th>Date</th><th>Status</th><th>Event</th></tr></thead>
                <tbody>
                  ${(this.amfiSummary.observation_opportunities || []).map(o => `
                    <tr>
                      <td>${o.name}</td>
                      <td>${o.platform}</td>
                      <td class="mono">${o.date}</td>
                      <td><span class="badge ${o.status === 'active_clear_no_detection' ? 'badge-info' : ((o.status === 'temporally_uncertain' || o.status === 'active_target_cloudy' || o.status === 'robust_active_clear_not_detected' || o.status === 'detection_only') ? 'badge-warn' : 'badge-danger')}">${o.status}</span></td>
                      <td class="mono">${o.event_id || 'unmatched'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <div class="mono" style="font-size:11px;color:#22D3EE;margin-top:10px">
              Coverage selector: fixed-time ${a.coverage_selector.fixed_time_valid}/${a.coverage_selector.fixed_time_candidates} valid;
              CMR ${a.coverage_selector.cmr_candidates} candidates / ${a.coverage_selector.cmr_volume_mb} MB;
              5 km geolocation ${a.coverage_selector.coarse_valid} valid / ${a.coverage_selector.coarse_incorrect} false accepts.
            </div>
            <div class="mono" style="font-size:11px;color:#FBBF24;margin-top:10px">
              Decision: bounded acquisition pilot GO; empirical PX-D-02 test NO-GO. No model training.
            </div>
          </div>
        `;
      }

      // 3. AMFI-01, D-AMFI-01, B3 & AMFI-03 Evidence Drawer
      const sciContainer = document.getElementById('amfiScienceCardsContainer');
      if (sciContainer) {
        sciContainer.innerHTML = `
          <div class="grid-2" style="margin-bottom:14px">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">AMFI-01 Archived Discovery (${c.amfi_01.decision})</h3>
                <span class="badge badge-info">CHAMPION: NONE</span>
              </div>
              <p style="font-size:12.5px;line-height:1.55;color:#CBD5E1">${c.amfi_01.key_finding}</p>
              <div class="mono" style="font-size:11px;color:#94A3B8;margin-top:8px">
                Panel: ${c.amfi_01.panel}<br>
                B1 Persistence Baseline: PR-AUC <b>${c.b1_persistence.any_event_pr_auc}</b> (any event) vs <b style="color:#FB7185">${c.b1_persistence.new_event_pr_auc}</b> (new 30-day event)
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <h3 class="card-title">D-AMFI-01 (${c.d_amfi_01.status})</h3>
                <span class="badge badge-warn">RESEARCH SURFACE ONLY</span>
              </div>
              <p style="font-size:12.5px;line-height:1.55;color:#CBD5E1">
                <b>Public Label:</b> ${c.d_amfi_01.public_label}<br>
                ${c.d_amfi_01.best_calibrated_model}: PR-AUC <b>${c.d_amfi_01.pr_auc}</b> (<b>${c.d_amfi_01.lift_factor}×</b> over ${(c.d_amfi_01.prevalence * 100).toFixed(2)}% baseline) · ROC-AUC <b>${c.d_amfi_01.roc_auc}</b> · Slope <b>${c.d_amfi_01.calibration_slope}</b>.
              </p>
              <div class="mono" style="font-size:11px;color:#FBBF24;margin-top:8px">${c.d_amfi_01.guardrail}</div>
            </div>
          </div>

          <div class="grid-2">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">B3 Frozen Canadian FWI Baseline</h3>
                <span class="badge badge-danger">FIRE DANGER ≠ IGNITION PROB.</span>
              </div>
              <p style="font-size:12.5px;line-height:1.55;color:#CBD5E1">
                B3-FWI + season scored <b>${c.b3_fwi.new_event_pr_auc}</b> PR-AUC (ROC <b>${c.b3_fwi.new_event_roc_auc}</b>) vs N0 cell+season (<b>${c.b3_fwi.n0_cell_season_pr_auc}</b>) and N1 weather (<b>${c.b3_fwi.n1_weather_pr_auc}</b>).
              </p>
              <div class="mono" style="font-size:11px;color:#94A3B8;margin-top:8px">${c.b3_fwi.interpretation}</div>
            </div>

            <div class="card">
              <div class="card-header">
                <h3 class="card-title">AMFI-03 Prospective Ignition Gate</h3>
                <span class="badge badge-danger">${c.amfi_03.status}</span>
              </div>
              <p style="font-size:12.5px;line-height:1.55;color:#FDA4AF">${c.amfi_03.reason}</p>
              <ul style="font-size:11.5px;color:#CBD5E1;margin:8px 0 0 18px;line-height:1.55">
                ${c.amfi_03.prohibited_claims.map(x => `<li>${x}</li>`).join('')}
              </ul>
            </div>
          </div>
        `;
      }

      // 3. AMFI-PX closed search archive (no prediction surface)
      const px = c.amfi_px;
      const pxContainer = document.getElementById('amfiPxLabContainer');
      if (pxContainer && px) {
        const discoveries = (px.frozen_discoveries || []).map(d => `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">${d.id} — ${d.name}</h3>
              <span class="badge ${d.status === 'SYNTHETIC_PRINCIPLE' ? 'badge-warn' : 'badge-info'}">${d.status}</span>
            </div>
            <p style="font-size:12.5px;line-height:1.55;color:#CBD5E1">${d.finding}</p>
          </div>
        `).join('');
        const methodology = px.methodology || {};
        const failed = (px.failed_experiments || []).map(x => `<li>${x}</li>`).join('');
        const guardrails = (px.guardrails || []).map(x => `<li>${x}</li>`).join('');
        const crossDomain = (methodology.cross_domain || []).map(x => `<li>${x}</li>`).join('');
        const progression = (this.amfiSummary.research_progression || []).map(p => `
          <tr>
            <td class="mono"><b>${p.stage}</b></td>
            <td><b>${p.campaign}</b></td>
            <td><span class="badge ${p.status === 'BLOCKED' ? 'badge-danger' : (p.status === 'SEARCH_CLOSED' ? 'badge-warn' : 'badge-info')}">${p.status}</span></td>
            <td>${p.role}</td>
            <td style="color:#CBD5E1;font-size:11.5px">${p.detail}</td>
          </tr>
        `).join('');
        pxContainer.innerHTML = `
          <div class="kpi-grid-4" style="margin-bottom:14px">
            <div class="kpi-box">
              <div class="label">RESEARCH ROUNDS</div>
              <div class="value">${px.rounds_completed}</div>
              <div class="sub">exploratory rounds completed</div>
            </div>
            <div class="kpi-box">
              <div class="label">SEARCH STATUS</div>
              <div class="value" style="font-size:15px;color:#FBBF24">CLOSED</div>
              <div class="sub">normal seating resumed; no further mutation on the same data</div>
            </div>
            <div class="kpi-box">
              <div class="label">OPERATIONAL CHAMPION</div>
              <div class="value negative">NONE</div>
              <div class="sub">no validated wildfire prediction system</div>
            </div>
            <div class="kpi-box">
              <div class="label">PX GLOBE PREDICTIONS</div>
              <div class="value negative">OFF</div>
              <div class="sub">PX-D-01 / PX-D-02 probabilities are not drawn</div>
            </div>
          </div>

          <div class="card" style="margin-bottom:14px">
            <div class="card-header">
              <h3 class="card-title">CouncilRise Research Progression</h3>
              <span class="badge badge-info">ONE SEARCH STRATEGY ENDED</span>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr><th>Stage</th><th>Campaign</th><th>Status</th><th>Role</th><th>Detail</th></tr>
                </thead>
                <tbody>${progression}</tbody>
              </table>
            </div>
          </div>

          <div class="grid-2" style="margin-bottom:14px">
            ${discoveries}
          </div>

          <div class="grid-2" style="margin-bottom:14px">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">Failed / Rejected Experiments</h3>
                <span class="badge badge-danger">PRESERVED</span>
              </div>
              <ul style="font-size:12px;color:#CBD5E1;margin:8px 0 0 18px;line-height:1.6">${failed}</ul>
            </div>
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">${methodology.name || 'Detection Externalization'}</h3>
                <span class="badge badge-warn">REUSABLE METHODOLOGY</span>
              </div>
              <p style="font-size:12.5px;line-height:1.55;color:#CBD5E1">${methodology.principle || ''}</p>
              <div class="mono" style="font-size:11px;color:#94A3B8;margin-top:8px">Cross-domain candidates:</div>
              <ul style="font-size:11.5px;color:#CBD5E1;margin:6px 0 0 18px;line-height:1.55">${crossDomain}</ul>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Guardrails &amp; Next Phase</h3>
              <span class="badge badge-info">${px.next_phase}</span>
            </div>
            <ul style="font-size:12px;color:#CBD5E1;margin:8px 0 0 18px;line-height:1.6">${guardrails}</ul>
            <div class="mono" style="font-size:11px;color:#FBBF24;margin-top:10px">
              The globe may display observations, weather and fire danger. It must not display PX-D-01 or PX-D-02 predicted probabilities.
            </div>
          </div>
        `;
      }
    }
  }

  global.EarthIntelligenceController = EarthIntelligenceController;
})(window);
