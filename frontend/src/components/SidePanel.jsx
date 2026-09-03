export default function SidePanel({
  collapsedPanelCount,
  analysisCollapsed,
  detailsCollapsed,
  onToggleAnalysis,
  onToggleDetails,
  graphModel,
  loadedAtLabel,
  selectedEndpoint,
  endpointMap,
  relatedState,
  focusedApiId,
  onClearSelection,
  onClearFocus,
  getEndpointLabel
}) {
  return (
    <aside className={`side-panel${collapsedPanelCount === 2 ? " all-collapsed" : collapsedPanelCount === 1 ? " partially-collapsed" : ""}`}>
      <section className={`panel info-panel collapsible-panel${analysisCollapsed ? " collapsed" : ""}`}>
        <button type="button" className={`collapse-toggle${analysisCollapsed ? " side-collapsed-toggle" : ""}`} onClick={onToggleAnalysis}>
          <div>
            <p className="eyebrow">Analysis</p>
            <h2>Structure overview</h2>
          </div>
          <span>{analysisCollapsed ? "Expand" : "Collapse"}</span>
        </button>

        {!analysisCollapsed ? (
          <>
            <div className="panel-meta-card">
              <span>Source</span>
              <strong>{graphModel.sourceName}</strong>
              <small>Loaded {loadedAtLabel || "just now"}</small>
            </div>
            <ul className="insight-list">
              {graphModel.insights.map((insight) => (
                <li key={insight}>{insight}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className={`panel details-panel collapsible-panel${detailsCollapsed ? " collapsed" : ""}`}>
        <button type="button" className={`collapse-toggle${detailsCollapsed ? " side-collapsed-toggle" : ""}`} onClick={onToggleDetails}>
          <div>
            <p className="eyebrow">Selected Endpoint</p>
            <h2>{selectedEndpoint ? selectedEndpoint.endpointName : "Nothing selected"}</h2>
            <p className="details-subtitle">
              {selectedEndpoint ? selectedEndpoint.apiName : "Select an endpoint in the graph to inspect its direct upstream and downstream relationships."}
            </p>
          </div>
          <span>{detailsCollapsed ? "Expand" : "Collapse"}</span>
        </button>

        {!detailsCollapsed ? (
          <>
            <div className="details-head inline-details-head">
              {selectedEndpoint ? (
                <button type="button" className="action-button action-secondary compact" onClick={onClearSelection}>
                  Clear highlight
                </button>
              ) : null}
            </div>

            <div className="detail-columns">
              <article className="detail-card">
                <h3>Upstream callers</h3>
                {selectedEndpoint ? (
                  relatedState.upstreamEdges.length > 0 ? (
                    <ul className="relation-list">
                      {relatedState.upstreamEdges.map((edge) => {
                        const sourceEndpoint = endpointMap.get(edge.fromId);
                        return (
                          <li key={edge.id}>
                            <strong>{sourceEndpoint.endpointName}</strong>
                            <span>{sourceEndpoint.apiName}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="empty-state">No explicit upstream callers in this workbook.</p>
                  )
                ) : (
                  <p className="empty-state">Select an endpoint to inspect it.</p>
                )}
              </article>

              <article className="detail-card">
                <h3>Downstream targets</h3>
                {selectedEndpoint ? (
                  relatedState.downstreamEdges.length > 0 ? (
                    <ul className="relation-list">
                      {relatedState.downstreamEdges.map((edge) => {
                        const targetEndpoint = endpointMap.get(edge.toId);
                        return (
                          <li key={edge.id}>
                            <strong>{targetEndpoint.endpointName}</strong>
                            <span>{targetEndpoint.apiName}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="empty-state">No explicit downstream targets in this workbook.</p>
                  )
                ) : (
                  <p className="empty-state">Select an endpoint to inspect it.</p>
                )}
              </article>
            </div>

            {selectedEndpoint ? (
              <div className="selection-footnote">
                <span>{getEndpointLabel(selectedEndpoint)}</span>
                <span>
                  {relatedState.activeEdgeIds.size} connected edges · {Math.max(relatedState.relatedEndpointIds.size - 1, 0)} related endpoints
                </span>
              </div>
            ) : null}

            {focusedApiId ? (
              <div className="selection-footnote filter-footnote">
                <span>Focused view is active</span>
                <button type="button" className="action-button action-secondary compact" onClick={onClearFocus}>
                  Show all APIs
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </aside>
  );
}
