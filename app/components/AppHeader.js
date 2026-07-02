'use client';

export default function AppHeader({
  activeTab,
  navItems = [],
  onTabChange,
  onLogoClick,
  modeLabel = 'LIVE',
  activeDate,
  isSimMode = false,
  textMode,
  onTextModeChange,
  accessKey,
  onAccessKeyChange,
  onSync,
  loading = false,
  actions,
}) {
  const logo = (
    <>
      <img className="brand-logo" src="/ba-logo.png" alt="Bourgon & Associates logo" />
      <span className="brand-copy">Texting / Email Operations Desk</span>
    </>
  );

  return (
    <header className="app-header">
      <div className="app-header-top">
        <div className="brand-block">
          {onLogoClick ? (
            <button type="button" className="brand-link" onClick={onLogoClick} aria-label="Go to Dashboard">
              {logo}
            </button>
          ) : (
            <a className="brand-link" href="/" aria-label="Go to Dashboard">
              {logo}
            </a>
          )}
        </div>

        <div className="header-controls">
          {isSimMode && <span className="sim-badge">Simulation - cron paused</span>}
          {onTextModeChange && (
            <div className="mode-toggle" role="group" aria-label="Text sending mode">
              {['test', 'live'].map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`mode-toggle-btn ${textMode === mode ? 'active' : ''} ${mode === 'live' ? 'live' : 'test'}`}
                  onClick={() => onTextModeChange(mode)}
                  aria-pressed={textMode === mode}
                >
                  {mode === 'live' ? 'Live' : 'Test'}
                </button>
              ))}
            </div>
          )}
          <span className="date-chip">{onTextModeChange ? activeDate || modeLabel : `${modeLabel}${activeDate ? ` ${activeDate}` : ''}`}</span>
          {onAccessKeyChange && (
            <input
              className="input header-key"
              value={accessKey}
              onChange={e => onAccessKeyChange(e.target.value)}
              placeholder="Access key"
              aria-label="Access key"
              autoComplete="off"
            />
          )}
          {onSync && (
            <button className="btn btn-outline btn-sm" onClick={onSync} disabled={loading}>
              {loading ? 'Syncing' : 'Sync'}
            </button>
          )}
          {actions}
        </div>
      </div>

      {navItems.length > 0 && (
        <nav className="tab-nav" aria-label="Main sections">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`tab-btn${activeTab === item.id ? ' active' : ''}`}
              onClick={() => onTabChange(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}
