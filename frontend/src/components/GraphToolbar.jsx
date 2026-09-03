export default function GraphToolbar({
  query,
  onQueryChange,
  onSubmit,
  onPreviousMatch,
  onNextMatch,
  matchCount,
  activeMatchIndex,
  disabled
}) {
  const hasQuery = query.trim().length > 0;
  const hasMatches = matchCount > 0;

  return (
    <div className="graph-toolbar-shell graph-toolbar-floating-shell">
      <div className="toolbar-search-cluster toolbar-glass-pill toolbar-search-pill">
        <span className="search-field-label search-field-inline-label">[ SEARCH VECTOR ]</span>
        <label className="search-field search-field-inline">
          <input
            type="search"
            className="api-search-input"
            placeholder="FIND API BY NAME"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmit();
            }}
            disabled={disabled}
          />
        </label>

        <div className="search-actions">
          <button type="button" className="action-button action-primary compact toolbar-pill" onClick={onSubmit} disabled={disabled}>
            LOCATE
          </button>
          <button type="button" className="action-button action-secondary compact toolbar-icon-button" onClick={onPreviousMatch} disabled={disabled || !hasMatches} aria-label="Previous match">
            ←
          </button>
          <button type="button" className="action-button action-secondary compact toolbar-icon-button" onClick={onNextMatch} disabled={disabled || !hasMatches} aria-label="Next match">
            →
          </button>
        </div>

        <span className="search-meta" aria-live="polite">
          {hasQuery ? (hasMatches ? `[ MATCH ${activeMatchIndex + 1} / ${matchCount} ]` : "[ NO MATCHES ]") : "[ TYPE NAME TO SNAP TO API ]"}
        </span>
      </div>
    </div>
  );
}
