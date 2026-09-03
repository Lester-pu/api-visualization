const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const fallbackRelationRows = [
  { id: 1, currentApi: "Journey eAPI", currentEndpoint: "order", downstreamApi: "OMS xAPI", downstreamEndpoint: "order" },
  { id: 2, currentApi: "Journey eAPI", currentEndpoint: "product", downstreamApi: "Catalog xAPI", downstreamEndpoint: "product" },
  { id: 3, currentApi: "Journey eAPI", currentEndpoint: "client", downstreamApi: "Client pAPI", downstreamEndpoint: "client" }
];

function cleanCellValue(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeApiShape(api) {
  return {
    ...api,
    id: cleanCellValue(api?.id),
    name: cleanCellValue(api?.name),
    kind: cleanCellValue(api?.kind) || "isolated",
    businessGroups: toArray(api?.businessGroups).map(cleanCellValue).filter(Boolean),
    businessGroupSources: toArray(api?.businessGroupSources ?? api?.businessGroupSource).map(cleanCellValue).filter(Boolean),
    endpointIds: toArray(api?.endpointIds).map(cleanCellValue).filter(Boolean),
    incoming: Number(api?.incoming ?? 0),
    outgoing: Number(api?.outgoing ?? 0)
  };
}

function normalizeEndpointShape(endpoint) {
  return {
    ...endpoint,
    id: cleanCellValue(endpoint?.id),
    apiId: cleanCellValue(endpoint?.apiId),
    apiName: cleanCellValue(endpoint?.apiName),
    endpointName: cleanCellValue(endpoint?.endpointName)
  };
}

function normalizeEdgeShape(edge) {
  return {
    ...edge,
    id: cleanCellValue(edge?.id),
    fromId: cleanCellValue(edge?.fromId),
    toId: cleanCellValue(edge?.toId),
    sources: toArray(edge?.sources).map(cleanCellValue).filter(Boolean),
    rowIds: toArray(edge?.rowIds)
  };
}

function withGraphMetadata(graph, metadata = {}) {
  return {
    ...graph,
    insights: deriveGraphInsights(graph),
    summary: {
      apiCount: graph.apis.length,
      endpointCount: graph.endpoints.length,
      edgeCount: graph.edges.length,
      rowCount: graph.rows.length
    },
    sourceName: metadata.sourceName ?? "内置示例数据",
    sheetName: metadata.sheetName ?? "Sheet1",
    loadedAt: metadata.loadedAt ?? new Date().toISOString()
  };
}

function toApiId(apiName, businessGroup = "") {
  const normalizedApiName = apiName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const normalizedBusinessGroup = cleanCellValue(businessGroup).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalizedBusinessGroup ? `${normalizedApiName}--${normalizedBusinessGroup}` : normalizedApiName;
}

function toEndpointId(apiName, endpointName, businessGroup = "") {
  return `${toApiId(apiName, businessGroup)}::${endpointName}`;
}

function inferApiKindFromName(apiName) {
  const normalizedName = cleanCellValue(apiName).toLowerCase().replace(/[\s_-]+/g, "");
  if (normalizedName.endsWith("eapi") || normalizedName.endsWith("eapp")) return "source";
  if (normalizedName.endsWith("papi")) return "bridge";
  if (normalizedName.endsWith("xapi") || normalizedName.endsWith("sapi")) return "sink";
  return null;
}

function mergeBusinessGroup(existingGroups, nextValue) {
  const nextGroup = cleanCellValue(nextValue);
  if (!nextGroup) return existingGroups;
  if (!existingGroups.includes(nextGroup)) existingGroups.push(nextGroup);
  return existingGroups;
}

function mergeBusinessGroupSource(existingSources, nextValue) {
  const nextSource = cleanCellValue(nextValue);
  if (!nextSource) return existingSources;
  if (!existingSources.includes(nextSource)) existingSources.push(nextSource);
  return existingSources;
}

function ensureApi(apiMap, apiName, businessGroup = "") {
  const apiId = toApiId(apiName, businessGroup);
  if (!apiMap.has(apiId)) {
    apiMap.set(apiId, { id: apiId, name: apiName, businessGroups: [], businessGroupSources: [], endpointIds: [], incoming: 0, outgoing: 0 });
  }
  const api = apiMap.get(apiId);
  mergeBusinessGroup(api.businessGroups, businessGroup);
  if (cleanCellValue(businessGroup)) mergeBusinessGroupSource(api.businessGroupSources, "explicit");
  return api;
}

function ensureApiWithSource(apiMap, apiName, businessGroup = "", businessGroupSource = "") {
  const api = ensureApi(apiMap, apiName, businessGroup);
  mergeBusinessGroupSource(api.businessGroupSources, businessGroupSource);
  return api;
}

function ensureEndpoint(apiMap, endpointMap, apiName, endpointName, businessGroup = "") {
  const api = ensureApi(apiMap, apiName, businessGroup);
  const endpointId = toEndpointId(apiName, endpointName, businessGroup);
  if (!endpointMap.has(endpointId)) {
    endpointMap.set(endpointId, { id: endpointId, apiId: api.id, apiName, endpointName });
    api.endpointIds.push(endpointId);
  }
  return endpointMap.get(endpointId);
}

export function buildGraphData(rows) {
  const apiMap = new Map();
  const endpointMap = new Map();
  const edgeMap = new Map();

  function addEdge(fromApi, fromEndpoint, fromBusinessGroup, toApi, toEndpoint, toBusinessGroup, sourceKind, rowId) {
    if (!fromApi || !fromEndpoint || !toApi || !toEndpoint) return;
    const fromNode = ensureEndpoint(apiMap, endpointMap, fromApi, fromEndpoint, fromBusinessGroup);
    const toNode = ensureEndpoint(apiMap, endpointMap, toApi, toEndpoint, toBusinessGroup);
    const edgeId = `${fromNode.id}->${toNode.id}`;
    if (!edgeMap.has(edgeId)) {
      edgeMap.set(edgeId, { id: edgeId, fromId: fromNode.id, toId: toNode.id, sources: [], rowIds: [] });
    }
    const edge = edgeMap.get(edgeId);
    if (!edge.sources.includes(sourceKind)) edge.sources.push(sourceKind);
    edge.rowIds.push(rowId);
  }

  rows.forEach((row) => {
    ensureApiWithSource(apiMap, row.currentApi, row.currentBusinessGroup, row.currentBusinessGroupSource);
    if (row.upstreamApi) ensureApiWithSource(apiMap, row.upstreamApi, row.upstreamBusinessGroup, row.upstreamBusinessGroupSource);
    if (row.downstreamApi) ensureApiWithSource(apiMap, row.downstreamApi, row.downstreamBusinessGroup, row.downstreamBusinessGroupSource);
    ensureEndpoint(apiMap, endpointMap, row.currentApi, row.currentEndpoint, row.currentBusinessGroup);
    addEdge(row.upstreamApi, row.upstreamEndpoint, row.upstreamBusinessGroup, row.currentApi, row.currentEndpoint, row.currentBusinessGroup, "upstream", row.id);
    addEdge(row.currentApi, row.currentEndpoint, row.currentBusinessGroup, row.downstreamApi, row.downstreamEndpoint, row.downstreamBusinessGroup, "downstream", row.id);
  });

  const apis = Array.from(apiMap.values());
  const endpoints = Array.from(endpointMap.values());
  const edges = Array.from(edgeMap.values());
  edges.forEach((edge) => {
    const fromEndpoint = endpointMap.get(edge.fromId);
    const toEndpoint = endpointMap.get(edge.toId);
    const fromApi = apiMap.get(fromEndpoint.apiId);
    const toApi = apiMap.get(toEndpoint.apiId);
    fromApi.outgoing += 1;
    toApi.incoming += 1;
  });
  apis.forEach((api) => {
    const inferredKind = inferApiKindFromName(api.name);
    if (inferredKind) api.kind = inferredKind;
    else if (api.incoming === 0 && api.outgoing > 0) api.kind = "source";
    else if (api.incoming > 0 && api.outgoing === 0) api.kind = "sink";
    else if (api.incoming > 0 && api.outgoing > 0) api.kind = "bridge";
    else api.kind = "isolated";
  });
  apis.forEach((api) => {
    api.endpointIds.sort((leftId, rightId) => endpointMap.get(leftId).endpointName.localeCompare(endpointMap.get(rightId).endpointName));
  });
  apis.sort((left, right) => {
    const rank = { source: 0, bridge: 1, sink: 2, isolated: 3 };
    const kindDelta = rank[left.kind] - rank[right.kind];
    if (kindDelta !== 0) return kindDelta;
    return left.name.localeCompare(right.name);
  });
  return { rows, apis, endpoints, edges };
}

export function deriveGraphInsights(graphData) {
  const sourceApis = graphData.apis.filter((api) => api.kind === "source").map((api) => api.name);
  const bridgeApis = graphData.apis.filter((api) => api.kind === "bridge").map((api) => api.name);
  const sinkApis = graphData.apis.filter((api) => api.kind === "sink").map((api) => api.name);
  const busiestApi = [...graphData.apis].sort((left, right) => right.incoming + right.outgoing - (left.incoming + left.outgoing))[0];
  return [
    `共识别 ${graphData.apis.length} 个 API、${graphData.endpoints.length} 个 endpoint、${graphData.edges.length} 条去重后的调用边。`,
    sourceApis.length > 0 ? `入口 API: ${sourceApis.join("、")}` : "当前数据里没有入口 API。",
    bridgeApis.length > 0 ? `处理 API: ${bridgeApis.join("、")}` : "当前数据里没有处理 API。",
    sinkApis.length > 0 ? `代理 API: ${sinkApis.join("、")}${busiestApi ? `；其中连接度最高的是 ${busiestApi.name}` : ""}` : "当前数据里没有代理 API。"
  ];
}

export function createGraphModel(rows, metadata = {}) {
  const graphData = buildGraphData(rows);
  return withGraphMetadata(graphData, metadata);
}

export function normalizeGraphModel(graph, metadata = {}) {
  const normalizedRows = toArray(graph?.rows);
  const normalizedApis = toArray(graph?.apis).map(normalizeApiShape).filter((api) => api.id && api.name);
  const normalizedEndpoints = toArray(graph?.endpoints).map(normalizeEndpointShape).filter((endpoint) => endpoint.id && endpoint.apiId);
  const normalizedEdges = toArray(graph?.edges).map(normalizeEdgeShape).filter((edge) => edge.id && edge.fromId && edge.toId);

  return withGraphMetadata(
    {
      rows: normalizedRows,
      apis: normalizedApis,
      endpoints: normalizedEndpoints,
      edges: normalizedEdges
    },
    {
      sourceName: graph?.sourceName ?? metadata.sourceName,
      sheetName: graph?.sheetName ?? metadata.sheetName,
      loadedAt: graph?.loadedAt ?? metadata.loadedAt
    }
  );
}

export async function parseWorkbookArrayBuffer(arrayBuffer, sourceName = "integration metric.xlsx") {
  const body = new FormData();
  body.append(
    "file",
    new File([arrayBuffer], sourceName, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    })
  );
  const response = await fetch(`${API_BASE_URL}/api/workbook/parse`, {
    method: "POST",
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Excel 解析失败。");
  }
  return normalizeGraphModel(data.graph, { sourceName });
}

export const fallbackGraphModel = createGraphModel(fallbackRelationRows, { sourceName: "内置示例数据", sheetName: "Sheet1" });
