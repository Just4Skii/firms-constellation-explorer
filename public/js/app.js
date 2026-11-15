/**
 * FIRMS CONSTELLATION INTELLIGENCE — MASTER APPLICATION CONTROLLER (app.js)
 * Coordinates the 7 analytical views, NASA Eyes 3D Globe & Temporal Playback,
 * 15-subset / 7-subset tie-preserving matrix, Pivotal-Subset Influence (I_p),
 * Spatial Hotspot Multi-Resolution Explorer, D1/D2/D3 Decision Stability Cards,
 * Web Audio Stereo Sonification, Local CSV Ingestion, and Reproducible Exports.
 */
(function (global) {
  'use strict';

  const STATE = {
    bundle: null,
    exactHotspotsByDay: {},
    geojson: null,
    activeView: null, // null = unobstructed full-screen 3D Earth (NASA Eyes mode)
    windowId: '2026-11',
    selectedYear: 2026,
    regionId: 'saf',
    metricMode: 'count', // 'count' | 'frp' | 'nadir_frp' | 'clusters'
    selectedPlatforms: ['Terra', 'Aqua', 'NOAA-20', 'NOAA-21'],
    selectedDateMode: '2026-11-13', // Start on latest clean date (never bombard all history at once)
    playbackPlaying: false,
    playbackDirection: 1, // +1 = forward in time, -1 = rewind backwards in time
    playbackSpeed: 1.0,
    playbackTimer: null,
    hotspotRes: '1.0deg',
    hotspotMetric: 'count',
    globe3d: null,
    reconPopup: null,
    fireStories: null,
    activeDayPoints: [],
    hotspotMap2d: null,
    audioCtx: null,
    currentAnalysis: null,
  };

  // =========================================================================
  // EXACT MATHEMATICAL & TIE-PRESERVING SUBSET ENGINE (MIRRORS PYTHON ENGINE)
  // =========================================================================

  function computeTopDaySet(dayToVal, relTol = 1e-9, absTol = 1e-9) {
    const entries = Object.entries(dayToVal).filter(([, v]) => v !== null && v !== undefined && !Number.isNaN(Number(v)));
    if (entries.length === 0) return [];
    const maxVal = Math.max(...entries.map(([, v]) => Number(v)));
    if (maxVal <= 0 && entries.every(([, v]) => Number(v) === 0)) return [];
    const tol = Math.max(absTol, relTol * Math.abs(maxVal));
    return entries
      .filter(([, v]) => Number(v) >= maxVal - tol)
      .map(([d]) => d)
      .sort();
  }

  function computeTieAveragedSpearman(arrA, arrB) {
    if (!arrA || !arrB || arrA.length !== arrB.length || arrA.length < 2) return null;
    const n = arrA.length;
    if (arrA.every(v => v === arrA[0]) || arrB.every(v => v === arrB[0])) return null;
    const rA = global.FIRMSCharts.computeTieAveragedRanksDesc(arrA);
    const rB = global.FIRMSCharts.computeTieAveragedRanksDesc(arrB);
    const meanA = rA.reduce((s, v) => s + v, 0) / n;
    const meanB = rB.reduce((s, v) => s + v, 0) / n;
    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      const da = rA[i] - meanA;
      const db = rB[i] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    if (denA <= 1e-12 || denB <= 1e-12) return null;
    return Number((num / Math.sqrt(denA * denB)).toFixed(4));
  }

  function getCombinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length === 0) return [];
    const head = arr[0];
    const tail = arr.slice(1);
    const withHead = getCombinations(tail, k - 1).map(c => [head, ...c]);
    const withoutHead = getCombinations(tail, k);
    return [...withHead, ...withoutHead];
  }

  function enumerateSubsets(platforms) {
    const out = [];
    for (let r = 1; r <= platforms.length; r++) {
      out.push(...getCombinations(platforms, r));
    }
    return out;
  }

  function setsEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function computePivotalInfluenceJS(topsMap, platforms) {
    const results = {};
    const fullKey = platforms.join('+');
    platforms.forEach(p => {
      const eligible = [];
      const pivotal = [];
      for (let r = 2; r <= platforms.length; r++) {
        const combs = getCombinations(platforms, r);
        combs.forEach(c => {
          if (!c.includes(p)) return;
          const withoutP = c.filter(x => x !== p);
          const keyWith = c.join('+');
          const keyWithout = withoutP.join('+');
          const topWith = topsMap[keyWith] || [];
          const topWithout = topsMap[keyWithout] || [];
          const changed = !setsEqual(topWith, topWithout);
          const item = {
            coalition: c,
            coalition_without_p: withoutP,
            top_with_p: topWith,
            top_without_p: topWithout,
            changed,
          };
          eligible.push(item);
          if (changed) pivotal.push(item);
        });
      }
      const denom = eligible.length;
      const numer = pivotal.length;
      const looWithout = platforms.filter(x => x !== p).join('+');
      results[p] = {
        platform: p,
        I_p: denom > 0 ? Number((numer / denom).toFixed(4)) : 0,
        numerator: numer,
        denominator: denom,
        fraction_label: `${numer}/${denom}`,
        leave_one_out_flips_pooled: platforms.length > 1 ? !setsEqual(topsMap[fullKey], topsMap[looWithout]) : false,
        pivotal_coalitions: pivotal,
        eligible_coalitions: eligible,
      };
    });
    return results;
  }

  function runClientConstellationAnalysis(regData, selectedPlatforms) {
    const avail = regData.platforms;
    const days = regData.days;
    const sel = avail.filter(p => selectedPlatforms.includes(p));
    const activeSel = sel.length > 0 ? sel : [...avail];

    const subsets = enumerateSubsets(avail);
    const countTopsMap = {};
    const frpTopsMap = {};
    const nadirTopsMap = {};
    const clusterTopsMap = {};

    const unionCount = new Set();
    const unionFrp = new Set();
    const unionAll = new Set();

    const subsetRows = subsets.map(sub => {
      const key = sub.join('+');
      const dCount = new Array(days.length).fill(0);
      const dFrp = new Array(days.length).fill(0);
      const dNadir = new Array(days.length).fill(0);
      const dClust = new Array(days.length).fill(0);

      sub.forEach(p => {
        const cArr = regData.daily_by_platform.count[p] || [];
        const fArr = regData.daily_by_platform.frp[p] || [];
        const nArr = (regData.daily_by_platform.nadir_frp && regData.daily_by_platform.nadir_frp[p]) || [];
        const clArr = (regData.daily_by_platform.spatial_clusters && regData.daily_by_platform.spatial_clusters[p]) || [];
        for (let i = 0; i < days.length; i++) {
          dCount[i] += (cArr[i] || 0);
          dFrp[i] = Number((dFrp[i] + (fArr[i] || 0)).toFixed(2));
          dNadir[i] = Number((dNadir[i] + (nArr[i] || 0)).toFixed(2));
          dClust[i] += (clArr[i] || 0);
        }
      });

      const cMap = {}, fMap = {}, nMap = {}, clMap = {};
      days.forEach((d, i) => {
        cMap[d] = dCount[i];
        fMap[d] = dFrp[i];
        nMap[d] = dNadir[i];
        clMap[d] = dClust[i];
      });

      const topC = computeTopDaySet(cMap);
      const topF = computeTopDaySet(fMap);
      const topN = computeTopDaySet(nMap);
      const topCl = computeTopDaySet(clMap);

      countTopsMap[key] = topC;
      frpTopsMap[key] = topF;
      nadirTopsMap[key] = topN;
      clusterTopsMap[key] = topCl;

      topC.forEach(d => { unionCount.add(d); unionAll.add(d); });
      topF.forEach(d => { unionFrp.add(d); unionAll.add(d); });

      return {
        subset: sub,
        subset_key: key,
        subset_size: sub.length,
        is_singleton: sub.length === 1,
        is_full_constellation: sub.length === avail.length,
        is_currently_selected: key === activeSel.join('+'),
        total_detections: dCount.reduce((a, b) => a + b, 0),
        summed_frp_mw: Number(dFrp.reduce((a, b) => a + b, 0).toFixed(2)),
        summed_nadir_frp_mw: Number(dNadir.reduce((a, b) => a + b, 0).toFixed(2)),
        total_clusters: dClust.reduce((a, b) => a + b, 0),
        daily_count: dCount,
        daily_frp: dFrp,
        daily_nadir_frp: dNadir,
        daily_clusters: dClust,
        top_count_days: topC,
        top_frp_days: topF,
        top_nadir_frp_days: topN,
        top_cluster_days: topCl,
        metrics_agree: setsEqual(topC, topF),
        spearman_count_vs_frp: computeTieAveragedSpearman(dCount, dFrp),
      };
    });

    const distinctCountSets = new Set(Object.values(countTopsMap).map(a => a.join(',')));
    const distinctFrpSets = new Set(Object.values(frpTopsMap).map(a => a.join(',')));
    const sensorSensitiveCount = distinctCountSets.size > 1;
    const sensorSensitiveFrp = distinctFrpSets.size > 1;
    const sensorSetSensitive = sensorSensitiveCount || sensorSensitiveFrp;

    const selKey = activeSel.join('+');
    const selectedRow = subsetRows.find(r => r.subset_key === selKey) || subsetRows[subsetRows.length - 1];
    const metricSensitiveSelected = !selectedRow.metrics_agree;
    const metricSensitiveAny = subsetRows.some(r => !r.metrics_agree);
    const metricSensitive = metricSensitiveSelected || metricSensitiveAny;
    const jointSensitive = sensorSetSensitive && metricSensitive;

    // CORR-04: Singleton consensus evaluated per metric using tops[(p,)]
    const singleCountSets = avail.map(p => (countTopsMap[p] || []).join(','));
    const singleFrpSets = avail.map(p => (frpTopsMap[p] || []).join(','));
    const noConsensusCount = avail.length > 1 && new Set(singleCountSets).size === avail.length;
    const noConsensusFrp = avail.length > 1 && new Set(singleFrpSets).size === avail.length;

    const fullKey = avail.join('+');
    const pooledDisagreesCount = avail.some(p => !setsEqual(countTopsMap[fullKey], countTopsMap[p]));
    const pooledDisagreesFrp = avail.some(p => !setsEqual(frpTopsMap[fullKey], frpTopsMap[p]));

    let primaryClass = 'CONSTELLATION_INVARIANT';
    if (jointSensitive) primaryClass = 'PLATFORM_AND_METRIC_SENSITIVE';
    else if (sensorSetSensitive) primaryClass = 'SENSOR_SET_SENSITIVE';
    else if (metricSensitive) primaryClass = 'METRIC_SENSITIVE';

    const badges = [];
    if (!sensorSetSensitive && !metricSensitive) badges.push('CONSTELLATION_INVARIANT');
    if (sensorSetSensitive) badges.push('SENSOR_SET_SENSITIVE');
    if (metricSensitive) badges.push('METRIC_SENSITIVE');
    if (jointSensitive) badges.push('PLATFORM_AND_METRIC_SENSITIVE');
    if (noConsensusCount || noConsensusFrp) badges.push('NO_SENSOR_CONSENSUS');
    if (pooledDisagreesCount || pooledDisagreesFrp) badges.push('POOLED_RANK_DISAGREEMENT');

    return {
      available_platforms: avail,
      selected_platforms: activeSel,
      subset_count: subsets.length,
      subset_matrix: subsetRows,
      selected_summary: selectedRow,
      top_day_union: {
        count_union: Array.from(unionCount).sort(),
        frp_union: Array.from(unionFrp).sort(),
        joint_union: Array.from(unionAll).sort(),
        union_size: unionAll.size,
        is_single_stable_date: unionAll.size === 1,
      },
      classifications: {
        primary: primaryClass,
        active_badges: badges,
        CONSTELLATION_INVARIANT: !sensorSetSensitive && !metricSensitive,
        SENSOR_SET_SENSITIVE: sensorSetSensitive,
        METRIC_SENSITIVE: metricSensitive,
        METRIC_SENSITIVE_SELECTED: metricSensitiveSelected,
        PLATFORM_AND_METRIC_SENSITIVE: jointSensitive,
        NO_SENSOR_CONSENSUS: noConsensusCount || noConsensusFrp,
        NO_SENSOR_CONSENSUS_COUNT: noConsensusCount,
        NO_SENSOR_CONSENSUS_FRP: noConsensusFrp,
        POOLED_RANK_DISAGREEMENT: pooledDisagreesCount || pooledDisagreesFrp,
      },
      platform_influence: {
        detection_count: computePivotalInfluenceJS(countTopsMap, avail),
        summed_frp: computePivotalInfluenceJS(frpTopsMap, avail),
      },
    };
  }

  // =========================================================================
  // INITIALIZATION & DATA LOADING
  // =========================================================================

  async function initApp() {
    try {
      const [bundleRes, geoRes, exactRes] = await Promise.all([
        fetch('data/firms_bundle.json'),
        fetch('assets/maps/ne_110m_admin_0_countries.geojson'),
        fetch('data/exact_hotspots_by_day.json').catch(() => null),
      ]);
      STATE.bundle = await bundleRes.json();
      STATE.geojson = await geoRes.json();
      STATE.exactHotspotsByDay = (exactRes && exactRes.ok) ? await exactRes.json() : {};

      // Initialize Full-Viewport NASA Eyes 3D Globe, Satellite Recon Imagery Pop-Up, & 2D Hotspot Map
      STATE.globe3d = new global.FIRMSGlobe3D('eyesGlobeCanvas', 'eyesGlobeTooltip');
      global.__firmsGlobe3d = STATE.globe3d;
      STATE.globe3d.setGeoJSON(STATE.geojson);
      const initialYearZones = STATE.globe3d.setActiveYear(STATE.selectedYear);

      STATE.reconPopup = new global.FireSatelliteReconPopup();
      STATE.reconPopup.setZonesList(initialYearZones);

      const openReconForZone = (zone) => {
        if (!zone) return;
        const win = STATE.bundle.windows[STATE.windowId];
        const dateLabel = zone.incidentDate || (STATE.selectedDateMode === 'ALL'
          ? win.clean_days[win.clean_days.length - 1]
          : STATE.selectedDateMode);
        STATE.reconPopup.show(zone, dateLabel, STATE.activeDayPoints, STATE.selectedPlatforms);
      };

      STATE.reconPopup.onOpenFireStory = (storyId) => {
        if (STATE.reconPopup) STATE.reconPopup.hide(false);
        switchView('fire-stories');
        if (STATE.fireStories) STATE.fireStories.openStory(storyId, false);
      };

      STATE.reconPopup.onNavigateZone = (zone) => {
        if (STATE.globe3d) STATE.globe3d.flyTo(zone.lat, zone.lon, 2.25, zone);
        openReconForZone(zone);
      };
      STATE.reconPopup.onCloseZoomOut = () => {
        if (STATE.globe3d) {
          STATE.globe3d.selectedFireZone = null;
          STATE.globe3d.flyTo(-12.0, 22.0, 1.12);
          STATE.globe3d.spinDirection = 1;
          STATE.globe3d.pauseSpinUntil = performance.now() + 900;
          STATE.globe3d.autoSpin = true;
        }
      };

      // Initialize Fire Stories Documentary Manager (FIRE-STORIES-01)
      if (typeof global.FireStoriesManager === 'function') {
        STATE.fireStories = new global.FireStoriesManager({
          onSyncGlobeToStory: (story, closeDrawer = false) => {
            if (!story) return;
            if (typeof STATE._switchHistoricalYear === 'function') {
              STATE._switchHistoricalYear(story.year, false);
            }
            if (closeDrawer) switchView(null);
            const ev = (STATE.globe3d?.allGlobeEvents || []).find(e => e.storyId === story.story_id || e.year === story.year);
            if (STATE.globe3d && ev) {
              STATE.globe3d.flyTo(ev.lat, ev.lon, 2.35, ev);
              openReconForZone(ev);
            } else if (STATE.globe3d) {
              STATE.globe3d.flyTo(story.lat, story.lon, 2.35);
            }
            showToast(`Synced Earth to ${story.year}: ${story.title}`);
          }
        });
        STATE.fireStories.loadBundle().catch(() => {});
      }

      STATE.globe3d.onSelectSatellite = (sat) => {
        if (sat && sat.isPrimary) {
          togglePlatform(sat.id);
          showToast(`${sat.label} (${sat.instrument}) toggled in constellation.`);
        } else if (sat) {
          showToast(`${sat.label} · ${sat.instrument} · Sun-Synchronous ${sat.inc}° Orbit`);
        }
      };
      STATE.globe3d.onSelectEvent = (ev) => {
        if (ev && ev.regionId && STATE.bundle.windows[STATE.windowId].regions[ev.regionId]) {
          STATE.regionId = ev.regionId;
          const regSel = document.getElementById('globalRegionSelect');
          if (regSel) regSel.value = ev.regionId;
          refreshAllViews();
        }
        openReconForZone(ev);
        showToast(`Satellite Swath Zoom: ${ev.title}`);
      };
      STATE.globe3d.onSelectFireCluster = (zone) => {
        openReconForZone(zone);
      };
      STATE.globe3d.onZoomThresholdReached = (zone) => {
        openReconForZone(zone);
      };

      // Keep bottom Historical Explorer scrubber visible by default so user can see current date & rewind/step backwards in time
      const deck = document.getElementById('firmsEarthDeck');
      if (deck) deck.classList.remove('minimized');

      STATE.hotspotMap2d = new global.FIRMSHotspotMap2D('hotspotMapCanvas');
      STATE.hotspotMap2d.setGeoJSON(STATE.geojson);

      bindGlobalEvents();
      populateRegionSelector();
      syncPlatformSelectionForWindow();
      refreshAllViews();
      startLiveMissionClock();

      if (typeof global.EarthIntelligenceController === 'function') {
        STATE.earthIntel = new global.EarthIntelligenceController(STATE);
        STATE.earthIntel.init();
      }
    } catch (err) {
      console.error('Initialization error:', err);
      const errBanner = document.getElementById('globalErrorBanner');
      if (errBanner) {
        errBanner.style.display = 'block';
        errBanner.textContent = `Data bundle initialization error: ${err.message}. Ensure server.py is running.`;
      }
    }
  }

  function startLiveMissionClock() {
    const timeEl = document.getElementById('bottomBarTimeText');
    if (!timeEl) return;
    let simSec = 13 * 3600 + 46 * 60; // Start at 13:46 LST (NOAA-20 overpass)
    setInterval(() => {
      simSec = (simSec + 18) % 86400;
      const hrs24 = Math.floor(simSec / 3600);
      const mins = Math.floor((simSec % 3600) / 60);
      const pad = n => String(n).padStart(2, '0');
      timeEl.textContent = `${pad(hrs24)}:${pad(mins)} LST`;
    }, 250);
  }

  function populateRegionSelector() {
    const sel = document.getElementById('globalRegionSelect');
    if (!sel || !STATE.bundle) return;
    const win = STATE.bundle.windows[STATE.windowId];
    const regOrder = [
      'saf', 'global', 'waf', 'eaf', 'naf_med',
      'sam_n', 'sam_s', 'nam_w', 'nam_e', 'cam_car',
      'eur_w', 'eur_e_rus', 'me_cas', 'sas', 'eas', 'sea', 'aus_pac'
    ];
    sel.innerHTML = '';
    regOrder.forEach(rid => {
      const r = win.regions[rid];
      if (!r) return;
      const opt = document.createElement('option');
      opt.value = rid;
      opt.textContent = `${r.meta.name} (${r.meta.macro})`;
      if (rid === STATE.regionId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function syncPlatformSelectionForWindow(previousWindowId = null) {
    const win = STATE.bundle.windows[STATE.windowId];
    if (!win) return;
    const avail = win.platforms;
    const kept = STATE.selectedPlatforms.filter(p => avail.includes(p));
    STATE.selectedPlatforms = kept.length > 0 ? kept : [...avail];
    // Default to the latest clean single date so the Earth never gets bombarded with all historical fires at once
    const prevDate = STATE.selectedDateMode;
    STATE.selectedDateMode = win.clean_days[win.clean_days.length - 1];
    stopTimelinePlayback();

    if (STATE.globe3d && previousWindowId && previousWindowId !== STATE.windowId) {
      // Switching to May 2022 archival window goes back in time -> rotate backwards!
      const isGoingBack = STATE.windowId < previousWindowId || STATE.selectedDateMode < prevDate;
      STATE.globe3d.triggerTimeTravelRotation(isGoingBack ? -3 : 3);
    }
  }

  // =========================================================================
  // GLOBAL NAVIGATION & CONTROL HANDLERS
  // =========================================================================

  function switchView(viewId) {
    // Toggle behavior: clicking the already-active drawer or passing null closes all drawers to reveal the full 3D Earth
    if (!viewId || STATE.activeView === viewId) {
      STATE.activeView = null;
    } else {
      STATE.activeView = viewId;
    }
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === STATE.activeView);
    });
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `view-${STATE.activeView}`);
    });

    if (STATE.activeView) {
      setTimeout(() => {
        refreshActiveViewCharts();
      }, 35);
    }
  }

  function togglePlatform(plat) {
    const win = STATE.bundle.windows[STATE.windowId];
    if (!win || !win.platforms.includes(plat)) return;
    const idx = STATE.selectedPlatforms.indexOf(plat);
    if (idx >= 0) {
      if (STATE.selectedPlatforms.length === 1) {
        showToast('At least one active satellite platform must remain selected.');
        return;
      }
      STATE.selectedPlatforms.splice(idx, 1);
    } else {
      STATE.selectedPlatforms.push(plat);
    }
    // Keep canonical order
    STATE.selectedPlatforms = win.platforms.filter(p => STATE.selectedPlatforms.includes(p));
    refreshAllViews();
  }

  function showToast(msg) {
    const t = document.getElementById('appToast');
    if (!t) return;
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.display = 'none'; }, 3200);
  }

  // =========================================================================
  // MASTER VIEW RENDERING PIPELINE
  // =========================================================================

  function refreshAllViews() {
    if (!STATE.bundle) return;
    const win = STATE.bundle.windows[STATE.windowId];
    const regData = win.regions[STATE.regionId] || win.regions['saf'];
    STATE.currentAnalysis = runClientConstellationAnalysis(regData, STATE.selectedPlatforms);

    renderTopbarPills(win);
    renderSidebarStatus(win, regData);
    renderOverviewView(win, regData, STATE.currentAnalysis);
    renderHistoricalExplorerView(win, regData, STATE.currentAnalysis);
    renderMetricIntelligenceView(win, regData, STATE.currentAnalysis);
    renderConstellationLabView(win, regData, STATE.currentAnalysis);
    renderHotspotIntelligenceView();
    renderDecisionAnalysisView(win, regData, STATE.currentAnalysis);
    renderMethodologyView();

    update3DGlobes(win, regData);
    refreshActiveViewCharts();
  }

  function refreshActiveViewCharts() {
    if (!STATE.bundle || !STATE.currentAnalysis) return;
    const win = STATE.bundle.windows[STATE.windowId];
    const regData = win.regions[STATE.regionId] || win.regions['saf'];
    const selRow = STATE.currentAnalysis.selected_summary;

    if (STATE.activeView === 'metrics' || STATE.activeView === 'overview') {
      global.FIRMSCharts.renderMetricComparisonChart(
        'metricDualChart',
        regData.days,
        selRow.daily_count,
        selRow.daily_frp,
        selRow.top_count_days,
        selRow.top_frp_days,
        -1
      );
      global.FIRMSCharts.renderRankBumpChart(
        'metricRankBumpChart',
        regData.days,
        selRow.daily_count,
        selRow.daily_frp
      );
    }
    if (STATE.activeView === 'constellation') {
      global.FIRMSCharts.renderPlatformInfluenceChart(
        'influenceBarChart',
        STATE.currentAnalysis.platform_influence,
        STATE.currentAnalysis.available_platforms
      );
    }
    if (STATE.activeView === 'hotspots' && STATE.hotspotMap2d) {
      STATE.hotspotMap2d.render();
    }
  }

  function renderTopbarPills(win) {
    const container = document.getElementById('topbarPlatformPills');
    if (!container) return;
    const allFive = [
      { id: 'Terra', color: '#0D9488' },
      { id: 'Aqua', color: '#2563EB' },
      { id: 'NOAA-20', color: '#EA580C' },
      { id: 'NOAA-21', color: '#7C3AED' },
      { id: 'Suomi-NPP', color: '#64748B' },
    ];
    container.innerHTML = '';
    allFive.forEach(p => {
      const isAvail = win.platforms.includes(p.id);
      const isSelected = STATE.selectedPlatforms.includes(p.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      if (!isAvail) {
        btn.className = 'sat-pill disabled-feed';
        const reason = (STATE.windowId === '2026-11' && p.id === 'Suomi-NPP')
          ? 'FEED_EMPTY_IN_RETRIEVAL (112B header-only CSV · null rows)'
          : 'Not launched in May 2022 window (Launched Nov 2022)';
        btn.title = reason;
        btn.innerHTML = `<span class="dot" style="background:${p.color}"></span>${p.id} <span class="mono" style="font-size:10px">[${STATE.windowId === '2026-11' ? 'EMPTY FEED' : 'N/A'}]</span>`;
      } else {
        btn.className = `sat-pill ${isSelected ? 'active' : ''}`;
        btn.innerHTML = `<span class="dot" style="background:${p.color}"></span>${p.id} ${isSelected ? '✓' : ''}`;
        btn.addEventListener('click', () => togglePlatform(p.id));
      }
      container.appendChild(btn);
    });
  }

  function renderSidebarStatus(win, regData) {
    const el = document.getElementById('sidebarContextSummary');
    if (!el) return;
    el.innerHTML = `
      <div class="sidebar-footer-row"><span>Window:</span><b class="mono" style="color:#38BDF8">${STATE.windowId} (7d Clean)</b></div>
      <div class="sidebar-footer-row"><span>Quarantined:</span><b class="mono" style="color:#FBBF24">${win.quarantined_day} (⛨)</b></div>
      <div class="sidebar-footer-row"><span>Active Sensors:</span><b class="mono" style="color:#F8FAFC">${STATE.selectedPlatforms.length}/${win.platforms.length}</b></div>
      <div class="sidebar-footer-row"><span>Coalitions:</span><b class="mono" style="color:#34D399">${STATE.currentAnalysis.subset_count} Subsets</b></div>
    `;
  }

  function getClassificationBadgeHTML(clsName) {
    const map = {
      CONSTELLATION_INVARIANT: ['badge-ok', 'CONSTELLATION_INVARIANT ✓'],
      SENSOR_SET_SENSITIVE: ['badge-warn', 'SENSOR_SET_SENSITIVE ΔS'],
      METRIC_SENSITIVE: ['badge-info', 'METRIC_SENSITIVE ΔM'],
      PLATFORM_AND_METRIC_SENSITIVE: ['badge-danger', 'PLATFORM_AND_METRIC_SENSITIVE ΔS×ΔM'],
      NO_SENSOR_CONSENSUS: ['badge-danger', 'NO_SENSOR_CONSENSUS ⇕'],
      POOLED_RANK_DISAGREEMENT: ['badge-warn', 'POOLED_RANK_DISAGREEMENT ⊕'],
    };
    const [style, label] = map[clsName] || ['badge-neutral', clsName];
    return `<span class="badge ${style}">${label}</span>`;
  }

  // =========================================================================
  // VIEW 1: OVERVIEW
  // =========================================================================

  function renderOverviewView(win, regData, analysis) {
    const sel = analysis.selected_summary;
    const union = analysis.top_day_union;

    const countPeakStr = sel.top_count_days.join(', ');
    const frpPeakStr = sel.top_frp_days.join(', ');

    const maxCountVal = Math.max(...sel.daily_count);
    const maxFrpVal = Math.max(...sel.daily_frp);

    const setEl = (id, html) => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = html;
    };

    setEl('ovRegionLabel', `${regData.meta.name} · ${win.clean_days[0]} to ${win.clean_days[win.clean_days.length - 1]}`);
    setEl('ovPlatformLabel', `Selected Constellation: ${STATE.selectedPlatforms.join(' + ')} (${analysis.subset_count} total subsets tested)`);
    setEl('ovPeakCountDate', countPeakStr);
    setEl('ovPeakCountMeta', `Peak Observed Detection Count: <b>${maxCountVal.toLocaleString()}</b> observations`);
    setEl('ovPeakFrpDate', frpPeakStr);
    setEl('ovPeakFrpMeta', `Peak Summed Observed FRP: <b>${maxFrpVal.toLocaleString()} MW</b>`);

    const agreeText = sel.metrics_agree
      ? `<span class="badge badge-ok">METRICS AGREE ON ${countPeakStr}</span>`
      : `<span class="badge badge-danger">METRIC DISAGREEMENT: Count (${countPeakStr}) ≠ FRP (${frpPeakStr})</span>`;

    setEl('ovHeroAgreementRow', `
      ${agreeText}
      ${getClassificationBadgeHTML(analysis.classifications.primary)}
      <span class="badge badge-neutral">Top-Day Union (${union.union_size}d): ${union.joint_union.join(', ')}</span>
    `);

    // 4 KPI Cards
    setEl('ovKpiCount', sel.total_detections.toLocaleString());
    setEl('ovKpiCountSub', `Peak Day: ${countPeakStr} · Quarantined ${win.quarantined_day} excluded`);

    setEl('ovKpiClusters', sel.total_clusters.toLocaleString());
    setEl('ovKpiClustersSub', `Peak Day: ${sel.top_cluster_days.join(', ')} · Spatial Occupancy / M2c`);

    setEl('ovKpiFrp', `${sel.summed_frp_mw.toLocaleString()} MW`);
    setEl('ovKpiFrpSub', `M4c Nadir-Filtered FRP: ${sel.summed_nadir_frp_mw.toLocaleString()} MW (Peak: ${sel.top_nadir_frp_days.join(', ')})`);

    setEl('ovKpiRho', sel.spearman_count_vs_frp !== null ? sel.spearman_count_vs_frp.toFixed(4) : '—');
    setEl('ovKpiRhoSub', `Tie-averaged Spearman ρ (Count vs FRP) · ${analysis.subset_count} non-empty subsets`);

    // Constellation Status Table on Overview
    const tbody = document.getElementById('ovConstellationTableBody');
    if (tbody) {
      tbody.innerHTML = '';
      STATE.bundle.instrument_timeline.forEach(inst => {
        const is2026 = STATE.windowId === '2026-11';
        const status = is2026 ? inst.status_2026_pilot : inst.status_2022_archive;
        const pCountArr = regData.daily_by_platform.count[inst.platform];
        const pFrpArr = regData.daily_by_platform.frp[inst.platform];
        const regCount = pCountArr ? pCountArr.reduce((a, b) => a + b, 0) : null;
        const regFrp = pFrpArr ? pFrpArr.reduce((a, b) => a + b, 0) : null;
        const singleTopC = pCountArr ? computeTopDaySet(Object.fromEntries(regData.days.map((d, i) => [d, pCountArr[i]]))).join(', ') : '—';
        const singleTopF = pFrpArr ? computeTopDaySet(Object.fromEntries(regData.days.map((d, i) => [d, pFrpArr[i]]))).join(', ') : '—';

        let stateBadge = `<span class="badge badge-ok">DATA_AVAILABLE ✓</span>`;
        if (status === 'FEED_EMPTY_IN_RETRIEVAL') {
          stateBadge = `<span class="badge badge-neutral">FEED_EMPTY_IN_RETRIEVAL · NULL</span>`;
        } else if (status === 'NOT_YET_LAUNCHED') {
          stateBadge = `<span class="badge badge-neutral">NOT_YET_LAUNCHED (Nov 2022)</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${inst.color};margin-right:7px"></span><b>${inst.platform}</b> <span class="mono" style="font-size:11px;color:var(--text-muted)">${inst.instrument}</span></td>
          <td class="mono">${inst.observed_2026_daytime_lst}</td>
          <td>${stateBadge}</td>
          <td class="num">${regCount !== null ? regCount.toLocaleString() : '<span style="color:var(--text-muted)">null (not 0)</span>'}</td>
          <td class="num">${regFrp !== null ? Math.round(regFrp).toLocaleString() + ' MW' : '<span style="color:var(--text-muted)">null</span>'}</td>
          <td class="mono">${singleTopC}</td>
          <td class="mono">${singleTopF}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  // =========================================================================
  // VIEW 2: HISTORICAL EXPLORER & NASA EYES 3D GLOBE
  // =========================================================================

  function renderHistoricalExplorerView(win, regData, analysis) {
    const sel = analysis.selected_summary;
    const setEl = (id, html) => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = html;
    };

    const formatCompactSpots = (n) => {
      if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
      if (n >= 1000) return `${Math.round(n / 1000)}k`;
      return n.toLocaleString();
    };

    const selDayIdx = win.clean_days.indexOf(STATE.selectedDateMode);
    const activeSpots = selDayIdx >= 0 ? sel.daily_count[selDayIdx] : sel.total_detections;
    const satCount = STATE.selectedPlatforms.length;
    const friendlyPeriod = STATE.windowId === '2026-11' ? 'Nov 7–13, 2026' : 'May 22–28, 2022';
    const activeYr = STATE.selectedYear || (STATE.windowId === '2022-05' ? 2022 : 2026);

    // Update NASA Eyes Explorer Left & Dock overlays
    setEl('eyesHudTitle', `${regData.meta.name} (${STATE.windowId})`);
    setEl('eyesHudDateReadout', STATE.selectedDateMode === 'ALL'
      ? `${friendlyPeriod} · <span style="color:#38BDF8">${formatCompactSpots(activeSpots)} spots</span> · ${satCount} sats`
      : `${STATE.selectedDateMode} · <span style="color:#38BDF8">${formatCompactSpots(activeSpots)} spots</span> · ${satCount} sats`
    );
    setEl('bottomBarDateText', STATE.selectedDateMode === 'ALL'
      ? (STATE.windowId === '2026-11' ? 'Nov 13, 2026' : 'May 28, 2022')
      : STATE.selectedDateMode
    );
    setEl('deckPeriodLabel', STATE.windowId === '2026-11' ? 'November 2026' : 'May 2022 Archive');
    const metricLabelMap = {
      count: 'Detection Count (M1)',
      clusters: '1km Clusters (M2c)',
      frp: 'Observed FRP (MW)',
      nadir_frp: 'Nadir FRP (M4c)',
    };
    setEl('deckMetricLabel', metricLabelMap[STATE.metricMode] || 'Detection / FRP');
    setEl('deckCenterDateLabel', STATE.selectedDateMode === 'ALL'
      ? `${win.clean_days[0].replace(/-/g, ' — ')} .. ${win.clean_days[win.clean_days.length - 1].slice(8)}`
      : STATE.selectedDateMode.replace(/-/g, ' — ')
    );
    setEl('activeYearChipLabel', (activeYr === 2026 || activeYr === 2022) ? `Year: ${activeYr}` : `Story: ${activeYr}`);
    setEl('activeSatChipLabel', `Satellites (${satCount})`);
    setEl('leftEventHeadline', 'Click any glowing fire pin to inspect');
    setEl('leftEventSub', `${sel.total_detections.toLocaleString()} Detections`);

    // Render ultra-slim 8-slot Horizon Spark Strip (7 clean days + 1 partial trailing UTC day)
    const track = document.getElementById('eyesTimelineTrack');
    if (track) {
      track.innerHTML = '';
      const maxDayCount = Math.max(1, ...sel.daily_count);
      const monthTag = STATE.windowId === '2022-05' ? 'May' : 'Nov';
      win.clean_days.forEach((d, idx) => {
        const cVal = sel.daily_count[idx];
        const fVal = sel.daily_frp[idx];
        const isActive = STATE.selectedDateMode === d || (STATE.selectedDateMode === 'ALL' && idx === win.clean_days.length - 1);
        const barW = Math.max(8, Math.round((cVal / maxDayCount) * 24));
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = `eyes-day-slot ${STATE.selectedDateMode === d ? 'active' : ''}`;
        slot.title = `${d} · ${cVal.toLocaleString()} detections · ${Math.round(fVal).toLocaleString()} MW`;
        const dayNum = d.slice(8);
        const lbl = STATE.selectedDateMode === d ? `${monthTag} ${dayNum}` : dayNum;
        slot.innerHTML = `
          <span class="eyes-day-lbl">${lbl}</span>
          <span class="eyes-day-bar" style="width:${barW}px"></span>
        `;
        slot.addEventListener('click', () => {
          stopTimelinePlayback();
          selectDateWithTimeTravel(d, win.clean_days);
        });
        track.appendChild(slot);
      });

      const qSlot = document.createElement('div');
      qSlot.className = 'eyes-day-slot quarantined';
      qSlot.title = `Partial UTC trailing day (${win.quarantined_day}) quarantined from daily rankings`;
      qSlot.innerHTML = `
        <span class="eyes-day-lbl">${win.quarantined_day.slice(8)}*</span>
        <span class="eyes-day-bar" style="width:10px;background:#FB7185"></span>
      `;
      track.appendChild(qSlot);
    }

    // Historical Multi-Year Comparison Table (2022 Archival vs 2026 Pilot for selected region)
    const compBody = document.getElementById('historicalComparisonTableBody');
    if (compBody) {
      const reg2022 = STATE.bundle.windows['2022-05'].regions[STATE.regionId] || STATE.bundle.windows['2022-05'].regions['saf'];
      const reg2026 = STATE.bundle.windows['2026-11'].regions[STATE.regionId] || STATE.bundle.windows['2026-11'].regions['saf'];
      const an2022 = reg2022.default_analysis.selected_summary;
      const an2026 = reg2026.default_analysis.selected_summary;

      const medCount22 = Math.round([...an2022.daily_count].sort((a, b) => a - b)[3]);
      const medCount26 = Math.round([...an2026.daily_count].sort((a, b) => a - b)[3]);
      const medFrp22 = Math.round([...an2022.daily_frp].sort((a, b) => a - b)[3]);
      const medFrp26 = Math.round([...an2026.daily_frp].sort((a, b) => a - b)[3]);

      compBody.innerHTML = `
        <tr>
          <td><b>May 22–28, 2022 (Archival Window)</b></td>
          <td class="mono">Terra + Aqua + NOAA-20 (7 subsets)</td>
          <td class="num">${an2022.total_detections.toLocaleString()}</td>
          <td class="num">${medCount22.toLocaleString()} / day</td>
          <td class="num">${an2022.summed_frp_mw.toLocaleString()} MW</td>
          <td class="num">${medFrp22.toLocaleString()} MW / day</td>
          <td class="mono">${an2022.top_count_days.join(', ')}</td>
          <td class="mono">${an2022.top_frp_days.join(', ')}</td>
          <td><span class="badge badge-info">COMPLETE 7-DAY WINDOW</span></td>
        </tr>
        <tr>
          <td><b>Nov 07–13, 2026 (Pilot Window)</b></td>
          <td class="mono">Terra + Aqua + NOAA-20 + NOAA-21 (15 subsets)</td>
          <td class="num">${an2026.total_detections.toLocaleString()}</td>
          <td class="num">${medCount26.toLocaleString()} / day</td>
          <td class="num">${an2026.summed_frp_mw.toLocaleString()} MW</td>
          <td class="num">${medFrp26.toLocaleString()} MW / day</td>
          <td class="mono">${an2026.top_count_days.join(', ')}</td>
          <td class="mono">${an2026.top_frp_days.join(', ')}</td>
          <td><span class="badge badge-warn">CONSTELLATION SHIFT (+NOAA-21)</span></td>
        </tr>
      `;
    }
  }

  function selectDateWithTimeTravel(newDate, cleanDays) {
    const oldDate = STATE.selectedDateMode;
    if (oldDate !== newDate && STATE.globe3d && newDate !== 'ALL') {
      const oldIdx = cleanDays.indexOf(oldDate);
      const newIdx = cleanDays.indexOf(newDate);
      let delta = 0;
      if (oldIdx >= 0 && newIdx >= 0) {
        delta = newIdx - oldIdx;
      } else if (newDate < oldDate) {
        delta = -1;
      } else {
        delta = 1;
      }
      if (delta !== 0) {
        STATE.globe3d.triggerTimeTravelRotation(delta);
        showToast(delta < 0
          ? `◀ Moving Back in Time to ${newDate} (Retrograde Earth Rotation)`
          : `▶ Advancing in Time to ${newDate}`
        );
      }
    }
    STATE.selectedDateMode = newDate;
    refreshAllViews();

    // Update active satellite imagery pop-up if it is open
    if (STATE.reconPopup && STATE.reconPopup.popupEl && STATE.reconPopup.popupEl.classList.contains('open')) {
      STATE.reconPopup.show(STATE.reconPopup.currentZone, newDate, STATE.activeDayPoints, STATE.selectedPlatforms);
    }
  }

  function isMajorFireHotspotOutsideAfrica(c) {
    // c = [platform, lat, lon, count, frp, nadir_frp]
    const lat = c[1], lon = c[2], val = c[3], frp = c[4];
    // Keep high-detail Africa (Southern, Central, East, West Africa Sahel/Savanna south of Sahara 16°N)
    if (lat >= -35 && lat <= 16 && lon >= -18 && lon <= 52) {
      return val >= 3 || frp >= 25;
    }
    // Outside Africa: retain ONLY top major fire regimes (Cerrado/Amazon, N. Australia, SE Asia, W. North America)
    const inSouthAmerica = lat >= -32 && lat <= 8 && lon >= -76 && lon <= -36;
    const inAustralia = lat >= -36 && lat <= -10 && lon >= 114 && lon <= 154;
    const inSEAsia = lat >= -8 && lat <= 24 && lon >= 94 && lon <= 128;
    const inNorthAmerica = lat >= 16 && lat <= 56 && lon >= -130 && lon <= -75;
    if (inSouthAmerica || inAustralia || inSEAsia || inNorthAmerica) {
      return val >= 14 || frp >= 180;
    }
    return false;
  }

  function update3DGlobes(win, regData) {
    if (!STATE.globe3d) return;
    const globalByDay = win.globe_cells_by_day || {};
    const saByDay = (STATE.windowId === '2026-11' && STATE.bundle.southern_africa_deep_dive)
      ? STATE.bundle.southern_africa_deep_dive.regional_cells_by_day
      : null;

    // Default to SINGLE active date so the Earth never gets bombarded with all historical days at once
    const daysToInclude = STATE.selectedDateMode === 'ALL'
      ? win.clean_days
      : [STATE.selectedDateMode || win.clean_days[win.clean_days.length - 1]];

    const exactMap = STATE.exactHotspotsByDay || {};
    const winExact = exactMap[STATE.windowId] || exactMap;
    const exactPts = [];
    let hasExactForSelected = false;

    if (STATE.selectedYear === 2026 || STATE.selectedYear === 2022) {
      daysToInclude.forEach(dayStr => {
        const dayExact = winExact[dayStr];
        if (Array.isArray(dayExact) && dayExact.length > 0) {
          hasExactForSelected = true;
          for (let i = 0; i < dayExact.length; i++) {
            exactPts.push(dayExact[i]);
          }
        }
      });
    }

    if (hasExactForSelected) {
      STATE.activeDayPoints = exactPts;
      STATE.globe3d.setObservationPoints(exactPts, STATE.metricMode, STATE.selectedPlatforms);
      return;
    }

    if (STATE.selectedYear !== 2026 && STATE.selectedYear !== 2022) {
      // Archival incident year outside statistical FIRMS CSV windows: keep globe focused on that year's verified events cleanly
      STATE.activeDayPoints = [];
      STATE.globe3d.setObservationPoints([], STATE.metricMode, STATE.selectedPlatforms);
      return;
    }

    const cellMap = new Map();

    const addCell = (d) => {
      const key = `${d[0]}_${d[1]}_${d[2]}`;
      const existing = cellMap.get(key);
      if (existing) {
        existing[3] += d[3];
        existing[4] = Number((existing[4] + d[4]).toFixed(2));
        existing[5] = Number((existing[5] + d[5]).toFixed(2));
      } else {
        cellMap.set(key, [d[0], d[1], d[2], d[3], d[4], d[5]]);
      }
    };

    daysToInclude.forEach(dayStr => {
      const gList = globalByDay[dayStr] || [];
      for (let i = 0; i < gList.length; i++) {
        const c = gList[i];
        if (saByDay && c[1] >= -35 && c[1] <= -5 && c[2] >= 10 && c[2] <= 52) continue;
        if (!isMajorFireHotspotOutsideAfrica(c)) continue;
        addCell(c);
      }
      if (saByDay && saByDay[dayStr]) {
        const sList = saByDay[dayStr];
        for (let i = 0; i < sList.length; i++) {
          addCell(sList[i]);
        }
      }
    });

    const pts = Array.from(cellMap.values());
    STATE.activeDayPoints = pts;
    STATE.globe3d.setObservationPoints(pts, STATE.metricMode, STATE.selectedPlatforms);
  }

  // =========================================================================
  // VIEW 3: METRIC INTELLIGENCE
  // =========================================================================

  function renderMetricIntelligenceView(win, regData, analysis) {
    const sel = analysis.selected_summary;
    const days = regData.days;
    const cRanks = global.FIRMSCharts.computeTieAveragedRanksDesc(sel.daily_count);
    const fRanks = global.FIRMSCharts.computeTieAveragedRanksDesc(sel.daily_frp);
    const nRanks = global.FIRMSCharts.computeTieAveragedRanksDesc(sel.daily_nadir_frp);

    const setEl = (id, html) => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = html;
    };

    setEl('miCountTopDay', sel.top_count_days.join(', '));
    setEl('miFrpTopDay', sel.top_frp_days.join(', '));
    setEl('miNadirTopDay', sel.top_nadir_frp_days.join(', '));
    setEl('miSpearmanVal', sel.spearman_count_vs_frp !== null ? sel.spearman_count_vs_frp.toFixed(4) : '—');
    setEl('miDisagreementVerdict', sel.metrics_agree
      ? `<span class="badge badge-ok">SAME TOP DAY (${sel.top_count_days.join(', ')})</span>`
      : `<span class="badge badge-danger">DIFFERENT TOP DAYS: Count → ${sel.top_count_days.join(', ')} vs FRP → ${sel.top_frp_days.join(', ')}</span>`
    );

    const tbody = document.getElementById('miDailyComparisonTableBody');
    if (tbody) {
      tbody.innerHTML = '';
      days.forEach((d, i) => {
        const rShift = cRanks[i] - fRanks[i];
        const isTopC = sel.top_count_days.includes(d);
        const isTopF = sel.top_frp_days.includes(d);
        const tr = document.createElement('tr');
        if (isTopC || isTopF) tr.className = 'selected-row';
        tr.innerHTML = `
          <td class="mono"><b>${d}</b> ${isTopC ? '<span class="badge badge-count">● #1 COUNT</span>' : ''} ${isTopF ? '<span class="badge badge-frp">◆ #1 FRP</span>' : ''}</td>
          <td class="num">${sel.daily_count[i].toLocaleString()}</td>
          <td class="num">#${cRanks[i]}</td>
          <td class="num">${sel.daily_frp[i].toLocaleString()} MW</td>
          <td class="num">#${fRanks[i]}</td>
          <td class="num">${sel.daily_nadir_frp[i].toLocaleString()} MW</td>
          <td class="num">#${nRanks[i]}</td>
          <td class="num">${rShift === 0 ? '<span class="badge badge-ok">0 (Aligned)</span>' : `<span class="badge badge-warn">${rShift > 0 ? '+' : ''}${rShift} Rank Shift</span>`}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  // =========================================================================
  // VIEW 4: CONSTELLATION LAB (15-SUBSET / 7-SUBSET MATRIX & PIVOTAL INFLUENCE)
  // =========================================================================

  function renderConstellationLabView(win, regData, analysis) {
    const union = analysis.top_day_union;
    const setEl = (id, html) => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = html;
    };

    setEl('clUnionBadges', `
      <span class="badge badge-count">Count Top-Day Union: ${union.count_union.join(', ')}</span>
      <span class="badge badge-frp">FRP Top-Day Union: ${union.frp_union.join(', ')}</span>
      <span class="badge badge-info">Combined Top-Day Union (${union.union_size} dates): ${union.joint_union.join(', ')}</span>
    `);

    setEl('clClassificationBadges', analysis.classifications.active_badges.map(getClassificationBadgeHTML).join(' '));

    // Full 2D Platform Subset x Metric Matrix
    const matrixBody = document.getElementById('clSubsetMatrixBody');
    if (matrixBody) {
      matrixBody.innerHTML = '';
      analysis.subset_matrix.forEach((row, idx) => {
        const tr = document.createElement('tr');
        if (row.is_currently_selected) tr.className = 'selected-row';
        tr.style.cursor = 'pointer';
        tr.title = 'Click to activate this exact platform subset';
        tr.addEventListener('click', () => {
          STATE.selectedPlatforms = [...row.subset];
          refreshAllViews();
        });
        tr.innerHTML = `
          <td class="mono">${idx + 1}</td>
          <td><b>${row.subset.join(' + ')}</b> ${row.is_singleton ? '<span class="badge badge-neutral">Singleton</span>' : ''} ${row.is_full_constellation ? '<span class="badge badge-info">All Active</span>' : ''} ${row.is_currently_selected ? '<span class="badge badge-ok">Selected</span>' : ''}</td>
          <td class="num">${row.total_detections.toLocaleString()}</td>
          <td class="num">${row.summed_frp_mw.toLocaleString()} MW</td>
          <td class="mono"><span class="badge badge-count">● ${row.top_count_days.join(', ')}</span></td>
          <td class="mono"><span class="badge badge-frp">◆ ${row.top_frp_days.join(', ')}</span></td>
          <td class="mono">${row.top_nadir_frp_days.join(', ')}</td>
          <td class="num">${row.spearman_count_vs_frp !== null ? row.spearman_count_vs_frp.toFixed(4) : '—'}</td>
          <td>${row.metrics_agree ? '<span class="badge badge-ok">AGREE ✓</span>' : '<span class="badge badge-danger">DISAGREE ΔM</span>'}</td>
        `;
        matrixBody.appendChild(tr);
      });
    }

    // Pivotal-Subset Platform Influence Table
    const infBody = document.getElementById('clInfluenceTableBody');
    if (infBody) {
      infBody.innerHTML = '';
      analysis.available_platforms.forEach(p => {
        const cInf = analysis.platform_influence.detection_count[p];
        const fInf = analysis.platform_influence.summed_frp[p];
        const pivotalCountList = cInf.pivotal_coalitions.map(c => `{${c.coalition.join(',')}}: ${c.top_without_p.join('/')}→${c.top_with_p.join('/')}`).join('; ') || 'None (0 pivotal transitions)';
        const pivotalFrpList = fInf.pivotal_coalitions.map(c => `{${c.coalition.join(',')}}: ${c.top_without_p.join('/')}→${c.top_with_p.join('/')}`).join('; ') || 'None (0 pivotal transitions)';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><b>${p}</b></td>
          <td class="num"><b>${cInf.I_p.toFixed(4)}</b> <span class="mono">(${cInf.fraction_label})</span></td>
          <td>${cInf.leave_one_out_flips_pooled ? '<span class="badge badge-warn">FLIPS POOLED</span>' : '<span class="badge badge-neutral">Stable</span>'}</td>
          <td class="mono" style="font-size:11px">${pivotalCountList}</td>
          <td class="num"><b>${fInf.I_p.toFixed(4)}</b> <span class="mono">(${fInf.fraction_label})</span></td>
          <td class="mono" style="font-size:11px">${pivotalFrpList}</td>
        `;
        infBody.appendChild(tr);
      });
    }
  }

  // =========================================================================
  // VIEW 5: SPATIAL HOTSPOT INTELLIGENCE
  // =========================================================================

  function renderHotspotIntelligenceView() {
    if (!STATE.bundle) return;
    const saDeep = STATE.bundle.southern_africa_deep_dive;
    const gridObj = saDeep.multi_resolution_hotspots[STATE.hotspotRes] || saDeep.multi_resolution_hotspots['1.0deg'];

    const listToRender = STATE.hotspotMetric === 'frp'
      ? gridObj.top_by_frp
      : (STATE.hotspotMetric === 'clusters' ? gridObj.top_by_clusters : gridObj.top_by_count);

    if (STATE.hotspotMap2d) {
      STATE.hotspotMap2d.update(listToRender.slice(0, 18), STATE.hotspotMetric, STATE.hotspotRes);
    }

    // Populate side-by-side Frequency vs FRP Hotspot tables
    const countBody = document.getElementById('hsCountTableBody');
    const frpBody = document.getElementById('hsFrpTableBody');

    if (countBody) {
      countBody.innerHTML = '';
      gridObj.top_by_count.slice(0, 10).forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="num">#${c.rank}</td>
          <td class="mono"><b>${c.cell_id}</b></td>
          <td class="num"><b>${c.detection_count.toLocaleString()}</b></td>
          <td class="num">${c.spatial_cluster_count.toLocaleString()}</td>
          <td class="num">${c.summed_frp_mw.toLocaleString()} MW</td>
          <td class="num">${c.daytime_pct}% Day</td>
        `;
        countBody.appendChild(tr);
      });
    }

    if (frpBody) {
      frpBody.innerHTML = '';
      gridObj.top_by_frp.slice(0, 10).forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="num">#${c.rank}</td>
          <td class="mono"><b>${c.cell_id}</b></td>
          <td class="num"><b>${c.summed_frp_mw.toLocaleString()} MW</b></td>
          <td class="num">${c.nadir_frp_mw.toLocaleString()} MW</td>
          <td class="num">${c.detection_count.toLocaleString()}</td>
          <td class="num">${c.mean_frp_per_obs} MW/obs</td>
        `;
        frpBody.appendChild(tr);
      });
    }
  }

  // =========================================================================
  // VIEW 6: OPERATIONAL DECISION ANALYSIS (D1, D2, D3)
  // =========================================================================

  function renderDecisionAnalysisView(win, regData, analysis) {
    const sel = analysis.selected_summary;
    const d3Count = regData.d3_trajectory.count;
    const d3Frp = regData.d3_trajectory.frp;

    const setEl = (id, html) => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = html;
    };

    // D1 Card
    setEl('d1SummaryContent', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div class="card" style="padding:10px;background:var(--bg-subtle)">
          <div class="mono" style="font-size:10.5px;color:var(--metric-count)">HIGHEST OBSERVED DETECTION-COUNT DAY</div>
          <div class="mono" style="font-size:17px;font-weight:800;margin-top:3px">${sel.top_count_days.join(', ')}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--bg-subtle)">
          <div class="mono" style="font-size:10.5px;color:var(--metric-frp)">HIGHEST OBSERVED FRP DAY</div>
          <div class="mono" style="font-size:17px;font-weight:800;margin-top:3px">${sel.top_frp_days.join(', ')}</div>
        </div>
      </div>
      <div class="mono" style="font-size:12px;line-height:1.6">
        <div>• <b>Top-Day Union Across All ${analysis.subset_count} Subsets:</b> ${analysis.top_day_union.joint_union.join(', ')}</div>
        <div>• <b>Southern Africa Validated Benchmark:</b> Unordered Top-2 alert window <code>{2026-11-07, 2026-11-08}</code> is invariant across MODIS Combined, Aqua, NOAA-20, and NOAA-21, while exact #1 day shifts between Nov 08 (MODIS count) and Nov 07 (VIIRS &amp; all FRP). Morning-only Terra selects Nov 10 (#1 under 2km geodesic clusters).</div>
      </div>
    `);

    // D3 Trajectory Table
    const d3Body = document.getElementById('d3TrajectoryTableBody');
    if (d3Body) {
      d3Body.innerHTML = '';
      win.platforms.forEach(p => {
        const cArr = regData.daily_by_platform.count[p] || [];
        const fArr = regData.daily_by_platform.frp[p] || [];
        const earlyC = cArr.slice(0, 3).reduce((a, b) => a + b, 0);
        const lateC = cArr.slice(-3).reduce((a, b) => a + b, 0);
        const pctC = earlyC > 0 ? (((lateC - earlyC) / earlyC) * 100).toFixed(1) : '—';

        const earlyF = fArr.slice(0, 3).reduce((a, b) => a + b, 0);
        const lateF = fArr.slice(-3).reduce((a, b) => a + b, 0);
        const pctF = earlyF > 0 ? (((lateF - earlyF) / earlyF) * 100).toFixed(1) : '—';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><b>${p}</b></td>
          <td class="mono">${regData.days.slice(0, 3).map(d => d.slice(5)).join(', ')}</td>
          <td class="mono">${regData.days.slice(-3).map(d => d.slice(5)).join(', ')}</td>
          <td class="num">${earlyC.toLocaleString()} → ${lateC.toLocaleString()}</td>
          <td class="num"><b>${pctC}%</b></td>
          <td class="num">${Math.round(earlyF).toLocaleString()} → ${Math.round(lateF).toLocaleString()} MW</td>
          <td class="num"><b>${pctF}%</b></td>
          <td><span class="badge ${Number(pctC) < 0 && Number(pctF) < 0 ? 'badge-ok' : 'badge-warn'}">${Number(pctC) < 0 && Number(pctF) < 0 ? 'DECLINING (ALIGNED)' : 'MIXED'}</span></td>
        `;
        d3Body.appendChild(tr);
      });
    }

    setEl('d3PooledSummary', `
      <b>Pooled Region Trajectory (${regData.meta.name}):</b>
      Observed Detection Count changed by <b>${d3Count.pct_change_3d_vs_3d}%</b> (${d3Count.early_window_sum.toLocaleString()} → ${d3Count.late_window_sum.toLocaleString()}, OLS slope: ${d3Count.ols_daily_slope}/day);
      Summed Observed FRP changed by <b>${d3Frp.pct_change_3d_vs_3d}%</b> (${d3Frp.early_window_sum.toLocaleString()} MW → ${d3Frp.late_window_sum.toLocaleString()} MW, OLS slope: ${d3Frp.ols_daily_slope} MW/day).
    `);
  }

  // =========================================================================
  // VIEW 7: DATA & METHODOLOGY + CSV INGESTION & EXPORT
  // =========================================================================

  function renderMethodologyView() {
    if (!STATE.bundle) return;
    const corrContainer = document.getElementById('methodologyCorrectionsList');
    if (corrContainer && corrContainer.children.length === 0) {
      corrContainer.innerHTML = STATE.bundle.mandatory_corrections.map(c => `
        <div class="card" style="margin-bottom:12px;border-left:4px solid #0284C7">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <b class="mono" style="font-size:13px">${c.id}: ${c.title}</b>
            <span class="badge badge-ok">${c.status}</span>
          </div>
          ${c.falsified_method ? `<div style="font-size:12px;color:#DC2626;margin-bottom:4px"><b>Falsified / Rejected:</b> ${c.falsified_method} — ${c.falsified_result || ''}</div>` : ''}
          <div style="font-size:12.5px;color:var(--text-secondary)"><b>Validated Production Implementation:</b> ${c.validated_replacement} ${c.validated_result ? `(${c.validated_result})` : ''}</div>
        </div>
      `).join('');
    }
  }

  // =========================================================================
  // WEB AUDIO STEREO SONIFICATION (COUNT = LEFT, FRP = RIGHT)
  // =========================================================================

  function playDualMetricSonification() {
    if (!STATE.currentAnalysis) return;
    const sel = STATE.currentAnalysis.selected_summary;
    const cArr = sel.daily_count;
    const fArr = sel.daily_frp;
    if (!cArr || cArr.length === 0) return;

    if (STATE.audioCtx) {
      try { STATE.audioCtx.close(); } catch (_) {}
      STATE.audioCtx = null;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      showToast('Web Audio API is not supported in this browser.');
      return;
    }

    const ctx = new AudioCtx();
    STATE.audioCtx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);

    const norm = arr => {
      const lo = Math.min(...arr), hi = Math.max(...arr);
      return arr.map(v => (v - lo) / Math.max(hi - lo, 1e-9));
    };
    const cN = norm(cArr);
    const fN = norm(fArr);
    const noteDur = 0.36;
    const t0 = ctx.currentTime + 0.05;

    cN.forEach((uC, i) => {
      const uF = fN[i];
      const start = t0 + i * noteDur;
      const end = start + noteDur * 0.88;

      const makeTone = (u, panVal, waveType) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const pan = ctx.createStereoPanner();
        osc.type = waveType;
        osc.frequency.value = 220 + 280 * u;
        pan.pan.value = panVal;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.14, start + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(g).connect(pan).connect(master);
        osc.start(start);
        osc.stop(end + 0.02);
      };

      makeTone(uC, -0.7, 'triangle'); // Left ear: Detection Count
      makeTone(uF, 0.7, 'sine');      // Right ear: Summed Observed FRP
    });

    showToast('Playing 7-day stereo comparison: Left Channel = Count, Right Channel = FRP (MW).');
  }

  // =========================================================================
  // TIMELINE PLAYBACK CONTROLLER (NASA EYES)
  // =========================================================================

  function toggleTimelinePlayback(direction = 1) {
    if (STATE.playbackPlaying && STATE.playbackDirection === direction) {
      stopTimelinePlayback();
      return;
    }
    if (STATE.playbackTimer) clearTimeout(STATE.playbackTimer);
    const win = STATE.bundle.windows[STATE.windowId];
    const days = win.clean_days;
    STATE.playbackPlaying = true;
    STATE.playbackDirection = direction;

    const playBtn = document.getElementById('eyesPlayBtn');
    const rewindBtn = document.getElementById('eyesRewindBtn');
    if (playBtn) playBtn.textContent = direction > 0 ? '⏸' : '▶';
    if (rewindBtn) rewindBtn.textContent = direction < 0 ? '⏸' : '◀';

    let idx = days.indexOf(STATE.selectedDateMode);
    if (idx < 0) idx = direction > 0 ? 0 : days.length - 1;

    const stepDay = () => {
      if (!STATE.playbackPlaying) return;
      selectDateWithTimeTravel(days[idx], days, direction);
      idx = (idx + direction + days.length) % days.length;
      STATE.playbackTimer = setTimeout(stepDay, Math.round(950 / STATE.playbackSpeed));
    };
    stepDay();
  }

  function stopTimelinePlayback() {
    STATE.playbackPlaying = false;
    if (STATE.playbackTimer) clearTimeout(STATE.playbackTimer);
    STATE.playbackTimer = null;
    const playBtn = document.getElementById('eyesPlayBtn');
    const rewindBtn = document.getElementById('eyesRewindBtn');
    if (playBtn) playBtn.textContent = '▶';
    if (rewindBtn) rewindBtn.textContent = '◀';
  }

  function stepTimeline(dir) {
    stopTimelinePlayback();
    const win = STATE.bundle.windows[STATE.windowId];
    const days = win.clean_days;
    let idx = days.indexOf(STATE.selectedDateMode);
    if (idx < 0) idx = dir > 0 ? 0 : days.length - 1;
    else idx = (idx + dir + days.length) % days.length;
    selectDateWithTimeTravel(days[idx], days, dir);
  }

  // =========================================================================
  // LOCAL CSV INGESTION & REPRODUCIBLE EXPORTS
  // =========================================================================

  async function runCsvIngestionTest(filename, csvContent, platform) {
    const outBox = document.getElementById('csvIngestionResultBox');
    if (outBox) outBox.innerHTML = `<div class="mono">Running SHA-256 &amp; CORR-03 hygiene audit on ${filename}...</div>`;
    try {
      const res = await fetch('/api/ingest-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, csv_content: csvContent, platform }),
      });
      const data = await res.json();
      if (outBox) {
        outBox.innerHTML = `<pre class="mono" style="margin:0;font-size:11.5px;white-space:pre-wrap">${JSON.stringify(data, null, 2)}</pre>`;
      }
      showToast(`Audited ${filename}: status = ${data.source_state}`);
    } catch (err) {
      if (outBox) outBox.textContent = `Ingestion error: ${err.message}`;
    }
  }

  function exportReproducibleJsonBundle() {
    if (!STATE.currentAnalysis || !STATE.bundle) return;
    const win = STATE.bundle.windows[STATE.windowId];
    const regData = win.regions[STATE.regionId];
    const payload = {
      exported_at_utc: new Date().toISOString(),
      project: 'FIRMS Constellation Intelligence',
      configuration: {
        window_id: STATE.windowId,
        date_range: `${win.clean_days[0]} to ${win.clean_days[win.clean_days.length - 1]}`,
        quarantined_partial_utc_date: win.quarantined_day,
        region_id: STATE.regionId,
        region_name: regData.meta.name,
        available_platforms: STATE.currentAnalysis.available_platforms,
        selected_platforms: STATE.selectedPlatforms,
        metric_mode: STATE.metricMode,
        data_coverage_status: 'DATA_AVAILABLE (Partial trailing UTC date quarantined per CORR-03)',
      },
      results: STATE.currentAnalysis,
      d3_trajectory: regData.d3_trajectory,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `firms_reproducibility_${STATE.windowId}_${STATE.regionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded reproducible JSON analysis + configuration manifest.');
  }

  function exportDailyCsvTable() {
    window.location.href = `/api/export/csv?window=${encodeURIComponent(STATE.windowId)}&region=${encodeURIComponent(STATE.regionId)}`;
    showToast('Downloading reproducible daily CSV table with provenance headers...');
  }

  // =========================================================================
  // EVENT BINDINGS
  // =========================================================================

  function bindGlobalEvents() {
    // Navigation buttons (open/toggle glass drawers)
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Close drawer buttons ("✕ Return to 3D Earth")
    document.querySelectorAll('[data-close-drawer]').forEach(btn => {
      btn.addEventListener('click', () => switchView(null));
    });

    // Brand click & "+" button & MAIN MENU
    const brandReset = document.getElementById('brandResetGlobeBtn');
    if (brandReset) {
      brandReset.addEventListener('click', () => {
        switchView(null);
        if (STATE.globe3d) {
          STATE.globe3d.setEarthStyle('visible_earth');
          STATE.globe3d.showOrbits = true;
          STATE.globe3d.flyTo(-6.0, 21.0, 1.08);
          STATE.globe3d.autoSpin = true;
        }
      });
    }

    const openOvBtn = document.getElementById('hudOpenOverviewBtn');
    if (openOvBtn) openOvBtn.addEventListener('click', () => switchView('overview'));

    function switchHistoricalYear(newYear, autoFly = true) {
      const yr = Number(newYear) || 2026;
      const prevYr = STATE.selectedYear || 2026;
      STATE.selectedYear = yr;

      document.querySelectorAll('#eyesYearTrack .eyes-year-pill').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.year) === yr);
      });

      const isGoingBack = yr < prevYr;
      if (STATE.globe3d) {
        const yrZones = STATE.globe3d.setActiveYear(yr);
        if (STATE.reconPopup) STATE.reconPopup.setZonesList(yrZones);
        if (yr !== prevYr) {
          STATE.globe3d.triggerTimeTravelRotation(isGoingBack ? -3 : 3);
        }

        if (yr === 2022 && STATE.windowId !== '2022-05') {
          STATE.windowId = '2022-05';
          const winSel = document.getElementById('globalWindowSelect');
          if (winSel) winSel.value = '2022-05';
          syncPlatformSelectionForWindow('2026-11');
        } else if (yr === 2026 && STATE.windowId !== '2026-11') {
          STATE.windowId = '2026-11';
          const winSel = document.getElementById('globalWindowSelect');
          if (winSel) winSel.value = '2026-11';
          syncPlatformSelectionForWindow('2022-05');
        }

        refreshAllViews();

        const leadEv = yrZones[0] || null;
        const calloutHeadline = document.getElementById('leftEventHeadline');
        const deckDate = document.getElementById('deckCenterDateLabel');
        const yearChipLbl = document.getElementById('activeYearChipLabel');
        if (yearChipLbl) {
          yearChipLbl.textContent = (yr === 2026 || yr === 2022) ? `Year: ${yr}` : `Story: ${yr}`;
        }
        if (leadEv && yr !== 2026 && yr !== 2022) {
          if (deckDate) deckDate.textContent = `${leadEv.incidentDate.replace(/-/g, ' — ')}`;
          if (calloutHeadline) calloutHeadline.textContent = `${yr} · ${leadEv.title.slice(0, 34)} — click pin to inspect`;
        } else if (calloutHeadline) {
          calloutHeadline.textContent = 'Click any glowing fire pin to inspect';
        }

        if (autoFly && leadEv && yr !== 2026) {
          if (STATE.reconPopup) STATE.reconPopup.hide(false);
          STATE.globe3d.flyTo(leadEv.lat, leadEv.lon, 1.85, leadEv);
        } else if (autoFly && yr === 2026) {
          if (STATE.reconPopup) STATE.reconPopup.hide(false);
          STATE.globe3d.flyTo(-12.0, 22.0, 1.12);
        }

        if (yr !== prevYr) {
          showToast(isGoingBack
            ? `◀ Moving Back in Time to ${yr} · Showing ${yr} Verified Fire Incidents Only`
            : `▶ Advancing in Time to ${yr} · Showing ${yr} Verified Fire Incidents Only`
          );
        }
      }
    }

    // Bind global handle for FireStoriesManager
    STATE._switchHistoricalYear = switchHistoricalYear;

    const sciLabBtn = document.getElementById('scienceLabToggleBtn');
    const sciLabPop = document.getElementById('scienceLabPopover');
    const yearPopBtn = document.getElementById('yearPopoverTrigger');
    const yearPop = document.getElementById('yearPopover');
    const satPopBtn = document.getElementById('satPopoverTrigger');
    const satPop = document.getElementById('satPopover');
    const layersFab = document.getElementById('layersFabBtn');
    const layersPop = document.getElementById('layersPopover');
    const closeLayersBtn = document.getElementById('closeLayersPopoverBtn');

    const closeAllHudPopovers = (exceptPop = null) => {
      [
        [sciLabPop, sciLabBtn],
        [yearPop, yearPopBtn],
        [satPop, satPopBtn],
        [layersPop, layersFab],
      ].forEach(([pop, btn]) => {
        if (pop && pop !== exceptPop) {
          pop.classList.remove('open');
          if (btn) btn.classList.remove('open', 'active');
          if (btn === sciLabBtn) btn.setAttribute('aria-expanded', 'false');
        }
      });
    };

    if (sciLabBtn && sciLabPop) {
      sciLabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !sciLabPop.classList.contains('open');
        closeAllHudPopovers(willOpen ? sciLabPop : null);
        sciLabPop.classList.toggle('open', willOpen);
        sciLabBtn.classList.toggle('open', willOpen);
        sciLabBtn.setAttribute('aria-expanded', String(willOpen));
      });
      sciLabPop.querySelectorAll('.lab-item').forEach(item => {
        item.addEventListener('click', () => closeAllHudPopovers(null));
      });
    }

    if (yearPopBtn && yearPop) {
      yearPopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !yearPop.classList.contains('open');
        closeAllHudPopovers(willOpen ? yearPop : null);
        yearPop.classList.toggle('open', willOpen);
        yearPopBtn.classList.toggle('open', willOpen);
      });
    }

    if (satPopBtn && satPop) {
      satPopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !satPop.classList.contains('open');
        closeAllHudPopovers(willOpen ? satPop : null);
        satPop.classList.toggle('open', willOpen);
        satPopBtn.classList.toggle('open', willOpen);
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.science-lab-wrap, .dock-popover, #yearPopoverTrigger, #satPopoverTrigger, #layersPopover, #layersFabBtn')) {
        closeAllHudPopovers(null);
      }
    });

    document.querySelectorAll('#eyesYearTrack .eyes-year-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        switchHistoricalYear(Number(btn.dataset.year), true);
        if (yearPop) yearPop.classList.remove('open');
        if (yearPopBtn) yearPopBtn.classList.remove('open');
      });
    });

    const mainMenuBtn = document.getElementById('mainMenuToggleBtn');
    if (mainMenuBtn) mainMenuBtn.addEventListener('click', () => {
      closeAllHudPopovers(null);
      switchView('overview');
    });

    // Top-bar Earth Shader mode switches (Earth vs Night IR)
    const visEarthBtn = document.getElementById('topLinkVisibleEarth');
    const nightEarthBtn = document.getElementById('topLinkNightEarth');
    const deck = document.getElementById('firmsEarthDeck');
    const blTitle = document.getElementById('hudActiveLayerTitle');

    const activateEarthVisualMode = (style, _showScrubber, titleText) => {
      switchView(null);
      closeAllHudPopovers(null);
      if (STATE.globe3d) {
        STATE.globe3d.setProjectionMode('3D');
        STATE.globe3d.setEarthStyle(style);
        STATE.globe3d.showOrbits = style === 'visible_earth';
      }
      if (visEarthBtn) visEarthBtn.classList.toggle('active', style === 'visible_earth');
      if (nightEarthBtn) nightEarthBtn.classList.toggle('active', style === 'cobalt_night');
      if (deck) deck.classList.remove('minimized');
      if (blTitle && titleText) blTitle.textContent = titleText;
    };

    if (visEarthBtn) {
      visEarthBtn.addEventListener('click', () => {
        activateEarthVisualMode('visible_earth', true, 'Earth from Orbit');
      });
    }
    if (nightEarthBtn) {
      nightEarthBtn.addEventListener('click', () => {
        activateEarthVisualMode('cobalt_night', true, 'Night Infrared Earth');
      });
    }

    // Upper-left guide chip click -> calmly rotate/zoom Earth onto fire belt
    const leftEvent = document.getElementById('leftLatestEventCallout');
    if (leftEvent) {
      leftEvent.addEventListener('click', () => {
        if (STATE.globe3d && STATE.globe3d.globeEvents && STATE.globe3d.globeEvents.length > 0) {
          const ev = STATE.globe3d.globeEvents[0];
          STATE.globe3d.flyTo(ev.lat, ev.lon, 1.85, ev);
        } else if (STATE.globe3d) {
          STATE.globe3d.flyTo(-22.5, 24.0, 1.85);
        }
        showToast('Focused fire zone — click any glowing fire spot to inspect');
      });
    }

    // Layers trigger in top command pill
    if (layersFab && layersPop) {
      layersFab.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !layersPop.classList.contains('open');
        closeAllHudPopovers(willOpen ? layersPop : null);
        layersPop.classList.toggle('open', willOpen);
        layersFab.classList.toggle('active', willOpen);
      });
    }
    if (closeLayersBtn && layersPop) {
      closeLayersBtn.addEventListener('click', () => closeAllHudPopovers(null));
    }

    // Bottom NASA Eyes Vital Signs Bar tabs
    document.querySelectorAll('[data-vital-action]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.vital-sign-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const act = tab.dataset.vitalAction;
        if (act === 'satellites_now') {
          activateEarthVisualMode('visible_earth', false, 'Satellites Now');
          if (STATE.globe3d) STATE.globe3d.showOrbits = true;
        } else if (act === 'visible_earth') {
          activateEarthVisualMode('visible_earth', false, 'Visible Earth');
        } else if (act === 'night_fire') {
          activateEarthVisualMode('cobalt_night', true, 'FIRMS Night Thermal');
        } else if (act === 'metric_count') {
          STATE.metricMode = 'count';
          if (blTitle) blTitle.textContent = 'Detection Count (M1)';
          refreshAllViews();
        } else if (act === 'metric_clusters') {
          STATE.metricMode = 'clusters';
          if (blTitle) blTitle.textContent = '1km Geodesic Clusters';
          refreshAllViews();
        } else if (act === 'metric_frp') {
          STATE.metricMode = 'frp';
          if (blTitle) blTitle.textContent = 'Observed FRP (MW)';
          refreshAllViews();
        } else if (act === 'metric_nadir') {
          STATE.metricMode = 'nadir_frp';
          if (blTitle) blTitle.textContent = 'Nadir-Filtered FRP';
          refreshAllViews();
        }
      });
    });

    // Bottom-right NASA Eyes utility icons
    const bClock = document.getElementById('bottomClockToggleDeck');
    const bDeckBtn = document.getElementById('bottomToggleDeckBtn');
    if (bClock && deck) bClock.addEventListener('click', () => deck.classList.toggle('minimized'));
    if (bDeckBtn && deck) bDeckBtn.addEventListener('click', () => deck.classList.toggle('minimized'));

    const bZoomInBtn = document.getElementById('bottomZoomInBtn');
    if (bZoomInBtn) {
      bZoomInBtn.addEventListener('click', () => {
        if (STATE.globe3d) STATE.globe3d.zoomBy(1.55);
      });
    }

    const bZoomOutBtn = document.getElementById('bottomZoomOutBtn');
    if (bZoomOutBtn) {
      bZoomOutBtn.addEventListener('click', () => {
        if (STATE.globe3d) STATE.globe3d.zoomBy(0.64);
      });
    }

    const bOrbitBtn = document.getElementById('bottomToggleOrbitsBtn');
    if (bOrbitBtn) {
      bOrbitBtn.addEventListener('click', () => {
        if (!STATE.globe3d) return;
        STATE.globe3d.showOrbits = !STATE.globe3d.showOrbits;
        bOrbitBtn.classList.toggle('active', STATE.globe3d.showOrbits);
      });
    }

    const bShaderBtn = document.getElementById('bottomToggleShaderBtn');
    if (bShaderBtn) {
      bShaderBtn.addEventListener('click', () => {
        if (!STATE.globe3d) return;
        const nextStyle = STATE.globe3d.earthStyle === 'visible_earth' ? 'cobalt_night' : 'visible_earth';
        activateEarthVisualMode(nextStyle, true, nextStyle === 'cobalt_night' ? 'Night Infrared Earth' : 'Earth from Orbit');
      });
    }

    const bFullBtn = document.getElementById('bottomFullscreenBtn');
    if (bFullBtn) {
      bFullBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }

    // Quick-jump buttons
    document.querySelectorAll('[data-jump-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.jumpView));
    });

    // Window selector
    const winSel = document.getElementById('globalWindowSelect');
    if (winSel) {
      winSel.addEventListener('change', (e) => {
        const prevWinId = STATE.windowId;
        STATE.windowId = e.target.value;
        populateRegionSelector();
        syncPlatformSelectionForWindow(prevWinId);
        refreshAllViews();
        if (STATE.windowId === '2022_may' && prevWinId !== '2022_may') {
          showToast('Rewinding Earth backward to May 2022 archival constellation window');
        }
      });
    }

    // Region selector
    const regSel = document.getElementById('globalRegionSelect');
    if (regSel) {
      regSel.addEventListener('change', (e) => {
        STATE.regionId = e.target.value;
        const win = STATE.bundle.windows[STATE.windowId];
        const reg = win.regions[STATE.regionId];
        if (reg && reg.meta && reg.meta.bbox && STATE.globe3d) {
          const [latMin, latMax, lonMin, lonMax] = reg.meta.bbox;
          const cLat = (latMin + latMax) / 2;
          const cLon = (lonMin + lonMax) / 2;
          const z = STATE.regionId === 'global' ? 0.95 : 1.55;
          STATE.globe3d.flyTo(cLat, cLon, z);
        }
        refreshAllViews();
      });
    }

    // Metric mode selector
    const metSel = document.getElementById('globalMetricSelect');
    if (metSel) {
      metSel.addEventListener('change', (e) => {
        STATE.metricMode = e.target.value;
        refreshAllViews();
      });
    }

    // Theme toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('theme-dark');
        const isDark = document.body.classList.contains('theme-dark');
        themeBtn.textContent = isDark ? '☀ Light Editorial' : '☾ Observatory Dark';
        refreshActiveViewCharts();
      });
    }

    // Mobile menu toggle
    const mobBtn = document.getElementById('mobileMenuBtn');
    if (mobBtn) {
      mobBtn.addEventListener('click', () => {
        document.getElementById('appSidebar').classList.toggle('open');
      });
    }

    // NASA Eyes 3D / 2D & Playback controls
    const proj3dBtn = document.getElementById('eyesMode3dBtn');
    const proj2dBtn = document.getElementById('eyesMode2dBtn');
    if (proj3dBtn && proj2dBtn) {
      proj3dBtn.addEventListener('click', () => {
        STATE.globe3d.setProjectionMode('3D');
        proj3dBtn.classList.add('play-circle');
        proj2dBtn.classList.remove('play-circle');
      });
      proj2dBtn.addEventListener('click', () => {
        STATE.globe3d.setProjectionMode('2D');
        proj2dBtn.classList.add('play-circle');
        proj3dBtn.classList.remove('play-circle');
      });
    }

    const orbitToggleBtn = document.getElementById('eyesOrbitToggleBtn');
    if (orbitToggleBtn) {
      orbitToggleBtn.addEventListener('click', () => {
        STATE.globe3d.showOrbits = !STATE.globe3d.showOrbits;
        orbitToggleBtn.textContent = STATE.globe3d.showOrbits ? 'Orbits: ON' : 'Orbits: OFF';
      });
    }

    const playBtn = document.getElementById('eyesPlayBtn');
    if (playBtn) playBtn.addEventListener('click', () => toggleTimelinePlayback(1));

    const rewindBtn = document.getElementById('eyesRewindBtn');
    if (rewindBtn) rewindBtn.addEventListener('click', () => toggleTimelinePlayback(-1));

    const prevBtn = document.getElementById('eyesPrevBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => stepTimeline(-1));

    const nextBtn = document.getElementById('eyesNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', () => stepTimeline(1));

    const allDaysBtn = document.getElementById('eyesAllDaysBtn');
    if (allDaysBtn) {
      allDaysBtn.addEventListener('click', () => {
        stopTimelinePlayback();
        STATE.selectedDateMode = 'ALL';
        refreshAllViews();
      });
    }

    const speedSel = document.getElementById('eyesSpeedSelect');
    if (speedSel) {
      speedSel.addEventListener('change', (e) => {
        STATE.playbackSpeed = Number(e.target.value) || 1.0;
      });
    }

    // Hotspot resolution & metric selectors
    const hsResSel = document.getElementById('hotspotResSelect');
    if (hsResSel) {
      hsResSel.addEventListener('change', (e) => {
        STATE.hotspotRes = e.target.value;
        renderHotspotIntelligenceView();
      });
    }
    const hsMetSel = document.getElementById('hotspotMetricSelect');
    if (hsMetSel) {
      hsMetSel.addEventListener('change', (e) => {
        STATE.hotspotMetric = e.target.value;
        renderHotspotIntelligenceView();
      });
    }

    // Sonification button
    const sonBtn = document.getElementById('playSonificationBtn');
    if (sonBtn) sonBtn.addEventListener('click', playDualMetricSonification);

    // Export buttons
    document.querySelectorAll('.export-json-btn').forEach(b => b.addEventListener('click', exportReproducibleJsonBundle));
    document.querySelectorAll('.export-csv-btn').forEach(b => b.addEventListener('click', exportDailyCsvTable));

    // CSV Ingestion test buttons & file input
    const testEmptyBtn = document.getElementById('testEmptyFeedBtn');
    if (testEmptyBtn) {
      testEmptyBtn.addEventListener('click', () => {
        const headerOnly = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n';
        runCsvIngestionTest('SNPP_7d_Southern_Africa.csv (112B Header-Only)', headerOnly, 'Suomi-NPP');
      });
    }

    const testPartialBtn = document.getElementById('testPartialDayBtn');
    if (testPartialBtn) {
      testPartialBtn.addEventListener('click', () => {
        const sampleRows = [
          'latitude,longitude,scan,track,acq_date,acq_time,satellite,confidence,frp,daynight',
          '-24.51,22.41,0.42,0.38,2026-11-07,1145,N20,nominal,18.4,D',
          '-24.52,22.42,0.42,0.38,2026-11-07,1145,N20,high,24.1,D',
          '-24.55,22.45,0.41,0.38,2026-11-08,1125,N20,nominal,15.2,D',
          '-24.56,22.46,0.41,0.38,2026-11-08,1125,N20,nominal,19.8,D',
          '-24.58,22.49,0.45,0.40,2026-11-09,1105,N20,nominal,12.1,D',
          '-24.59,22.50,0.45,0.40,2026-11-09,1105,N20,nominal,14.7,D',
          '-24.60,22.51,0.39,0.37,2026-11-10,1150,N20,high,31.0,D',
          '-24.61,22.52,0.39,0.37,2026-11-10,1150,N20,nominal,11.5,D',
          '-24.62,22.53,0.40,0.38,2026-11-11,1130,N20,nominal,16.9,D',
          '-24.63,22.54,0.40,0.38,2026-11-11,1130,N20,nominal,13.3,D',
          '-24.64,22.55,0.43,0.39,2026-11-12,1115,N20,nominal,14.2,D',
          '-24.65,22.56,0.43,0.39,2026-11-12,1115,N20,nominal,10.8,D',
          '-24.66,22.57,0.41,0.38,2026-11-13,1155,N20,nominal,12.9,D',
          '-24.67,22.58,0.41,0.38,2026-11-13,1155,N20,nominal,11.1,D',
          '-24.68,22.59,0.44,0.39,2026-11-14,0815,N20,nominal,9.4,D',
        ].join('\n');
        runCsvIngestionTest('Rolling_8Date_With_Partial_2026-11-14.csv', sampleRows, 'NOAA-20');
      });
    }

    const fileInput = document.getElementById('localCsvFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          runCsvIngestionTest(file.name, String(ev.target.result || ''), 'VIIRS');
        };
        reader.readAsText(file);
      });
    }

    window.addEventListener('resize', () => {
      refreshActiveViewCharts();
    });
  }

  document.addEventListener('DOMContentLoaded', initApp);
})(window);
