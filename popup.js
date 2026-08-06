document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const resultsArea = document.getElementById('resultsArea');
    const clearBtn = document.getElementById('clearBtn');
    const searchField = document.getElementById('searchField');
    const urlHint = document.getElementById('urlHint');
    const hero = document.getElementById('hero');
    const topbar = document.getElementById('topbar');

    const ANALYSIS_STEPS = [
        'Checking CDN…',
        'Checking SSL…',
        'Inspecting Headers…',
        'Analyzing Cache…',
        'Calculating TTFB…',
        'Checking Compression…',
        'Inspecting Resources…',
        'Generating Report…'
    ];
    let stepTimer = null;

    restoreAnalysisState();

    /* ---------------- input handling (same validation contract) ---------------- */

    urlInput.addEventListener('input', () => {
        const value = urlInput.value.trim();
        analyzeBtn.disabled = value.length <= 3 || !/^https?:\/\//i.test(value.startsWith('http') ? value : 'https://' + value);
        updateFieldUI();
    });

    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !analyzeBtn.disabled) {
            analyze();
        }
    });

    urlInput.addEventListener('focus', () => searchField.classList.add('focused'));
    urlInput.addEventListener('blur', () => searchField.classList.remove('focused'));

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            urlInput.value = '';
            analyzeBtn.disabled = true;
            updateFieldUI();
            urlInput.focus();
        });
    }

    function updateFieldUI() {
        const value = urlInput.value.trim();
        if (clearBtn) clearBtn.hidden = value.length === 0;

        if (!value) {
            searchField.classList.remove('invalid');
            setHint('', '');
            return;
        }
        if (analyzeBtn.disabled) {
            searchField.classList.add('invalid');
            setHint('Enter a valid website URL, e.g. example.com', 'error');
        } else {
            searchField.classList.remove('invalid');
            const normalized = /^https?:\/\//i.test(value) ? value : 'https://' + value;
            setHint(/^https?:\/\//i.test(value) ? 'Press Enter to analyze' : `Will analyze ${normalized}`, 'ok');
        }
    }

    function setHint(text, tone) {
        if (!urlHint) return;
        urlHint.textContent = text;
        urlHint.className = 'field-hint' + (tone ? ' ' + tone : '');
    }

    /* ---------------- reset ---------------- */

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            setRefreshingState(true);
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ action: 'CLEAR_ANALYSIS_STATE' }, () => {
                    urlInput.value = '';
                    analyzeBtn.disabled = true;
                    resultsArea.innerHTML = '';
                    setRefreshingState(false);
                    setHomeMode(true);
                    updateFieldUI();
                });
            } else {
                urlInput.value = '';
                analyzeBtn.disabled = true;
                resultsArea.innerHTML = '';
                setRefreshingState(false);
                setHomeMode(true);
                updateFieldUI();
            }
        });
    }

    // Listen for real-time progress messages from background.js
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === 'ANALYSIS_PROGRESS') {
                const statusEl = document.getElementById('loadingStatusText');
                if (statusEl) {
                    statusEl.textContent = message.step;
                }
            } else if (message.action === 'ANALYSIS_STATE_UPDATED' && message.state) {
                renderAnalysisState(message.state);
            }
        });
    }

    // Info icon tooltip click handler for mobile/touch + accordion toggling
    if (resultsArea) {
        const tooltipTargets = (e) => {
            const wrapper = e.target.closest && e.target.closest('.info-icon-wrapper');
            if (wrapper) placeTooltip(wrapper);
        };
        resultsArea.addEventListener('mouseover', tooltipTargets);
        resultsArea.addEventListener('focusin', tooltipTargets);

        resultsArea.addEventListener('click', (e) => {
            const wrapper = e.target.closest('.info-icon-wrapper');
            if (wrapper) {
                e.stopPropagation();
                const wasActive = wrapper.classList.contains('active');
                resultsArea.querySelectorAll('.info-icon-wrapper.active').forEach(el => el.classList.remove('active'));
                if (!wasActive) {
                    placeTooltip(wrapper);
                    wrapper.classList.add('active');
                }
                return;
            }
            resultsArea.querySelectorAll('.info-icon-wrapper.active').forEach(el => el.classList.remove('active'));

            const trigger = e.target.closest('.acc-trigger');
            if (trigger) {
                const acc = trigger.closest('.accordion');
                const open = acc.classList.toggle('open');
                trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
            }
        });
    }

    function placeTooltip(wrapper) {
        const tip = wrapper.querySelector('.info-tooltip');
        if (!tip) return;
        const rect = wrapper.getBoundingClientRect();
        const width = tip.offsetWidth || 208;
        const margin = 18;
        const viewport = Math.min(document.body.clientWidth || 400, document.documentElement.clientWidth || 400);
        const max = viewport - width - margin;
        const desired = rect.left + rect.width / 2 - width / 2;
        const clamped = Math.max(margin, Math.min(desired, Math.max(margin, max)));
        tip.style.setProperty('--tt-left', `${Math.round(clamped - rect.left)}px`);
        tip.classList.add('positioned');
    }

    function setRefreshingState(isSpinning) {
        if (!refreshBtn) return;
        if (isSpinning) {
            refreshBtn.classList.add('spinning');
            refreshBtn.disabled = true;
        } else {
            refreshBtn.classList.remove('spinning');
            refreshBtn.disabled = false;
        }
    }

    function setHomeMode(isHome) {
        if (hero) hero.hidden = !isHome;
        if (topbar) topbar.hidden = isHome;
    }

    function setAnalyzingState(isAnalyzing) {
        analyzeBtn.classList.toggle('loading', isAnalyzing);
        analyzeBtn.disabled = isAnalyzing || analyzeBtn.disabled;
    }

    /* ---------------- analysis (logic unchanged) ---------------- */

    async function analyze() {
        const rawUrl = urlInput.value.trim();
        if (!rawUrl) {
            setRefreshingState(false);
            return;
        }

        let url = rawUrl;
        if (!/^https?:\/\//i.test(url)) {
            url = 'https://' + url;
        }

        showLoadingUI('Validating URL…');
        analyzeBtn.disabled = true;
        setAnalyzingState(true);
        setRefreshingState(true);

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
                action: 'START_ANALYSIS',
                url: url
            }, (response) => {
                analyzeBtn.disabled = false;
                setAnalyzingState(false);
                setRefreshingState(false);
                if (chrome.runtime.lastError) {
                    console.error("[UI v2] Runtime error:", chrome.runtime.lastError);
                    showError(chrome.runtime.lastError.message || "Failed to communicate with background service worker.");
                    return;
                }

                if (response && response.success) {
                    showResults(response.data);
                } else {
                    console.error("[UI v2] Analysis Error:", response?.error);
                    showError(response?.error || "Analysis Failed. Please verify URL and try again.");
                }
            });
        } else {
            showError("Extension background runtime unavailable.");
            analyzeBtn.disabled = false;
            setAnalyzingState(false);
            setRefreshingState(false);
        }
    }

    analyzeBtn.addEventListener('click', (e) => {
        spawnRipple(e);
        analyze();
    });

    function spawnRipple(e) {
        const rect = analyzeBtn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
        ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
        analyzeBtn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }

    function restoreAnalysisState() {
        updateFieldUI();
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
            populateActiveTabUrl();
            return;
        }

        chrome.runtime.sendMessage({ action: 'GET_ANALYSIS_STATE' }, (response) => {
            if (chrome.runtime.lastError || !response || !response.state) {
                populateActiveTabUrl();
                return;
            }
            renderAnalysisState(response.state);
        });
    }

    function renderAnalysisState(state) {
        if (!state) return;
        if (state.url) {
            urlInput.value = state.url;
            updateFieldUI();
        }

        if (state.status === 'running') {
            showLoadingUI(state.progress || 'Analyzing website…');
            analyzeBtn.disabled = true;
            setAnalyzingState(true);
            setRefreshingState(true);
        } else if (state.status === 'completed' && state.result) {
            showResults(state.result);
            analyzeBtn.disabled = false;
            setAnalyzingState(false);
            setRefreshingState(false);
        } else if (state.status === 'error') {
            showError(state.error || 'Analysis failed.');
            analyzeBtn.disabled = false;
            setAnalyzingState(false);
            setRefreshingState(false);
        }
    }

    function populateActiveTabUrl() {
        if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) return;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0] || !tabs[0].url) return;
            const tabUrl = tabs[0].url;
            if (tabUrl.startsWith('http://') || tabUrl.startsWith('https://')) {
                urlInput.value = tabUrl;
                analyzeBtn.disabled = false;
                updateFieldUI();
            } else if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('edge://') || tabUrl.startsWith('about:')) {
                urlInput.placeholder = "Enter website URL…";
            }
        });
    }

    /* ---------------- presentation ---------------- */

    function stopStepCycle() {
        if (stepTimer) {
            clearInterval(stepTimer);
            stepTimer = null;
        }
    }

    function showError(msg) {
        stopStepCycle();
        setHomeMode(false);
        resultsArea.innerHTML = `
            <div class="error-msg">
                ${icon('alert')}
                <span><strong>Analysis failed</strong>${escapeHtml(msg)}</span>
            </div>`;
    }

    function showLoadingUI(initialText) {
        stopStepCycle();
        setHomeMode(false);
        const loadingTpl = document.getElementById('loadingTemplate');
        resultsArea.innerHTML = '';
        if (loadingTpl) {
            const clone = loadingTpl.content.cloneNode(true);
            resultsArea.appendChild(clone);
            const statusEl = document.getElementById('loadingStatusText');
            if (statusEl && initialText) {
                statusEl.textContent = initialText;
            }
            runStepChecklist();
        } else {
            resultsArea.innerHTML = '<div class="loading-state"><p id="loadingStatusText" class="loading-step">Analyzing…</p></div>';
        }
    }

    function runStepChecklist() {
        const list = document.getElementById('stepList');
        if (!list) return;
        let index = 0;
        const render = () => {
            const done = ANALYSIS_STEPS.slice(Math.max(0, index - 2), index);
            const current = ANALYSIS_STEPS[index];
            list.innerHTML = [
                ...done.map(step => `<li class="step-row">${icon('check', 'step-check')}<span>${escapeHtml(step)}</span></li>`),
                current ? `<li class="step-row active"><span class="step-dot"></span><span>${escapeHtml(current)}</span></li>` : ''
            ].join('');
        };
        render();
        stepTimer = setInterval(() => {
            index += 1;
            if (index >= ANALYSIS_STEPS.length) {
                index = ANALYSIS_STEPS.length - 1;
                render();
                stopStepCycle();
                return;
            }
            render();
        }, 1200);
    }

    function showResults(data) {
        if (!resultsArea || !data) return;
        stopStepCycle();
        setHomeMode(false);

        const scoreDetails = data.scoreDetails || { score: 0, grade: 'F' };
        const score = scoreDetails.score;
        const grade = scoreDetails.grade || 'A+';

        const cdn = data.cdn || { provider: 'Not Detected', confidence: 'none', evidence: [] };
        const providerName = (cdn.provider && cdn.provider !== 'Unknown / not detected' && cdn.provider !== 'Unknown') ? cdn.provider : 'Not Detected';

        const timing = data.timing || {};
        const connection = data.connection || {};
        const transfer = data.transfer || {};
        const highlights = data.highlights || {};
        const tls = data.tls || { available: false };
        const securityHeaders = data.securityHeaders || {};
        const cache = data.cache || { documentSource: 'network', providerStatus: 'No Cache Headers' };
        const suggestions = data.suggestions || [];
        const finalUrl = data.finalUrl || urlInput.value.trim();
        const isHttps = finalUrl ? finalUrl.toLowerCase().startsWith('https://') : false;

        let host = finalUrl;
        try { host = new URL(finalUrl).hostname; } catch (err) { /* keep raw */ }

        const cacheStatusRaw = cache.providerStatus || 'No Cache Headers';
        const cacheStatusVal = cacheStatusRaw === 'UNKNOWN' ? 'Unknown' : cacheStatusRaw;

        const circumference = 2 * Math.PI * 48;
        const offset = circumference - (score / 100) * circumference;

        const documentMs = timing.documentMs ?? null;
        const domContentLoadedMs = timing.domContentLoadedMs ?? null;
        const loadEventMs = timing.loadEventMs ?? null;
        const networkIdleMs = timing.networkIdleMs ?? null;
        const ttfbMs = timing.ttfbMs ?? null;
        const downloadMs = timing.downloadMs ?? null;

        const isReused = !!connection.reused;
        const dnsMs = timing.dnsMs;
        const tcpMs = timing.tcpMs;
        const tlsMs = timing.tlsMs;

        const totalNet = Math.max(1, (ttfbMs || 0) + (downloadMs || 0));
        const phasePct = (value) => Number.isFinite(value) ? Math.min(100, Math.round((value / totalNet) * 100)) : 0;
        const dnsPct = phasePct(dnsMs);
        const tcpPct = phasePct(tcpMs);
        const tlsPct = phasePct(tlsMs);
        const ttfbPct = phasePct(ttfbMs);
        const dlPct = phasePct(downloadMs);
        const isQuic = typeof connection.protocol === 'string' && connection.protocol.toLowerCase().startsWith('h3');
        const connectionPhaseLabel = isQuic ? "QUIC Transport" : "TCP Connection";

        resultsArea.innerHTML = `
            <div class="dashboard">
                <!-- Website information -->
                <div class="card site-card">
                    <div class="site-head">
                        <img class="site-favicon" alt="" src="https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}">
                        <div style="min-width:0">
                            <div class="site-host">${escapeHtml(host)}</div>
                            <div class="site-url">${escapeHtml(finalUrl)}</div>
                        </div>
                    </div>
                    <div class="site-meta">
                        <span class="pill ${isHttps ? 'good' : 'bad'}">${icon('shield')}${isHttps ? 'HTTPS' : 'HTTP'}</span>
                        <span class="pill ${data.statusCode >= 400 ? 'bad' : 'good'}">${icon('checkCircle')}${data.statusCode || 200}</span>
                        <span class="pill">${icon('bolt')}${escapeHtml(connection.protocol || 'h2')}</span>
                        <span class="pill accent">${icon('cloud')}${escapeHtml(providerName)}</span>
                    </div>
                </div>

                <!-- Performance score -->
                <div class="card score-card">
                    <div class="gauge">
                        <svg width="108" height="108" viewBox="0 0 108 108">
                            <circle class="gauge-bg" cx="54" cy="54" r="48"></circle>
                            <circle id="scoreCircle" class="gauge-fg" cx="54" cy="54" r="48"
                                stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"></circle>
                        </svg>
                        <div class="gauge-center">
                            <span class="gauge-score" id="scoreNumber" data-target="${score}">0</span>
                            <span class="gauge-grade">Grade ${escapeHtml(String(grade))}</span>
                        </div>
                    </div>
                    <div class="score-copy">
                        <span class="score-label">Performance Score${renderInfoIcon("Weighted evaluation of page load speed, TTFB, edge cache efficiency, compression, and security headers.", "left")}</span>
                        <span class="caption">${score} / 100 points from a background CDP run of the live page.</span>
                    </div>
                </div>

                <!-- Quick stats -->
                <div class="stats-grid">
                    ${statCard('cloud', 'CDN', escapeHtml(providerName), `${escapeHtml(cdn.confidence || 'none')} confidence`)}
                    ${statCard('shield', 'SSL', isHttps ? (tls.available ? escapeHtml(tls.version) : 'Secured') : 'Not Secure', isHttps ? 'Encrypted transport' : 'Plain HTTP', isHttps ? 'text-success' : 'text-error')}
                    ${statCard('database', 'Cache', escapeHtml(cacheStatusVal), escapeHtml(cache.documentSource || 'network'), cacheStatusVal.includes('HIT') ? 'text-success' : 'text-warning')}
                    ${statCard('clock', 'TTFB', formatDuration(ttfbMs), 'Time to first byte')}
                </div>

                <!-- Detailed analysis -->
                <div class="accordions">
                    ${accordion('gauge', 'Performance', '', true, `
                        <div class="rows">
                            ${row('Main Document', formatDuration(documentMs), '', "Fetch duration for primary HTML document payload.")}
                            ${row('DOM Content Loaded', formatDuration(domContentLoadedMs), '', "Time elapsed until HTML document is completely parsed and DOM tree is constructed.")}
                            ${row('Page Load Event', formatDuration(loadEventMs), '', "Total time elapsed until window onload event fired.")}
                            ${row('Network Idle', formatDuration(networkIdleMs), '', "Time elapsed until network activity completely settles after page load.")}
                            ${row('Full TTFB', formatDuration(ttfbMs), '', "Time to First Byte - duration between request start and first response byte.")}
                            ${row('Document Download', formatDuration(downloadMs), '', "Time taken to receive the full main document body.")}
                            ${row('Remote IP', escapeHtml(connection.remoteIp || 'Not Available'), 'mono', "The resolved IP address of the edge or origin server.")}
                        </div>
                    `)}

                    ${accordion('shield', 'Security', '', false, `
                        <div class="rows">
                            ${row('Transport', isHttps ? 'HTTPS (Secured)' : 'HTTP (Not Secure)', isHttps ? 'text-success' : 'text-error', "Indicates whether connection is encrypted over HTTPS or plain HTTP.")}
                            ${row('TLS Version', tls.available ? escapeHtml(tls.version) : 'Not Available', '', "The negotiated TLS protocol version.")}
                            ${row('Cipher Suite', tls.available ? escapeHtml(tls.cipher) : 'Not Available', 'mono', "Cryptographic cipher suite used for encryption.")}
                            ${row('Certificate Issuer', tls.available ? escapeHtml(tls.issuer) : 'Not Available', '', "Certificate Authority (CA) that issued the SSL/TLS certificate.")}
                        </div>
                    `)}

                    ${accordion('file', 'Headers', '', false, `
                        ${renderSecurityHeaderItem("Strict-Transport-Security (HSTS)", securityHeaders.hsts, "Forces browsers to connect over HTTPS automatically.")}
                        ${renderSecurityHeaderItem("Content-Security-Policy (CSP)", securityHeaders.csp, "Restricts execution of unauthorized scripts to prevent XSS.")}
                        ${renderSecurityHeaderItem("X-Frame-Options", securityHeaders.xFrameOptions, "Defends against clickjacking by restricting framing.")}
                        ${renderSecurityHeaderItem("X-Content-Type-Options", securityHeaders.xContentTypeOptions, "Prevents MIME-sniffing outside declared content type.")}
                        ${renderSecurityHeaderItem("Referrer-Policy", securityHeaders.referrerPolicy, "Controls HTTP referrer header privacy.")}
                    `)}

                    ${accordion('database', 'Cache', '', false, `
                        <div class="rows">
                            ${row('Cache Provider Status', escapeHtml(cacheStatusVal), cacheStatusVal.includes('HIT') ? 'text-success' : 'text-warning', "Indicates whether edge delivered response from cache (HIT), origin (MISS), or dynamic bypass (BYPASS).")}
                            ${row('Doc Delivery Source', escapeHtml(cache.documentSource || 'network'), 'text-info', "Shows whether document was retrieved from network, disk cache, service worker, or prefetch.")}
                            ${row('CDN Provider', escapeHtml(providerName), 'text-accent', "Identifies the Content Delivery Network routing traffic to edge servers.")}
                            ${row('Detection Confidence', escapeHtml(cdn.confidence || 'none'), '', "How strong the CDN fingerprint evidence is.")}
                            ${cdn.evidence && cdn.evidence.length > 0 ? row('Evidence', escapeHtml(cdn.evidence[0]), 'mono', "Header or fingerprint used to identify the provider.") : ''}
                        </div>
                    `)}

                    ${accordion('file', 'Resources', String(transfer.requestCount || 0), false, `
                        <div class="rows">
                            ${row('Total Requests', transfer.requestCount || 0, '', "Total number of network requests executed during page load.")}
                            ${row('Failed Requests', transfer.failedRequestCount || 0, transfer.failedRequestCount > 0 ? 'text-error' : 'text-success', "Number of network requests that failed or encountered network errors.")}
                            ${row('1st Party Requests', transfer.firstPartyCount || 0, '', "Requests sent to the primary target domain or subdomains.")}
                            ${row('3rd Party Requests', transfer.thirdPartyCount || 0, '', "Requests sent to external domains (analytics, fonts, ads, third-party scripts).")}
                            ${row('Encoded Bytes', formatBytes(transfer.encodedBytes), '', "Total compressed network bytes transferred across all requests.")}
                        </div>
                        ${renderResourceCard("Largest Resource Overall", highlights.largestResource, "Resource with single largest encoded payload size.")}
                        ${renderResourceCard("Largest Image Asset", highlights.largestImage, "Image file with largest transferred file size.")}
                        ${renderResourceCard("Largest JavaScript Script", highlights.largestJS, "JavaScript script file with largest payload size.")}
                        ${renderResourceCard("Largest CSS Stylesheet", highlights.largestCSS, "CSS stylesheet with largest payload size.")}
                        ${renderResourceCard("Slowest Network Resource", highlights.slowestResource, "Request taking longest total duration.")}
                    `)}

                    ${accordion('bolt', 'Optimization Suggestions', String(suggestions.length), false, suggestions.length ? suggestions.map(s => `
                        <div class="subcard">
                            <div class="subcard-head">
                                <span>${escapeHtml(s.title)}${renderInfoIcon("Actionable recommendation based on verified evidence.", "right")}</span>
                                <span class="badge ${escapeHtml(s.type)}">${escapeHtml(s.type)}</span>
                            </div>
                            <p class="subcard-desc">${escapeHtml(s.desc)}</p>
                        </div>
                    `).join('') : `<p class="caption">No optimization issues detected for this page.</p>`)}

                    ${accordion('clock', 'Mini Waterfall', '', false, `
                        <div class="waterfall">
                            ${wfPhase('DNS Resolution', formatPhaseDuration(dnsMs, dnsPct, isReused, false), 'phase-dns', barWidth(dnsMs, dnsPct), "Time required to resolve domain name into IP address.")}
                            ${wfPhase(connectionPhaseLabel, formatPhaseDuration(tcpMs, tcpPct, isReused, false), 'phase-tcp', barWidth(tcpMs, tcpPct), "Time spent establishing initial TCP connection or QUIC session.")}
                            ${wfPhase('TLS Handshake', formatPhaseDuration(tlsMs, tlsPct, isReused, !isHttps), 'phase-tls', barWidth(tlsMs, tlsPct), "Time spent negotiating TLS security keys and validating SSL certificate.")}
                            ${wfPhase('Full TTFB', formatPhaseDuration(ttfbMs, ttfbPct, false, false), 'phase-ttfb', barWidth(ttfbMs, ttfbPct), "Time to First Byte between request start and first response header byte.")}
                            ${wfPhase('Document Download', formatPhaseDuration(downloadMs, dlPct, false, false), 'phase-download', barWidth(downloadMs, dlPct), "Time taken to receive the full main document body.")}
                            <div class="rows">
                                ${row('DOM Content Loaded', formatDuration(domContentLoadedMs), '', "Time elapsed until HTML document is completely parsed and DOM tree is constructed.")}
                                ${row('Page Load Event', formatDuration(loadEventMs), '', "Time elapsed until page load event fires and initial resources finish loading.")}
                                ${row('Network Idle', formatDuration(networkIdleMs), '', "Time elapsed until network activity completely settles after page load.")}
                            </div>
                        </div>
                    `)}
                </div>
            </div>
        `;

        setTimeout(() => {
            const circle = document.getElementById('scoreCircle');
            if (circle) circle.style.strokeDashoffset = offset;
            animateCounter(document.getElementById('scoreNumber'), score);
        }, 100);
    }

    function animateCounter(el, target) {
        if (!el || !Number.isFinite(target)) return;
        const duration = 800;
        const start = performance.now();
        const tick = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            el.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3)));
            if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    /* ---------------- render helpers ---------------- */

    function statCard(iconName, label, value, sub, valueClass = '') {
        return `
            <div class="stat-card">
                <span class="stat-top">${icon(iconName)}${escapeHtml(label)}</span>
                <span class="stat-value ${valueClass}" title="${String(value)}">${value}</span>
                <span class="stat-sub">${sub}</span>
            </div>`;
    }

    function accordion(iconName, title, count, open, body) {
        return `
            <div class="accordion${open ? ' open' : ''}">
                <button type="button" class="acc-trigger" aria-expanded="${open ? 'true' : 'false'}">
                    ${icon(iconName, 'acc-icon')}
                    <span>${escapeHtml(title)}</span>
                    ${count ? `<span class="acc-count">${escapeHtml(count)}</span>` : '<span class="acc-count"></span>'}
                    ${icon('chevron', 'acc-chevron')}
                </button>
                <div class="acc-panel">
                    <div class="acc-inner">
                        <div class="acc-body">${body}</div>
                    </div>
                </div>
            </div>`;
    }

    function row(label, value, valueClass = '', tooltip = '') {
        return `
            <div class="row">
                <span class="row-label">${escapeHtml(label)}${tooltip ? renderInfoIcon(tooltip, 'left') : ''}</span>
                <span class="row-value ${valueClass}" title="${String(value).replace(/"/g, '')}">${value}</span>
            </div>`;
    }

    function wfPhase(name, time, barClass, width, tooltip = '') {
        return `
            <div class="wf-phase">
                <div class="wf-top">
                    <span class="wf-name">${escapeHtml(name)}${tooltip ? renderInfoIcon(tooltip, 'left') : ''}</span>
                    <span class="wf-time">${time}</span>
                </div>
                <div class="wf-track"><div class="wf-bar ${barClass}" style="width: ${width}%;"></div></div>
            </div>`;
    }

    function renderResourceCard(title, item, tooltipText = '') {
        if (!item) {
            return `
                <div class="subcard">
                    <div class="subcard-head">
                        <span>${escapeHtml(title)}${tooltipText ? renderInfoIcon(tooltipText, 'left') : ''}</span>
                        <span class="subcard-meta">Not Available</span>
                    </div>
                    <div class="url-text">No asset detected</div>
                </div>`;
        }
        return `
            <div class="subcard">
                <div class="subcard-head">
                    <span>${escapeHtml(title)}${tooltipText ? renderInfoIcon(tooltipText, 'left') : ''}</span>
                    <span class="subcard-meta">${formatBytes(item.bytes)} · ${item.durationMs}ms</span>
                </div>
                <div class="url-text">${escapeHtml(item.url)}</div>
            </div>`;
    }

    function renderSecurityHeaderItem(name, check, tooltipText = '') {
        if (!check) return '';
        return `
            <div class="subcard">
                <div class="subcard-head">
                    <span>${escapeHtml(name)}${tooltipText ? renderInfoIcon(tooltipText, 'left') : ''}</span>
                    <span class="badge ${check.present ? 'pass' : 'fail'}">${check.present ? 'Pass' : 'Missing'}</span>
                </div>
                <div class="subcard-desc">${escapeHtml(check.description)}</div>
                ${check.value ? `<div class="url-text">${escapeHtml(check.value)}</div>` : ''}
            </div>`;
    }

    const ICONS = {
        globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3.6 9h16.8M3.6 15h16.8"></path><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"></path>',
        shield: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10c-4-1.8-7-5.5-7-10V6z"></path><path d="m9.2 12.2 1.9 1.9 3.7-3.7"></path>',
        clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7.5V12l3 2"></path>',
        database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"></ellipse><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"></path><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"></path>',
        cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.96A6 6 0 0 0 6.2 10.5A3.75 3.75 0 0 0 7 19z"></path>',
        bolt: '<path d="M13 2 4.5 13.5H11l-.8 8.5L19.5 10H13z"></path>',
        gauge: '<path d="M12 14l4-4"></path><path d="M20.5 17a9 9 0 1 0-17 0"></path><circle cx="12" cy="14" r="1.6"></circle>',
        file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path>',
        checkCircle: '<circle cx="12" cy="12" r="9"></circle><path d="m8.5 12.3 2.4 2.4 4.6-4.9"></path>',
        check: '<path d="m4.5 12.5 5 5 10-11"></path>',
        alert: '<path d="M10.3 3.9 2.5 17.4A1.9 1.9 0 0 0 4.2 20.3h15.6a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><path d="M12 16.5h.01"></path>',
        chevron: '<path d="m6 9 6 6 6-6"></path>'
    };

    function icon(name, className = '') {
        const path = ICONS[name] || ICONS.globe;
        return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    }

    function barWidth(ms, pct) {
        if (ms === null || ms === undefined || ms === 0) return 0;
        return Math.max(2, pct);
    }

    function formatDuration(ms) {
        if (!Number.isFinite(ms) || ms === null || ms === undefined) return 'Not Available';
        if (ms === 0) return '0 ms';
        if (ms > 0 && ms < 1) return '&lt;1 ms';
        const displayValue = ms < 10 ? Number(ms.toFixed(2)) : Math.round(ms);
        return `${displayValue} ms`;
    }

    function formatPhaseDuration(ms, pct, isReused = false, isNotApplicable = false) {
        if (isNotApplicable) return 'Not Applicable';
        if (isReused) return 'Connection Reused';
        const duration = formatDuration(ms);
        if (duration === 'Not Available' || duration === 'Not Applicable') return duration;
        return `${duration} (${pct}%)`;
    }

    function renderInfoIcon(text, align = 'center') {
        const alignClass = align === 'right' ? ' align-right' : align === 'left' ? ' align-left' : '';
        return `<span class="info-icon-wrapper${alignClass}" tabindex="0" role="button" aria-label="Metric information">
            <svg class="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span class="info-tooltip" role="tooltip">${escapeHtml(text)}</span>
        </span>`;
    }

    function formatBytes(bytes) {
        if (!bytes || isNaN(bytes) || bytes <= 0) return "0 B";
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
