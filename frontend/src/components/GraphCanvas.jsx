import { useEffect } from "react";
import { gsap } from "gsap";

export default function GraphCanvas({
  busyLabel,
  stageRef,
  svgRef,
  camera,
  viewWidth,
  viewHeight,
  graphBounds,
  layout,
  graphModel,
  endpointMap,
  relatedState,
  selectedEndpointId,
  collapsedApiIds,
  focusedApiId,
  visibleSearchMatchIds,
  activeSearchApi,
  hoveredApiId,
  setHoveredApiId,
  hoveredEndpointId,
  setHoveredEndpointId,
  hoveredEdgeId,
  setHoveredEdgeId,
  searchPulseApiId,
  copiedToken,
  onPanStart,
  onDragStart,
  onToggleApiCollapsed,
  onToggleApiFocus,
  onStopTextInteraction,
  onCopyText,
  onSelectEndpoint,
  onWheel,
  onStageClick,
  createEdgePath,
  isDragging,
  getBlockTextStartY,
  uiMetrics
}) {
  const {
    CONTROL_LANE_RIGHT_INSET,
    HANDLE_CONTROL_CLUSTER_WIDTH,
    HEADER_TOP_PADDING,
    TITLE_LANE_TOP_OFFSET,
    TITLE_LANE_BOTTOM_PADDING,
    API_NAME_LINE_HEIGHT,
    API_NAME_BASELINE_OFFSET,
    API_META_GAP,
    API_META_LINE_HEIGHT,
    API_META_BASELINE_OFFSET,
    HANDLE_CONTROL_WIDTH,
    HANDLE_CONTROL_HEIGHT,
    HANDLE_ICON_CONTROL_WIDTH,
    ENDPOINT_LINE_HEIGHT,
    ENDPOINT_BASELINE_OFFSET,
    ENDPOINT_TEXT_LEFT_PADDING,
    ENDPOINT_TEXT_RIGHT_PADDING,
    ENDPOINT_TEXT_CLIP_VERTICAL_PADDING
  } = uiMetrics;

  const apiAnimationKey = graphModel.apis.map((api) => api.id).join("|");
  const edgeAnimationKey = graphModel.edges.map((edge) => edge.id).join("|");
  const collapsedAnimationKey = Array.from(collapsedApiIds).sort().join("|");

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const context = gsap.context(() => {
      const apiGroups = gsap.utils.toArray("[data-api-card]");
      const endpointGroups = gsap.utils.toArray("[data-endpoint-group]");
      const edgePaths = gsap.utils.toArray("[data-edge-path]");

      gsap.killTweensOf([...apiGroups, ...endpointGroups, ...edgePaths]);

      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });

      timeline
        .fromTo(
          apiGroups,
          { autoAlpha: 0, y: 28, scale: 0.975, transformOrigin: "50% 50%" },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.72, stagger: 0.035 },
          0.04
        )
        .fromTo(
          endpointGroups,
          { autoAlpha: 0, x: -10 },
          { autoAlpha: 1, x: 0, duration: 0.42, stagger: 0.01 },
          0.16
        );

      edgePaths.forEach((path, index) => {
        const d = typeof path.getAttribute === "function" ? path.getAttribute("d") : "";
        if (!d || !String(d).trim()) return;
        let length = 0;
        try {
          length = typeof path.getTotalLength === "function" ? path.getTotalLength() : 0;
        } catch (_error) {
          length = 0;
        }
        if (!length) return;
        gsap.fromTo(
          path,
          { strokeDasharray: length, strokeDashoffset: length, opacity: 0.18 },
          {
            strokeDashoffset: 0,
            opacity: 1,
            duration: 0.86,
            delay: 0.14 + index * 0.012,
            ease: "power2.out",
            clearProps: "strokeDasharray,strokeDashoffset"
          }
        );
      });
    }, stage);

    return () => context.revert();
  }, [activeSearchApi?.id, apiAnimationKey, collapsedAnimationKey, edgeAnimationKey, focusedApiId, stageRef]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const context = gsap.context(() => {
      const emphasisTargets = gsap.utils.toArray(".api-card-group.focused, .api-card-group.current-match, .endpoint-group.selected");
      if (emphasisTargets.length === 0) return;
      gsap.fromTo(
        emphasisTargets,
        { scale: 0.985, transformOrigin: "50% 50%" },
        { scale: 1.018, duration: 0.34, repeat: 1, yoyo: true, ease: "power2.inOut", stagger: 0.04 }
      );
    }, stage);

    return () => context.revert();
  }, [activeSearchApi?.id, focusedApiId, selectedEndpointId, stageRef]);

  return (
    <div
      ref={stageRef}
      className="graph-stage"
      onWheel={onWheel}
      onClick={onStageClick}
    >
      <div className="graph-stage-noise" />
      <div className="graph-stage-vignette" />

      {busyLabel ? (
        <div className="graph-loading-overlay">
          <div className="graph-loading-card">
            <span className="graph-spinner" />
            <strong>{busyLabel}</strong>
            <p>Please wait while the topology re-renders.</p>
          </div>
        </div>
      ) : null}

      <svg ref={svgRef} viewBox={`${camera.x} ${camera.y} ${viewWidth} ${viewHeight}`} className="graph-svg" role="img" aria-label="API endpoint dependency graph">
        <defs>
          <marker id="edge-arrow" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto">
            <path d="M 0 0 L 12 6 L 0 12 z" className="arrow-marker" />
          </marker>
          <pattern id="grid-pattern" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" className="grid-line" fill="none" />
          </pattern>
        </defs>

        <rect x={camera.x - viewWidth * 1.5} y={camera.y - viewHeight * 1.5} width={viewWidth * 4} height={viewHeight * 4} className="canvas-hit-area" fill="url(#grid-pattern)" onPointerDown={onPanStart} />
        <rect x={graphBounds.minX - 8000} y={graphBounds.minY - 8000} width={graphBounds.maxX - graphBounds.minX + 16000} height={graphBounds.maxY - graphBounds.minY + 16000} className="canvas-backdrop" />

        {graphModel.apis.map((api) => {
          const apiLayout = layout.apiLayoutMap.get(api.id);
          const related = relatedState.relatedApiIds.has(api.id);
          const dimmed = selectedEndpointId && !related;
          const collapsed = collapsedApiIds.has(api.id);
          const focused = focusedApiId === api.id;
          const matched = visibleSearchMatchIds.has(api.id);
          const searchCurrent = activeSearchApi?.id === api.id;
          const hoveringApi = hoveredApiId === api.id;
          const titleCenterX = apiLayout.x + apiLayout.width / 2;
          const controlX = apiLayout.x + apiLayout.width - CONTROL_LANE_RIGHT_INSET - HANDLE_CONTROL_CLUSTER_WIDTH;
          const titleLaneY = apiLayout.y + HEADER_TOP_PADDING + TITLE_LANE_TOP_OFFSET;
          const titleLaneHeight = Math.max(apiLayout.handleHeight - TITLE_LANE_TOP_OFFSET - TITLE_LANE_BOTTOM_PADDING, API_NAME_LINE_HEIGHT);

          return (
            <g
              key={api.id}
              data-api-card={api.id}
              className={`api-card-group${related ? " active" : ""}${dimmed ? " dimmed" : ""}${hoveringApi ? " hovered" : ""}${matched ? " matched" : ""}${searchCurrent ? " current-match" : ""}${searchPulseApiId === api.id ? " search-pulse" : ""}${focused ? " focused" : ""}`}
              onPointerEnter={() => setHoveredApiId(api.id)}
              onPointerLeave={() => setHoveredApiId((currentId) => (currentId === api.id ? null : currentId))}
            >
              {matched ? <rect x={apiLayout.x - 10} y={apiLayout.y - 10} width={apiLayout.width + 20} height={apiLayout.height + 20} className={`api-search-halo${searchCurrent ? " current" : ""}`} /> : null}
              <rect x={apiLayout.x} y={apiLayout.y} width={apiLayout.width} height={apiLayout.height} className={`api-card api-${api.kind}`} />
              <rect x={apiLayout.x + 8} y={apiLayout.y + 8} width={apiLayout.width - 16} height={apiLayout.handleHeight} className={`drag-handle handle-${api.kind}`} onPointerDown={(event) => onDragStart(event, api, apiLayout)} />

              <g className="api-toggle-control-group" transform={`translate(${controlX + HANDLE_ICON_CONTROL_WIDTH + 4} ${apiLayout.y + 14})`} onClick={(event) => { event.stopPropagation(); onToggleApiFocus(api.id); }}>
                <rect x="0" y="0" width={HANDLE_CONTROL_WIDTH} height={HANDLE_CONTROL_HEIGHT} className={`api-switch-track${focused ? " active" : ""}`} />
                <circle cx={focused ? 20 : 8} cy="9" r="6" className={`api-switch-thumb${focused ? " active" : ""}`} />
              </g>

              <g className="api-toggle-icon-group" transform={`translate(${controlX} ${apiLayout.y + 14})`} onClick={(event) => { event.stopPropagation(); onToggleApiCollapsed(api.id); }}>
                <rect x="0" y="0" width={HANDLE_ICON_CONTROL_WIDTH} height={HANDLE_CONTROL_HEIGHT} className={`api-icon-button${collapsed ? " active" : ""}`} />
                <text x={HANDLE_ICON_CONTROL_WIDTH / 2} y="10" className="api-icon-glyph" textAnchor="middle">{collapsed ? "+" : "−"}</text>
              </g>

              <text x={titleCenterX} y={getBlockTextStartY(titleLaneY, titleLaneHeight, apiLayout.apiNameLines.length, API_NAME_LINE_HEIGHT, API_NAME_BASELINE_OFFSET)} className={`api-name-label api-name-${api.kind}`} textAnchor="middle" onPointerDown={onStopTextInteraction} onClick={(event) => onCopyText(event, api.name, "API 名称", `api:${api.id}`)}>
                {apiLayout.apiNameLines.map((line, index) => <tspan key={`${api.id}-title-${index}`} x={titleCenterX} dy={index === 0 ? 0 : API_NAME_LINE_HEIGHT}>{line}</tspan>)}
              </text>

              {copiedToken === `api:${api.id}` ? <text x={apiLayout.x + apiLayout.width - CONTROL_LANE_RIGHT_INSET - 4} y={apiLayout.y + 30} className="copied-badge" textAnchor="end">Copied</text> : null}

              {apiLayout.businessGroupLines.length > 0 ? (
                <text x={titleCenterX} y={getBlockTextStartY(apiLayout.y + HEADER_TOP_PADDING + apiLayout.handleHeight + API_META_GAP, apiLayout.businessGroupHeight, apiLayout.businessGroupLines.length, API_META_LINE_HEIGHT, API_META_BASELINE_OFFSET)} className={`api-business-group-label${api.businessGroupSources?.[0] ? ` bg-source-${api.businessGroupSources[0].toLowerCase()}` : ""}`} textAnchor="middle" onPointerDown={onStopTextInteraction} onClick={(event) => onCopyText(event, api.businessGroups.join(" / "), "业务组", `bg:${api.id}`)}>
                  {apiLayout.businessGroupLines.map((line, index) => <tspan key={`${api.id}-bg-${index}`} x={titleCenterX} dy={index === 0 ? 0 : API_META_LINE_HEIGHT}>{line}</tspan>)}
                </text>
              ) : null}

              {copiedToken === `bg:${api.id}` ? <text x={apiLayout.x + apiLayout.width - CONTROL_LANE_RIGHT_INSET - 4} y={apiLayout.y + apiLayout.handleHeight + 26} className="copied-badge" textAnchor="end">Copied</text> : null}

              {!collapsed ? api.endpointIds.map((endpointId) => {
                const endpoint = endpointMap.get(endpointId);
                const endpointLayout = layout.endpointLayoutMap.get(endpointId);
                if (!endpoint || !endpointLayout) return null;

                const active = relatedState.relatedEndpointIds.has(endpoint.id);
                const selected = selectedEndpointId === endpoint.id;
                const endpointDimmed = selectedEndpointId && !active;
                const hovered = hoveredEndpointId === endpoint.id;

                return (
                  <g
                    key={endpoint.id}
                    data-endpoint-group={endpoint.id}
                    className={`endpoint-group${selected ? " selected" : ""}${active ? " active" : ""}${endpointDimmed ? " dimmed" : ""}${hovered ? " hovered" : ""}`}
                    onPointerEnter={() => setHoveredEndpointId(endpoint.id)}
                    onPointerLeave={() => setHoveredEndpointId((currentId) => (currentId === endpoint.id ? null : currentId))}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectEndpoint(endpoint.id);
                    }}
                  >
                    <rect x={endpointLayout.x} y={endpointLayout.y} width={endpointLayout.width} height={endpointLayout.height} className="endpoint-card" />
                    <clipPath id={`endpoint-clip-${endpoint.id}`}>
                      <rect x={endpointLayout.x + ENDPOINT_TEXT_LEFT_PADDING - 2} y={endpointLayout.y + ENDPOINT_TEXT_CLIP_VERTICAL_PADDING} width={Math.max(endpointLayout.width - ENDPOINT_TEXT_LEFT_PADDING - ENDPOINT_TEXT_RIGHT_PADDING + 4, 0)} height={Math.max(endpointLayout.height - ENDPOINT_TEXT_CLIP_VERTICAL_PADDING * 2, 0)} />
                    </clipPath>
                    <text x={endpointLayout.x + ENDPOINT_TEXT_LEFT_PADDING} y={getBlockTextStartY(endpointLayout.y, endpointLayout.height, endpointLayout.labelLines.length, ENDPOINT_LINE_HEIGHT, ENDPOINT_BASELINE_OFFSET)} className="endpoint-label" clipPath={`url(#endpoint-clip-${endpoint.id})`} onPointerDown={onStopTextInteraction} onClick={(event) => onCopyText(event, endpoint.endpointName, "Endpoint 名称", `endpoint:${endpoint.id}`)}>
                      {endpointLayout.labelLines.map((line, index) => <tspan key={`${endpoint.id}-line-${index}`} x={endpointLayout.x + ENDPOINT_TEXT_LEFT_PADDING} dy={index === 0 ? 0 : ENDPOINT_LINE_HEIGHT}>{line}</tspan>)}
                    </text>
                    {copiedToken === `endpoint:${endpoint.id}` ? <text x={endpointLayout.x + endpointLayout.width - 12} y={endpointLayout.y + 16} className="copied-badge" textAnchor="end">Copied</text> : null}
                  </g>
                );
              }) : null}
            </g>
          );
        })}

        <g className="edge-layer edge-layer-top">
          {graphModel.edges.map((edge) => {
            const fromNode = layout.endpointLayoutMap.get(edge.fromId);
            const toNode = layout.endpointLayoutMap.get(edge.toId);
            if (!fromNode || !toNode) return null;
            const active = relatedState.activeEdgeIds.has(edge.id);
            const dimmed = selectedEndpointId && !active;
            const hovered = hoveredEdgeId === edge.id || hoveredEndpointId === edge.fromId || hoveredEndpointId === edge.toId;

            return (
              <path
                key={edge.id}
                d={createEdgePath(fromNode, toNode, layout.apiLayoutMap, isDragging)}
                data-edge-path={edge.id}
                className={`edge-path${active ? " active" : ""}${dimmed ? " dimmed" : ""}${hovered ? " hovered" : ""}`}
                markerEnd="url(#edge-arrow)"
                fill="none"
                style={isDragging ? { strokeDasharray: "none", strokeDashoffset: 0 } : {}}
                onPointerEnter={() => setHoveredEdgeId(edge.id)}
                onPointerLeave={() => setHoveredEdgeId((currentId) => (currentId === edge.id ? null : currentId))}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
