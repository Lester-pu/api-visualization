import { startTransition, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import "./App.css";
import { deriveGraphInsights, fallbackGraphModel, normalizeGraphModel, parseWorkbookArrayBuffer } from "./apiGraphData";
import GraphCanvas from "./components/GraphCanvas";
import GraphLegend from "./components/GraphLegend";
import GraphToolbar from "./components/GraphToolbar";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 820;
const CARD_MIN_WIDTH = 276;
const CARD_MAX_WIDTH = 640;
const CARD_PADDING = 22;
const CARD_BOTTOM_PADDING = 20;
const HEADER_TOP_PADDING = 10;
const HEADER_BOTTOM_PADDING = 18;
const API_NAME_FONT_SCALE = 1.18;
const API_NAME_LINE_HEIGHT = 20;
const API_NAME_BASELINE_OFFSET = 16;
const API_META_FONT_SCALE = 0.8;
const API_META_LINE_HEIGHT = 14;
const API_META_BASELINE_OFFSET = 11;
const API_META_GAP = 8;
const HANDLE_HORIZONTAL_PADDING = 18;
const HANDLE_VERTICAL_PADDING = 11;
const HANDLE_MIN_HEIGHT = 86;
const ENDPOINT_MIN_HEIGHT = 42;
const ENDPOINT_FONT_SCALE = 0.88;
const ENDPOINT_VERTICAL_PADDING = 12;
const ENDPOINT_LINE_HEIGHT = 16;
const ENDPOINT_BASELINE_OFFSET = 12;
const ENDPOINT_GAP = 14;
const ENDPOINT_TEXT_LEFT_PADDING = 22;
const ENDPOINT_TEXT_RIGHT_PADDING = 24;
const ENDPOINT_TEXT_CLIP_VERTICAL_PADDING = 4;
const EDGE_DOCK_OFFSET = 18;
const EDGE_ROUTE_PADDING = 28;
const EDGE_ROUTE_EPSILON = 1.5;
const EDGE_ROUTE_LANE_GAP = 52;
const EDGE_CORNER_RADIUS = 16;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.4;
const INITIAL_CAMERA = { x: -120, y: -80, zoom: 1 };
const COLUMN_START_X = 80;
const COLUMN_HORIZONTAL_GAP = 180;
const SEARCH_ZOOM = 0.94;
const HANDLE_CONTROL_WIDTH = 28;
const HANDLE_CONTROL_HEIGHT = 18;
const HANDLE_ICON_CONTROL_WIDTH = 24;
const HANDLE_CONTROL_CLUSTER_WIDTH = HANDLE_ICON_CONTROL_WIDTH + 4 + HANDLE_CONTROL_WIDTH;
const EXPORT_PADDING = 96;
const HANDLE_DRAG_DOT_SPACE = 52;
const HANDLE_RIGHT_CONTROL_SPACE = 86;
const API_CARD_GAP = 60;
const API_CLUSTER_GAP = 108;
const CONTROL_LANE_TOP = 14;
const CONTROL_LANE_RIGHT_INSET = 18;
const TITLE_LANE_TOP_OFFSET = CONTROL_LANE_TOP + HANDLE_CONTROL_HEIGHT + 12;
const TITLE_LANE_BOTTOM_PADDING = 14;
const AUTO_ARRANGE_ANIMATION_MS = 460;

gsap.registerPlugin(useGSAP);

const UI_METRICS = {
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
};

function getEndpointLabel(node) {
  return `${node.apiName} / ${node.endpointName}`;
}

function getBusinessGroupLabel(api) {
  const tags = [`[ CLASS: ${String(api.kind ?? "unknown").toUpperCase()} ]`];
  if (api.businessGroups && api.businessGroups.length > 0) {
    tags.push(`[ BG: ${api.businessGroups.join(" / ").toUpperCase()} ]`);
  }
  return tags.join(" ");
}

function getBusinessGroupSource(api) {
  const source = Array.isArray(api?.businessGroupSources) ? api.businessGroupSources[0] : "";
  return String(source || "").trim().toLowerCase();
}

function getArchitectureLayer(apiName) {
  const rawName = String(apiName ?? "").trim().toLowerCase();
  const compactName = rawName.replace(/[^a-z0-9]+/g, "");
  if (/(^|[^a-z0-9])eapi([^a-z0-9]|$)/.test(rawName) || compactName.includes("eapi")) return "source";
  if (/(^|[^a-z0-9])papi([^a-z0-9]|$)/.test(rawName) || compactName.includes("papi")) return "bridge";
  if (/(^|[^a-z0-9])sapi([^a-z0-9]|$)/.test(rawName) || compactName.includes("sapi")) return "sink";
  if (/(^|[^a-z0-9])xapi([^a-z0-9]|$)/.test(rawName) || compactName.includes("xapi")) return "sink";
  return null;
}

function normalizeApiToken(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function filterGraphModelToCurrentApis(graphModel) {
  const currentApiTokenSet = new Set(
    (graphModel.rows ?? [])
      .map((row) => normalizeApiToken(row?.currentApi))
      .filter(Boolean)
  );
  if (currentApiTokenSet.size === 0) return graphModel;

  const apis = graphModel.apis.filter((api) => currentApiTokenSet.has(normalizeApiToken(api.name)));
  if (apis.length === 0) return graphModel;

  const retainedApiIdSet = new Set(apis.map((api) => api.id));
  const endpoints = graphModel.endpoints.filter((endpoint) => (
    retainedApiIdSet.has(endpoint.apiId)
    || currentApiTokenSet.has(normalizeApiToken(endpoint.apiName))
  ));
  const endpointIds = new Set(endpoints.map((endpoint) => endpoint.id));
  const endpointById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const edges = graphModel.edges.filter((edge) => {
    const fromEndpoint = endpointById.get(edge.fromId);
    const toEndpoint = endpointById.get(edge.toId);
    if (!fromEndpoint || !toEndpoint) return false;
    const fromIsCurrent = currentApiTokenSet.has(normalizeApiToken(fromEndpoint.apiName));
    const toIsCurrent = currentApiTokenSet.has(normalizeApiToken(toEndpoint.apiName));
    return fromIsCurrent && toIsCurrent && endpointIds.has(edge.fromId) && endpointIds.has(edge.toId);
  });
  const rowIdSet = new Set(edges.flatMap((edge) => edge.rowIds).map((rowId) => String(rowId)));
  const rows = graphModel.rows.filter((row) => rowIdSet.has(String(row.id)));
  const endpointIdsByApiId = new Map();
  endpoints.forEach((endpoint) => {
    if (!endpointIdsByApiId.has(endpoint.apiId)) endpointIdsByApiId.set(endpoint.apiId, []);
    endpointIdsByApiId.get(endpoint.apiId).push(endpoint.id);
  });

  const apiStats = new Map(apis.map((api) => [api.id, { incoming: 0, outgoing: 0 }]));
  edges.forEach((edge) => {
    const fromApiId = endpointById.get(edge.fromId)?.apiId;
    const toApiId = endpointById.get(edge.toId)?.apiId;
    if (fromApiId && apiStats.has(fromApiId)) apiStats.get(fromApiId).outgoing += 1;
    if (toApiId && apiStats.has(toApiId)) apiStats.get(toApiId).incoming += 1;
  });

  const filteredApis = apis
    .map((api) => ({
      ...api,
      kind: getArchitectureLayer(api.name) ?? api.kind,
      endpointIds: (endpointIdsByApiId.get(api.id) ?? []).filter((endpointId) => endpointIds.has(endpointId)),
      incoming: apiStats.get(api.id)?.incoming ?? 0,
      outgoing: apiStats.get(api.id)?.outgoing ?? 0
    }))
    .filter((api) => api.endpointIds.length > 0 || (apiStats.get(api.id)?.incoming ?? 0) > 0 || (apiStats.get(api.id)?.outgoing ?? 0) > 0);

  if (edges.length === 0 || filteredApis.length === 0 || endpoints.length === 0) {
    return graphModel;
  }

  const nextGraph = { rows, apis: filteredApis, endpoints, edges };
  return {
    ...graphModel,
    ...nextGraph,
    insights: deriveGraphInsights(nextGraph),
    summary: {
      apiCount: filteredApis.length,
      endpointCount: endpoints.length,
      edgeCount: edges.length,
      rowCount: rowIdSet.size
    }
  };
}

function formatGraphSummary(summary) {
  return `${summary.apiCount} API / ${summary.endpointCount} 接口 / ${summary.edgeCount} 连线`;
}

function formatLoadedTime(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function getCharacterWidthUnits(character) {
  if (/\s/.test(character)) return 0.34;
  if (/[\u3400-\u9fff]/.test(character)) return 1.08;
  if (/[A-Z]/.test(character)) return 0.8;
  if (/[a-z]/.test(character)) return 0.68;
  if (/[0-9]/.test(character)) return 0.7;
  if (/[{}()[\]<>]/.test(character)) return 0.56;
  if (/[\/]/.test(character)) return 0.58;
  if (/[_\-.:,;=]/.test(character)) return 0.5;
  return 0.72;
}

function measureTextUnits(text) {
  return Array.from(String(text ?? "")).reduce((sum, character) => sum + getCharacterWidthUnits(character), 0);
}

function measureTextWidth(text, fontScale = 1) {
  return measureTextUnits(text) * 10.2 * fontScale;
}

function getLineCapacity(maxWidth) {
  return Math.max(8, maxWidth / 11.8);
}

function getBlockTextStartY(boxY, boxHeight, lineCount, lineHeight, baselineOffset) {
  const safeLineCount = Math.max(lineCount, 1);
  const textBlockHeight = baselineOffset + (safeLineCount - 1) * lineHeight;
  return boxY + Math.max((boxHeight - textBlockHeight) / 2, 0) + baselineOffset;
}

function wrapTextToLines(text, maxUnits) {
  const normalizedText = String(text ?? "").trim();
  if (!normalizedText) return [""];
  const tokens = [];
  let currentToken = "";

  function pushToken() {
    if (!currentToken) return;
    tokens.push(currentToken);
    currentToken = "";
  }

  const suffixBreakCharacters = new Set(["/", "_", "-", ".", ":", ",", ";", "=", ")", "]", "}", ">"]);
  const prefixBreakCharacters = new Set(["(", "[", "{", "<"]);

  Array.from(normalizedText).forEach((character, index, characters) => {
    const previousCharacter = characters[index - 1] ?? "";
    const camelBoundary = /[a-z0-9]/.test(previousCharacter) && /[A-Z]/.test(character);

    if (camelBoundary) pushToken();

    if (/\s/.test(character)) {
      currentToken += character;
      pushToken();
      return;
    }

    if (prefixBreakCharacters.has(character)) pushToken();

    currentToken += character;

    if (suffixBreakCharacters.has(character)) {
      pushToken();
    }
  });

  pushToken();
  const lines = [];
  let currentLine = "";

  function pushCurrentLine() {
    const nextLine = currentLine.trimEnd();
    if (nextLine) lines.push(nextLine);
    currentLine = "";
  }

  function pushLongToken(token) {
    let remainder = currentLine ? token : token.replace(/^\s+/, "");
    while (remainder) {
      let slice = "";
      for (const character of Array.from(remainder)) {
        const nextSlice = slice + character;
        if (measureTextUnits(nextSlice) > maxUnits && slice) break;
        slice = nextSlice;
      }
      lines.push(slice.trimEnd());
      remainder = remainder.slice(slice.length).trimStart();
    }
  }

  tokens.forEach((token) => {
    const nextToken = currentLine ? token : token.replace(/^\s+/, "");
    if (!nextToken) return;
    const candidate = `${currentLine}${nextToken}`;
    if (measureTextUnits(candidate) <= maxUnits) {
      currentLine = candidate;
      return;
    }
    if (currentLine.trim()) pushCurrentLine();
    const lineToken = nextToken.replace(/^\s+/, "");
    if (!lineToken) return;
    if (measureTextUnits(lineToken) <= maxUnits) {
      currentLine = lineToken;
      return;
    }
    pushLongToken(lineToken);
  });

  if (currentLine.trim()) pushCurrentLine();
  return lines.length > 0 ? lines : [normalizedText];
}

function clampCardWidth(width) {
  return Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, Math.ceil(width)));
}

function rectsOverlap(leftRect, rightRect, gap = 12) {
  return (
    leftRect.x < rightRect.x + rightRect.width + gap &&
    leftRect.x + leftRect.width + gap > rightRect.x &&
    leftRect.y < rightRect.y + rightRect.height + gap &&
    leftRect.y + leftRect.height + gap > rightRect.y
  );
}

function findNonOverlappingY(desiredY, height, placedLayouts, gap = API_CARD_GAP) {
  let nextY = Math.max(92, desiredY);
  const sortedLayouts = [...placedLayouts].sort((left, right) => left.y - right.y);
  let changed = true;
  while (changed) {
    changed = false;
    for (const placedLayout of sortedLayouts) {
      if (nextY < placedLayout.y + placedLayout.height + gap && nextY + height + gap > placedLayout.y) {
        nextY = placedLayout.y + placedLayout.height + gap;
        changed = true;
      }
    }
  }
  return nextY;
}

function clampApiY(y) {
  return Math.max(92, y);
}

function findNearestNonOverlappingPosition(desiredPosition, size, otherLayouts, gap = API_CARD_GAP) {
  const normalizedDesired = { x: Math.round(desiredPosition.x), y: Math.round(clampApiY(desiredPosition.y)) };
  const desiredRect = { x: normalizedDesired.x, y: normalizedDesired.y, width: size.width, height: size.height };

  if (otherLayouts.every((layout) => !rectsOverlap(desiredRect, layout, gap))) return normalizedDesired;

  const xCandidates = new Set([normalizedDesired.x]);
  const yCandidates = new Set([normalizedDesired.y]);

  otherLayouts.forEach((layout) => {
    xCandidates.add(Math.round(layout.x + layout.width + gap));
    xCandidates.add(Math.round(layout.x - size.width - gap));
    xCandidates.add(Math.round(layout.x));
    xCandidates.add(Math.round(layout.x + layout.width - size.width));
    yCandidates.add(Math.round(clampApiY(layout.y + layout.height + gap)));
    yCandidates.add(Math.round(clampApiY(layout.y - size.height - gap)));
    yCandidates.add(Math.round(clampApiY(layout.y)));
    yCandidates.add(Math.round(clampApiY(layout.y + layout.height - size.height)));
  });

  let bestPosition = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  Array.from(xCandidates).forEach((x) => {
    Array.from(yCandidates).forEach((y) => {
      const candidateRect = { x, y, width: size.width, height: size.height };
      if (otherLayouts.some((layout) => rectsOverlap(candidateRect, layout, gap))) return;
      const distance = Math.hypot(x - normalizedDesired.x, y - normalizedDesired.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = { x, y };
      }
    });
  });

  if (bestPosition) return bestPosition;

  for (let ring = 1; ring <= 8; ring += 1) {
    const offset = ring * gap;
    const ringCandidates = [
      { x: normalizedDesired.x + offset, y: normalizedDesired.y },
      { x: normalizedDesired.x - offset, y: normalizedDesired.y },
      { x: normalizedDesired.x, y: clampApiY(normalizedDesired.y + offset) },
      { x: normalizedDesired.x, y: clampApiY(normalizedDesired.y - offset) },
      { x: normalizedDesired.x + offset, y: clampApiY(normalizedDesired.y + offset) },
      { x: normalizedDesired.x + offset, y: clampApiY(normalizedDesired.y - offset) },
      { x: normalizedDesired.x - offset, y: clampApiY(normalizedDesired.y + offset) },
      { x: normalizedDesired.x - offset, y: clampApiY(normalizedDesired.y - offset) }
    ];
    for (const candidate of ringCandidates) {
      const candidateRect = { x: candidate.x, y: candidate.y, width: size.width, height: size.height };
      if (otherLayouts.some((layout) => rectsOverlap(candidateRect, layout, gap))) continue;
      return candidate;
    }
  }

  return normalizedDesired;
}

function createApiConnectionMap(data) {
  const endpointToApiId = new Map(data.endpoints.map((endpoint) => [endpoint.id, endpoint.apiId]));
  const apiConnections = new Map(data.apis.map((api) => [api.id, new Set()]));

  data.edges.forEach((edge) => {
    const fromApiId = endpointToApiId.get(edge.fromId);
    const toApiId = endpointToApiId.get(edge.toId);

    if (!fromApiId || !toApiId || fromApiId === toApiId) {
      return;
    }

    apiConnections.get(fromApiId)?.add(toApiId);
    apiConnections.get(toApiId)?.add(fromApiId);
  });

  return apiConnections;
}

function getConnectedApiClusters(data, apiConnections) {
  const visited = new Set();
  const clusters = [];

  data.apis.forEach((api) => {
    if (visited.has(api.id)) return;
    const queue = [api.id];
    const clusterApiIds = [];
    visited.add(api.id);

    while (queue.length > 0) {
      const apiId = queue.shift();
      clusterApiIds.push(apiId);
      (apiConnections.get(apiId) ?? new Set()).forEach((connectedApiId) => {
        if (visited.has(connectedApiId)) return;
        visited.add(connectedApiId);
        queue.push(connectedApiId);
      });
    }

    clusters.push(clusterApiIds);
  });

  return clusters;
}

function getLayoutsBounds(layouts) {
  return layouts.reduce((bounds, layout) => ({
    minX: Math.min(bounds.minX, layout.x),
    minY: Math.min(bounds.minY, layout.y),
    maxX: Math.max(bounds.maxX, layout.x + layout.width),
    maxY: Math.max(bounds.maxY, layout.y + layout.height)
  }), { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
}

function buildClusterLocalLayout(clusterApiIds, layoutMap, apiConnections) {
  const clusterApiIdSet = new Set(clusterApiIds);
  const localPositions = {};
  const placedLayouts = [];
  const rootApiId = [...clusterApiIds].sort((left, right) => {
    const degreeDiff = (apiConnections.get(right)?.size ?? 0) - (apiConnections.get(left)?.size ?? 0);
    if (degreeDiff !== 0) return degreeDiff;
    return left.localeCompare(right);
  })[0];

  if (!rootApiId) return { positions: localPositions, bounds: { minX: 0, minY: 0, maxX: CARD_MIN_WIDTH, maxY: HANDLE_MIN_HEIGHT } };

  const visitOrder = [];
  const queue = [rootApiId];
  const visited = new Set([rootApiId]);

  while (queue.length > 0) {
    const apiId = queue.shift();
    visitOrder.push(apiId);
    [...(apiConnections.get(apiId) ?? [])]
      .filter((connectedApiId) => clusterApiIdSet.has(connectedApiId) && !visited.has(connectedApiId))
      .sort((left, right) => (apiConnections.get(right)?.size ?? 0) - (apiConnections.get(left)?.size ?? 0))
      .forEach((connectedApiId) => {
        visited.add(connectedApiId);
        queue.push(connectedApiId);
      });
  }

  clusterApiIds.forEach((apiId) => {
    if (!visited.has(apiId)) visitOrder.push(apiId);
  });

  visitOrder.forEach((apiId, index) => {
    const layout = layoutMap.get(apiId);
    if (!layout) return;

    if (index === 0) {
      const rootLayout = { x: 0, y: 0, width: layout.width, height: layout.height };
      localPositions[apiId] = { x: 0, y: 0 };
      placedLayouts.push({ apiId, ...rootLayout });
      return;
    }

    const connectedPlacedLayouts = [...(apiConnections.get(apiId) ?? [])]
      .map((connectedApiId) => placedLayouts.find((placedLayout) => placedLayout.apiId === connectedApiId))
      .filter(Boolean);

    const averageConnectedCenterX = connectedPlacedLayouts.length > 0
      ? connectedPlacedLayouts.reduce((sum, connectedLayout) => sum + connectedLayout.x + connectedLayout.width / 2, 0) / connectedPlacedLayouts.length
      : 0;
    const averageConnectedCenterY = connectedPlacedLayouts.length > 0
      ? connectedPlacedLayouts.reduce((sum, connectedLayout) => sum + connectedLayout.y + connectedLayout.height / 2, 0) / connectedPlacedLayouts.length
      : 0;

    const candidatePositions = connectedPlacedLayouts.flatMap((connectedLayout) => [
      {
        x: connectedLayout.x + connectedLayout.width + API_CARD_GAP,
        y: connectedLayout.y + (connectedLayout.height - layout.height) / 2,
        flowBias: 0
      },
      {
        x: connectedLayout.x - layout.width - API_CARD_GAP,
        y: connectedLayout.y + (connectedLayout.height - layout.height) / 2,
        flowBias: 1.25
      },
      {
        x: connectedLayout.x + (connectedLayout.width - layout.width) / 2,
        y: connectedLayout.y + connectedLayout.height + API_CARD_GAP,
        flowBias: 0.45
      },
      {
        x: connectedLayout.x + (connectedLayout.width - layout.width) / 2,
        y: connectedLayout.y - layout.height - API_CARD_GAP,
        flowBias: 0.45
      }
    ]);

    if (candidatePositions.length === 0) {
      const bounds = getLayoutsBounds(placedLayouts);
      candidatePositions.push({ x: bounds.maxX + API_CARD_GAP, y: 0, flowBias: 0.2 });
    }

    const scoredCandidate = candidatePositions.reduce((best, candidate) => {
      const snapped = findNearestNonOverlappingPosition(candidate, { width: layout.width, height: layout.height }, placedLayouts, API_CARD_GAP);
      const candidateCenterX = snapped.x + layout.width / 2;
      const candidateCenterY = snapped.y + layout.height / 2;
      const connectionDistance = connectedPlacedLayouts.reduce((sum, connectedLayout) => {
        const connectedCenterX = connectedLayout.x + connectedLayout.width / 2;
        const connectedCenterY = connectedLayout.y + connectedLayout.height / 2;
        return sum + Math.hypot(candidateCenterX - connectedCenterX, candidateCenterY - connectedCenterY);
      }, 0);
      const horizontalBacktrackPenalty = candidateCenterX < averageConnectedCenterX ? (averageConnectedCenterX - candidateCenterX) * 1.1 : 0;
      const verticalSpreadPenalty = Math.abs(candidateCenterY - averageConnectedCenterY) * 0.22;
      const score = connectionDistance + horizontalBacktrackPenalty + verticalSpreadPenalty + candidate.flowBias * API_CARD_GAP;
      if (!best || score < best.score) return { position: snapped, score };
      return best;
    }, null);

    const position = scoredCandidate?.position ?? findNearestNonOverlappingPosition({ x: 0, y: 0 }, { width: layout.width, height: layout.height }, placedLayouts, API_CARD_GAP);
    localPositions[apiId] = position;
    placedLayouts.push({ apiId, x: position.x, y: position.y, width: layout.width, height: layout.height });
  });

  const bounds = getLayoutsBounds(placedLayouts);
  const normalizedPositions = Object.fromEntries(Object.entries(localPositions).map(([apiId, position]) => [apiId, { x: position.x - bounds.minX, y: position.y - bounds.minY }]));
  return {
    positions: normalizedPositions,
    bounds: { minX: 0, minY: 0, maxX: bounds.maxX - bounds.minX, maxY: bounds.maxY - bounds.minY }
  };
}

function createApiMeasurementMap(data, collapsedApiIds = new Set()) {
  const endpointMap = new Map(data.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const measurements = new Map();
  data.apis.forEach((api) => {
    const collapsed = collapsedApiIds.has(api.id);
    const endpointNames = api.endpointIds.map((endpointId) => endpointMap.get(endpointId)?.endpointName ?? "");
    const titleWidth = measureTextWidth(api.name, API_NAME_FONT_SCALE);
    const endpointWidth = endpointNames.reduce((widest, endpointName) => Math.max(widest, measureTextWidth(endpointName, ENDPOINT_FONT_SCALE)), 0);
    const businessGroupLabel = getBusinessGroupLabel(api);
    const businessGroupWidth = businessGroupLabel ? measureTextWidth(businessGroupLabel, API_META_FONT_SCALE) : 0;
    const cardWidth = clampCardWidth(Math.max(titleWidth, endpointWidth, businessGroupWidth) + CARD_PADDING * 2 + HANDLE_RIGHT_CONTROL_SPACE + HANDLE_DRAG_DOT_SPACE);
    const titleLines = wrapTextToLines(api.name, getLineCapacity(cardWidth - HANDLE_HORIZONTAL_PADDING * 2 - HANDLE_RIGHT_CONTROL_SPACE - HANDLE_DRAG_DOT_SPACE));
    const handleHeight = Math.max(HANDLE_MIN_HEIGHT, TITLE_LANE_TOP_OFFSET + TITLE_LANE_BOTTOM_PADDING + titleLines.length * API_NAME_LINE_HEIGHT);
    const businessGroupLines = businessGroupLabel ? wrapTextToLines(businessGroupLabel, getLineCapacity(cardWidth - CARD_PADDING * 2 - 24)) : [];
    const businessGroupHeight = businessGroupLines.length > 0 ? HANDLE_VERTICAL_PADDING * 2 + businessGroupLines.length * API_META_LINE_HEIGHT : 0;
    const endpointTextWidth = Math.max(96, cardWidth - CARD_PADDING * 2 - ENDPOINT_TEXT_LEFT_PADDING - ENDPOINT_TEXT_RIGHT_PADDING);
    const endpointLineCapacity = getLineCapacity(endpointTextWidth);
    const endpointItems = api.endpointIds.map((endpointId) => {
      const endpoint = endpointMap.get(endpointId);
      const labelLines = wrapTextToLines(endpoint?.endpointName ?? "", endpointLineCapacity);
      const height = Math.max(ENDPOINT_MIN_HEIGHT, ENDPOINT_VERTICAL_PADDING * 2 + labelLines.length * ENDPOINT_LINE_HEIGHT);
      return { endpointId, labelLines, height };
    });
    const visibleEndpointItems = collapsed ? [] : endpointItems;
    const endpointHeight = visibleEndpointItems.reduce((sum, endpointItem) => sum + endpointItem.height, 0) + Math.max(visibleEndpointItems.length - 1, 0) * ENDPOINT_GAP;
    const headerHeight = HEADER_TOP_PADDING + handleHeight + (businessGroupHeight > 0 ? API_META_GAP + businessGroupHeight : 0) + HEADER_BOTTOM_PADDING;
    measurements.set(api.id, { width: cardWidth, height: headerHeight + endpointHeight + CARD_BOTTOM_PADDING, headerHeight, handleHeight, titleLines, businessGroupLines, businessGroupHeight, endpointItems, visibleEndpointItems, collapsed });
  });
  return measurements;
}

function getApiColumnKey(api) {
  const kind = String(api?.kind ?? "").trim().toLowerCase();
  if (kind === "source" || kind === "eapi") return "source";
  if (kind === "bridge" || kind === "papi") return "bridge";
  if (kind === "sink" || kind === "sapi" || kind === "xapi" || kind === "isolated") return "sink";
  return "sink";
}

function compareApiNames(leftApi, rightApi) {
  return String(leftApi?.name ?? "").localeCompare(String(rightApi?.name ?? ""), undefined, { sensitivity: "base" });
}

function createWeightedApiAdjacency(data) {
  const endpointToApiId = new Map(data.endpoints.map((endpoint) => [endpoint.id, endpoint.apiId]));
  const apiToColumn = new Map(data.apis.map((api) => [api.id, getApiColumnKey(api)]));
  const adjacency = new Map(data.apis.map((api) => [api.id, new Map()]));

  data.edges.forEach((edge) => {
    const fromApiId = endpointToApiId.get(edge.fromId);
    const toApiId = endpointToApiId.get(edge.toId);
    if (!fromApiId || !toApiId || fromApiId === toApiId) return;

    const fromColumn = apiToColumn.get(fromApiId);
    const toColumn = apiToColumn.get(toApiId);
    const forwardWeight = fromColumn === "source" && toColumn === "bridge"
      ? 2.4
      : fromColumn === "bridge" && toColumn === "sink"
        ? 2.6
        : 1.2;

    const forwardNeighbors = adjacency.get(fromApiId);
    const backwardNeighbors = adjacency.get(toApiId);
    if (forwardNeighbors) forwardNeighbors.set(toApiId, (forwardNeighbors.get(toApiId) ?? 0) + forwardWeight);
    if (backwardNeighbors) backwardNeighbors.set(fromApiId, (backwardNeighbors.get(fromApiId) ?? 0) + forwardWeight * 0.95);
  });

  return adjacency;
}

function sumNeighborWeights(adjacencyMap, apiId, candidateApiIds = []) {
  const neighborMap = adjacencyMap.get(apiId);
  if (!neighborMap || candidateApiIds.length === 0) return 0;
  return candidateApiIds.reduce((sum, neighborId) => sum + (neighborMap.get(neighborId) ?? 0), 0);
}

function getWeightedAverageIndex(adjacencyMap, apiId, orderedApiIds = []) {
  const neighborMap = adjacencyMap.get(apiId);
  if (!neighborMap || orderedApiIds.length === 0) return Number.POSITIVE_INFINITY;
  let weightedIndexSum = 0;
  let weightSum = 0;
  orderedApiIds.forEach((candidateApiId, index) => {
    const weight = neighborMap.get(candidateApiId) ?? 0;
    if (!weight) return;
    weightedIndexSum += index * weight;
    weightSum += weight;
  });
  return weightSum > 0 ? weightedIndexSum / weightSum : Number.POSITIVE_INFINITY;
}

function getWeightedAverageCenterY(adjacencyMap, apiId, layoutByApiId) {
  const neighborMap = adjacencyMap.get(apiId);
  if (!neighborMap || neighborMap.size === 0) return null;
  let weightedCenterY = 0;
  let weightSum = 0;
  neighborMap.forEach((weight, neighborApiId) => {
    const layout = layoutByApiId.get(neighborApiId);
    if (!layout || !weight) return;
    weightedCenterY += (layout.y + layout.height / 2) * weight;
    weightSum += weight;
  });
  return weightSum > 0 ? weightedCenterY / weightSum : null;
}

function createColumnLayoutsFromOrder(columnKey, apiList, columnX, measurementMap, preferredCenterYByApiId = new Map()) {
  const cardHeights = apiList.map((api) => measurementMap.get(api.id)?.height ?? HANDLE_MIN_HEIGHT);
  const totalHeight = cardHeights.reduce((sum, value) => sum + value, 0) + Math.max(apiList.length - 1, 0) * API_CARD_GAP;
  const baseStartY = Math.max(92, (VIEWPORT_HEIGHT - totalHeight) / 2);

  const orderedLayouts = [];
  let cursorY = baseStartY;
  apiList.forEach((api, index) => {
    const measurement = measurementMap.get(api.id);
    const height = cardHeights[index];
    const preferredCenterY = preferredCenterYByApiId.get(api.id);
    const preferredY = Number.isFinite(preferredCenterY) ? clampApiY(preferredCenterY - height / 2) : cursorY;
    const y = Math.max(cursorY, preferredY);
    const layout = {
      apiId: api.id,
      x: columnX,
      y,
      width: measurement?.width ?? CARD_MIN_WIDTH,
      height,
      column: columnKey,
      headerHeight: measurement?.headerHeight ?? HANDLE_MIN_HEIGHT,
      handleHeight: measurement?.handleHeight ?? HANDLE_MIN_HEIGHT,
      businessGroupLines: measurement?.businessGroupLines ?? [],
      businessGroupHeight: measurement?.businessGroupHeight ?? 0,
      apiNameLines: measurement?.titleLines ?? [api.name]
    };
    orderedLayouts.push(layout);
    cursorY = y + height + API_CARD_GAP;
  });

  return orderedLayouts;
}

function createArchitecturalColumnLayouts(data, measurementMap) {
  const columns = { source: [], bridge: [], sink: [] };
  data.apis.forEach((api) => {
    columns[getApiColumnKey(api)].push(api);
  });

  const adjacency = createWeightedApiAdjacency(data);
  columns.source.sort(compareApiNames);

  const sourceApiIds = columns.source.map((api) => api.id);
  columns.bridge.sort((left, right) => {
    const leftScore = getWeightedAverageIndex(adjacency, left.id, sourceApiIds);
    const rightScore = getWeightedAverageIndex(adjacency, right.id, sourceApiIds);
    if (Number.isFinite(leftScore) || Number.isFinite(rightScore)) {
      if (!Number.isFinite(leftScore)) return 1;
      if (!Number.isFinite(rightScore)) return -1;
      if (Math.abs(leftScore - rightScore) > 0.0001) return leftScore - rightScore;
    }
    const leftWeight = sumNeighborWeights(adjacency, left.id, sourceApiIds);
    const rightWeight = sumNeighborWeights(adjacency, right.id, sourceApiIds);
    if (leftWeight !== rightWeight) return rightWeight - leftWeight;
    return compareApiNames(left, right);
  });

  const bridgeApiIds = columns.bridge.map((api) => api.id);
  columns.sink.sort((left, right) => {
    const leftScore = getWeightedAverageIndex(adjacency, left.id, bridgeApiIds);
    const rightScore = getWeightedAverageIndex(adjacency, right.id, bridgeApiIds);
    if (Number.isFinite(leftScore) || Number.isFinite(rightScore)) {
      if (!Number.isFinite(leftScore)) return 1;
      if (!Number.isFinite(rightScore)) return -1;
      if (Math.abs(leftScore - rightScore) > 0.0001) return leftScore - rightScore;
    }
    const leftWeight = sumNeighborWeights(adjacency, left.id, bridgeApiIds);
    const rightWeight = sumNeighborWeights(adjacency, right.id, bridgeApiIds);
    if (leftWeight !== rightWeight) return rightWeight - leftWeight;
    return compareApiNames(left, right);
  });

  const maxColumnWidth = {
    source: columns.source.reduce((maxWidth, api) => Math.max(maxWidth, measurementMap.get(api.id)?.width ?? CARD_MIN_WIDTH), CARD_MIN_WIDTH),
    bridge: columns.bridge.reduce((maxWidth, api) => Math.max(maxWidth, measurementMap.get(api.id)?.width ?? CARD_MIN_WIDTH), CARD_MIN_WIDTH),
    sink: columns.sink.reduce((maxWidth, api) => Math.max(maxWidth, measurementMap.get(api.id)?.width ?? CARD_MIN_WIDTH), CARD_MIN_WIDTH)
  };

  const columnX = {
    source: COLUMN_START_X,
    bridge: COLUMN_START_X + maxColumnWidth.source + COLUMN_HORIZONTAL_GAP,
    sink: COLUMN_START_X + maxColumnWidth.source + COLUMN_HORIZONTAL_GAP + maxColumnWidth.bridge + COLUMN_HORIZONTAL_GAP
  };

  const sourceLayouts = createColumnLayoutsFromOrder("source", columns.source, columnX.source, measurementMap);
  const sourceLayoutByApiId = new Map(sourceLayouts.map((layout) => [layout.apiId, layout]));

  const bridgePreferredCenterY = new Map(columns.bridge.map((api) => [api.id, getWeightedAverageCenterY(adjacency, api.id, sourceLayoutByApiId)]));
  const bridgeLayouts = createColumnLayoutsFromOrder("bridge", columns.bridge, columnX.bridge, measurementMap, bridgePreferredCenterY);
  const bridgeLayoutByApiId = new Map(bridgeLayouts.map((layout) => [layout.apiId, layout]));

  const sinkPreferredCenterY = new Map(columns.sink.map((api) => [api.id, getWeightedAverageCenterY(adjacency, api.id, bridgeLayoutByApiId)]));
  const sinkLayouts = createColumnLayoutsFromOrder("sink", columns.sink, columnX.sink, measurementMap, sinkPreferredCenterY);

  return [...sourceLayouts, ...bridgeLayouts, ...sinkLayouts];
}

function clampZoom(zoomValue) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomValue));
}

function createGraphLayout(data, apiPositions, collapsedApiIds = new Set()) {
  const measurementMap = createApiMeasurementMap(data, collapsedApiIds);
  const defaultLayouts = createArchitecturalColumnLayouts(data, measurementMap);
  const apiLayoutMap = new Map();
  const endpointLayoutMap = new Map();
  defaultLayouts.forEach((defaultLayout) => {
    const api = data.apis.find((item) => item.id === defaultLayout.apiId);
    const measurement = measurementMap.get(api.id);
    const manualPosition = apiPositions[api.id];
    const nextLayout = manualPosition ? { ...defaultLayout, x: manualPosition.x, y: manualPosition.y } : defaultLayout;
    apiLayoutMap.set(api.id, nextLayout);
    let endpointCursorY = nextLayout.y + measurement.headerHeight;
    if (measurement.collapsed) {
      const collapsedCenterY = nextLayout.y + measurement.headerHeight / 2;
      measurement.endpointItems.forEach((endpointItem) => {
        endpointLayoutMap.set(endpointItem.endpointId, {
          id: endpointItem.endpointId,
          apiId: api.id,
          x: nextLayout.x + nextLayout.width / 2,
          y: collapsedCenterY,
          width: 0,
          height: 0,
          leftDockX: nextLayout.x - EDGE_DOCK_OFFSET,
          rightDockX: nextLayout.x + nextLayout.width + EDGE_DOCK_OFFSET,
          centerY: collapsedCenterY,
          labelLines: endpointItem.labelLines,
          collapsed: true
        });
      });
    } else {
      measurement.visibleEndpointItems.forEach((endpointItem) => {
        const endpointId = endpointItem.endpointId;
        const endpointWidth = nextLayout.width - CARD_PADDING * 2;
        const endpointX = nextLayout.x + CARD_PADDING;
        const endpointY = endpointCursorY;
        endpointLayoutMap.set(endpointId, { id: endpointId, apiId: api.id, x: endpointX, y: endpointY, width: endpointWidth, height: endpointItem.height, leftDockX: endpointX - EDGE_DOCK_OFFSET, rightDockX: endpointX + endpointWidth + EDGE_DOCK_OFFSET, centerY: endpointY + endpointItem.height / 2, labelLines: endpointItem.labelLines, collapsed: false });
        endpointCursorY += endpointItem.height + ENDPOINT_GAP;
      });
    }
  });
  return { apiLayoutMap, endpointLayoutMap };
}

function inflateLayout(layout, padding = EDGE_ROUTE_PADDING) {
  const safePadding = padding + EDGE_ROUTE_EPSILON;
  return { left: layout.x - safePadding, top: layout.y - safePadding, right: layout.x + layout.width + safePadding, bottom: layout.y + layout.height + safePadding };
}

function segmentIntersectsRect(startPoint, endPoint, rect) {
  if (startPoint.x === endPoint.x) {
    const minY = Math.min(startPoint.y, endPoint.y);
    const maxY = Math.max(startPoint.y, endPoint.y);
    return startPoint.x > rect.left && startPoint.x < rect.right && maxY > rect.top && minY < rect.bottom;
  }
  if (startPoint.y === endPoint.y) {
    const minX = Math.min(startPoint.x, endPoint.x);
    const maxX = Math.max(startPoint.x, endPoint.x);
    return startPoint.y > rect.top && startPoint.y < rect.bottom && maxX > rect.left && minX < rect.right;
  }
  return false;
}

function offsetPoint(point, directionPoint, distance) {
  if (point.x === directionPoint.x) {
    return { x: point.x, y: point.y + Math.sign(directionPoint.y - point.y) * distance };
  }
  return { x: point.x + Math.sign(directionPoint.x - point.x) * distance, y: point.y };
}

function createRoundedOrthogonalPath(points, radius = EDGE_CORNER_RADIUS) {
  const normalizedPoints = points.filter((point, index) => {
    const previousPoint = points[index - 1];
    return !previousPoint || previousPoint.x !== point.x || previousPoint.y !== point.y;
  });
  if (normalizedPoints.length < 2) return "";
  let path = `M ${normalizedPoints[0].x} ${normalizedPoints[0].y}`;
  for (let index = 1; index < normalizedPoints.length; index += 1) {
    const previousPoint = normalizedPoints[index - 1];
    const currentPoint = normalizedPoints[index];
    const nextPoint = normalizedPoints[index + 1];
    if (!nextPoint) {
      path += ` L ${currentPoint.x} ${currentPoint.y}`;
      continue;
    }
    const incomingLength = Math.abs(currentPoint.x - previousPoint.x) + Math.abs(currentPoint.y - previousPoint.y);
    const outgoingLength = Math.abs(nextPoint.x - currentPoint.x) + Math.abs(nextPoint.y - currentPoint.y);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    if (cornerRadius < 1) {
      path += ` L ${currentPoint.x} ${currentPoint.y}`;
      continue;
    }
    const cornerStart = offsetPoint(currentPoint, previousPoint, cornerRadius);
    const cornerEnd = offsetPoint(currentPoint, nextPoint, cornerRadius);
    path += ` L ${cornerStart.x} ${cornerStart.y}`;
    path += ` Q ${currentPoint.x} ${currentPoint.y} ${cornerEnd.x} ${cornerEnd.y}`;
  }
  return path;
}

function pointInsideRect(point, rect) {
  return point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
}

function segmentIntersectsAnyRect(startPoint, endPoint, rects) {
  return rects.some((rect) => segmentIntersectsRect(startPoint, endPoint, rect));
}

function normalizeOrthogonalPoints(points) {
  const deduped = points.filter((point, index) => {
    const previousPoint = points[index - 1];
    return !previousPoint || previousPoint.x !== point.x || previousPoint.y !== point.y;
  });

  return deduped.filter((point, index) => {
    if (index === 0 || index === deduped.length - 1) return true;
    const previousPoint = deduped[index - 1];
    const nextPoint = deduped[index + 1];
    const sameVertical = previousPoint.x === point.x && point.x === nextPoint.x;
    const sameHorizontal = previousPoint.y === point.y && point.y === nextPoint.y;
    return !(sameVertical || sameHorizontal);
  });
}

function createGridRoute(startPoint, endPoint, obstacleRects) {
  const xCoords = [...new Set([startPoint.x, endPoint.x, ...obstacleRects.flatMap((rect) => [rect.left, rect.right])])].sort((left, right) => left - right);
  const yCoords = [...new Set([startPoint.y, endPoint.y, ...obstacleRects.flatMap((rect) => [rect.top, rect.bottom])])].sort((left, right) => left - right);
  const nodes = new Map();
  const neighbors = new Map();

  xCoords.forEach((x) => {
    yCoords.forEach((y) => {
      const key = `${x}:${y}`;
      const point = { x, y };
      const isEndpoint = (x === startPoint.x && y === startPoint.y) || (x === endPoint.x && y === endPoint.y);
      if (!isEndpoint && obstacleRects.some((rect) => pointInsideRect(point, rect))) return;
      nodes.set(key, point);
      neighbors.set(key, []);
    });
  });

  yCoords.forEach((y) => {
    for (let index = 0; index < xCoords.length - 1; index += 1) {
      const leftKey = `${xCoords[index]}:${y}`;
      const rightKey = `${xCoords[index + 1]}:${y}`;
      const leftPoint = nodes.get(leftKey);
      const rightPoint = nodes.get(rightKey);
      if (!leftPoint || !rightPoint || segmentIntersectsAnyRect(leftPoint, rightPoint, obstacleRects)) continue;
      const distance = Math.abs(rightPoint.x - leftPoint.x);
      neighbors.get(leftKey).push({ key: rightKey, distance });
      neighbors.get(rightKey).push({ key: leftKey, distance });
    }
  });

  xCoords.forEach((x) => {
    for (let index = 0; index < yCoords.length - 1; index += 1) {
      const topKey = `${x}:${yCoords[index]}`;
      const bottomKey = `${x}:${yCoords[index + 1]}`;
      const topPoint = nodes.get(topKey);
      const bottomPoint = nodes.get(bottomKey);
      if (!topPoint || !bottomPoint || segmentIntersectsAnyRect(topPoint, bottomPoint, obstacleRects)) continue;
      const distance = Math.abs(bottomPoint.y - topPoint.y);
      neighbors.get(topKey).push({ key: bottomKey, distance });
      neighbors.get(bottomKey).push({ key: topKey, distance });
    }
  });

  const startKey = `${startPoint.x}:${startPoint.y}`;
  const endKey = `${endPoint.x}:${endPoint.y}`;
  if (!nodes.has(startKey) || !nodes.has(endKey)) return null;

  const distances = new Map([[startKey, 0]]);
  const previous = new Map();
  const visited = new Set();

  while (visited.size < nodes.size) {
    let currentKey = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    distances.forEach((distance, key) => {
      if (!visited.has(key) && distance < currentDistance) {
        currentDistance = distance;
        currentKey = key;
      }
    });
    if (!currentKey) break;
    if (currentKey === endKey) break;
    visited.add(currentKey);

    neighbors.get(currentKey).forEach(({ key, distance }) => {
      if (visited.has(key)) return;
      const nextDistance = currentDistance + distance;
      if (nextDistance < (distances.get(key) ?? Number.POSITIVE_INFINITY)) {
        distances.set(key, nextDistance);
        previous.set(key, currentKey);
      }
    });
  }

  if (!previous.has(endKey) && startKey !== endKey) return null;

  const path = [];
  let cursor = endKey;
  while (cursor) {
    path.unshift(nodes.get(cursor));
    cursor = previous.get(cursor);
  }

  return normalizeOrthogonalPoints(path);
}

function pickRoutingLane(startY, endY, inflatedLayouts) {
  const minTop = Math.min(startY, endY, ...inflatedLayouts.map((rect) => rect.top));
  const maxBottom = Math.max(startY, endY, ...inflatedLayouts.map((rect) => rect.bottom));
  const topLane = minTop - EDGE_ROUTE_LANE_GAP;
  const bottomLane = maxBottom + EDGE_ROUTE_LANE_GAP;
  const midY = (startY + endY) / 2;
  return Math.abs(midY - topLane) <= Math.abs(bottomLane - midY) ? topLane : bottomLane;
}

function getFittedCamera(bounds, padding = 96) {
  const width = Math.max(bounds.maxX - bounds.minX, 320);
  const height = Math.max(bounds.maxY - bounds.minY, 240);
  const zoom = clampZoom(Math.min(VIEWPORT_WIDTH / (width + padding * 2), VIEWPORT_HEIGHT / (height + padding * 2)));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return { x: centerX - VIEWPORT_WIDTH / (2 * zoom), y: centerY - VIEWPORT_HEIGHT / (2 * zoom), zoom };
}

function createAutoArrangePositions(data, currentPositions, collapsedApiIds = new Set()) {
  const measurementMap = createApiMeasurementMap(data, collapsedApiIds);
  const arrangedLayouts = createArchitecturalColumnLayouts(data, measurementMap);
  return Object.fromEntries(arrangedLayouts.map((layout) => [layout.apiId, { x: layout.x, y: layout.y }]));
}

function createEdgePath(fromNode, toNode, apiLayoutMap, isDragging = false) {
  const coordinateValues = [fromNode?.x, fromNode?.y, fromNode?.width, fromNode?.height, fromNode?.leftDockX, fromNode?.rightDockX, fromNode?.centerY, toNode?.x, toNode?.y, toNode?.width, toNode?.height, toNode?.leftDockX, toNode?.rightDockX, toNode?.centerY];
  if (coordinateValues.some((value) => !Number.isFinite(value))) return "";
  const fromCenterX = fromNode.x + fromNode.width / 2;
  const toCenterX = toNode.x + toNode.width / 2;
  const direction = toCenterX >= fromCenterX ? 1 : -1;
  const startPoint = { x: direction === 1 ? fromNode.rightDockX : fromNode.leftDockX, y: fromNode.centerY };
  const endPoint = { x: direction === 1 ? toNode.leftDockX : toNode.rightDockX, y: toNode.centerY };
  const minDockStub = Math.max(EDGE_DOCK_OFFSET * 0.65, 8);
  const ensureHorizontalDockStubs = (route) => {
    if (!Array.isArray(route) || route.length < 2) return route;
    const baseRoute = normalizeOrthogonalPoints(route);
    const safeRoute = [...baseRoute];
    const expectedStartX = startPoint.x + direction * minDockStub;
    const expectedEndX = endPoint.x - direction * minDockStub;
    if (safeRoute.length < 2 || safeRoute[1].y !== startPoint.y || Math.sign((safeRoute[1].x ?? startPoint.x) - startPoint.x) !== direction || Math.abs((safeRoute[1]?.x ?? startPoint.x) - startPoint.x) < 1) {
      safeRoute.splice(1, 0, { x: expectedStartX, y: startPoint.y });
    }
    const beforeEndIndex = safeRoute.length - 2;
    if (beforeEndIndex < 0 || safeRoute[beforeEndIndex].y !== endPoint.y || Math.sign(endPoint.x - (safeRoute[beforeEndIndex]?.x ?? endPoint.x)) !== direction || Math.abs(endPoint.x - (safeRoute[beforeEndIndex]?.x ?? endPoint.x)) < 1) {
      safeRoute.splice(safeRoute.length - 1, 0, { x: expectedEndX, y: endPoint.y });
    }
    return normalizeOrthogonalPoints(safeRoute);
  };
  const obstacleRects = Array.from(apiLayoutMap.values())
    .filter((layout) => layout.apiId !== fromNode.apiId && layout.apiId !== toNode.apiId)
    .map((layout) => inflateLayout(layout));
  const isValidRoute = (route) => Array.isArray(route) && route.length > 1;
  const toPathOrFallback = (route) => {
    const orthogonalFallback = ensureHorizontalDockStubs(normalizeOrthogonalPoints([startPoint, { x: (startPoint.x + endPoint.x) / 2, y: startPoint.y }, { x: (startPoint.x + endPoint.x) / 2, y: endPoint.y }, endPoint]));
    if (!isValidRoute(route)) return createRoundedOrthogonalPath(orthogonalFallback);
    const preparedRoute = ensureHorizontalDockStubs(route);
    const path = createRoundedOrthogonalPath(preparedRoute);
    return path || createRoundedOrthogonalPath(orthogonalFallback);
  };
  const directMidX = (startPoint.x + endPoint.x) / 2;
  const simpleRoute = normalizeOrthogonalPoints([startPoint, { x: directMidX, y: startPoint.y }, { x: directMidX, y: endPoint.y }, endPoint]);
  if (isDragging) {
    const dragTopLane = Math.min(startPoint.y, endPoint.y) - EDGE_ROUTE_LANE_GAP;
    const dragEscapeRoute = normalizeOrthogonalPoints([startPoint, { x: startPoint.x, y: dragTopLane }, { x: endPoint.x, y: dragTopLane }, endPoint]);
    return toPathOrFallback(isValidRoute(simpleRoute) ? simpleRoute : dragEscapeRoute);
  }
  const simpleSegments = simpleRoute.slice(0, -1).map((point, index) => [point, simpleRoute[index + 1]]);
  const canUseSimpleRoute = simpleSegments.every(([segmentStart, segmentEnd]) => !segmentIntersectsAnyRect(segmentStart, segmentEnd, obstacleRects));
  if (canUseSimpleRoute) return toPathOrFallback(simpleRoute);
  const gridRoute = createGridRoute(startPoint, endPoint, obstacleRects);
  if (isValidRoute(gridRoute)) {
    const normalizedGridRoute = normalizeOrthogonalPoints(gridRoute);
    const routeSegments = normalizedGridRoute.slice(0, -1).map((point, index) => [point, normalizedGridRoute[index + 1]]);
    const isSafeRoute = routeSegments.every(([segmentStart, segmentEnd]) => !segmentIntersectsAnyRect(segmentStart, segmentEnd, obstacleRects));
    if (isSafeRoute) return toPathOrFallback(normalizedGridRoute);
  }
  const routeLaneY = pickRoutingLane(startPoint.y, endPoint.y, obstacleRects);
  const outerLaneX = direction === 1
    ? Math.max(startPoint.x, endPoint.x, ...obstacleRects.map((rect) => rect.right)) + EDGE_ROUTE_LANE_GAP
    : Math.min(startPoint.x, endPoint.x, ...obstacleRects.map((rect) => rect.left)) - EDGE_ROUTE_LANE_GAP;
  const fallbackRoute = normalizeOrthogonalPoints([startPoint, { x: outerLaneX, y: startPoint.y }, { x: outerLaneX, y: routeLaneY }, { x: outerLaneX, y: endPoint.y }, endPoint]);
  const fallbackSegments = fallbackRoute.slice(0, -1).map((point, index) => [point, fallbackRoute[index + 1]]);
  if (fallbackSegments.every(([segmentStart, segmentEnd]) => !segmentIntersectsAnyRect(segmentStart, segmentEnd, obstacleRects))) {
    return toPathOrFallback(fallbackRoute);
  }

  const globalTopLane = Math.min(startPoint.y, endPoint.y, ...obstacleRects.map((rect) => rect.top)) - EDGE_ROUTE_LANE_GAP * 1.5;
  const topEscapeRoute = normalizeOrthogonalPoints([startPoint, { x: startPoint.x, y: globalTopLane }, { x: endPoint.x, y: globalTopLane }, endPoint]);
  const topEscapeSegments = topEscapeRoute.slice(0, -1).map((point, index) => [point, topEscapeRoute[index + 1]]);
  if (topEscapeSegments.every(([segmentStart, segmentEnd]) => !segmentIntersectsAnyRect(segmentStart, segmentEnd, obstacleRects))) {
    return toPathOrFallback(topEscapeRoute);
  }

  const globalBottomLane = Math.max(startPoint.y, endPoint.y, ...obstacleRects.map((rect) => rect.bottom)) + EDGE_ROUTE_LANE_GAP * 1.5;
  return toPathOrFallback(normalizeOrthogonalPoints([startPoint, { x: startPoint.x, y: globalBottomLane }, { x: endPoint.x, y: globalBottomLane }, endPoint]));
}

function getRelatedState(selectedEndpointId, data) {
  if (!selectedEndpointId) {
    return { relatedEndpointIds: new Set(data.endpoints.map((endpoint) => endpoint.id)), relatedApiIds: new Set(data.apis.map((api) => api.id)), activeEdgeIds: new Set(data.edges.map((edge) => edge.id)), upstreamEdges: [], downstreamEdges: [] };
  }
  const relatedEndpointIds = new Set([selectedEndpointId]);
  const relatedApiIds = new Set();
  const activeEdgeIds = new Set();
  const upstreamEdges = [];
  const downstreamEdges = [];
  const endpointMap = new Map(data.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const outgoingEdgeMap = new Map();
  const incomingEdgeMap = new Map();

  data.edges.forEach((edge) => {
    if (!outgoingEdgeMap.has(edge.fromId)) outgoingEdgeMap.set(edge.fromId, []);
    if (!incomingEdgeMap.has(edge.toId)) incomingEdgeMap.set(edge.toId, []);
    outgoingEdgeMap.get(edge.fromId).push(edge);
    incomingEdgeMap.get(edge.toId).push(edge);
  });

  const upstreamVisited = new Set([selectedEndpointId]);
  const upstreamQueue = [selectedEndpointId];
  while (upstreamQueue.length > 0) {
    const endpointId = upstreamQueue.shift();
    (incomingEdgeMap.get(endpointId) ?? []).forEach((edge) => {
      activeEdgeIds.add(edge.id);
      relatedEndpointIds.add(edge.fromId);
      relatedEndpointIds.add(edge.toId);
      upstreamEdges.push(edge);
      if (!upstreamVisited.has(edge.fromId)) {
        upstreamVisited.add(edge.fromId);
        upstreamQueue.push(edge.fromId);
      }
    });
  }

  const downstreamVisited = new Set([selectedEndpointId]);
  const downstreamQueue = [selectedEndpointId];
  while (downstreamQueue.length > 0) {
    const endpointId = downstreamQueue.shift();
    (outgoingEdgeMap.get(endpointId) ?? []).forEach((edge) => {
      activeEdgeIds.add(edge.id);
      relatedEndpointIds.add(edge.fromId);
      relatedEndpointIds.add(edge.toId);
      downstreamEdges.push(edge);
      if (!downstreamVisited.has(edge.toId)) {
        downstreamVisited.add(edge.toId);
        downstreamQueue.push(edge.toId);
      }
    });
  }

  relatedEndpointIds.forEach((endpointId) => {
    const endpoint = endpointMap.get(endpointId);
    if (endpoint) relatedApiIds.add(endpoint.apiId);
  });
  return {
    relatedEndpointIds,
    relatedApiIds,
    activeEdgeIds,
    upstreamEdges: upstreamEdges.filter((edge, index, edges) => edges.findIndex((candidate) => candidate.id === edge.id) === index),
    downstreamEdges: downstreamEdges.filter((edge, index, edges) => edges.findIndex((candidate) => candidate.id === edge.id) === index)
  };
}

function getGraphBounds(graphModel, layout) {
  const apiLayouts = graphModel.apis.map((api) => layout.apiLayoutMap.get(api.id)).filter(Boolean);
  if (apiLayouts.length === 0) return { minX: 0, minY: 0, maxX: VIEWPORT_WIDTH, maxY: VIEWPORT_HEIGHT };
  return apiLayouts.reduce((bounds, apiLayout) => ({ minX: Math.min(bounds.minX, apiLayout.x), minY: Math.min(bounds.minY, apiLayout.y), maxX: Math.max(bounds.maxX, apiLayout.x + apiLayout.width), maxY: Math.max(bounds.maxY, apiLayout.y + apiLayout.height) }), { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
}

function buildFocusedGraphModel(graphModel, focusedApiId) {
  if (!focusedApiId) return graphModel;
  const focusedApi = graphModel.apis.find((api) => api.id === focusedApiId);
  if (!focusedApi) return graphModel;
  const endpointMap = new Map(graphModel.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const visibleApiIds = new Set([focusedApiId]);
  const visibleEndpointIds = new Set(focusedApi.endpointIds);
  const visibleEdgeIds = new Set();
  graphModel.edges.forEach((edge) => {
    if (visibleEndpointIds.has(edge.fromId) || visibleEndpointIds.has(edge.toId)) {
      visibleEdgeIds.add(edge.id);
      visibleEndpointIds.add(edge.fromId);
      visibleEndpointIds.add(edge.toId);
    }
  });
  visibleEndpointIds.forEach((endpointId) => {
    const endpoint = endpointMap.get(endpointId);
    if (endpoint) visibleApiIds.add(endpoint.apiId);
  });
  const endpoints = graphModel.endpoints.filter((endpoint) => visibleEndpointIds.has(endpoint.id));
  const edges = graphModel.edges.filter((edge) => visibleEdgeIds.has(edge.id));
  const apis = graphModel.apis.filter((api) => visibleApiIds.has(api.id)).map((api) => ({ ...api, endpointIds: api.endpointIds.filter((endpointId) => visibleEndpointIds.has(endpointId)) }));
  const rowIds = new Set(edges.flatMap((edge) => edge.rowIds));
  return { ...graphModel, apis, endpoints, edges, summary: { ...graphModel.summary, apiCount: apis.length, endpointCount: endpoints.length, edgeCount: edges.length, rowCount: rowIds.size } };
}

function filterApiPositions(currentPositions, nextModel) {
  const allowedIds = new Set(nextModel.apis.map((api) => api.id));
  return Object.fromEntries(Object.entries(currentPositions).filter(([apiId]) => allowedIds.has(apiId)));
}

function hasActiveTextSelection() {
  return typeof window !== "undefined" && String(window.getSelection?.() ?? "").trim().length > 0;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getThemePalette() {
  return {
    background: "#040404",
    edge: "#efe9dc",
    text: "#f3efe7",
    endpointFill: "#060606",
    endpointStroke: "#2e2b26",
    sourceFill: "#1c0a0a",
    sourceStroke: "#ff5a3d",
    bridgeFill: "#0e0e0e",
    bridgeStroke: "#f3efe7",
    sinkFill: "#101010",
    sinkStroke: "#c7c1b6",
    isolatedFill: "#090909",
    isolatedStroke: "#787268"
  };
}

function buildDrawioXml(graphModel, layout, collapsedApiIds, bounds) {
  const palette = getThemePalette();
  const endpointMap = new Map(graphModel.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];

  graphModel.apis.forEach((api) => {
    const apiLayout = layout.apiLayoutMap.get(api.id);
    const fillColor = api.kind === "source" ? palette.sourceFill : api.kind === "bridge" ? palette.bridgeFill : api.kind === "sink" ? palette.sinkFill : palette.isolatedFill;
    const strokeColor = api.kind === "source" ? palette.sourceStroke : api.kind === "bridge" ? palette.bridgeStroke : api.kind === "sink" ? palette.sinkStroke : palette.isolatedStroke;
    const label = [api.name, ...(api.businessGroups?.length ? [`BG: ${api.businessGroups.join(" / ")}`] : [])].join("&#xa;");
    cells.push(`<mxCell id="api-${escapeXml(api.id)}" value="${escapeXml(label)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${escapeXml(fillColor)};strokeColor=${escapeXml(strokeColor)};fontColor=${escapeXml(palette.text)};fontStyle=1;arcSize=14;spacingTop=18;" vertex="1" parent="1"><mxGeometry x="${apiLayout.x}" y="${apiLayout.y}" width="${apiLayout.width}" height="${apiLayout.height}" as="geometry"/></mxCell>`);

    if (!collapsedApiIds.has(api.id)) {
      api.endpointIds.forEach((endpointId) => {
        const endpoint = endpointMap.get(endpointId);
        const endpointLayout = layout.endpointLayoutMap.get(endpointId);
        if (!endpoint || !endpointLayout || endpointLayout.collapsed) return;
        cells.push(`<mxCell id="endpoint-${escapeXml(endpoint.id)}" value="${escapeXml(endpoint.endpointName)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${escapeXml(palette.endpointFill)};strokeColor=${escapeXml(palette.endpointStroke)};fontColor=${escapeXml(palette.text)};arcSize=12;spacingLeft=14;" vertex="1" parent="1"><mxGeometry x="${endpointLayout.x}" y="${endpointLayout.y}" width="${endpointLayout.width}" height="${endpointLayout.height}" as="geometry"/></mxCell>`);
      });
    }
  });

  graphModel.edges.forEach((edge) => {
    const fromEndpoint = endpointMap.get(edge.fromId);
    const toEndpoint = endpointMap.get(edge.toId);
    if (!fromEndpoint || !toEndpoint) return;
    const sourceId = collapsedApiIds.has(fromEndpoint.apiId) ? `api-${fromEndpoint.apiId}` : `endpoint-${edge.fromId}`;
    const targetId = collapsedApiIds.has(toEndpoint.apiId) ? `api-${toEndpoint.apiId}` : `endpoint-${edge.toId}`;
    cells.push(`<mxCell id="edge-${escapeXml(edge.id)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${escapeXml(palette.edge)};endArrow=block;endFill=1;" edge="1" parent="1" source="${escapeXml(sourceId)}" target="${escapeXml(targetId)}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  });

  return `<?xml version="1.0" encoding="UTF-8"?><mxGraphModel dx="1440" dy="920" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.ceil(bounds.maxX - bounds.minX + EXPORT_PADDING * 2)}" pageHeight="${Math.ceil(bounds.maxY - bounds.minY + EXPORT_PADDING * 2)}" background="${escapeXml(palette.background)}"><root>${cells.join("")}</root></mxGraphModel>`;
}

function downloadTextFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

async function copyTextToClipboard(text, onSuccess, onError) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    onSuccess?.();
  } catch (error) {
    onError?.(error);
  }
}

function base64ToBlob(base64, mimeType) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

async function requestZipWorkbook(files) {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  const response = await fetch(`${API_BASE_URL}/api/mule/scan`, { method: "POST", body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Zip 转换 Excel 失败。");
  return data;
}

export default function App() {
  const [graphModel, setGraphModel] = useState(fallbackGraphModel);
  const [selectedEndpointId, setSelectedEndpointId] = useState(null);
  const [apiPositions, setApiPositions] = useState({});
  const [camera, setCamera] = useState(INITIAL_CAMERA);
  const [apiSearchQuery, setApiSearchQuery] = useState("");
  const [collapsedApiIds, setCollapsedApiIds] = useState(() => new Set());
  const [focusedApiId, setFocusedApiId] = useState(null);
  const [pendingCenterApiId, setPendingCenterApiId] = useState(null);
  const [fileHandle, setFileHandle] = useState(null);
  const [selectedZipFiles, setSelectedZipFiles] = useState([]);
  const [exportDirectoryHandle, setExportDirectoryHandle] = useState(null);
  const [statusMessage, setStatusMessage] = useState("当前显示内置示例数据。点击“选择 Excel”加载真实文件。");
  const [errorMessage, setErrorMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isGeneratingWorkbook, setIsGeneratingWorkbook] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [generatedWorkbookBase64, setGeneratedWorkbookBase64] = useState(null);
  const [generatedWorkbookFileName, setGeneratedWorkbookFileName] = useState(null);
  const [copiedToken, setCopiedToken] = useState(null);
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
  const [hoveredApiId, setHoveredApiId] = useState(null);
  const [hoveredEndpointId, setHoveredEndpointId] = useState(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null);
  const [searchPulseApiId, setSearchPulseApiId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [exportState, setExportState] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const svgRef = useRef(null);
  const shellRef = useRef(null);
  const headerRef = useRef(null);
  const workspaceRef = useRef(null);
  const graphStageRef = useRef(null);
  const inputRef = useRef(null);
  const zipInputRef = useRef(null);
  const dragStateRef = useRef(null);
  const panStateRef = useRef(null);
  const suppressClearRef = useRef(false);
  const cameraRef = useRef(INITIAL_CAMERA);
  const layoutRef = useRef(null);
  const panelPreferenceLockedRef = useRef(false);
  const copyTimeoutRef = useRef(null);
  const autoArrangeAnimationRef = useRef(null);
  const toastTimeoutsRef = useRef(new Map());
  const toastCounterRef = useRef(0);
  const toastReadyRef = useRef(false);
  const lastStatusRef = useRef(statusMessage);
  const lastErrorRef = useRef(errorMessage);

  const architectureGraphModel = filterGraphModelToCurrentApis(graphModel);
  const visibleGraphModel = buildFocusedGraphModel(architectureGraphModel, focusedApiId);
  const endpointMap = new Map(visibleGraphModel.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const layout = createGraphLayout(visibleGraphModel, apiPositions, collapsedApiIds);
  const selectedEndpoint = selectedEndpointId ? endpointMap.get(selectedEndpointId) : null;
  const relatedState = getRelatedState(selectedEndpointId, visibleGraphModel);
  const supportsFileSystemAccess = typeof window !== "undefined" && "showOpenFilePicker" in window;
  const supportsDirectoryPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;
  const viewWidth = VIEWPORT_WIDTH / camera.zoom;
  const viewHeight = VIEWPORT_HEIGHT / camera.zoom;
  const graphBounds = getGraphBounds(visibleGraphModel, layout);
  const collapsedPanelCount = Number(detailsCollapsed);
  const sidePanelWidth = collapsedPanelCount === 1 ? 54 : 256;
  const selectedCodePackageNames = selectedZipFiles.length > 0 ? selectedZipFiles.map((file) => file.name).join("、") : "未选择代码包";
  const exportDirectoryLabel = exportDirectoryHandle ? exportDirectoryHandle.name : "浏览器下载 / 未选择";
  const normalizedSearchQuery = apiSearchQuery.trim().toLowerCase();
  const searchMatches = normalizedSearchQuery
    ? architectureGraphModel.apis.filter((api) => api.name.toLowerCase().includes(normalizedSearchQuery))
    : [];
  const activeSearchApi = searchMatches.length > 0 ? searchMatches[((activeSearchMatchIndex % searchMatches.length) + searchMatches.length) % searchMatches.length] : null;
  const visibleApiIds = new Set(visibleGraphModel.apis.map((api) => api.id));
  const visibleSearchMatchIds = new Set(searchMatches.filter((api) => visibleApiIds.has(api.id)).map((api) => api.id));
  const busyLabel = isRefreshing
    ? "Parsing workbook and refreshing graph..."
    : isGeneratingWorkbook
      ? "Scanning selected zip files and generating workbook..."
      : exportState;
  const loadedAtLabel = formatLoadedTime(graphModel.loadedAt);
  const importedSystemLabel = fileHandle?.name ?? generatedWorkbookFileName ?? graphModel.sourceName;

  function pushToast(type, message) {
    if (!message) return;
    const id = `${type}-${toastCounterRef.current += 1}`;
    setToasts((current) => [...current, { id, type, message }].slice(-4));
    const timeoutId = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      toastTimeoutsRef.current.delete(id);
    }, type === "error" ? 4200 : 2600);
    toastTimeoutsRef.current.set(id, timeoutId);
  }

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useGSAP(
    () => {
      const shell = shellRef.current;
      if (!shell) return;

      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline
        .fromTo(
          ".glow",
          { autoAlpha: 0, scale: 0.82 },
          { autoAlpha: 1, scale: 1, duration: 0.9, stagger: 0.08 },
          0
        )
        .fromTo(
          headerRef.current,
          { autoAlpha: 0, y: 24 },
          { autoAlpha: 1, y: 0, duration: 0.78 },
          0.06
        )
        .fromTo(
          workspaceRef.current,
          { autoAlpha: 0, y: 18 },
          { autoAlpha: 1, y: 0, duration: 0.64 },
          0.18
        );
    },
    { scope: shellRef }
  );

  useGSAP(
    () => {
      if (toasts.length === 0) return;
      gsap.fromTo(
        ".toast-card",
        { autoAlpha: 0, x: 18, y: 4 },
        { autoAlpha: 1, x: 0, y: 0, duration: 0.32, ease: "power2.out", stagger: 0.04 }
      );
    },
    { dependencies: [toasts], scope: shellRef }
  );

  useEffect(() => () => {
    if (autoArrangeAnimationRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(autoArrangeAnimationRef.current);
    }
    toastTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
  }, []);

  useEffect(() => {
    if (!isCanvasFullscreen || typeof window === "undefined") return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape") setIsCanvasFullscreen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isCanvasFullscreen]);

  useEffect(() => {
    setCollapsedApiIds((currentIds) => {
      const nextIds = new Set([...currentIds].filter((apiId) => architectureGraphModel.apis.some((api) => api.id === apiId)));
      return nextIds.size === currentIds.size ? currentIds : nextIds;
    });
  }, [architectureGraphModel]);

  useEffect(() => {
    if (focusedApiId && !architectureGraphModel.apis.some((api) => api.id === focusedApiId)) setFocusedApiId(null);
  }, [focusedApiId, architectureGraphModel]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveSearchMatchIndex(0);
      return;
    }
    setActiveSearchMatchIndex((currentIndex) => Math.min(currentIndex, searchMatches.length - 1));
  }, [searchMatches.length]);

  useEffect(() => {
    if (!toastReadyRef.current) {
      toastReadyRef.current = true;
      return;
    }
    if (statusMessage && statusMessage !== lastStatusRef.current) {
      lastStatusRef.current = statusMessage;
      pushToast("status", statusMessage);
    }
  }, [statusMessage]);

  useEffect(() => {
    if (!toastReadyRef.current) return;
    if (errorMessage && errorMessage !== lastErrorRef.current) {
      lastErrorRef.current = errorMessage;
      pushToast("error", errorMessage);
    }
    if (!errorMessage) {
      lastErrorRef.current = "";
    }
  }, [errorMessage]);

  useEffect(() => {
    if (!searchPulseApiId) return undefined;
    const timeoutId = window.setTimeout(() => setSearchPulseApiId(null), 1400);
    return () => window.clearTimeout(timeoutId);
  }, [searchPulseApiId]);

  useEffect(() => {
    if (selectedEndpointId && !visibleGraphModel.endpoints.some((endpoint) => endpoint.id === selectedEndpointId)) setSelectedEndpointId(null);
  }, [selectedEndpointId, visibleGraphModel]);

  useEffect(() => {
    if (!pendingCenterApiId) return;
    const apiLayout = layout.apiLayoutMap.get(pendingCenterApiId);
    if (!apiLayout) return;
    const nextZoom = Math.max(cameraRef.current.zoom, SEARCH_ZOOM);
    const titleCenterY = apiLayout.y + HEADER_TOP_PADDING + apiLayout.handleHeight / 2;
    setCamera({ x: apiLayout.x + apiLayout.width / 2 - VIEWPORT_WIDTH / (2 * nextZoom), y: titleCenterY - VIEWPORT_HEIGHT / (2 * nextZoom), zoom: nextZoom });
    setPendingCenterApiId(null);
  }, [layout, pendingCenterApiId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const applyResponsiveDefault = (matchesSmallScreen) => {
      if (panelPreferenceLockedRef.current) return;
      setDetailsCollapsed(matchesSmallScreen);
    };
    applyResponsiveDefault(mediaQuery.matches);
    const handleMediaChange = (event) => applyResponsiveDefault(event.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleMediaChange);
      return () => mediaQuery.removeEventListener("change", handleMediaChange);
    }
    mediaQuery.addListener(handleMediaChange);
    return () => mediaQuery.removeListener(handleMediaChange);
  }, []);

  function toggleDetailsCollapsed() {
    panelPreferenceLockedRef.current = true;
    setDetailsCollapsed((current) => !current);
  }

  function clientPointToWorld(clientX, clientY) {
    const svgRect = svgRef.current?.getBoundingClientRect();
    const currentCamera = cameraRef.current;
    if (!svgRect || !svgRect.width || !svgRect.height) return { x: 0, y: 0 };
    return { x: currentCamera.x + ((clientX - svgRect.left) / svgRect.width) * (VIEWPORT_WIDTH / currentCamera.zoom), y: currentCamera.y + ((clientY - svgRect.top) / svgRect.height) * (VIEWPORT_HEIGHT / currentCamera.zoom) };
  }

  function zoomAtPoint(clientX, clientY, nextZoomValue) {
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect) return;
    const currentCamera = cameraRef.current;
    const nextZoom = clampZoom(nextZoomValue);
    const ratioX = (clientX - svgRect.left) / svgRect.width;
    const ratioY = (clientY - svgRect.top) / svgRect.height;
    const anchorX = currentCamera.x + ratioX * (VIEWPORT_WIDTH / currentCamera.zoom);
    const anchorY = currentCamera.y + ratioY * (VIEWPORT_HEIGHT / currentCamera.zoom);
    setCamera({ x: anchorX - ratioX * (VIEWPORT_WIDTH / nextZoom), y: anchorY - ratioY * (VIEWPORT_HEIGHT / nextZoom), zoom: nextZoom });
  }

  function resetView() {
    setCamera(getFittedCamera(graphBounds));
  }

  function centerApi(apiId) {
    setPendingCenterApiId(apiId);
  }

  function focusSearchMatch(nextIndex) {
    const normalizedQueryValue = apiSearchQuery.trim().toLowerCase();
    if (!normalizedQueryValue) {
      setErrorMessage("Type an API name to search.");
      return;
    }
    if (searchMatches.length === 0) {
      setErrorMessage(`No API matched “${apiSearchQuery}”.`);
      return;
    }

    const safeIndex = ((nextIndex % searchMatches.length) + searchMatches.length) % searchMatches.length;
    const matchedApi = searchMatches[safeIndex];
    setActiveSearchMatchIndex(safeIndex);
    if (focusedApiId && focusedApiId !== matchedApi.id) setFocusedApiId(null);
    setSelectedEndpointId(null);
    setSearchPulseApiId(matchedApi.id);
    centerApi(matchedApi.id);
    setErrorMessage("");
    setStatusMessage(`Centered on ${matchedApi.name} (${safeIndex + 1}/${searchMatches.length}).`);
  }

  function focusApiBySearch() {
    focusSearchMatch(activeSearchMatchIndex);
  }

  function focusNextSearchMatch() {
    focusSearchMatch(activeSearchMatchIndex + 1);
  }

  function focusPreviousSearchMatch() {
    focusSearchMatch(activeSearchMatchIndex - 1);
  }

  function toggleApiCollapsed(apiId) {
    setCollapsedApiIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(apiId)) nextIds.delete(apiId); else nextIds.add(apiId);
      return nextIds;
    });
  }

  function toggleAllApisCollapsed() {
    setCollapsedApiIds((currentIds) => {
      const visibleApiIds = visibleGraphModel.apis.map((api) => api.id);
      const allCollapsed = visibleApiIds.length > 0 && visibleApiIds.every((apiId) => currentIds.has(apiId));
      const nextIds = new Set(currentIds);
      if (allCollapsed) {
        visibleApiIds.forEach((apiId) => nextIds.delete(apiId));
      } else {
        visibleApiIds.forEach((apiId) => nextIds.add(apiId));
      }
      return nextIds;
    });
  }

  function toggleApiFocus(apiId) {
    setFocusedApiId((currentApiId) => {
      const nextFocusedApiId = currentApiId === apiId ? null : apiId;
      if (nextFocusedApiId) {
        const apiName = graphModel.apis.find((api) => api.id === apiId)?.name ?? apiId;
        setStatusMessage(`Focused view enabled for ${apiName}.`);
        centerApi(apiId);
      } else {
        setStatusMessage(`Showing the full graph again. ${formatGraphSummary(graphModel.summary)}.`);
      }
      return nextFocusedApiId;
    });
  }

  async function applyWorkbookFile(file, nextHandle = null) {
    setIsRefreshing(true);
    setErrorMessage("");
    try {
      const buffer = await file.arrayBuffer();
      const nextModel = await parseWorkbookArrayBuffer(buffer, file.name);
      startTransition(() => {
        const nextPositions = {};
        const nextLayout = createGraphLayout(nextModel, nextPositions);
        setGraphModel(nextModel);
        setCollapsedApiIds(new Set());
        setFocusedApiId(null);
        setApiSearchQuery("");
        setGeneratedWorkbookBase64(null);
        setGeneratedWorkbookFileName(null);
        setSelectedEndpointId((currentId) => (nextModel.endpoints.some((endpoint) => endpoint.id === currentId) ? currentId : null));
        setApiPositions((currentPositions) => filterApiPositions(currentPositions, nextModel));
        setCamera(getFittedCamera(getGraphBounds(nextModel, nextLayout)));
      });
      if (nextHandle) setFileHandle(nextHandle);
      setStatusMessage(`Loaded ${file.name} / ${nextModel.sheetName}. ${formatGraphSummary(nextModel.summary)}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Workbook parsing failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function chooseExcelFile() {
    setErrorMessage("");
    if (supportsFileSystemAccess) {
      const [handle] = await window.showOpenFilePicker({
        excludeAcceptAllOption: false,
        multiple: false,
        types: [{ description: "Excel Workbook", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] } }]
      });
      if (!handle) return;
      const file = await handle.getFile();
      await applyWorkbookFile(file, handle);
      return;
    }
    inputRef.current?.click();
  }

  async function refreshWorkbook() {
    setErrorMessage("");
    if (fileHandle) {
      const file = await fileHandle.getFile();
      await applyWorkbookFile(file, fileHandle);
      return;
    }
    inputRef.current?.click();
  }

  function chooseZipFile() {
    setErrorMessage("");
    zipInputRef.current?.click();
  }

  async function chooseExportDirectory() {
    setErrorMessage("");
    if (!supportsDirectoryPicker) {
      setStatusMessage("This browser does not support choosing an export folder. The workbook will download normally instead.");
      return;
    }
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    if (!handle) return;
    setExportDirectoryHandle(handle);
    setStatusMessage(`Export folder selected: ${handle.name}`);
  }

  async function saveGeneratedWorkbook(resultLike = null) {
    const outputFileName = resultLike?.outputFileName ?? generatedWorkbookFileName;
    const workbookBlob = resultLike?.workbookBlob ?? (generatedWorkbookBase64 ? base64ToBlob(generatedWorkbookBase64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") : null);
    if (!outputFileName || !workbookBlob) return "";
    if (exportDirectoryHandle) {
      const fileHandle = await exportDirectoryHandle.getFileHandle(outputFileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(workbookBlob);
      await writable.close();
      return `已生成并保存到 ${exportDirectoryHandle.name}\\${outputFileName}`;
    }
    const objectUrl = URL.createObjectURL(workbookBlob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = outputFileName;
    link.click();
    URL.revokeObjectURL(objectUrl);
    return `已生成 ${outputFileName}，浏览器已触发下载。`;
  }

  async function generateWorkbookFromZip() {
    if (selectedZipFiles.length === 0) {
      setErrorMessage("Select at least one Mule repo zip file first.");
      return;
    }
    setIsGeneratingWorkbook(true);
    setErrorMessage("");
    try {
      setStatusMessage(`Processing ${selectedZipFiles.length} selected zip file(s)...`);
      const result = await requestZipWorkbook(selectedZipFiles);
      const nextGraphModel = normalizeGraphModel(result.graph, { sourceName: result.workbookFileName ?? "Generated workbook" });
      setGeneratedWorkbookBase64(result.workbookBase64);
      setGeneratedWorkbookFileName(result.workbookFileName);
      const workbookBlob = base64ToBlob(result.workbookBase64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const saveMessage = await saveGeneratedWorkbook({ outputFileName: result.workbookFileName, workbookBlob });
      startTransition(() => {
        const nextPositions = {};
        const nextLayout = createGraphLayout(nextGraphModel, nextPositions);
        setGraphModel(nextGraphModel);
        setCollapsedApiIds(new Set());
        setFocusedApiId(null);
        setApiSearchQuery("");
        setSelectedEndpointId(null);
        setApiPositions(nextPositions);
        setCamera(getFittedCamera(getGraphBounds(nextGraphModel, nextLayout)));
      });
      setStatusMessage(`${saveMessage} Merged ${selectedZipFiles.length} zip file(s) and switched the graph to the combined result. ${formatGraphSummary(nextGraphModel.summary)}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Zip to workbook generation failed.");
    } finally {
      setIsGeneratingWorkbook(false);
    }
  }

  function resetLayout() {
    if (autoArrangeAnimationRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(autoArrangeAnimationRef.current);
      autoArrangeAnimationRef.current = null;
    }
    const nextPositions = {};
    const nextLayout = createGraphLayout(visibleGraphModel, nextPositions, collapsedApiIds);
    setApiPositions(nextPositions);
    setCamera(getFittedCamera(getGraphBounds(visibleGraphModel, nextLayout)));
  }

  function autoArrangeLayout() {
    if (typeof window === "undefined") return;
    if (autoArrangeAnimationRef.current !== null) {
      window.cancelAnimationFrame(autoArrangeAnimationRef.current);
      autoArrangeAnimationRef.current = null;
    }

    const nextPositions = createAutoArrangePositions(visibleGraphModel, apiPositions, collapsedApiIds);
    const nextLayout = createGraphLayout(visibleGraphModel, nextPositions, collapsedApiIds);
    const nextCamera = getFittedCamera(getGraphBounds(visibleGraphModel, nextLayout));
    const startPositions = Object.fromEntries(Array.from(layout.apiLayoutMap.entries()).map(([apiId, apiLayout]) => [apiId, { x: apiLayout.x, y: apiLayout.y }]));
    const movingApiIds = visibleGraphModel.apis
      .map((api) => api.id)
      .filter((apiId) => {
        const start = startPositions[apiId] ?? nextPositions[apiId];
        const end = nextPositions[apiId] ?? start;
        return start && end && (Math.abs(end.x - start.x) > 0.5 || Math.abs(end.y - start.y) > 0.5);
      });

    if (movingApiIds.length === 0) {
      setApiPositions(nextPositions);
      setCamera(nextCamera);
      return;
    }

    const animationStart = window.performance.now();
    const easeOutCubic = (value) => 1 - (1 - value) ** 3;
    let lastFrameTimestamp = 0;

    const step = (timestamp) => {
      if (timestamp - lastFrameTimestamp < 16 && timestamp !== animationStart) {
        autoArrangeAnimationRef.current = window.requestAnimationFrame(step);
        return;
      }
      lastFrameTimestamp = timestamp;

      const progress = Math.min((timestamp - animationStart) / AUTO_ARRANGE_ANIMATION_MS, 1);
      const easedProgress = easeOutCubic(progress);
      const interpolatedPositions = {};

      movingApiIds.forEach((apiId) => {
        const start = startPositions[apiId] ?? nextPositions[apiId];
        const end = nextPositions[apiId] ?? start;
        interpolatedPositions[apiId] = {
          x: start.x + (end.x - start.x) * easedProgress,
          y: start.y + (end.y - start.y) * easedProgress
        };
      });

      setApiPositions((currentPositions) => ({ ...currentPositions, ...interpolatedPositions }));

      if (progress < 1) {
        autoArrangeAnimationRef.current = window.requestAnimationFrame(step);
        return;
      }

      autoArrangeAnimationRef.current = null;
      setApiPositions(nextPositions);
      setCamera(nextCamera);
    };

    autoArrangeAnimationRef.current = window.requestAnimationFrame(step);
  }

  function handleDragStart(event, api, apiLayout) {
    if (autoArrangeAnimationRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(autoArrangeAnimationRef.current);
      autoArrangeAnimationRef.current = null;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressClearRef.current = true;
    const point = clientPointToWorld(event.clientX, event.clientY);
    dragStateRef.current = { apiId: api.id, offsetX: point.x - apiLayout.x, offsetY: point.y - apiLayout.y, currentPosition: { x: apiLayout.x, y: apiLayout.y } };
    setIsDragging(true);
  }

  function handlePanStart(event) {
    if (event.target !== event.currentTarget) return;
    panStateRef.current = { clientX: event.clientX, clientY: event.clientY, cameraX: cameraRef.current.x, cameraY: cameraRef.current.y, zoom: cameraRef.current.zoom };
  }

  function stopTextInteraction(event) {
    event.stopPropagation();
  }

  function handleCopyText(event, text, label, token) {
    event.stopPropagation();
    copyTextToClipboard(
      text,
      () => {
        if (copyTimeoutRef.current) {
          window.clearTimeout(copyTimeoutRef.current);
        }
        setCopiedToken(token);
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopiedToken(null);
          copyTimeoutRef.current = null;
        }, 1200);
        setStatusMessage(`已复制${label}: ${text}`);
        setErrorMessage("");
      },
      () => {
        setErrorMessage(`复制${label}失败。`);
      }
    );
  }

  async function exportCanvasAsPdf() {
    if (!svgRef.current) return;
    setErrorMessage("");
    setExportState("Exporting PDF canvas...");
    const palette = getThemePalette();
    const width = Math.max(Math.ceil(graphBounds.maxX - graphBounds.minX + EXPORT_PADDING * 2), VIEWPORT_WIDTH);
    const height = Math.max(Math.ceil(graphBounds.maxY - graphBounds.minY + EXPORT_PADDING * 2), VIEWPORT_HEIGHT);
    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-20000px";
    wrapper.style.top = "0";
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    wrapper.style.background = palette.background;
    const svgClone = svgRef.current.cloneNode(true);
    svgClone.setAttribute("width", String(width));
    svgClone.setAttribute("height", String(height));
    svgClone.setAttribute("viewBox", `${graphBounds.minX - EXPORT_PADDING} ${graphBounds.minY - EXPORT_PADDING} ${width} ${height}`);
    const backgroundRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    backgroundRect.setAttribute("x", String(graphBounds.minX - EXPORT_PADDING));
    backgroundRect.setAttribute("y", String(graphBounds.minY - EXPORT_PADDING));
    backgroundRect.setAttribute("width", String(width));
    backgroundRect.setAttribute("height", String(height));
    backgroundRect.setAttribute("fill", palette.background);
    const defs = svgClone.querySelector("defs");
    if (defs?.nextSibling) svgClone.insertBefore(backgroundRect, defs.nextSibling);
    else svgClone.appendChild(backgroundRect);
    wrapper.appendChild(svgClone);
    document.body.appendChild(wrapper);
    try {
      const dataUrl = await toPng(wrapper, { cacheBust: true, pixelRatio: 2, backgroundColor: palette.background });
      const pdf = new jsPDF({ orientation: width >= height ? "landscape" : "portrait", unit: "px", format: [width, height] });
      pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
      pdf.save("api-graph-canvas.pdf");
      setStatusMessage("PDF canvas exported.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF export failed.");
    } finally {
      setExportState("");
      document.body.removeChild(wrapper);
    }
  }

  function exportCanvasAsDrawio() {
    try {
      setExportState("Exporting draw.io file...");
      const xml = buildDrawioXml(visibleGraphModel, layout, collapsedApiIds, graphBounds);
      downloadTextFile(xml, "api-graph-canvas.drawio.xml", "application/xml;charset=utf-8");
      setStatusMessage("draw.io XML exported.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "draw.io export failed.");
    } finally {
      setExportState("");
    }
  }

  useEffect(() => {
    function handlePointerMove(event) {
      const dragState = dragStateRef.current;
      if (panStateRef.current) {
        const svgRect = svgRef.current?.getBoundingClientRect();
        if (!svgRect) return;
        const viewScaleX = (VIEWPORT_WIDTH / panStateRef.current.zoom) / svgRect.width;
        const viewScaleY = (VIEWPORT_HEIGHT / panStateRef.current.zoom) / svgRect.height;
        const deltaX = (event.clientX - panStateRef.current.clientX) * viewScaleX;
        const deltaY = (event.clientY - panStateRef.current.clientY) * viewScaleY;
        setCamera({ x: panStateRef.current.cameraX - deltaX, y: panStateRef.current.cameraY - deltaY, zoom: panStateRef.current.zoom });
        return;
      }
      if (!dragState) return;
      const api = visibleGraphModel.apis.find((item) => item.id === dragState.apiId);
      if (!api) return;
      const point = clientPointToWorld(event.clientX, event.clientY);
      const nextPosition = { x: point.x - dragState.offsetX, y: point.y - dragState.offsetY };
      if (!Number.isFinite(nextPosition.x) || !Number.isFinite(nextPosition.y)) return;
      dragStateRef.current = { ...dragState, currentPosition: nextPosition };
      setApiPositions((currentPositions) => ({ ...currentPositions, [dragState.apiId]: nextPosition }));
    }

    function handlePointerUp() {
      if (panStateRef.current) panStateRef.current = null;
      if (dragStateRef.current) {
        const dragState = dragStateRef.current;
        const currentLayout = layoutRef.current;
        const currentApiLayout = currentLayout.apiLayoutMap.get(dragState.apiId);
        if (currentApiLayout) {
          const desiredPosition = dragState.currentPosition ?? { x: currentApiLayout.x, y: currentApiLayout.y };
          const otherLayouts = Array.from(currentLayout.apiLayoutMap.entries()).filter(([apiId]) => apiId !== dragState.apiId).map(([, otherLayout]) => otherLayout);
          const snappedPosition = findNearestNonOverlappingPosition(desiredPosition, { width: currentApiLayout.width, height: currentApiLayout.height }, otherLayouts, API_CARD_GAP);
          setApiPositions((currentPositions) => ({ ...currentPositions, [dragState.apiId]: snappedPosition }));
        }
        dragStateRef.current = null;
        setIsDragging(false);
        window.setTimeout(() => {
          suppressClearRef.current = false;
        }, 0);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [visibleGraphModel]);

  return (
    <main ref={shellRef} className="graph-shell">
      <div className="glow glow-left" />
      <div className="glow glow-right" />

      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden-input" onChange={async (event) => { const file = event.target.files?.[0]; if (file) await applyWorkbookFile(file); event.target.value = ""; }} />
      <input ref={zipInputRef} type="file" accept=".zip" multiple className="hidden-input" onChange={(event) => { const files = Array.from(event.target.files ?? []); setSelectedZipFiles(files); if (files.length > 0) setStatusMessage(files.length === 1 ? `Selected Mule repo zip: ${files[0].name}` : `Selected ${files.length} Mule repo zip files in processing order.`); event.target.value = ""; }} />

      <section ref={headerRef} className="graph-header panel">
        <div className="hero-copy-block">
          <h1>
            <span>API ENDPOINT FLOW TRACING</span>
          </h1>
          <p className="intro-copy">CENTRAL TRACE FIELD: Compact search, aggressive canvas space, sharp route tracing, and docked telemetry on a single screen.</p>
        </div>
        <div className="summary-stack">
          <div className="top-menu-rail panel">
            <div className="top-rail-row">
              <div className="toolbar-menu-bar top-rail-menu-bar">
                <div className="menu-group">
                  <button type="button" className="action-button action-secondary menu-trigger">CODE ANALYSIS</button>
                  <div className="menu-dropdown">
                    <button type="button" className="menu-item-button" onClick={chooseZipFile} disabled={isGeneratingWorkbook}>Choose zip files</button>
                    <button type="button" className="menu-item-button" onClick={chooseExportDirectory} disabled={isGeneratingWorkbook}>Choose export folder</button>
                    <button type="button" className="menu-item-button" onClick={generateWorkbookFromZip} disabled={isGeneratingWorkbook}>{isGeneratingWorkbook ? "Generating..." : "Generate workbook"}</button>
                    {fileHandle ? <button type="button" className="menu-item-button" onClick={refreshWorkbook} disabled={isRefreshing}>Refresh workbook</button> : null}
                    {generatedWorkbookBase64 ? <button type="button" className="menu-item-button" onClick={() => saveGeneratedWorkbook()}>Download workbook</button> : null}
                  </div>
                </div>
                <div className="menu-group">
                  <button type="button" className="action-button action-secondary menu-trigger">EXPORT</button>
                  <div className="menu-dropdown">
                    <button type="button" className="menu-item-button" onClick={exportCanvasAsPdf}>Export PDF</button>
                    <button type="button" className="menu-item-button" onClick={exportCanvasAsDrawio}>Export draw.io</button>
                  </div>
                </div>
                <div className="menu-group">
                  <button type="button" className="action-button action-primary menu-trigger" disabled={isRefreshing}>OPEN WORKBOOK</button>
                  <div className="menu-dropdown">
                    <button type="button" className="menu-item-button" onClick={chooseExcelFile} disabled={isRefreshing}>Choose workbook</button>
                    {fileHandle ? <button type="button" className="menu-item-button" onClick={refreshWorkbook} disabled={isRefreshing}>Refresh workbook</button> : null}
                  </div>
                </div>
              </div>

              <div className="header-file-info">
                <span className="header-file-label">[ IMPORTED SYSTEM ]</span>
                <strong className="header-file-name">{importedSystemLabel}</strong>
                <span className="header-file-meta">{busyLabel ? `[ STATUS: ${busyLabel} ]` : `[ SOURCE: ${graphModel.sourceName} ] [ SHEET: ${graphModel.sheetName} ] [ LOADED: ${loadedAtLabel || "JUST NOW"} ]`}</span>
              </div>
            </div>
          </div>

          <div className="toolbar-top-row bridge-row">
            <div className="header-scale-bridge panel">
              <span className="toolbar-cluster-label">[ LIVE SCALE ]</span>
              <div className="toolbar-scale-items">
                <span className="toolbar-scale-chip"><span className="toolbar-scale-key">[API]</span><strong className="toolbar-scale-value">{visibleGraphModel.summary.apiCount}</strong></span>
                <span className="toolbar-scale-chip"><span className="toolbar-scale-key">[ENDPOINT]</span><strong className="toolbar-scale-value">{visibleGraphModel.summary.endpointCount}</strong></span>
                <span className="toolbar-scale-chip"><span className="toolbar-scale-key">[FLOW]</span><strong className="toolbar-scale-value">{visibleGraphModel.summary.edgeCount}</strong></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={workspaceRef} className={`workspace-grid${isCanvasFullscreen ? " canvas-fullscreen" : ""}`} style={{ gridTemplateColumns: isCanvasFullscreen ? "minmax(0, 1fr)" : `minmax(0, 1fr) ${sidePanelWidth}px` }}>
        <section className={`panel graph-panel${isCanvasFullscreen ? " canvas-fullscreen" : ""}`}>
          <GraphToolbar
            query={apiSearchQuery}
            onQueryChange={setApiSearchQuery}
            onSubmit={focusApiBySearch}
            onPreviousMatch={focusPreviousSearchMatch}
            onNextMatch={focusNextSearchMatch}
            matchCount={searchMatches.length}
            activeMatchIndex={activeSearchApi ? activeSearchMatchIndex : 0}
            disabled={Boolean(busyLabel)}
          />

          <GraphLegend
            zoomPercent={Math.round(camera.zoom * 100)}
            onZoomOut={() => setCamera((current) => ({ ...current, zoom: clampZoom(current.zoom / 1.15) }))}
            onZoomIn={() => setCamera((current) => ({ ...current, zoom: clampZoom(current.zoom * 1.15) }))}
            onFit={resetView}
            onCollapseAll={toggleAllApisCollapsed}
            allCollapsed={visibleGraphModel.apis.length > 0 && visibleGraphModel.apis.every((api) => collapsedApiIds.has(api.id))}
            onResetLayout={resetLayout}
            onAutoArrange={autoArrangeLayout}
            onToggleFullscreen={() => setIsCanvasFullscreen((current) => !current)}
            isCanvasFullscreen={isCanvasFullscreen}
            disabled={Boolean(busyLabel)}
          />

          <GraphCanvas
            busyLabel={busyLabel}
            stageRef={graphStageRef}
            svgRef={svgRef}
            camera={camera}
            viewWidth={viewWidth}
            viewHeight={viewHeight}
            graphBounds={graphBounds}
            layout={layout}
            graphModel={visibleGraphModel}
            endpointMap={endpointMap}
            relatedState={relatedState}
            selectedEndpointId={selectedEndpointId}
            collapsedApiIds={collapsedApiIds}
            focusedApiId={focusedApiId}
            visibleSearchMatchIds={visibleSearchMatchIds}
            activeSearchApi={activeSearchApi}
            hoveredApiId={hoveredApiId}
            setHoveredApiId={setHoveredApiId}
            hoveredEndpointId={hoveredEndpointId}
            setHoveredEndpointId={setHoveredEndpointId}
            hoveredEdgeId={hoveredEdgeId}
            setHoveredEdgeId={setHoveredEdgeId}
            searchPulseApiId={searchPulseApiId}
            copiedToken={copiedToken}
            onPanStart={handlePanStart}
            onDragStart={handleDragStart}
            onToggleApiCollapsed={toggleApiCollapsed}
            onToggleApiFocus={toggleApiFocus}
            onStopTextInteraction={stopTextInteraction}
            onCopyText={handleCopyText}
            onSelectEndpoint={(endpointId) => setSelectedEndpointId((currentId) => currentId === endpointId ? null : endpointId)}
            onWheel={(event) => {
              event.preventDefault();
              const factor = event.deltaY > 0 ? 1 / 1.08 : 1.08;
              zoomAtPoint(event.clientX, event.clientY, cameraRef.current.zoom * factor);
            }}
            onStageClick={() => {
              if (suppressClearRef.current) {
                suppressClearRef.current = false;
                return;
              }
              if (hasActiveTextSelection()) return;
            }}
            createEdgePath={createEdgePath}
            isDragging={isDragging}
            getBlockTextStartY={getBlockTextStartY}
            uiMetrics={UI_METRICS}
          />
        </section>

        {!isCanvasFullscreen ? <Sidebar collapsedPanelCount={collapsedPanelCount} detailsCollapsed={detailsCollapsed} onToggleDetails={toggleDetailsCollapsed} selectedEndpoint={selectedEndpoint} endpointMap={endpointMap} relatedState={relatedState} focusedApiId={focusedApiId} onClearSelection={() => setSelectedEndpointId(null)} onClearFocus={() => setFocusedApiId(null)} getEndpointLabel={getEndpointLabel} /> : null}
      </section>

      <StatusBar statusMessage={statusMessage} errorMessage={errorMessage} summary={formatGraphSummary(visibleGraphModel.summary)} sourceName={graphModel.sourceName} busyLabel={busyLabel} toasts={toasts} />
    </main>
  );
}
