'use client';

import { useState, useEffect, useCallback } from 'react';
import { OUTLINE_TEMPLATE } from '@/lib/handoff-template';
import AppHeader from '../components/AppHeader';

export default function ScriptsManager() {
  const [accessKey, setAccessKey] = useState('Alex'); // in memory only
  const [scripts, setScripts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const authHeaders = useCallback(
    (extra = {}) => ({ 'x-access-key': accessKey, ...extra }),
    [accessKey]
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/scripts', { headers: authHeaders() });
      if (res.ok) setScripts((await res.json()).scripts || []);
      else setStatus(`Load failed: HTTP ${res.status}`);
    } catch { setStatus('Network error loading scripts.'); }
  }, [authHeaders]);

  useEffect(() => { load(); }, [load]);

  const newScript = () => {
    setSelectedId(null);
    setName('');
    setSource(OUTLINE_TEMPLATE);
    setStatus('New script — fill in name and source, then Save.');
  };

  const select = (s) => {
    setSelectedId(s.id);
    setName(s.name);
    setSource(s.source);
    setStatus('');
  };

  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      const isNew = !selectedId;
      const res = await fetch(isNew ? '/api/scripts' : `/api/scripts/${selectedId}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name, source }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus(isNew ? 'Created.' : 'Saved.');
        setSelectedId(data.script.id);
        await load();
      } else {
        setStatus(`Error: ${data.error || res.status}`);
      }
    } catch { setStatus('Network error saving.'); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this script?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/scripts/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) {
        if (selectedId === id) { setSelectedId(null); setName(''); setSource(''); }
        await load();
        setStatus('Deleted.');
      } else {
        setStatus(`Delete failed: HTTP ${res.status}`);
      }
    } catch { setStatus('Network error deleting.'); }
    finally { setBusy(false); }
  };

  const copyOutline = async () => {
    try {
      await navigator.clipboard.writeText(OUTLINE_TEMPLATE);
      setStatus('Handoff outline copied to clipboard.');
    } catch {
      setStatus('Clipboard blocked — select the source box and copy manually.');
    }
  };

  return (
    <div className="app">
      <AppHeader
        modeLabel="AUTOMATIONS"
        accessKey={accessKey}
        onAccessKeyChange={setAccessKey}
        actions={<button className="btn btn-outline btn-sm" onClick={copyOutline}>Copy Outline</button>}
      />

      <div className="tab-content dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '1rem' }}>
        {/* List */}
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Scripts ({scripts.length})</span>
            <button className="btn btn-primary btn-sm" onClick={newScript}>+ New</button>
          </div>
          {scripts.length === 0 && <p className="empty-state muted">No scripts yet.</p>}
          <ul style={{ listStyle: 'none' }}>
            {scripts.map((s) => (
              <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid var(--gray-200)' }}>
                <button
                  className={`btn btn-sm ${selectedId === s.id ? 'btn-primary' : 'btn-outline'}`}
                  style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => select(s)}
                  title={`Updated ${s.updatedAt}`}
                >
                  {s.name}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(s.id)} aria-label={`Delete ${s.name}`}>✕</button>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor */}
        <div className="card">
          <div className="card-title">{selectedId ? 'Edit script' : 'New script'}</div>
          <label className="field-label">Name</label>
          <input
            className="input"
            style={{ width: '100%', marginBottom: '0.75rem' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. format-reminder"
          />
          <label className="field-label">Source — implements run(input, helpers)</label>
          <textarea
            className="input mono"
            rows={18}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button className="btn btn-primary" onClick={save} disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : (selectedId ? 'Save' : 'Create')}
            </button>
            <button className="btn btn-outline" onClick={copyOutline}>Copy Outline</button>
          </div>
          {status && <p className="meta" style={{ marginTop: '0.75rem' }}>{status}</p>}
        </div>
      </div>
    </div>
  );
}
