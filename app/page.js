'use client';

import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';

export default function Dashboard() {
  // Auth
  const [accessKey, setAccessKey] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [isErrorState, setIsErrorState] = useState(false);

  // Navigation
  const [mainTab, setMainTab] = useState('dashboard');
  const [recordsSubTab, setRecordsSubTab] = useState('birthdays');
  const [searchQuery, setSearchQuery] = useState('');

  // System state
  const [simMode, setSimMode] = useState(false);
  const [simDate, setSimDate] = useState('');
  const [realDate, setRealDate] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [birthdays, setBirthdays] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [sentDates, setSentDates] = useState([]);
  const [loading, setLoading] = useState(false);

  // Logs (History tab)
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);

  // Upload reports
  const [birthdayReport, setBirthdayReport] = useState(null);
  const [renewalReport, setRenewalReport] = useState(null);

  // Drag state
  const [dragOverBirthday, setDragOverBirthday] = useState(false);
  const [dragOverRenewal, setDragOverRenewal] = useState(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (type, text) => {
    const time = new Date().toLocaleTimeString('en-CA', { hour12: false });
    setLogs(prev => [...prev, { type, text, time }]);
  };

  // ── Auth ─────────────────────────────────────────────────────────────
  const submitPasscode = async (code) => {
    setCheckingAuth(true);
    setAuthError('');
    setIsErrorState(false);
    try {
      const res = await fetch('/api/debug', { headers: { 'x-access-key': code } });
      if (res.ok) {
        const data = await res.json();
        setAccessKey(code);
        setIsAuthenticated(true);
        updateState(data);
        addLog('system', 'Session started. Connected to Redis.');
      } else {
        setIsErrorState(true);
        setIsShaking(true);
        setAuthError('Invalid passcode.');
        setTimeout(() => {
          setPasscode('');
          setIsShaking(false);
          setIsErrorState(false);
        }, 800);
      }
    } catch {
      setAuthError('Could not reach server.');
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleNumberClick = (num) => {
    if (checkingAuth || isShaking || passcode.length >= 4) return;
    setAuthError('');
    const nextPasscode = passcode + num;
    setPasscode(nextPasscode);
    if (nextPasscode.length === 4) {
      submitPasscode(nextPasscode);
    }
  };

  const handleDelete = () => {
    if (checkingAuth || isShaking) return;
    setPasscode(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (checkingAuth || isShaking) return;
    setPasscode('');
  };

  useEffect(() => {
    if (isAuthenticated) return;
    const handleKeyDown = (e) => {
      if (checkingAuth || isShaking) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleNumberClick(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleDelete();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated, passcode, checkingAuth, isShaking]);

  // ── Sync ─────────────────────────────────────────────────────────────
  const fetchStatus = async () => {
    if (!accessKey) return;
    setLoading(true);
    try {
      const res = await fetch('/api/debug', { headers: { 'x-access-key': accessKey } });
      if (res.ok) {
        updateState(await res.json());
      } else {
        addLog('error', 'Sync failed: HTTP ' + res.status);
      }
    } catch {
      addLog('error', 'Network error during sync.');
    } finally {
      setLoading(false);
    }
  };

  const updateState = (data) => {
    setSimMode(data.simMode);
    setSimDate(data.simDate);
    setRealDate(data.realDate);
    setBirthdays(data.birthdays || []);
    setRenewals(data.renewals || []);
    setSentDates(data.sentDates || []);
    setSelectedDate(data.simMode ? data.simDate : data.realDate);
  };

  // ── Simulate ──────────────────────────────────────────────────────────
  const handleSimulate = async () => {
    if (!selectedDate) { addLog('error', 'Select a date before running simulation.'); return; }
    setLoading(true);
    addLog('system', `Running simulation for ${selectedDate}...`);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'x-access-key': accessKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const r = data.digestResult;
        addLog('system', `Simulation complete — active date: ${data.activeDate}`);
        if (r.skipped) {
          addLog('meta', `Skipped (idempotency): ${r.reason}`);
        } else if (r.smsSent) {
          addLog('system', `SMS sent successfully. SID: ${r.sid}`);
          addLog('sms', r.body);
        } else if (r.error) {
          addLog('error', `Twilio error: ${r.error}`);
          if (r.body) addLog('sms', r.body);
        } else {
          addLog('meta', `No matches: ${r.reason}`);
        }
        await fetchStatus();
      } else {
        addLog('error', `Simulation error: ${data.error || 'Unknown failure'}`);
      }
    } catch {
      addLog('error', 'Network error during simulation.');
    } finally {
      setLoading(false);
    }
  };

  const handleStopSimulation = async () => {
    setLoading(true);
    addLog('system', 'Stopping simulation mode...');
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'x-access-key': accessKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        addLog('system', 'Simulation stopped. Back to real-time mode.');
        await fetchStatus();
      } else {
        addLog('error', `Failed to stop: ${data.error || 'Server error'}`);
      }
    } catch {
      addLog('error', 'Network error stopping simulation.');
    } finally {
      setLoading(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (!window.confirm('Reset the database?\n\nThis permanently deletes all client records, simulation state, and sent-digest logs.')) return;
    setLoading(true);
    addLog('system', 'Resetting database...');
    try {
      const res = await fetch('/api/debug', {
        method: 'POST',
        headers: { 'x-access-key': accessKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        addLog('system', 'Database reset complete. All records deleted.');
        setBirthdayReport(null);
        setRenewalReport(null);
        await fetchStatus();
      } else {
        addLog('error', `Reset failed: ${data.error}`);
      }
    } catch {
      addLog('error', 'Network error during reset.');
    } finally {
      setLoading(false);
    }
  };

  // ── CSV ───────────────────────────────────────────────────────────────
  const processCSV = (file, type) => {
    addLog('system', `Parsing ${type} CSV — "${file.name}"...`);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: async (results) => {
        const records = results.data;
        addLog('system', `Uploading ${records.length} rows to database...`);
        try {
          const res = await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'x-access-key': accessKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, records })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            const report = { success: true, added: data.added, updated: data.updated, errors: data.errors };
            if (type === 'birthdays') setBirthdayReport(report);
            else setRenewalReport(report);
            addLog('system', `Upload done — added: ${data.added}, updated: ${data.updated}, errors: ${data.errors.length}`);
            if (data.errors.length) {
              data.errors.forEach(e => addLog('error', `Row ${e.row}: ${e.reason}`));
            }
            await fetchStatus();
          } else {
            const msg = data.error || 'Upload failed';
            addLog('error', msg);
            if (type === 'birthdays') setBirthdayReport({ success: false, errorMessage: msg });
            else setRenewalReport({ success: false, errorMessage: msg });
          }
        } catch {
          addLog('error', 'Network error during upload.');
        }
      },
      error: (err) => addLog('error', `CSV parse error: ${err.message}`)
    });
  };

  const handleDrop = (e, setDrag, type) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files[0]) processCSV(e.dataTransfer.files[0], type);
  };

  // ── Date helpers ──────────────────────────────────────────────────────
  const addDays = (dateStr, days) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

  const isRenewalMatch = (renewalDate, dateStr) => {
    if (!renewalDate || !dateStr) return false;
    const targetStr = addDays(dateStr, 3);
    const [ty, tm, td] = targetStr.split('-').map(Number);
    const [, rMonth, rDay] = renewalDate.split('-').map(Number);
    if (rMonth === tm && rDay === td) return true;
    const isLeap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
    if (tm === 2 && td === 28 && !isLeap && rMonth === 2 && rDay === 29) return true;
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

  // ── Sorted & filtered records ─────────────────────────────────────────
  const q = searchQuery.toLowerCase();

  const sortedBirthdays = [...birthdays]
    .filter(c => !q || `${c.firstName} ${c.lastName}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const am = isBirthdayMatch(a.birthDate, selectedDate);
      const bm = isBirthdayMatch(b.birthDate, selectedDate);
      if (am && !bm) return -1;
      if (!am && bm) return 1;
      return getDaysUntil(a.birthDate, selectedDate) - getDaysUntil(b.birthDate, selectedDate);
    });

  const sortedRenewals = [...renewals]
    .filter(p => !q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const am = isRenewalMatch(a.renewalDate, selectedDate);
      const bm = isRenewalMatch(b.renewalDate, selectedDate);
      if (am && !bm) return -1;
      if (!am && bm) return 1;
      return getDaysUntil(a.renewalDate, selectedDate) - getDaysUntil(b.renewalDate, selectedDate);
    });

  const activeDate = simMode ? simDate : realDate;

  // ── Login screen ──────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="gate">
        <div className={`gate-form${isShaking ? ' shake' : ''}`}>
          <div style={{ textAlign: 'center' }}>
            <h1>B&A Operations</h1>
            <p className="gate-sub">Enter passcode to unlock the dashboard</p>
          </div>
          
          <div className="numpad-container">
            {/* Dots indicator */}
            <div className="numpad-dots">
              {[0, 1, 2, 3].map((index) => {
                let dotClass = 'numpad-dot';
                if (isErrorState) {
                  dotClass += ' error';
                } else if (index < passcode.length) {
                  dotClass += ' active';
                }
                return <div key={index} className={dotClass} />;
              })}
            </div>

            {/* Error Message */}
            {authError && (
              <p className="error-text" style={{ minHeight: '1.25rem', marginBottom: '0.5rem', textAlign: 'center' }}>
                {authError}
              </p>
            )}

            {/* Grid */}
            <div className="numpad-grid">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <button
                  key={num}
                  type="button"
                  className="numpad-btn"
                  onClick={() => handleNumberClick(num)}
                  disabled={checkingAuth || isShaking}
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                className="numpad-btn btn-action"
                onClick={handleClear}
                disabled={checkingAuth || isShaking || !passcode}
              >
                Clear
              </button>
              <button
                type="button"
                className="numpad-btn"
                onClick={() => handleNumberClick('0')}
                disabled={checkingAuth || isShaking}
              >
                0
              </button>
              <button
                type="button"
                className="numpad-btn btn-action"
                onClick={handleDelete}
                disabled={checkingAuth || isShaking || !passcode}
                aria-label="Delete"
              >
                ⌫
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main app ──────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="app-title">B&amp;A Operations</span>
          <span className="app-sub">Texting Desk</span>
        </div>
        <div className="header-right">
          {simMode && <span className="sim-badge">Sim Active — texts paused</span>}
          <span className="date-chip">{simMode ? 'SIM' : 'LIVE'} {activeDate}</span>
          <button className="btn btn-outline btn-sm" onClick={fetchStatus} disabled={loading}>
            {loading ? '…' : 'Sync'}
          </button>
        </div>
      </header>

      {/* Tab navigation */}
      <nav className="tab-nav">
        <button className={`tab-btn${mainTab === 'dashboard' ? ' active' : ''}`} onClick={() => setMainTab('dashboard')}>
          Dashboard
        </button>
        <button className={`tab-btn${mainTab === 'records' ? ' active' : ''}`} onClick={() => setMainTab('records')}>
          Records ({birthdays.length + renewals.length})
        </button>
        <button className={`tab-btn${mainTab === 'history' ? ' active' : ''}`} onClick={() => setMainTab('history')}>
          History{logs.length > 0 ? ` (${logs.length})` : ''}
        </button>
      </nav>

      {/* ── DASHBOARD TAB ─────────────────────────────────────────────── */}
      {mainTab === 'dashboard' && (
        <div className="tab-content">
          {simMode && (
            <div className="sim-banner">
              Simulation mode is <strong>ON</strong> — the daily cron is paused. Simulating date: <strong>{simDate}</strong>
            </div>
          )}

          <div className="dashboard-grid">
            {/* Uploads */}
            <div className="card">
              <h2 className="card-title">Upload CSV Files</h2>
              <div className="upload-pair">

                {/* Birthday CSV */}
                <div>
                  <p className="upload-label">Birthdays</p>
                  <div
                    className={`dropzone${dragOverBirthday ? ' drag-over' : ''}`}
                    onDragOver={e => { e.preventDefault(); setDragOverBirthday(true); }}
                    onDragLeave={() => setDragOverBirthday(false)}
                    onDrop={e => handleDrop(e, setDragOverBirthday, 'birthdays')}
                    onClick={() => document.getElementById('pick-birthday').click()}
                  >
                    <span className="dz-arrow">↑</span>
                    <span>Drop CSV or click to browse</span>
                    <input
                      id="pick-birthday"
                      type="file"
                      accept=".csv"
                      style={{ display: 'none' }}
                      onChange={e => { if (e.target.files[0]) processCSV(e.target.files[0], 'birthdays'); e.target.value = ''; }}
                    />
                  </div>
                  <p className="upload-hint">Columns: First Name, Last Name, Phone Number, Birth Date, Email, Client File Link</p>
                  {birthdayReport && (
                    <div className={`report ${birthdayReport.success ? 'report-ok' : 'report-err'}`}>
                      {birthdayReport.success
                        ? `Added ${birthdayReport.added} · Updated ${birthdayReport.updated} · Errors ${birthdayReport.errors.length}${birthdayReport.errors.length ? ' — see History tab' : ''}`
                        : `Failed: ${birthdayReport.errorMessage}`}
                    </div>
                  )}
                </div>

                {/* Renewal CSV */}
                <div>
                  <p className="upload-label">Policy Renewals</p>
                  <div
                    className={`dropzone${dragOverRenewal ? ' drag-over' : ''}`}
                    onDragOver={e => { e.preventDefault(); setDragOverRenewal(true); }}
                    onDragLeave={() => setDragOverRenewal(false)}
                    onDrop={e => handleDrop(e, setDragOverRenewal, 'renewals')}
                    onClick={() => document.getElementById('pick-renewal').click()}
                  >
                    <span className="dz-arrow">↑</span>
                    <span>Drop CSV or click to browse</span>
                    <input
                      id="pick-renewal"
                      type="file"
                      accept=".csv"
                      style={{ display: 'none' }}
                      onChange={e => { if (e.target.files[0]) processCSV(e.target.files[0], 'renewals'); e.target.value = ''; }}
                    />
                  </div>
                  <p className="upload-hint">Columns: First Name, Last Name, Policy Type, Renewal Date, Email, Phone Number</p>
                  {renewalReport && (
                    <div className={`report ${renewalReport.success ? 'report-ok' : 'report-err'}`}>
                      {renewalReport.success
                        ? `Added ${renewalReport.added} · Updated ${renewalReport.updated} · Errors ${renewalReport.errors.length}${renewalReport.errors.length ? ' — see History tab' : ''}`
                        : `Failed: ${renewalReport.errorMessage}`}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Simulation controls */}
            <div className="card">
              <h2 className="card-title">Simulation</h2>
              <div className="sim-panel">

                <div className="sim-row">
                  <span className="sim-row-label">Mode</span>
                  <span className={`sim-row-val ${simMode ? 'val-sim' : 'val-live'}`}>
                    {simMode ? 'Simulation' : 'Real-Time'}
                  </span>
                </div>

                <div className="sim-row">
                  <span className="sim-row-label">Active date</span>
                  <span className="mono" style={{ fontSize: '0.85rem' }}>{activeDate}</span>
                </div>

                <div className="sim-row">
                  <span className="sim-row-label">Digests sent</span>
                  <span>{sentDates.length}</span>
                </div>

                <div>
                  <label className="field-label" htmlFor="sim-date-input">Simulate date:</label>
                  <input
                    id="sim-date-input"
                    type="date"
                    className="input"
                    value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)}
                  />
                </div>

                <button className="btn btn-primary" onClick={handleSimulate} disabled={loading}>
                  Run Simulation
                </button>

                {simMode && (
                  <button className="btn btn-outline" onClick={handleStopSimulation} disabled={loading}>
                    Stop Simulation
                  </button>
                )}

                <button className="btn btn-danger" onClick={handleReset} disabled={loading}>
                  Reset Database
                </button>

                <p style={{ fontSize: '0.75rem', color: 'var(--gray-400)', lineHeight: 1.4 }}>
                  Note: Vercel Cron runs at 15:30 UTC — that&rsquo;s 7:30 AM PST / 8:30 AM PDT.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RECORDS TAB ───────────────────────────────────────────────── */}
      {mainTab === 'records' && (
        <div className="tab-content">
          <div className="records-top">
            <input
              type="search"
              className="input search-box"
              placeholder="Filter by name…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <span className="records-meta">
                {sortedBirthdays.length + sortedRenewals.length} result{sortedBirthdays.length + sortedRenewals.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="sub-tabs">
            <button
              className={`sub-tab${recordsSubTab === 'birthdays' ? ' active' : ''}`}
              onClick={() => setRecordsSubTab('birthdays')}
            >
              Birthdays ({sortedBirthdays.length})
            </button>
            <button
              className={`sub-tab${recordsSubTab === 'renewals' ? ' active' : ''}`}
              onClick={() => setRecordsSubTab('renewals')}
            >
              Renewals ({sortedRenewals.length})
            </button>
          </div>

          {recordsSubTab === 'birthdays' ? (
            <div className="table-wrap">
              {sortedBirthdays.length === 0 ? (
                <p className="empty-state">
                  {searchQuery ? 'No birthdays match your search.' : 'No birthday records yet — upload a CSV on the Dashboard tab.'}
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
                          <td>{c.email || <span className="muted">—</span>}</td>
                          <td>
                            {c.clientFileLink
                              ? <a href={c.clientFileLink} target="_blank" rel="noopener noreferrer">View</a>
                              : <span className="muted">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="table-wrap">
              {sortedRenewals.length === 0 ? (
                <p className="empty-state">
                  {searchQuery ? 'No renewals match your search.' : 'No renewal records yet — upload a CSV on the Dashboard tab.'}
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Policy Type</th>
                      <th>Phone</th>
                      <th>Renewal Date</th>
                      <th>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRenewals.map((p, i) => {
                      const matched = isRenewalMatch(p.renewalDate, selectedDate);
                      return (
                        <tr key={i} className={matched ? 'matched' : ''}>
                          <td>
                            {p.firstName} {p.lastName}
                            {matched && <span className="match-tag">3-day alert</span>}
                          </td>
                          <td>{p.policyType}</td>
                          <td className="mono">{p.phone}</td>
                          <td className="mono">{p.renewalDate}</td>
                          <td>{p.email || <span className="muted">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ───────────────────────────────────────────────── */}
      {mainTab === 'history' && (
        <div className="tab-content">
          <div className="history-toolbar">
            <span className="history-meta">{logs.length} log {logs.length !== 1 ? 'entries' : 'entry'}</span>
            {logs.length > 0 && (
              <button className="btn btn-outline btn-sm" onClick={() => setLogs([])}>Clear</button>
            )}
          </div>

          <div className="terminal">
            {logs.length === 0 ? (
              <div className="t-line meta">
                <span className="t-time">—</span>
                <span className="t-body">No activity yet. Upload a file or run a simulation from the Dashboard tab.</span>
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`t-line ${log.type}`}>
                  <span className="t-time">{log.time}</span>
                  {log.type === 'sms'
                    ? <span className="t-body"><span className="t-sms-block">{log.text}</span></span>
                    : <span className="t-body">{log.text}</span>}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

    </div>
  );
}
