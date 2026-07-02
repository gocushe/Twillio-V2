'use client';

import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import AppHeader from './components/AppHeader';
import { BUSINESS_TIME_ZONE, DAILY_RUN_WINDOW_LABEL, QUIET_HOURS_START, QUIET_HOURS_END } from '@/lib/schedule';

const TERMINAL = new Set(['failed_to_route', 'text_delivered', 'failed_delivery']);

const STATUS_LABEL = {
  draft: 'Draft',
  request_sent: 'Request sent',
  twilio_accepted: 'Text accepted',
  text_delivered: 'Delivered',
  failed_to_route: 'Failed to route',
  failed_delivery: 'Failed delivery',
};

const DEFAULT_SETTINGS = {
  template: 'Birthday reminder: {{firstName}} {{lastName}} has a birthday on {{birthDate}}. Phone: {{phoneNumber}}. Email: {{email}}. File: {{clientFileLink}}.',
  mode: 'test',
  retryCount: '2',
  failureAlert: '',
  duplicateBehavior: 'update',
  retentionDays: '90',
};

function statusTone(status) {
  if (status === 'text_delivered' || status === 'ok') return 'report-ok';
  if (status === 'failed_to_route' || status === 'failed_delivery' || status === 'error') return 'report-err';
  return 'report-info';
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

function validateBirthdayHeaders(fields = []) {
  const normalized = new Set(fields.map(normalizeHeader));
  const missing = [];
  if (!normalized.has('firstname')) missing.push('First Name');
  if (!normalized.has('lastname')) missing.push('Last Name');
  if (!normalized.has('birthdate')) missing.push('Birth Date');
  if (!normalized.has('phonenumber') && !normalized.has('phone')) missing.push('Phone Number');
  return missing;
}

export default function Dashboard() {
  const [accessKey, setAccessKey] = useState('Alex');

  const [mainTab, setMainTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');

  const [simMode, setSimMode] = useState(false);
  const [simDate, setSimDate] = useState('');
  const [realDate, setRealDate] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [birthdays, setBirthdays] = useState([]);
  const [sentDates, setSentDates] = useState([]);
  const [loading, setLoading] = useState(false);

  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);

  const [birthdayReport, setBirthdayReport] = useState(null);
  const [dragOverBirthday, setDragOverBirthday] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState(null);

  const [linkedNumber, setLinkedNumber] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [directStatus, setDirectStatus] = useState(null);
  const [directRun, setDirectRun] = useState(null);
  const [directSending, setDirectSending] = useState(false);
  const directPollRef = useRef(null);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('ba-operations-settings');
      if (saved) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
    } catch {
      addLog('error', 'Settings could not be loaded from this browser.', { event: 'Settings', source: 'local storage' });
    }
  }, []);

  useEffect(() => () => clearInterval(directPollRef.current), []);

  const addLog = (type, text, meta = {}) => {
    const time = new Date().toLocaleTimeString('en-CA', { hour12: false });
    setLogs(prev => [...prev, {
      type,
      text,
      time,
      event: meta.event || (type === 'error' ? 'Failure' : type === 'sms' ? 'Text' : 'System'),
      status: meta.status || (type === 'error' ? 'Needs attention' : 'OK'),
      source: meta.source || 'Dashboard',
    }]);
  };

  const updateState = (data) => {
    setSimMode(data.simMode);
    setSimDate(data.simDate);
    setRealDate(data.realDate);
    setBirthdays(data.birthdays || []);
    setSentDates(data.sentDates || []);
    setSelectedDate(data.simMode ? data.simDate : data.realDate);
  };

  const fetchLinkedRecipient = async () => {
    if (!accessKey) return;
    try {
      const res = await fetch('/api/sms/recipient', { headers: { 'x-access-key': accessKey } });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLinkedNumber(data.masked || '');
      } else {
        setLinkedNumber('');
        addLog('error', `${data.error || `HTTP ${res.status}`}. Configure TARGET_PHONE_NUMBER before direct text sends.`, {
          event: 'Linked number',
          status: `HTTP ${res.status}`,
          source: '/api/sms/recipient',
        });
      }
    } catch {
      setLinkedNumber('');
      addLog('error', 'Network error loading the linked boss number.', { event: 'Linked number', source: '/api/sms/recipient' });
    }
  };

  const fetchStatus = async () => {
    if (!accessKey) return;
    setLoading(true);
    try {
      const res = await fetch('/api/debug', { headers: { 'x-access-key': accessKey } });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        updateState(data);
      } else {
        addLog('error', `${data.error || `HTTP ${res.status}`}. Check access key and storage configuration.`, {
          event: 'Sync',
          status: `HTTP ${res.status}`,
          source: '/api/debug',
        });
      }
    } catch {
      addLog('error', 'Network error during sync. Confirm the local app is running.', { event: 'Sync', source: '/api/debug' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessKey) {
      fetchStatus();
      fetchLinkedRecipient();
    }
  }, [accessKey]);

  const pollDirectStatus = (runId) => {
    clearInterval(directPollRef.current);
    directPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/sms/status/${runId}`, { headers: { 'x-access-key': accessKey } });
        if (!res.ok) return;
        const data = await res.json();
        setDirectRun(data);
        if (TERMINAL.has(data.status)) {
          clearInterval(directPollRef.current);
          addLog(data.status === 'text_delivered' ? 'sms' : 'error', `Direct text ${STATUS_LABEL[data.status] || data.status}.`, {
            event: 'Direct text',
            status: STATUS_LABEL[data.status] || data.status,
            source: '/api/sms/status',
          });
        }
      } catch {
        // Keep polling; transient status errors should not overwrite the send result.
      }
    }, 2000);
  };

  const handleDirectText = async () => {
    const text = directMessage.trim();
    if (!text) {
      setDirectStatus({ type: 'error', message: 'Message body is required.' });
      return;
    }

    if (settings.mode !== 'live') {
      setDirectStatus({ type: 'ok', message: 'Test mode preview recorded. No SMS was sent.' });
      addLog('system', `Test mode direct text preview: ${text}`, {
        event: 'Direct text',
        status: 'Preview only',
        source: 'Test mode',
      });
      return;
    }

    setDirectSending(true);
    setDirectStatus(null);
    setDirectRun(null);
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'x-access-key': accessKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202) {
        setDirectRun({ runId: data.runId, status: data.status, sid: data.sid, segments: data.segments, history: [{ status: 'request_sent' }, { status: data.status }] });
        setDirectStatus({ type: 'ok', message: `Text accepted for ${linkedNumber || 'linked number'}.` });
        addLog('sms', `Direct text accepted for ${linkedNumber || 'linked number'}.`, {
          event: 'Direct text',
          status: STATUS_LABEL[data.status] || data.status,
          source: '/api/sms/send',
        });
        pollDirectStatus(data.runId);
      } else {
        const message = data.error || `Send failed (HTTP ${res.status}).`;
        setDirectStatus({ type: 'error', message });
        addLog('error', `${message} Next step: confirm Twilio and linked number settings.`, {
          event: 'Direct text',
          status: `HTTP ${res.status}`,
          source: '/api/sms/send',
        });
      }
    } catch {
      setDirectStatus({ type: 'error', message: 'Network error during direct text send.' });
      addLog('error', 'Network error during direct text send. Confirm the local app is running.', { event: 'Direct text', source: '/api/sms/send' });
    } finally {
      setDirectSending(false);
    }
  };

  const handleSimulate = async () => {
    if (!selectedDate) {
      addLog('error', 'Select a date before running the birthday simulation.', { event: 'Simulation' });
      setSimulationStatus({ type: 'error', message: 'Select a date before running the simulation.' });
      return;
    }
    setLoading(true);
    setSimulationStatus({ type: 'info', message: `Running birthday simulation for ${selectedDate}...` });
    addLog('system', `Running birthday reminder simulation for ${selectedDate}.`, { event: 'Simulation' });
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'x-access-key': accessKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, dryRun: settings.mode !== 'live', mode: settings.mode })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const r = data.digestResult;
        if (r.skipped) {
          setSimulationStatus({ type: 'info', message: `Skipped: ${r.reason}` });
          addLog('system', `Skipped: ${r.reason}`, { event: 'Simulation', status: 'Skipped' });
        } else if (r.dryRun) {
          setSimulationStatus({ type: 'ok', message: `Test mode preview generated for ${r.activeDate}. No SMS was sent.` });
          addLog('system', `Test mode birthday simulation preview for ${r.activeDate}.`, { event: 'Simulation', status: 'Preview only' });
          if (r.body) addLog('sms', r.body, { event: 'Birthday digest preview', source: 'Generated message' });
        } else if (r.smsSent) {
          setSimulationStatus({ type: 'ok', message: `Birthday reminder text sent for ${r.activeDate}.` });
          addLog('sms', `Birthday reminder text sent. SID: ${r.sid}`, { event: 'Simulation', source: '/api/simulate' });
          addLog('sms', r.body, { event: 'Birthday digest', source: 'Generated message' });
        } else if (r.error) {
          const rateText = r.rateLimited && r.retryAfterSeconds ? ` Try again in ${Math.ceil(r.retryAfterSeconds / 60)} minute(s).` : '';
          setSimulationStatus({ type: 'error', message: `${r.error}${rateText}` });
          addLog('error', `Twilio error: ${r.error}${rateText}`, { event: 'Simulation', source: '/api/simulate' });
          if (r.body) addLog('sms', r.body, { event: 'Birthday digest', status: 'Not sent' });
        } else {
          setSimulationStatus({ type: 'info', message: r.reason || 'No birthday reminders found.' });
          addLog('system', r.reason || 'No birthday reminders found.', { event: 'Simulation', status: 'No send' });
        }
        await fetchStatus();
      } else {
        setSimulationStatus({ type: 'error', message: data.error || 'Simulation failed.' });
        addLog('error', `${data.error || 'Unknown failure'}. Next step: check the selected date and server logs.`, {
          event: 'Simulation',
          status: `HTTP ${res.status}`,
          source: '/api/simulate',
        });
      }
    } catch {
      setSimulationStatus({ type: 'error', message: 'Network error during birthday simulation.' });
      addLog('error', 'Network error during birthday simulation.', { event: 'Simulation', source: '/api/simulate' });
    } finally {
      setLoading(false);
    }
  };

  const handleStopSimulation = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'x-access-key': accessKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSimulationStatus({ type: 'info', message: 'Simulation stopped. Real-time schedule restored.' });
        addLog('system', 'Birthday simulation stopped. Real-time mode restored.', { event: 'Simulation' });
        await fetchStatus();
      } else {
        addLog('error', data.error || 'Failed to stop simulation.', { event: 'Simulation', source: '/api/simulate' });
      }
    } catch {
      addLog('error', 'Network error stopping simulation.', { event: 'Simulation', source: '/api/simulate' });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset birthday reminder records, simulation state, and sent-digest logs?')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/debug', {
        method: 'POST',
        headers: { 'x-access-key': accessKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSimulationStatus(null);
        addLog('system', 'Birthday reminder records and run state reset.', { event: 'Reset' });
        setBirthdayReport(null);
        await fetchStatus();
      } else {
        addLog('error', data.error || 'Reset failed.', { event: 'Reset', status: `HTTP ${res.status}`, source: '/api/debug' });
      }
    } catch {
      addLog('error', 'Network error during reset.', { event: 'Reset', source: '/api/debug' });
    } finally {
      setLoading(false);
    }
  };

  const processCSV = (file) => {
    addLog('system', `Parsing birthday CSV "${file.name}".`, { event: 'CSV import' });
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: async (results) => {
        const missing = validateBirthdayHeaders(results.meta?.fields || []);
        if (missing.length) {
          const msg = `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`;
          setBirthdayReport({ success: false, errorMessage: msg });
          addLog('error', msg, { event: 'CSV import', status: 'Invalid CSV' });
          return;
        }

        const records = results.data;
        addLog('system', `Uploading ${records.length} birthday rows.`, { event: 'CSV import' });
        try {
          const res = await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'x-access-key': accessKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'birthdays', records })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            const report = { success: true, added: data.added, updated: data.updated, errors: data.errors };
            setBirthdayReport(report);
            addLog('system', `Import complete. Added ${data.added}, updated ${data.updated}, errors ${data.errors.length}.`, { event: 'CSV import' });
            if (data.errors.length) data.errors.forEach(e => addLog('error', `Row ${e.row}: ${e.reason}`, { event: 'CSV import', status: 'Row skipped' }));
            await fetchStatus();
          } else {
            const msg = data.error || 'Upload failed.';
            addLog('error', `${msg} Next step: confirm required birthday columns and phone/date formats.`, {
              event: 'CSV import',
              status: `HTTP ${res.status}`,
              source: '/api/ingest',
            });
            setBirthdayReport({ success: false, errorMessage: msg });
          }
        } catch {
          addLog('error', 'Network error during birthday CSV upload.', { event: 'CSV import', source: '/api/ingest' });
        }
      },
      error: (err) => addLog('error', `CSV parse error: ${err.message}`, { event: 'CSV import' })
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOverBirthday(false);
    if (e.dataTransfer.files[0]) processCSV(e.dataTransfer.files[0]);
  };

  const isBirthdayMatch = (birthDate, dateStr) => {
    if (!birthDate || !dateStr) return false;
    const [year, month, day] = dateStr.split('-').map(Number);
    const [, bMonth, bDay] = birthDate.split('-').map(Number);
    if (bMonth === month && bDay === day) return true;
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (month === 2 && day === 28 && !isLeap && bMonth === 2 && bDay === 29) return true;
    return false;
  };

  const getDaysUntil = (dateStr, activeDateStr) => {
    if (!dateStr || !activeDateStr) return 999;
    const [ay, am, ad] = activeDateStr.split('-').map(Number);
    const [, tm, td] = dateStr.split('-').map(Number);
    const active = new Date(ay, am - 1, ad);
    let next = new Date(ay, tm - 1, td);
    if (next < active) next.setFullYear(ay + 1);
    return Math.ceil((next - active) / 86400000);
  };

  const persistSettings = (nextSettings, message) => {
    try {
      window.localStorage.setItem('ba-operations-settings', JSON.stringify(nextSettings));
      if (message) addLog('system', message, { event: 'Settings' });
    } catch {
      addLog('error', 'Settings could not be saved in this browser.', { event: 'Settings', source: 'local storage' });
    }
  };

  const updateSetting = (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      persistSettings(next);
      return next;
    });
  };

  const saveSettings = () => {
    persistSettings(settings, 'Operations settings saved in this browser.');
  };

  const exportLogs = () => {
    const payload = JSON.stringify(logs, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ba-operations-logs-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearLogs = () => {
    if (!window.confirm('Clear visible History entries?')) return;
    setLogs([]);
  };

  const q = searchQuery.toLowerCase();
  const sortedBirthdays = [...birthdays]
    .filter(c => {
      const haystack = `${c.firstName} ${c.lastName} ${c.phone} ${c.birthDate} ${c.email || ''} ${c.clientFileLink || ''}`.toLowerCase();
      return !q || haystack.includes(q);
    })
    .sort((a, b) => {
      const am = isBirthdayMatch(a.birthDate, selectedDate);
      const bm = isBirthdayMatch(b.birthDate, selectedDate);
      if (am && !bm) return -1;
      if (!am && bm) return 1;
      return getDaysUntil(a.birthDate, selectedDate) - getDaysUntil(b.birthDate, selectedDate);
    });

  const activeDate = simMode ? simDate : realDate;
  const directCharCount = directMessage.length;
  const navItems = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'records', label: `Birthday Records (${birthdays.length})` },
    { id: 'history', label: logs.length ? `History (${logs.length})` : 'History' },
  ];

  return (
    <div className="app">
      <AppHeader
        activeTab={mainTab}
        navItems={navItems}
        onTabChange={setMainTab}
        onLogoClick={() => setMainTab('dashboard')}
        modeLabel={settings.mode === 'live' ? 'LIVE' : 'TEST'}
        activeDate={activeDate}
        isSimMode={simMode}
        textMode={settings.mode}
        onTextModeChange={mode => updateSetting('mode', mode)}
        accessKey={accessKey}
        onAccessKeyChange={setAccessKey}
        onSync={fetchStatus}
        loading={loading}
      />

      {mainTab === 'dashboard' && (
        <main className="tab-content">
          {simMode && (
            <div className="sim-banner">
              Birthday simulation is <strong>ON</strong>. Real scheduled sends are paused. Simulating date: <strong>{simDate}</strong>
            </div>
          )}

          <div className="dashboard-grid">
            <section className="dashboard-main">
              <div className="card direct-card">
                <div className="card-head">
                  <div>
                    <h2 className="card-title">Direct Text Linked Number</h2>
                    <p className="card-subtitle">Send a manual message to the configured boss number.</p>
                  </div>
                  <span className={`status-pill ${settings.mode === 'live' ? 'status-live' : 'status-test'}`}>
                    {settings.mode === 'live' ? 'Live mode' : 'Test mode'}
                  </span>
                </div>

                <div className="linked-number-row">
                  <span className="field-label">Linked number</span>
                  <span className="linked-number">{linkedNumber || 'Not configured'}</span>
                </div>

                <label className="field-label" htmlFor="direct-message">Message</label>
                <textarea
                  id="direct-message"
                  className="input message-input"
                  rows={5}
                  value={directMessage}
                  onChange={e => setDirectMessage(e.target.value)}
                  placeholder="Type a direct birthday reminder or operations note..."
                  disabled={directSending}
                />

                <div className="message-meta">
                  <span>{directCharCount} chars</span>
                  <span>{directCharCount > 160 ? 'Multi-segment SMS' : 'Single segment'} · hard limit 10/hour</span>
                </div>

                <button className="btn btn-primary" onClick={handleDirectText} disabled={directSending || !directMessage.trim()}>
                  {directSending ? 'Sending' : settings.mode === 'live' ? 'Send Direct Text' : 'Preview Direct Text'}
                </button>

                {directStatus && (
                  <div className={`report ${directStatus.type === 'ok' ? 'report-ok' : 'report-err'}`}>
                    {directStatus.message}
                  </div>
                )}

                {directRun && (
                  <div className="status-feed">
                    <span className={statusTone(directRun.status)}>
                      {STATUS_LABEL[directRun.status] || directRun.status}
                    </span>
                    {directRun.runId && <span className="mono">run {directRun.runId.slice(0, 8)}</span>}
                  </div>
                )}
              </div>

              <div className="card">
                <h2 className="card-title">Upload Birthday CSV</h2>
                <div className="upload-pair upload-single">
                  <div>
                    <p className="upload-label">Birthday reminders</p>
                    <div
                      className={`dropzone${dragOverBirthday ? ' drag-over' : ''}`}
                      onDragOver={e => { e.preventDefault(); setDragOverBirthday(true); }}
                      onDragLeave={() => setDragOverBirthday(false)}
                      onDrop={handleDrop}
                      onClick={() => document.getElementById('pick-birthday').click()}
                      role="button"
                      tabIndex={0}
                      aria-label="Upload birthday CSV"
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('pick-birthday').click(); }}
                    >
                      <span className="dz-arrow">↑</span>
                      <span>Drop birthday CSV or click to browse</span>
                      <input
                        id="pick-birthday"
                        type="file"
                        accept=".csv"
                        style={{ display: 'none' }}
                        onChange={e => { if (e.target.files[0]) processCSV(e.target.files[0]); e.target.value = ''; }}
                      />
                    </div>
                    <p className="upload-hint">Required: First Name, Last Name, Phone Number, Birth Date. Optional: Email, Client File Link.</p>
                    {birthdayReport && (
                      <div className={`report ${birthdayReport.success ? 'report-ok' : 'report-err'}`}>
                        {birthdayReport.success
                          ? `Added ${birthdayReport.added} · Updated ${birthdayReport.updated} · Errors ${birthdayReport.errors.length}${birthdayReport.errors.length ? ' - see History' : ''}`
                          : `Failed: ${birthdayReport.errorMessage}`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <aside className="card">
              <h2 className="card-title">Birthday Operations</h2>
              <div className="sim-panel">
                <div className="sim-row">
                  <span className="sim-row-label">Mode</span>
                  <span className={`sim-row-val ${simMode ? 'val-sim' : 'val-live'}`}>
                    {simMode ? 'Simulation' : 'Real-Time'}
                  </span>
                </div>

                <div className="sim-row">
                  <span className="sim-row-label">Active date</span>
                  <span className="mono">{activeDate}</span>
                </div>

                <div className="sim-row">
                  <span className="sim-row-label">Birthday digests sent</span>
                  <span>{sentDates.length}</span>
                </div>

                <div>
                  <label className="field-label" htmlFor="sim-date-input">Simulate date</label>
                  <input
                    id="sim-date-input"
                    type="date"
                    className="input"
                    value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)}
                  />
                </div>

                <button className="btn btn-primary" onClick={handleSimulate} disabled={loading}>
                  Run Birthday Simulation
                </button>

                {simMode && (
                  <button className="btn btn-outline" onClick={handleStopSimulation} disabled={loading}>
                    Stop Simulation
                  </button>
                )}

                <button className="btn btn-danger" onClick={handleReset} disabled={loading}>
                  Reset Birthday Data
                </button>

                {simulationStatus && (
                  <div className={`report ${simulationStatus.type === 'ok' ? 'report-ok' : simulationStatus.type === 'error' ? 'report-err' : 'report-info'}`}>
                    {simulationStatus.message}
                  </div>
                )}

                <p className="panel-note">
                  Schedule visibility: Vercel Cron runs at 15:00 UTC. The server sends during {DAILY_RUN_WINDOW_LABEL} {BUSINESS_TIME_ZONE}.
                </p>
              </div>
            </aside>
          </div>
        </main>
      )}

      {mainTab === 'records' && (
        <main className="tab-content">
          <div className="records-top">
            <input
              type="search"
              className="input search-box"
              placeholder="Filter birthday records..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <span className="records-meta">
              {sortedBirthdays.length} birthday record{sortedBirthdays.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="table-wrap">
            {sortedBirthdays.length === 0 ? (
              <p className="empty-state">
                {searchQuery ? 'No birthday records match your search.' : 'No birthday reminder records yet. Upload a birthday CSV on the Dashboard.'}
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Birthday</th>
                    <th>Email</th>
                    <th>File</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedBirthdays.map((c, i) => {
                    const matched = isBirthdayMatch(c.birthDate, selectedDate);
                    return (
                      <tr key={i} className={matched ? 'matched' : ''}>
                        <td>
                          {c.firstName} {c.lastName}
                          {matched && <span className="match-tag">Today</span>}
                        </td>
                        <td className="mono">{c.phone}</td>
                        <td className="mono">{c.birthDate}</td>
                        <td>{c.email || <span className="muted">-</span>}</td>
                        <td>
                          {c.clientFileLink
                            ? <a href={c.clientFileLink} target="_blank" rel="noopener noreferrer">View</a>
                            : <span className="muted">-</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </main>
      )}

      {mainTab === 'history' && (
        <main className="tab-content history-layout">
          <section>
            <div className="history-toolbar">
              <span className="history-meta">{logs.length} audit {logs.length !== 1 ? 'entries' : 'entry'}</span>
              <div className="toolbar-actions">
                {logs.length > 0 && <button className="btn btn-outline btn-sm" onClick={exportLogs}>Export</button>}
                {logs.length > 0 && <button className="btn btn-outline btn-sm" onClick={clearLogs}>Clear</button>}
              </div>
            </div>

            <div className="log-card">
              {logs.length === 0 ? (
                <div className="log-empty">
                  No activity yet. Import a birthday CSV, send a direct text, or run a birthday simulation.
                </div>
              ) : (
                logs.map((log, i) => (
                  <article key={i} className={`log-row ${log.type}`}>
                    <span className="log-time">{log.time}</span>
                    <span className="log-event">{log.event}</span>
                    <span className={`log-status ${statusTone(log.type === 'error' ? 'error' : log.status)}`}>{log.status}</span>
                    <span className="log-detail">{log.text}</span>
                    <span className="log-source">{log.source}</span>
                  </article>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </section>

          <section className="settings-card">
            <div className="card-head">
              <div>
                <h2 className="card-title">Operations Settings</h2>
                <p className="card-subtitle">Browser-saved controls for safe birthday reminder texting.</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={saveSettings}>Save Settings</button>
            </div>

            <div className="settings-grid">
              <label>
                <span className="field-label">Linked boss number</span>
                <input className="input" value={linkedNumber || 'Not configured'} readOnly aria-label="Linked boss number" />
              </label>
              <label>
                <span className="field-label">Daily run window</span>
                <input className="input" value={DAILY_RUN_WINDOW_LABEL} readOnly />
              </label>
              <label>
                <span className="field-label">Timezone</span>
                <input className="input" value={BUSINESS_TIME_ZONE} readOnly />
              </label>
              <label>
                <span className="field-label">Live/Test mode</span>
                <select className="input" value={settings.mode} onChange={e => updateSetting('mode', e.target.value)}>
                  <option value="test">Test - avoid real sends</option>
                  <option value="live">Live - real boss number</option>
                </select>
              </label>
              <label>
                <span className="field-label">Automatic quiet block</span>
                <input className="input" value={`${QUIET_HOURS_START} - ${QUIET_HOURS_END}`} readOnly />
              </label>
              <label>
                <span className="field-label">Retry count</span>
                <input className="input" type="number" min="0" max="5" value={settings.retryCount} onChange={e => updateSetting('retryCount', e.target.value)} />
              </label>
              <label>
                <span className="field-label">Failure alert recipient</span>
                <input className="input" value={settings.failureAlert} onChange={e => updateSetting('failureAlert', e.target.value)} placeholder="Optional phone or email" />
              </label>
              <label>
                <span className="field-label">Duplicate CSV behavior</span>
                <select className="input" value={settings.duplicateBehavior} onChange={e => updateSetting('duplicateBehavior', e.target.value)}>
                  <option value="update">Update existing records</option>
                  <option value="skip">Skip duplicates</option>
                  <option value="confirm">Ask before import</option>
                </select>
              </label>
              <label>
                <span className="field-label">Log retention days</span>
                <input className="input" type="number" min="1" value={settings.retentionDays} onChange={e => updateSetting('retentionDays', e.target.value)} />
              </label>
            </div>

            <label className="settings-template">
              <span className="field-label">Birthday reminder template</span>
              <textarea
                className="input"
                rows={4}
                value={settings.template}
                onChange={e => updateSetting('template', e.target.value)}
              />
            </label>

            <p className="panel-note">
              Supported tokens: {'{{firstName}}'}, {'{{lastName}}'}, {'{{birthDate}}'}, {'{{phoneNumber}}'}, {'{{email}}'}, {'{{clientFileLink}}'}.
            </p>
          </section>
        </main>
      )}
    </div>
  );
}
