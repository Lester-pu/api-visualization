const API_TYPES = [
  { key: "source", label: "[ CLASS: SOURCE ]", description: "Entry APIs that start a flow." },
  { key: "bridge", label: "[ CLASS: BRIDGE ]", description: "Processing APIs that relay traffic." },
  { key: "sink", label: "[ CLASS: SINK ]", description: "Target APIs called downstream." },
  { key: "isolated", label: "[ CLASS: ISOLATED ]", description: "APIs with no visible links in this dataset." }
];

const INTERACTIONS = [
  { key: "edge", label: "[ SIGNAL: ROUTE ]", description: "Endpoint-to-endpoint dependency path." },
  { key: "selection", label: "[ SIGNAL: TRACE ]", description: "Hazard states show the active trace." },
  { key: "search", label: "[ SIGNAL: SEARCH ]", description: "Focus glow marks current search hits." }
];

export default function GraphLegend({
  zoomPercent,
  onZoomOut,
  onZoomIn,
  onFit,
  onCollapseAll,
  allCollapsed,
  onResetLayout,
  onAutoArrange,
  onToggleFullscreen,
  isCanvasFullscreen,
  disabled
}) {
  return (
    <section className="graph-legend graph-legend-editorial legend-inline-strip" aria-label="Legend">
      <div className="legend-strip-section">
        <span className="legend-title">[ API CLASSES ]</span>
        <div className="legend-strip-items">
          {API_TYPES.map((item) => (
            <span
              key={item.key}
              className={`legend-chip class ${item.key}`}
              title={item.description}
              aria-label={`${item.label}. ${item.description}`}
            >
              <span className={`legend-swatch ${item.key}`} />
              <span className="legend-chip-label">{item.label.replace("[ CLASS: ", "").replace(" ]", "")}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="legend-strip-section">
        <span className="legend-title">[ SIGNAL LANGUAGE ]</span>
        <div className="legend-strip-items">
          {INTERACTIONS.map((item) => (
            <span
              key={item.key}
              className={`legend-chip signal ${item.key}`}
              title={item.description}
              aria-label={`${item.label}. ${item.description}`}
            >
              <span className={`legend-inline-marker ${item.key}`} />
              <span className="legend-chip-label">{item.label.replace("[ SIGNAL: ", "").replace(" ]", "")}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="legend-strip-section">
        <span className="legend-title">[ OPS ]</span>
        <div className="toolbar-actions-cluster toolbar-glass-pill toolbar-utility-pill legend-ops-cluster">
          <button type="button" className="action-button action-secondary compact toolbar-pill" onClick={onCollapseAll} disabled={disabled}>
            {allCollapsed ? "EXPAND" : "COLLAPSE"}
          </button>
          <button type="button" className="action-button action-secondary compact toolbar-icon-button" onClick={onZoomOut} disabled={disabled} aria-label="Zoom out">
            −
          </button>
          <span className="zoom-readout">{zoomPercent}%</span>
          <button type="button" className="action-button action-secondary compact toolbar-icon-button" onClick={onZoomIn} disabled={disabled} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="action-button action-secondary compact toolbar-pill" onClick={onFit} disabled={disabled}>
            FIT
          </button>
          <button type="button" className="action-button action-secondary compact toolbar-pill" onClick={onResetLayout} disabled={disabled}>
            RESET
          </button>
          <button type="button" className="action-button action-secondary compact toolbar-pill" onClick={onAutoArrange} disabled={disabled}>
            AUTO
          </button>
          <button type="button" className="action-button action-secondary compact toolbar-pill" onClick={onToggleFullscreen} disabled={disabled}>
            {isCanvasFullscreen ? "EXIT FULL" : "FULL"}
          </button>
        </div>
      </div>
    </section>
  );
}
