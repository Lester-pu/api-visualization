from __future__ import annotations

from typing import Any


def clean_cell_value(value: Any) -> str:
    return str(value or "").strip()


def to_api_id(api_name: str, business_group: str = "") -> str:
    normalized_api_name = "-".join(filter(None, "".join(ch.lower() if ch.isalnum() else " " for ch in api_name).split()))
    return normalized_api_name


def to_endpoint_id(api_name: str, endpoint_name: str, business_group: str = "") -> str:
    return f"{to_api_id(api_name, business_group)}::{endpoint_name}"


def infer_api_kind_from_name(api_name: str) -> str | None:
    normalized_name = clean_cell_value(api_name).lower().replace(" ", "").replace("_", "").replace("-", "")
    if normalized_name.endswith("eapi") or normalized_name.endswith("eapp"):
      return "source"
    if normalized_name.endswith("papi"):
      return "bridge"
    if normalized_name.endswith("xapi") or normalized_name.endswith("sapi"):
      return "sink"
    return None


def merge_business_group(existing_groups: list[str], next_value: str) -> list[str]:
    next_group = clean_cell_value(next_value)
    if next_group and next_group not in existing_groups:
        existing_groups.append(next_group)
    return existing_groups


def merge_business_group_source(existing_sources: list[str], next_value: str) -> list[str]:
    next_source = clean_cell_value(next_value)
    if next_source and next_source not in existing_sources:
        existing_sources.append(next_source)
    return existing_sources


def ensure_api(api_map: dict[str, dict[str, Any]], api_name: str, business_group: str = "", business_group_source: str = "") -> dict[str, Any]:
    api_id = to_api_id(api_name, business_group)
    if api_id not in api_map:
        api_map[api_id] = {
            "id": api_id,
            "name": api_name,
            "businessGroups": [],
            "businessGroupSources": [],
            "endpointIds": [],
            "incoming": 0,
            "outgoing": 0,
        }
    api = api_map[api_id]
    merge_business_group(api["businessGroups"], business_group)
    merge_business_group_source(api["businessGroupSources"], business_group_source)
    return api


def ensure_endpoint(api_map: dict[str, dict[str, Any]], endpoint_map: dict[str, dict[str, Any]], api_name: str, endpoint_name: str, business_group: str = "", business_group_source: str = "") -> dict[str, Any]:
    api = ensure_api(api_map, api_name, business_group, business_group_source)
    endpoint_id = to_endpoint_id(api_name, endpoint_name, business_group)
    if endpoint_id not in endpoint_map:
        endpoint_map[endpoint_id] = {
            "id": endpoint_id,
            "apiId": api["id"],
            "apiName": api_name,
            "endpointName": endpoint_name,
        }
        api["endpointIds"].append(endpoint_id)
    return endpoint_map[endpoint_id]


def build_graph_data(rows: list[dict[str, Any]]) -> dict[str, Any]:
    api_map: dict[str, dict[str, Any]] = {}
    endpoint_map: dict[str, dict[str, Any]] = {}
    edge_map: dict[str, dict[str, Any]] = {}

    def add_edge(from_api: str, from_endpoint: str, from_business_group: str, from_business_group_source: str, to_api: str, to_endpoint: str, to_business_group: str, to_business_group_source: str, source_kind: str, row_id: int) -> None:
        if not from_api or not from_endpoint or not to_api or not to_endpoint:
            return
        from_node = ensure_endpoint(api_map, endpoint_map, from_api, from_endpoint, from_business_group, from_business_group_source)
        to_node = ensure_endpoint(api_map, endpoint_map, to_api, to_endpoint, to_business_group, to_business_group_source)
        edge_id = f"{from_node['id']}->{to_node['id']}"
        if edge_id not in edge_map:
            edge_map[edge_id] = {"id": edge_id, "fromId": from_node["id"], "toId": to_node["id"], "sources": [], "rowIds": []}
        edge = edge_map[edge_id]
        if source_kind not in edge["sources"]:
            edge["sources"].append(source_kind)
        edge["rowIds"].append(row_id)

    for row in rows:
        ensure_api(api_map, row["currentApi"], row.get("currentBusinessGroup", ""), row.get("currentBusinessGroupSource", ""))
        if row.get("upstreamApi"):
            ensure_api(api_map, row["upstreamApi"], row.get("upstreamBusinessGroup", ""), row.get("upstreamBusinessGroupSource", ""))
        if row.get("downstreamApi"):
            ensure_api(api_map, row["downstreamApi"], row.get("downstreamBusinessGroup", ""), row.get("downstreamBusinessGroupSource", ""))
        ensure_endpoint(api_map, endpoint_map, row["currentApi"], row["currentEndpoint"], row.get("currentBusinessGroup", ""), row.get("currentBusinessGroupSource", ""))
        add_edge(row.get("upstreamApi", ""), row.get("upstreamEndpoint", ""), row.get("upstreamBusinessGroup", ""), row.get("upstreamBusinessGroupSource", ""), row["currentApi"], row["currentEndpoint"], row.get("currentBusinessGroup", ""), row.get("currentBusinessGroupSource", ""), "upstream", row["id"])
        add_edge(row["currentApi"], row["currentEndpoint"], row.get("currentBusinessGroup", ""), row.get("currentBusinessGroupSource", ""), row.get("downstreamApi", ""), row.get("downstreamEndpoint", ""), row.get("downstreamBusinessGroup", ""), row.get("downstreamBusinessGroupSource", ""), "downstream", row["id"])

    apis = list(api_map.values())
    endpoints = list(endpoint_map.values())
    edges = list(edge_map.values())
    for edge in edges:
        from_endpoint = endpoint_map[edge["fromId"]]
        to_endpoint = endpoint_map[edge["toId"]]
        api_map[from_endpoint["apiId"]]["outgoing"] += 1
        api_map[to_endpoint["apiId"]]["incoming"] += 1

    for api in apis:
        inferred_kind = infer_api_kind_from_name(api["name"])
        if inferred_kind:
            api["kind"] = inferred_kind
        elif api["incoming"] == 0 and api["outgoing"] > 0:
            api["kind"] = "source"
        elif api["incoming"] > 0 and api["outgoing"] == 0:
            api["kind"] = "sink"
        elif api["incoming"] > 0 and api["outgoing"] > 0:
            api["kind"] = "bridge"
        else:
            api["kind"] = "isolated"
        api["endpointIds"].sort(key=lambda endpoint_id: endpoint_map[endpoint_id]["endpointName"])

    rank = {"source": 0, "bridge": 1, "sink": 2, "isolated": 3}
    apis.sort(key=lambda item: (rank[item["kind"]], item["name"]))
    return {"rows": rows, "apis": apis, "endpoints": endpoints, "edges": edges}


def derive_graph_insights(graph_data: dict[str, Any]) -> list[str]:
    source_apis = [api["name"] for api in graph_data["apis"] if api["kind"] == "source"]
    bridge_apis = [api["name"] for api in graph_data["apis"] if api["kind"] == "bridge"]
    sink_apis = [api["name"] for api in graph_data["apis"] if api["kind"] == "sink"]
    busiest_api = sorted(graph_data["apis"], key=lambda item: item["incoming"] + item["outgoing"], reverse=True)[0] if graph_data["apis"] else None
    return [
        f"共识别 {len(graph_data['apis'])} 个 API、{len(graph_data['endpoints'])} 个 endpoint、{len(graph_data['edges'])} 条去重后的调用边。",
        f"入口 API: {'、'.join(source_apis)}" if source_apis else "当前数据里没有入口 API。",
        f"处理 API: {'、'.join(bridge_apis)}" if bridge_apis else "当前数据里没有处理 API。",
        (f"代理 API: {'、'.join(sink_apis)}" + (f"；其中连接度最高的是 {busiest_api['name']}" if busiest_api else "")) if sink_apis else "当前数据里没有代理 API。"
    ]


def create_graph_model(rows: list[dict[str, Any]], metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    metadata = metadata or {}
    graph_data = build_graph_data(rows)
    return {
        **graph_data,
        "insights": derive_graph_insights(graph_data),
        "summary": {
            "apiCount": len(graph_data["apis"]),
            "endpointCount": len(graph_data["endpoints"]),
            "edgeCount": len(graph_data["edges"]),
            "rowCount": len(rows),
        },
        "sourceName": metadata.get("sourceName", "上传文件"),
        "sheetName": metadata.get("sheetName", "Relations"),
        "loadedAt": metadata.get("loadedAt"),
    }
