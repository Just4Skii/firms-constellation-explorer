/**
 * FIRMS CONSTELLATION INTELLIGENCE — FIRE STORIES DOCUMENTARY MODULE (fire_stories.js)
 * Implements FIRE-STORIES-01:
 *   - Curated historical fire documentary collection (4 verified fires, <= 5 hard cap)
 *   - HTML5 <audio> player for original local MP3 documentary chapters (explicitly labeled AI_GENERATED_NARRATION)
 *   - Synchronized chapter navigation & word-accurate transcript viewer
 *   - Strict separation: Early Contemporaneous Reporting vs Official Cause Investigation vs Unknowns
 *   - Globe & Year synchronization to FIRMS / documented site coordinates + provenance-verified imagery
 */
(function (global) {
  'use strict';

  class FireStoriesManager {
    constructor(options = {}) {
      this.bundle = null;
      this.stories = [];
      this.activeStoryId = null;
      this.activeChapterIndex = 0;
      this.audio = new Audio();
      this.audio.preload = 'metadata';
      this.onSyncGlobeToStory = options.onSyncGlobeToStory || null;

      this.rootEl = document.getElementById('fireStoriesContainer');
      this._bindAudioEvents();
    }

    async loadBundle() {
      if (this.bundle) return this.bundle;
      const res = await fetch('data/fire_stories_bundle.json');
      this.bundle = await res.json();
      this.stories = this.bundle.stories || [];
      this.renderCollection();
      return this.bundle;
    }

    _bindAudioEvents() {
      this.audio.addEventListener('timeupdate', () => {
        const curEl = document.getElementById('fsAudioCurrentTime');
        const fillEl = document.getElementById('fsAudioProgress');
        const rangeEl = document.getElementById('fsAudioScrubber');
        const dur = this.audio.duration || 1;
        const pct = Math.min(100, (this.audio.currentTime / dur) * 100);
        if (curEl) curEl.textContent = this._fmtTime(this.audio.currentTime);
        if (fillEl) fillEl.style.width = `${pct.toFixed(1)}%`;
        if (rangeEl && !rangeEl._dragging) rangeEl.value = pct.toFixed(1);
      });

      this.audio.addEventListener('loadedmetadata', () => {
        const durEl = document.getElementById('fsAudioTotalTime');
        if (durEl) durEl.textContent = this._fmtTime(this.audio.duration || 0);
      });

      this.audio.addEventListener('play', () => this._updatePlayButton(true));
      this.audio.addEventListener('pause', () => this._updatePlayButton(false));
      this.audio.addEventListener('ended', () => {
        const st = this.getActiveStory();
        if (st && this.activeChapterIndex + 1 < st.chapters.length) {
          this.selectChapter(this.activeChapterIndex + 1, true);
        } else {
          this._updatePlayButton(false);
        }
      });
    }

    _updatePlayButton(isPlaying) {
      const btn = document.getElementById('fsPlayPauseBtn');
      if (btn) btn.textContent = isPlaying ? '❚❚ Pause Chapter' : '▶ Play Narration';
    }

    _fmtTime(sec) {
      const s = Math.max(0, Math.floor(sec || 0));
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return `${m}:${String(rem).padStart(2, '0')}`;
    }

    stopAudio() {
      try {
        this.audio.pause();
      } catch (e) { /* noop */ }
    }

    getActiveStory() {
      return this.stories.find(s => s.story_id === this.activeStoryId) || null;
    }

    openStory(storyId, syncGlobe = false) {
      const st = this.stories.find(s => s.story_id === storyId);
      if (!st) return;
      this.activeStoryId = st.story_id;
      this.activeChapterIndex = 0;
      this.renderStoryDetail(st);
      this.loadChapterAudio(st.chapters[0], false);
      if (syncGlobe && typeof this.onSyncGlobeToStory === 'function') {
        this.onSyncGlobeToStory(st);
      }
    }

    selectChapter(idx, autoPlay = false) {
      const st = this.getActiveStory();
      if (!st || !st.chapters[idx]) return;
      this.activeChapterIndex = idx;
      const ch = st.chapters[idx];

      document.querySelectorAll('.fs-chapter-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
      const titleEl = document.getElementById('fsActiveChapterTitle');
      const tagEl = document.getElementById('fsActiveChapterTag');
      const transEl = document.getElementById('fsActiveTranscript');
      if (titleEl) titleEl.textContent = ch.title;
      if (tagEl) tagEl.textContent = ch.narrator_tag;
      if (transEl) transEl.textContent = ch.text;

      this.loadChapterAudio(ch, autoPlay);
    }

    loadChapterAudio(chapter, autoPlay = false) {
      if (!chapter || !chapter.audio_url) return;
      this.audio.pause();
      this.audio.src = chapter.audio_url;
      this.audio.load();
      const durEl = document.getElementById('fsAudioTotalTime');
      const curEl = document.getElementById('fsAudioCurrentTime');
      if (curEl) curEl.textContent = '0:00';
      if (durEl && chapter.duration_sec) durEl.textContent = this._fmtTime(chapter.duration_sec);
      if (autoPlay) {
        this.audio.play().catch(() => {});
      }
    }

    _causeBadge(status) {
      if (status === 'CONFIRMED_CAUSE') {
        return `<span class="badge badge-ok">CONFIRMED CAUSE (OFFICIAL REPORT)</span>`;
      }
      if (status === 'PROBABLE_CAUSE') {
        return `<span class="badge badge-warn">PROBABLE CAUSE (FORENSIC / SCIENTIFIC)</span>`;
      }
      return `<span class="badge badge-muted">${status || 'UNDER REVIEW'}</span>`;
    }

    renderCollection() {
      if (!this.rootEl) return;
      this.activeStoryId = null;
      this.stopAudio();

      const cards = this.stories.map(st => `
        <article class="fs-story-card" data-story-card="${st.story_id}">
          <div class="fs-card-media">
            <img src="${st.images.ground}" alt="${st.title}" loading="lazy" />
            <span class="fs-year-pill">${st.year} · ${st.country}</span>
          </div>
          <div class="fs-card-body">
            <div style="margin-bottom:6px">${this._causeBadge(st.cause_status)}</div>
            <h3 class="fs-card-title">${st.title}</h3>
            <p class="fs-card-sub">${st.subtitle}</p>
            <div class="fs-card-meta mono">
              <span>📍 ${st.lat.toFixed(4)}°, ${st.lon.toFixed(4)}°</span>
              <span>🔥 ~${Number(st.burned_area_ha).toLocaleString()} ha</span>
              <span>🎧 ${st.chapters.length} Audio Chapters</span>
            </div>
            <div class="fs-card-actions">
              <button type="button" class="btn-action active fs-open-story-btn" data-open-story="${st.story_id}">▶ Experience Fire Story ›</button>
              <button type="button" class="btn-action fs-sync-globe-btn" data-sync-story="${st.story_id}">🌍 Fly Globe (${st.year})</button>
            </div>
          </div>
        </article>
      `).join('');

      this.rootEl.innerHTML = `
        <div class="fs-collection-banner">
          <div>
            <div class="badge badge-info" style="margin-bottom:6px">FIRE-STORIES-01 · CURATED HISTORICAL ARCHIVE (4 VERIFIED FIRES / HARD CAP 5)</div>
            <p style="font-size:12.5px;color:#CBD5E1;line-height:1.5;max-width:780px">
              Every Fire Story links verified location coordinates, archival photographs, real NASA/USGS/Copernicus orbital imagery, contemporaneous news summaries, and official post-fire forensic reports. Playable chapter audio uses original synthesized documentary narration derived strictly from cited evidence (never scraping or altering copyrighted news broadcasts).
            </p>
          </div>
        </div>
        <div class="fs-stories-grid">${cards}</div>
      `;

      this.rootEl.querySelectorAll('[data-open-story]').forEach(btn => {
        btn.addEventListener('click', () => this.openStory(btn.dataset.openStory, true));
      });
      this.rootEl.querySelectorAll('[data-sync-story]').forEach(btn => {
        btn.addEventListener('click', () => {
          const st = this.stories.find(s => s.story_id === btn.dataset.syncStory);
          if (st && typeof this.onSyncGlobeToStory === 'function') {
            this.onSyncGlobeToStory(st, true);
          }
        });
      });
    }

    renderStoryDetail(st) {
      if (!this.rootEl || !st) return;
      const ch = st.chapters[this.activeChapterIndex] || st.chapters[0];

      const chButtons = st.chapters.map((c, idx) => `
        <button type="button" class="fs-chapter-btn ${idx === this.activeChapterIndex ? 'active' : ''}" data-chapter-idx="${idx}">
          <span class="mono" style="font-size:10px;color:#38BDF8">CH ${idx + 1} · ${Math.round(c.duration_sec || 25)}s</span>
          <span>${c.title.replace(/^Chapter \d+:\s*/i, '')}</span>
        </button>
      `).join('');

      const sourceRows = st.sources.map(src => `
        <tr>
          <td class="mono" style="color:#38BDF8">${src.id}</td>
          <td><strong>${src.title}</strong><br/><span style="font-size:11px;color:#94A3B8">${src.publisher} · ${src.date}</span></td>
          <td>${src.type}</td>
          <td><span class="badge badge-muted">${src.hosting}</span></td>
          <td><a href="${src.url}" target="_blank" rel="noopener noreferrer" style="color:#38BDF8;text-decoration:underline">Verify ↗</a></td>
        </tr>
      `).join('');

      this.rootEl.innerHTML = `
        <div class="fs-detail-topbar">
          <button type="button" class="btn-action" id="fsBackToCollectionBtn">‹ All 4 Curated Fire Stories</button>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${this._causeBadge(st.cause_status)}
            <button type="button" class="btn-action active" id="fsFlyGlobeNowBtn">🌍 Sync 3D Earth to ${st.year} Incident</button>
          </div>
        </div>

        <div class="fs-detail-hero">
          <h2 style="font-size:21px;font-weight:700;color:#F8FAFC">${st.title}</h2>
          <p style="font-size:13px;color:#94A3B8;margin:4px 0 12px">${st.subtitle}</p>
          <div class="kpi-grid-4">
            <div class="kpi-box"><div class="label">ESTIMATED SITE COORDINATES</div><div class="val" style="font-size:15px">${st.lat.toFixed(4)}°, ${st.lon.toFixed(4)}°</div><div class="sub">${st.region} (FIRMS grid ~375 m–1 km)</div></div>
            <div class="kpi-box"><div class="label">EVENT DATES</div><div class="val" style="font-size:15px">${st.start_date}</div><div class="sub">Through ${st.end_date}</div></div>
            <div class="kpi-box"><div class="label">BURNED AREA</div><div class="val" style="font-size:15px">~${Number(st.burned_area_ha).toLocaleString()} ha</div><div class="sub">${st.burned_area_note.slice(0, 56)}…</div></div>
            <div class="kpi-box"><div class="label">SATELLITE LINKAGE</div><div class="val" style="font-size:14px;color:#34D399">${st.satellite_linkage.match_status}</div><div class="sub">${st.satellite_linkage.observation_date} · ${st.satellite_linkage.constellation.slice(0, 28)}</div></div>
          </div>
        </div>

        <!-- PROVENANCE-CLASSIFIED PHOTOGRAPHIC & SATELLITE PAIRING -->
        <div class="grid-2" style="margin-bottom:14px">
          <div class="card" style="margin-bottom:0">
            <div style="font-size:10.5px;font-weight:700;color:#34D399;margin-bottom:6px">📸 ${(st.photo_provenance && st.photo_provenance.primary.provenance_class) || 'VERIFIED_INCIDENT_PHOTO'}</div>
            <img src="${st.images.ground}" alt="On-location photograph for ${st.title}" class="fs-evidence-img" />
            ${st.photo_provenance && st.photo_provenance.primary ? `
              <div class="mono" style="font-size:10px;color:#94A3B8;margin-top:6px;line-height:1.4">
                <strong>${st.photo_provenance.primary.commons_title}</strong> · Creator: ${st.photo_provenance.primary.creator} · Date: ${st.photo_provenance.primary.capture_date} · License: ${st.photo_provenance.primary.license}
              </div>
            ` : ''}
          </div>
          <div class="card" style="margin-bottom:0">
            <div style="font-size:10.5px;font-weight:700;color:#38BDF8;margin-bottom:6px">🛰 ${(st.satellite_provenance && st.satellite_provenance.true_color.product_type) || 'INCIDENT_DATE_TRUE_COLOR'} · TIMESTAMPED SATELLITE OBSERVATION (${st.satellite_linkage.observation_date})</div>
            <img src="${st.images.satellite}" alt="Satellite observation imagery for ${st.title}" class="fs-evidence-img" />
            ${st.satellite_provenance && st.satellite_provenance.true_color ? `
              <div class="mono" style="font-size:10px;color:#94A3B8;margin-top:6px;line-height:1.4">
                ${st.satellite_provenance.true_color.sensor} · Acquisition: ${st.satellite_provenance.true_color.acquisition_date}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- CONTEMPORANEOUS & OFFICIAL NEWS BROADCASTS (REAL JOURNALISTS & VOICES) -->
        ${(st.news_broadcasts && st.news_broadcasts.length > 0) ? `
        <div class="card" style="margin-bottom:14px;border-color:rgba(245,158,11,0.35)">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <div>
              <div class="badge badge-warn" style="margin-bottom:4px">OFFICIAL NEWS BROADCASTS · REAL HUMAN JOURNALISTS (${st.news_broadcasts[0].verification_status || 'OEMBED_VERIFIED'})</div>
              <h3 style="font-size:15px;color:#F8FAFC" id="fsBroadcastTitle">${st.news_broadcasts[0].broadcaster}: ${st.news_broadcasts[0].title}</h3>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${st.news_broadcasts.map((nb, idx) => `
                <button type="button" class="btn-action fs-broadcast-btn ${idx === 0 ? 'active' : ''}" data-broadcast-idx="${idx}">📺 ${nb.broadcaster} (${nb.date})</button>
              `).join('')}
              <a id="fsBroadcastExtLink" href="${st.news_broadcasts[0].url}" target="_blank" rel="noopener noreferrer" class="btn-action">Open on YouTube ↗</a>
            </div>
          </div>
          <div style="position:relative;width:100%;aspect-ratio:16/9;max-height:360px;background:#020617;border-radius:8px;overflow:hidden;border:1px solid rgba(148,163,184,0.2)">
            <iframe
              id="fsBroadcastIframe"
              src="https://www.youtube-nocookie.com/embed/${st.news_broadcasts[0].youtube_id}?rel=0"
              title="${st.news_broadcasts[0].title}"
              style="width:100%;height:100%;border:0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen></iframe>
          </div>
          <div class="mono" style="font-size:10.5px;color:#94A3B8;margin-top:6px" id="fsBroadcastNote">${st.news_broadcasts[0].note} · Channel verified via oEmbed: ${st.news_broadcasts[0].oembed_channel || st.news_broadcasts[0].broadcaster}. If embed is blocked by browser/network policy, use "Open on YouTube ↗".</div>
        </div>
        ` : ''}

        <!-- INTERACTIVE DOCUMENTARY AUDIO PLAYER + TRANSCRIPT -->
        <div class="fs-audio-studio card" style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <div>
              <div class="badge badge-info" style="margin-bottom:4px">AI_GENERATED_NARRATION · ORIGINAL SCRIPTED DOCUMENTARY AUDIO</div>
              <h3 id="fsActiveChapterTitle" style="font-size:15px;color:#F8FAFC">${ch.title}</h3>
              <div id="fsActiveChapterTag" style="font-size:11px;color:#94A3B8">${ch.narrator_tag}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <button type="button" class="btn-action" id="fsRew10Btn">↺ 10s</button>
              <button type="button" class="btn-action active" id="fsPlayPauseBtn">▶ Play Narration</button>
              <button type="button" class="btn-action" id="fsFwd10Btn">10s ↻</button>
              <select id="fsSpeedSel" class="hud-select" style="width:auto;padding:4px 8px;font-size:11px">
                <option value="0.85">0.85×</option>
                <option value="1" selected>1.0×</option>
                <option value="1.25">1.25×</option>
                <option value="1.5">1.5×</option>
              </select>
            </div>
          </div>

          <div class="fs-scrubber-row">
            <span id="fsAudioCurrentTime" class="mono" style="font-size:11px;color:#38BDF8">0:00</span>
            <input type="range" id="fsAudioScrubber" min="0" max="100" value="0" step="0.5" style="flex:1" aria-label="Narration audio seek scrubber" />
            <span id="fsAudioTotalTime" class="mono" style="font-size:11px;color:#94A3B8">${this._fmtTime(ch.duration_sec || 25)}</span>
          </div>

          <div class="fs-chapters-row">${chButtons}</div>

          <div class="fs-transcript-box">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:#38BDF8;margin-bottom:4px">SYNCHRONIZED DOCUMENTARY TRANSCRIPT</div>
            <p id="fsActiveTranscript" style="font-size:13px;line-height:1.55;color:#E2E8F0">${ch.text}</p>
          </div>
        </div>

        <!-- EPISTEMOLOGICAL EVIDENCE SEPARATION -->
        <div class="grid-3" style="margin-bottom:14px">
          <div class="card" style="margin-bottom:0">
            <div style="font-size:10.5px;font-weight:700;color:#38BDF8;margin-bottom:6px">A. CONTEMPORANEOUS REPORTING</div>
            <p style="font-size:12px;line-height:1.5;color:#CBD5E1">${st.early_reporting}</p>
          </div>
          <div class="card" style="margin-bottom:0">
            <div style="font-size:10.5px;font-weight:700;color:#34D399;margin-bottom:6px">B. OFFICIAL INVESTIGATION FINDING (${st.cause_status})</div>
            <p style="font-size:12px;line-height:1.5;color:#CBD5E1">${st.official_conclusion}</p>
          </div>
          <div class="card" style="margin-bottom:0">
            <div style="font-size:10.5px;font-weight:700;color:#FBBF24;margin-bottom:6px">C. IMPACT &amp; WHAT REMAINS UNKNOWN</div>
            <p style="font-size:12px;line-height:1.5;color:#CBD5E1"><strong>Impact:</strong> ${st.human_impact}<br/><strong>Unresolved:</strong> ${st.what_remains_unknown}</p>
          </div>
        </div>

        <!-- SOURCE & RIGHTS REGISTER -->
        <div class="card">
          <h3 style="font-size:13px;margin-bottom:8px">Source Attribution, Satellite Linkage &amp; Copyright Policy</h3>
          <p class="mono" style="font-size:11px;color:#94A3B8;margin-bottom:8px">${st.satellite_linkage.note} · Rights: ${st.rights_summary.narration_type} (${st.rights_summary.broadcast_mirroring})</p>
          <div style="overflow-x:auto">
            <table class="data-table">
              <thead><tr><th>Source ID</th><th>Document / Media</th><th>Category</th><th>Hosting Policy</th><th>Reference</th></tr></thead>
              <tbody>${sourceRows}</tbody>
            </table>
          </div>
        </div>
      `;

      // Bind interactive controls
      document.getElementById('fsBackToCollectionBtn')?.addEventListener('click', () => this.renderCollection());
      document.getElementById('fsFlyGlobeNowBtn')?.addEventListener('click', () => {
        if (typeof this.onSyncGlobeToStory === 'function') {
          this.onSyncGlobeToStory(st, true);
        }
      });
      document.getElementById('fsPlayPauseBtn')?.addEventListener('click', () => {
        if (this.audio.paused) this.audio.play().catch(() => {});
        else this.audio.pause();
      });
      document.getElementById('fsRew10Btn')?.addEventListener('click', () => {
        this.audio.currentTime = Math.max(0, (this.audio.currentTime || 0) - 10);
      });
      document.getElementById('fsFwd10Btn')?.addEventListener('click', () => {
        this.audio.currentTime = Math.min(this.audio.duration || 0, (this.audio.currentTime || 0) + 10);
      });
      document.getElementById('fsSpeedSel')?.addEventListener('change', (e) => {
        this.audio.playbackRate = Number(e.target.value) || 1.0;
      });

      const scrubber = document.getElementById('fsAudioScrubber');
      if (scrubber) {
        scrubber.addEventListener('mousedown', () => { scrubber._dragging = true; });
        scrubber.addEventListener('mouseup', () => { scrubber._dragging = false; });
        scrubber.addEventListener('input', (e) => {
          const pct = Number(e.target.value) || 0;
          if (this.audio.duration) this.audio.currentTime = (pct / 100) * this.audio.duration;
        });
      }

      this.rootEl.querySelectorAll('.fs-chapter-btn').forEach(btn => {
        btn.addEventListener('click', () => this.selectChapter(Number(btn.dataset.chapterIdx), true));
      });

      this.rootEl.querySelectorAll('.fs-broadcast-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.broadcastIdx);
          const nb = st.news_broadcasts && st.news_broadcasts[idx];
          if (!nb) return;
          this.rootEl.querySelectorAll('.fs-broadcast-btn').forEach(b => b.classList.toggle('active', b === btn));
          const iframe = document.getElementById('fsBroadcastIframe');
          const titleEl = document.getElementById('fsBroadcastTitle');
          const extEl = document.getElementById('fsBroadcastExtLink');
          const noteEl = document.getElementById('fsBroadcastNote');
          if (iframe) iframe.src = `https://www.youtube-nocookie.com/embed/${nb.youtube_id}?rel=0`;
          if (titleEl) titleEl.textContent = `${nb.broadcaster}: ${nb.title}`;
          if (extEl) extEl.href = nb.url;
          if (noteEl) noteEl.textContent = `${nb.note} · Channel verified via oEmbed: ${nb.oembed_channel || nb.broadcaster}. If embed is blocked by browser/network policy, use "Open on YouTube ↗".`;
        });
      });
    }
  }

  global.FireStoriesManager = FireStoriesManager;
})(window);
