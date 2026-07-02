'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import AppHeader from '../components/AppHeader';

const TERMINAL = new Set(['failed_to_route', 'text_delivered', 'failed_delivery']);

const STATUS_LABEL = {
  draft: 'Draft',
  request_sent: 'Request sent',
  twilio_accepted: 'Twilio accepted',
  text_delivered: 'Delivered',
  failed_to_route: 'Failed to route',
  failed_delivery: 'Failed delivery',
};

function statusTone(status) {
  if (status === 'text_delivered') return 'report-ok';
  if (status === 'failed_to_route' || status === 'failed_delivery') return 'report-err';
  return 'meta';
}

export default function SmsPanel() {
  // Access key — held in memory only (never localStorage).
  const [accessKey, setAccessKey] = useState('Alex');

  const [masked, setMasked] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [run, setRun] = useState(null);      // { runId, status, history, ... }
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const authHeaders = useCallback(
    (extra = {}) => ({ 'x-access-key': accessKey, ...extra }),
    [accessKey]
  );

  // ── Masked recipient ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/sms/recipient', { headers: authHeaders() });
        if (!cancelled && res.ok) setMasked((await res.json()).masked || '');
        else if (!cancelled) setMasked('');
      } catch { if (!cancelled) setMasked(''); }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  // ── Status polling until terminal ─────────────────────────────────────
  const pollStatus = useCallback((runId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/sms/status/${runId}`, { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          setRun(data);
          if (TERMINAL.has(data.status)) clearInterval(pollRef.current);
        }
      } catch { /* keep polling */ }
    }, 2000);
  }, [authHeaders]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  // ── Segment / encoding preview ────────────────────────────────────────
  const charCount = body.length;
  const multiSegment = charCount > 160;

  // ── Send ──────────────────────────────────────────────────────────────
  const handleSend = async () => {
    setError('');
    const text = body.trim();
    if (!text) { setError('Message body is required.'); return; }
    setSending(true);
    setRun(null);
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (res.status === 202) {
        setRun({ runId: data.runId, status: data.status, sid: data.sid, segments: data.segments, history: [{ status: 'request_sent' }, { status: data.status }] });
        pollStatus(data.runId);
      } else {
        setError(data.error || `Send failed (HTTP ${res.status}).`);
        if (data.runId) setRun({ runId: data.runId, status: data.status || 'failed_to_route', segments: data.segments, history: [{ status: 'failed_to_route', detail: data.error }] });
      }
    } catch {
      setError('Network error during send.');
    } finally {
      setSending(false);
    }
  };

  const seg = run?.segments;

  return (
    <div className="app">
      <AppHeader
        modeLabel="DIRECT"
        accessKey={accessKey}
        onAccessKeyChange={setAccessKey}
      />

      <div className="tab-content">
        <div className="card">
          <div className="card-title">Send a message</div>
          <p className="muted" style={{ marginBottom: '0.75rem' }}>
            Recipient: <span className="mono">{masked || '—'}</span>
          </p>

          <textarea
            className="input"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type your message…"
            disabled={sending}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          />

          <div className="meta" style={{ display: 'flex', justifyContent: 'space-between', margin: '0.5rem 0 0.75rem' }}>
            <span>{charCount} chars</span>
            <span className={multiSegment ? 'report-err' : ''}>
              {multiSegment ? 'Over 160 — multi-segment SMS' : 'Single segment'}
            </span>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={sending || !body.trim()}
          >
            {sending ? 'Sending…' : 'Send Message'}
          </button>

          {error && <p className="error-text" style={{ marginTop: '0.75rem' }}>{error}</p>}
        </div>

        {/* ── Status feed ─────────────────────────────────────────────── */}
        {run && (
          <div className="card">
            <div className="card-title">Status</div>
            <p className="meta">
              runId <span className="mono">{run.runId}</span>
              {run.sid && <> · sid <span className="mono">{run.sid}</span></>}
              {seg && <> · {seg.segments} seg ({seg.encoding})</>}
            </p>
            <p>
              <span className={statusTone(run.status)} style={{ fontWeight: 600 }}>
                {STATUS_LABEL[run.status] || run.status}
              </span>
            </p>

            <ul className="mono" style={{ listStyle: 'none', marginTop: '0.5rem' }}>
              {(run.history || []).map((h, i) => (
                <li key={i} className="meta">
                  {h.at ? new Date(h.at).toLocaleTimeString('en-CA', { hour12: false }) : '—'}
                  {'  '}→ {STATUS_LABEL[h.status] || h.status}
                  {h.detail ? `  (${h.detail})` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
