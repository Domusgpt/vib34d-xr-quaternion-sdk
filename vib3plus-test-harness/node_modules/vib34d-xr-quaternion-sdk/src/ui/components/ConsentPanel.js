function createElement(tag, className) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    return element;
}

function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    try {
        return new Date(timestamp).toISOString().replace('T', ' ').replace('Z', 'Z');
    } catch (error) {
        return String(timestamp);
    }
}

function defaultDownloadFormatter(records) {
    return JSON.stringify({
        generatedAt: new Date().toISOString(),
        records
    }, null, 2);
}

function defaultFileName(prefix = 'compliance-log') {
    return `${prefix}-${Date.now()}.json`;
}

export function createConsentPanel(options = {}) {
    const {
        container,
        consentOptions = [],
        getTelemetryConsent,
        onConsentToggle,
        getComplianceRecords,
        getTelemetryAuditTrail,
        refreshInterval = 6000,
        downloadFormatter = defaultDownloadFormatter,
        downloadFileNamePrefix = 'compliance-log',
        onDownload,
        onRender,
        trackConsentToggle,
        createAnchor = () => document.createElement('a'),
        heading = 'Telemetry & Consent'
    } = options;

    if (!container) {
        throw new Error('[ConsentPanel] `container` is required.');
    }

    const state = {
        consent: {},
        refreshTimer: null,
        elements: {},
        destroyed: false
    };

    function buildStructure() {
        container.innerHTML = '';

        const headingEl = createElement('h2');
        headingEl.textContent = heading;
        container.appendChild(headingEl);

        const grid = createElement('div', 'consent-grid');
        const status = createElement('div', 'consent-status');
        const downloadButton = createElement('button', 'secondary');
        downloadButton.type = 'button';
        downloadButton.textContent = 'Download Compliance Log';
        const logList = createElement('ul', 'compliance-log');

        const toggles = new Map();
        consentOptions.forEach(option => {
            const label = createElement('label', 'consent-toggle');
            const wrapper = createElement('div');
            const titleEl = createElement('span');
            titleEl.textContent = option.title;
            const description = createElement('small');
            description.textContent = option.description;
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.consent = option.classification;
            input.setAttribute('aria-label', option.title);

            wrapper.appendChild(titleEl);
            wrapper.appendChild(description);
            label.appendChild(wrapper);
            label.appendChild(input);
            grid.appendChild(label);
            toggles.set(option.classification, input);
        });

        container.appendChild(grid);
        container.appendChild(status);
        container.appendChild(downloadButton);
        container.appendChild(logList);

        state.elements = {
            grid,
            status,
            downloadButton,
            logList,
            toggles
        };
    }

    function syncToggles(consent) {
        state.elements.toggles.forEach((input, classification) => {
            if (classification in consent) {
                input.checked = Boolean(consent[classification]);
            }
        });
    }

    function renderStatus(consentSnapshot, metadata = {}) {
        const enabled = Object.entries(consentSnapshot)
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key.toUpperCase());
        const disabled = Object.entries(consentSnapshot)
            .filter(([, value]) => !value)
            .map(([key]) => key.toUpperCase());
        const auditTrail = typeof getTelemetryAuditTrail === 'function' ? getTelemetryAuditTrail() : [];
        const auditCount = Array.isArray(auditTrail) ? auditTrail.length : 0;
        const source = metadata.source ? `Last change via ${metadata.source}.` : '';

        state.elements.status.innerHTML = `
            <strong>Active:</strong> ${enabled.length ? enabled.join(', ') : 'None'}<br>
            <strong>Opt-out:</strong> ${disabled.length ? disabled.join(', ') : 'None'}<br>
            <strong>Audit Entries:</strong> ${auditCount}<br>
            ${source}
        `.trim();

        onRender?.({ consent: consentSnapshot, metadata });
    }

    function renderComplianceLog() {
        const recordsSource = typeof getComplianceRecords === 'function' ? getComplianceRecords() : [];
        const records = Array.isArray(recordsSource) ? recordsSource : [];
        const recent = records.slice(-4).reverse();
        state.elements.logList.innerHTML = '';

        if (!recent.length) {
            const empty = document.createElement('li');
            empty.textContent = 'No compliance events captured yet.';
            state.elements.logList.appendChild(empty);
            return;
        }

        recent.forEach(entry => {
            const item = document.createElement('li');
            item.textContent = `${entry.event} • ${entry.classification?.toUpperCase?.() ?? ''}`.trim();
            const meta = document.createElement('span');
            const sourceLabel = entry.source ? ` • ${entry.source}` : '';
            meta.textContent = `${formatTimestamp(entry.timestamp)}${sourceLabel}`;
            item.appendChild(meta);
            state.elements.logList.appendChild(item);
        });
    }

    function handleDownload() {
        const recordsSource = typeof getComplianceRecords === 'function' ? getComplianceRecords() : [];
        const records = Array.isArray(recordsSource) ? recordsSource : [];
        const payload = downloadFormatter(records);
        if (onDownload) {
            onDownload({ records, payload });
            return;
        }

        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = createAnchor();
        link.href = url;
        link.download = defaultFileName(downloadFileNamePrefix);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function handleToggle(event) {
        const input = event.target;
        const classification = input.dataset.consent;
        const enabled = input.checked;

        onConsentToggle?.(classification, enabled);
        trackConsentToggle?.(classification, enabled);
    }

    function attachListeners() {
        state.elements.toggles.forEach(input => {
            input.addEventListener('change', handleToggle);
        });
        state.elements.downloadButton.addEventListener('click', handleDownload);
    }

    function detachListeners() {
        state.elements.toggles.forEach(input => {
            input.removeEventListener('change', handleToggle);
        });
        state.elements.downloadButton.removeEventListener('click', handleDownload);
    }

    function scheduleRefresh() {
        if (!refreshInterval || refreshInterval <= 0) {
            return;
        }
        clearInterval(state.refreshTimer);
        state.refreshTimer = setInterval(() => {
            if (state.destroyed) {
                clearInterval(state.refreshTimer);
                return;
            }
            renderComplianceLog();
        }, refreshInterval);
    }

    function mount() {
        buildStructure();
        attachListeners();
        const consentSnapshot = typeof getTelemetryConsent === 'function' ? getTelemetryConsent() : {};
        state.consent = consentSnapshot;
        syncToggles(consentSnapshot);
        renderStatus(consentSnapshot);
        renderComplianceLog();
        scheduleRefresh();
        return api;
    }

    function destroy() {
        state.destroyed = true;
        clearInterval(state.refreshTimer);
        detachListeners();
    }

    function handleConsentDecision(consentSnapshot, metadata = {}) {
        state.consent = consentSnapshot;
        syncToggles(consentSnapshot);
        renderStatus(consentSnapshot, metadata);
        renderComplianceLog();
    }

    const api = {
        mount,
        destroy,
        refreshComplianceLog: renderComplianceLog,
        handleConsentDecision
    };

    return api;
}
