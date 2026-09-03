export default function Sidebar({
  collapsedPanelCount,
  detailsCollapsed,
  onToggleDetails,
  selectedEndpoint,
  endpointMap,
  relatedState,
  focusedApiId,
  onClearSelection,
  onClearFocus,
  getEndpointLabel
}) {
  return (
    <aside className={`side-panel${collapsedPanelCount === 1 ? " all-collapsed" : ""}`}>
      <section className={`panel details-panel collapsible-panel${detailsCollapsed ? " collapsed" : ""}`}>
        <button type="button" className={`collapse-toggle${detailsCollapsed ? " side-collapsed-toggle" : ""}`} onClick={onToggleDetails}>
          <div>
            <p className="eyebrow">[ ACTIVE TRACE ]</p>
            <h2>{selectedEndpoint ? selectedEndpoint.endpointName : "No endpoint selected"}</h2>
            <p className="details-subtitle">
              {selectedEndpoint ? selectedEndpoint.apiName : "Select an endpoint in the graph to inspect upstream and downstream relationships."}
            </p>
          </div>
          <span>{detailsCollapsed ? "EXPAND" : "COLLAPSE"}</span>
        </button>

        {!detailsCollapsed ? (
          <>
            <div className="details-head inline-details-head">
              {selectedEndpoint ? (
                <button type="button" className="action-button action-secondary compact" onClick={onClearSelection}>
                  CLEAR TRACE
                </button>
              ) : null}
            </div>

            <div className="detail-columns sidebar-bento sidebar-bento-details">
              <article className="detail-card">
                <h3>[ UPSTREAM CALLERS ]</h3>
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
                <h3>[ DOWNSTREAM TARGETS ]</h3>
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
                  [ {relatedState.activeEdgeIds.size} CONNECTED EDGES ] [ {Math.max(relatedState.relatedEndpointIds.size - 1, 0)} RELATED ENDPOINTS ]
                </span>
              </div>
            ) : null}

            {focusedApiId ? (
              <div className="selection-footnote filter-footnote">
                <span>[ FOCUSED VIEW ACTIVE ]</span>
                <button type="button" className="action-button action-secondary compact" onClick={onClearFocus}>
                  SHOW ALL APIS
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </aside>
  );
}
