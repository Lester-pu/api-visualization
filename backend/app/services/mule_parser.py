from __future__ import annotations

import re
import zipfile
from html import unescape
from io import BytesIO
from pathlib import Path
from typing import Any

import yaml

from .graph_service import create_graph_model
from .workbook_service import build_workbook_bytes


def normalize_path(value: str | None) -> str:
    return str(value or "").replace("\\", "/").strip("/")


def basename(path_value: str | None) -> str:
    normalized = normalize_path(path_value)
    return normalized.split("/")[-1] if normalized else ""


def join_path(*parts: str) -> str:
    return normalize_path("/".join(part for part in parts if part))


def flatten_object(source: Any, prefix: str = "", target: dict[str, Any] | None = None) -> dict[str, Any]:
    if target is None:
        target = {}
    if isinstance(source, list):
        for index, value in enumerate(source):
            next_prefix = f"{prefix}.{index}" if prefix else str(index)
            flatten_object(value, next_prefix, target)
        return target
    if isinstance(source, dict):
        for key, value in source.items():
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            flatten_object(value, next_prefix, target)
        return target
    if prefix:
        target[prefix] = source
    return target


def parse_properties_text(text: str) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        mapping[key.strip()] = value.strip()
    return mapping


def parse_attributes(fragment: str) -> dict[str, str]:
    return {match.group(1): unescape(match.group(2)) for match in re.finditer(r'([\w:-]+)="([^"]*)"', fragment)}


def parse_pom_metadata(xml_text: str) -> dict[str, str]:
    artifact_id = re.search(r"<artifactId>([^<]+)</artifactId>", xml_text, re.I)
    name = re.search(r"<name>([^<]+)</name>", xml_text, re.I)
    return {"artifactId": artifact_id.group(1).strip() if artifact_id else "", "name": name.group(1).strip() if name else ""}


def infer_business_group_from_path(path_value: str | None) -> str:
    match = re.match(r"^/?([a-z]+)-([a-z]{2})/", str(path_value or ""), re.I)
    if not match:
        return ""
    family_map = {"cst": "Customer-Journey", "eco": "eCommerce", "rtl": "Retail", "dts": "Data-Services", "dpf": "Data-Platform", "sup": "Supply", "mnf": "Manufacturing", "fin": "Finance", "hr": "HR", "lvapp": "LVAPP"}
    family = family_map.get(match.group(1).lower())
    return f"{family}-{match.group(2).lower()}" if family else ""


def normalize_decoded_path(value: str | None) -> str:
    return re.sub(r"/{2,}", "/", str(value or "").replace("\\", "/"))


def parse_base_path_metadata(path_value: str | None) -> dict[str, str]:
    normalized_path = normalize_decoded_path(path_value)
    segments = [segment for segment in normalized_path.split("/") if segment]
    if len(segments) < 3:
        return {"businessGroup": infer_business_group_from_path(normalized_path), "apiName": "", "prefixPath": normalized_path}
    version_index = next((index for index, segment in enumerate(segments) if re.match(r"^v\d+$", segment, re.I)), -1)
    api_index = version_index - 1 if version_index > 0 else -1
    return {"businessGroup": infer_business_group_from_path(normalized_path), "apiName": segments[api_index] if api_index >= 0 else "", "prefixPath": f"/{'/'.join(segments[: version_index + 1])}" if version_index >= 0 else normalized_path}


def sanitize_endpoint_path(path_value: str | None) -> str:
    return normalize_decoded_path(re.sub(r"\?[^\s]*", "", re.sub(r"#\[[\s\S]*?\]", "", str(path_value or "")).strip()))


def derive_display_endpoint_path(resolved_base_path: str, resolved_path: str) -> str:
    cleaned_path = sanitize_endpoint_path(resolved_path)
    if cleaned_path and cleaned_path != "/":
        return cleaned_path if cleaned_path.startswith("/") else f"/{cleaned_path}"
    combined_path = sanitize_endpoint_path(f"{resolved_base_path}{resolved_path}")
    base_metadata = parse_base_path_metadata(resolved_base_path)
    prefix_path = base_metadata.get("prefixPath", "")
    if combined_path and prefix_path and combined_path.startswith(prefix_path):
        relative_path = combined_path[len(prefix_path):]
        return relative_path if relative_path.startswith("/") else f"/{relative_path}"
    return combined_path


def pick_dominant_business_group(candidates: list[str]) -> str:
    counts: dict[str, int] = {}
    for candidate in filter(None, candidates):
        counts[candidate] = counts.get(candidate, 0) + 1
    if not counts:
        return ""
    return sorted(counts.items(), key=lambda item: item[1], reverse=True)[0][0]


def infer_region_from_env_properties_path(env_properties_path: str | None) -> str:
    env_name = basename(env_properties_path).replace("-properties.yaml", "").replace("-properties.yml", "").lower()
    parts = env_name.split("-")
    return parts[-1] if len(parts) > 1 else ""


def strip_cdata(text: str) -> str:
    return re.sub(r"^<!\[CDATA\[|\]\]>$", "", text).strip()


def parse_xml_blocks(xml_text: str, tag_name: str) -> list[dict[str, Any]]:
    pattern = re.compile(rf"<{re.escape(tag_name)}\b([^>]*)>([\s\S]*?)</{re.escape(tag_name)}>")
    return [{"attributes": parse_attributes(match.group(1)), "body": match.group(2)} for match in pattern.finditer(xml_text)]


def parse_set_variables(flow_body: str) -> dict[str, str]:
    pattern = re.compile(r"<ee:set-variable\b([^>]*)>([\s\S]*?)</ee:set-variable>")
    variables: dict[str, str] = {}
    for match in pattern.finditer(flow_body):
        attributes = parse_attributes(match.group(1))
        if attributes.get("variableName"):
            variables[attributes["variableName"]] = strip_cdata(match.group(2))
    return variables


def parse_http_requests(flow_body: str) -> list[dict[str, Any]]:
    requests: list[dict[str, Any]] = []
    paired_pattern = re.compile(r"<http:request\b([^>]*?)>([\s\S]*?)</http:request>")
    self_pattern = re.compile(r"<http:request\b([^>]*?)/>")
    for match in paired_pattern.finditer(flow_body):
        requests.append({"attributes": parse_attributes(match.group(1)), "body": match.group(2)})
    for match in self_pattern.finditer(flow_body):
        requests.append({"attributes": parse_attributes(match.group(1)), "body": ""})
    return requests


def parse_wsc_consumes(flow_body: str) -> list[dict[str, Any]]:
    consumes: list[dict[str, Any]] = []
    pattern = re.compile(r"<wsc:consume\b([^>]*?)/?>(?:([\s\S]*?)</wsc:consume>)?")
    for match in pattern.finditer(flow_body):
        consumes.append({"attributes": parse_attributes(match.group(1)), "body": match.group(2) or ""})
    return consumes


def parse_db_calls(flow_body: str) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    pattern = re.compile(r"<(db:[\w-]+)\b([^>]*?)/?>(?:([\s\S]*?)</\1>)?")
    for match in pattern.finditer(flow_body):
        calls.append({"tag": match.group(1), "attributes": parse_attributes(match.group(2)), "body": match.group(3) or ""})
    return calls


def parse_flow_refs(flow_body: str) -> list[str]:
    refs: list[str] = []
    pattern = re.compile(r"<flow-ref\b([^>]*?)/?>(?:</flow-ref>)?")
    for match in pattern.finditer(flow_body):
        attributes = parse_attributes(match.group(1))
        if attributes.get("name"):
            refs.append(attributes["name"])
    return refs


def select_env_property_files(property_files: list[str], requested_env: str | None) -> list[str]:
    yaml_files = [file_path for file_path in property_files if re.search(r"-properties\.ya?ml$", file_path, re.I) and not re.search(r"secure-properties", file_path, re.I)]
    if requested_env:
        target_name = f"{requested_env.lower()}-properties.yaml"
        requested_file = next((file_path for file_path in yaml_files if basename(file_path).lower() == target_name), None)
        if not requested_file:
            raise ValueError(f"未找到环境配置文件: {requested_env}-properties.yaml")
        return [requested_file]
    default_file = next((file_path for file_path in yaml_files if basename(file_path).lower() == "local-properties.yaml"), None) or (yaml_files[0] if yaml_files else None)
    if not default_file:
        return []
    default_base = re.sub(r"-properties\.ya?ml$", "", basename(default_file), flags=re.I).lower()
    return sorted([file_path for file_path in yaml_files if basename(file_path).lower() == f"{default_base}-properties.yaml" or (basename(file_path).lower().startswith(f"{default_base}-") and basename(file_path).lower().endswith("-properties.yaml"))])


def resolve_property_value(raw_value: str | None, property_map: dict[str, Any]) -> str:
    if not raw_value:
        return ""
    resolved = str(raw_value)
    casefold_map = {str(key).lower(): value for key, value in property_map.items()}
    for _ in range(5):
        def repl(match: re.Match[str]) -> str:
            lookup_key = match.group(1)
            if lookup_key in property_map:
                return str(property_map.get(lookup_key, ""))
            lowered = lookup_key.lower()
            if lowered in casefold_map:
                return str(casefold_map.get(lowered, ""))
            return "{" + lookup_key + "}"
        next_resolved = re.sub(r"\$\{([^}]+)\}", repl, resolved)
        if next_resolved == resolved:
            break
        resolved = next_resolved
    return resolved


def decode_api_kit_path(encoded_path: str | None) -> str:
    decoded = str(encoded_path or "").replace("\\(", "/{").replace(")", "}").replace("\\", "/")
    decoded = normalize_decoded_path(decoded)
    return decoded if decoded.startswith("/") else f"/{decoded}"


def parse_api_kit_flow_name(flow_name: str) -> dict[str, str] | None:
    match = re.match(r"^([A-Za-z]+):(.*?)(?::application\\[^:]+)?(?::[^:]*)$", flow_name)
    if not match:
        return None
    return {"method": match.group(1).upper(), "path": decode_api_kit_path(match.group(2))}


def extract_path_placeholders(endpoint_path: str) -> dict[str, str]:
    return {match.group(1): "{" + match.group(1) + "}" for match in re.finditer(r"\{([^}]+)\}", endpoint_path)}


def evaluate_expression(expression: str, context: dict[str, Any], property_map: dict[str, Any]) -> str:
    trimmed = expression.strip()
    if not trimmed:
        return ""
    if (trimmed.startswith('"') and trimmed.endswith('"')) or (trimmed.startswith("'") and trimmed.endswith("'")):
        return trimmed[1:-1]
    if trimmed.startswith("%dw"):
        script_body = trimmed.split("---")[-1].strip() if "---" in trimmed else trimmed
        return evaluate_expression(script_body, context, property_map)
    if re.match(r"^attributes\.method$", trimmed, re.I):
        return context.get("method", "")
    if re.match(r"^attributes\.rawRequestPath$", trimmed, re.I):
        return context.get("rawRequestPath", "")
    uri_param_match = re.match(r"^attributes\.uriParams\.'([^']+)'$", trimmed)
    if uri_param_match:
        return context.get("uriParams", {}).get(uri_param_match.group(1), "{" + uri_param_match.group(1) + "}")
    query_param_match = re.match(r"^attributes\.queryParams\.'([^']+)'$", trimmed)
    if query_param_match:
        return context.get("queryParams", {}).get(query_param_match.group(1), "{" + query_param_match.group(1) + "}")
    vars_match = re.match(r"^vars\.([A-Za-z0-9_]+)$", trimmed)
    if vars_match:
        return context.get("vars", {}).get(vars_match.group(1), "{" + vars_match.group(1) + "}")
    property_concat_match = re.match(r"^Mule::p\('([^']+)'\)\s*\+\+\s*vars\.([A-Za-z0-9_]+)$", trimmed)
    if property_concat_match:
        left = property_map.get(property_concat_match.group(1), "{" + property_concat_match.group(1) + "}")
        right = context.get("vars", {}).get(property_concat_match.group(2), "{" + property_concat_match.group(2) + "}")
        return f"{left}{right}"
    property_match = re.match(r"^Mule::p\('([^']+)'\)$", trimmed)
    if property_match:
        return str(property_map.get(property_match.group(1), "{" + property_match.group(1) + "}"))
    match_expression = re.match(r"^vars\.([A-Za-z0-9_]+)\s+match\s+\{([\s\S]+)\}$", trimmed, re.M)
    if match_expression:
        current_value = context.get("vars", {}).get(match_expression.group(1), "")
        for case in re.finditer(r'case\s+"([^"]+)"\s*->\s*"([^"]*)"', match_expression.group(2)):
            if current_value == case.group(1):
                return case.group(2)
        else_match = re.search(r'else\s*->\s*"([^"]*)"', match_expression.group(2))
        return else_match.group(1) if else_match else ""
    return trimmed


def evaluate_request_path(raw_path: str | None, context: dict[str, Any], property_map: dict[str, Any]) -> str:
    if not raw_path:
        return ""
    raw_path = str(raw_path)
    if raw_path.startswith("#[") and raw_path.endswith("]"):
        return normalize_decoded_path(evaluate_expression(raw_path[2:-1], context, property_map))
    return normalize_decoded_path(resolve_property_value(raw_path, property_map))


def evaluate_method(raw_method: str | None, context: dict[str, Any], property_map: dict[str, Any] | None = None) -> str:
    if not raw_method:
        return context.get("method", "GET")
    raw_method = str(raw_method)
    if raw_method.startswith("#[") and raw_method.endswith("]"):
        return evaluate_expression(raw_method[2:-1], context, {}).upper()
    if "${" in raw_method and property_map is not None:
        return resolve_property_value(raw_method, property_map).upper()
    return raw_method.upper()


def apply_flow_variables(flow: dict[str, Any], context: dict[str, Any], property_map: dict[str, Any]) -> dict[str, Any]:
    next_context = {**context, "vars": dict(context.get("vars", {}))}
    for name, expression in flow.get("setVariables", {}).items():
        next_context["vars"][name] = evaluate_expression(expression, next_context, property_map)
    return next_context


def derive_downstream_api_name(request_config: dict[str, Any], resolved_base_path: str, resolved_endpoint_path: str) -> str:
    if resolved_base_path:
        segments = [segment for segment in resolved_base_path.split("/") if segment]
        for segment in reversed(segments):
            if not re.match(r"^v\d+$", segment, re.I):
                return segment
    if resolved_endpoint_path:
        for segment in resolved_endpoint_path.split("/"):
            if re.search(r"(papi|sapi|xapi|eapi)$", segment, re.I):
                return segment
    return request_config.get("name", "unknown-target").replace("HTTP_", "").replace("-Request_configuration", "").replace("_", "-")


def traverse_flow(flow_name: str, flows: dict[str, dict[str, Any]], context: dict[str, Any], property_map: dict[str, Any], request_configs: dict[str, dict[str, Any]], visited: set[str] | None = None) -> list[dict[str, Any]]:
    visited = visited or set()
    if not flow_name or flow_name in visited:
        return []
    flow = flows.get(flow_name)
    if not flow:
        return []
    next_visited = set(visited)
    next_visited.add(flow_name)
    next_context = apply_flow_variables(flow, context, property_map)
    relations: list[dict[str, Any]] = []
    for request in flow.get("httpRequests", []):
        request_config = request_configs.get(request["attributes"].get("config-ref", ""))
        resolved_base_path = resolve_property_value(request_config.get("basePath", ""), property_map) if request_config else ""
        resolved_path = evaluate_request_path(request["attributes"].get("path", ""), next_context, property_map)
        downstream_path = derive_display_endpoint_path(resolved_base_path, resolved_path)
        downstream_metadata = parse_base_path_metadata(resolved_base_path or downstream_path)
        relations.append({
            "downstreamApi": (downstream_metadata.get("apiName") or derive_downstream_api_name(request_config, resolved_base_path, downstream_path)) if request_config else request["attributes"].get("config-ref", "unknown-target"),
            "downstreamEndpoint": f"{evaluate_method(request['attributes'].get('method', ''), next_context, property_map)} {downstream_path}",
            "downstreamBusinessGroup": downstream_metadata.get("businessGroup", ""),
            "downstreamBusinessGroupSource": "inferred" if downstream_metadata.get("businessGroup", "") else "",
            "requestConfigName": request["attributes"].get("config-ref", ""),
            "host": resolve_property_value(request_config.get("host", ""), property_map) if request_config else "",
            "protocol": resolve_property_value(request_config.get("protocol", ""), property_map) if request_config else "",
            "port": resolve_property_value(request_config.get("port", ""), property_map) if request_config else "",
            "flowName": flow_name,
        })
    for consume in flow.get("wscConsumes", []):
        relations.append({
            "downstreamApi": consume["attributes"].get("config-ref", "SOAP-Service"),
            "downstreamEndpoint": f"SOAP {consume['attributes'].get('operation', 'consume')}",
            "downstreamBusinessGroup": "SOAP-External",
            "downstreamBusinessGroupSource": "explicit",
            "flowName": flow_name,
        })
    for db_call in flow.get("dbCalls", []):
        relations.append({
            "downstreamApi": db_call["attributes"].get("config-ref", "Database"),
            "downstreamEndpoint": f"DB {db_call['tag'].replace('db:', '')}",
            "downstreamBusinessGroup": "Database",
            "downstreamBusinessGroupSource": "explicit",
            "flowName": flow_name,
        })
    for ref_name in flow.get("flowRefs", []):
        relations.extend(traverse_flow(ref_name, flows, next_context, property_map, request_configs, next_visited))
    return relations


def unique_relations(relations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduplicated: list[dict[str, Any]] = []
    for relation in relations:
        key = "|".join([
            relation.get("currentApi", ""),
            relation.get("currentEndpoint", ""),
            relation.get("currentBusinessGroup", ""),
            relation.get("currentBusinessGroupSource", ""),
            relation.get("downstreamApi", ""),
            relation.get("downstreamEndpoint", ""),
            relation.get("downstreamBusinessGroup", ""),
            relation.get("downstreamBusinessGroupSource", ""),
        ])
        if key in seen:
            continue
        seen.add(key)
        deduplicated.append(relation)
    return deduplicated


def normalize_api_token(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def normalize_api_identity(value: str | None) -> str:
    token = normalize_api_token(value)
    return re.sub(r"(papi|sapi|eapi|xapi)$", "", token)


def is_self_reference_relation(current_api: str | None, downstream_api: str | None) -> bool:
    return bool(normalize_api_token(current_api) and normalize_api_token(current_api) == normalize_api_token(downstream_api))


def to_summary_url(relation: dict[str, Any]) -> str:
    endpoint = relation.get("downstreamEndpoint", "")
    if endpoint.startswith("DB "):
        return endpoint
    if endpoint.startswith("SOAP "):
        return endpoint
    
    protocol = (relation.get("protocol") or "https").lower()
    port = relation.get("port") or ""
    port_segment = f":{port}" if port and port not in {"80", "443"} else ""
    endpoint = re.sub(r"^[A-Z]+\s+", "", relation.get("downstreamEndpoint", ""))
    return f"{protocol}://{relation.get('host', '')}{port_segment}{endpoint}"


def load_zip_entries(zip_bytes: bytes) -> dict[str, bytes]:
    entries: dict[str, bytes] = {}
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        for name in archive.namelist():
            if name.endswith("/"):
                continue
            entries[normalize_path(name)] = archive.read(name)
    return entries


def load_directory_entries(root_path: Path) -> dict[str, bytes]:
    if not root_path.exists():
        raise FileNotFoundError(f"路径不存在: {root_path}")
    base_name = root_path.name
    entries: dict[str, bytes] = {}
    for file_path in root_path.rglob("*"):
        if file_path.is_file():
            relative_path = normalize_path(str(Path(base_name) / file_path.relative_to(root_path)))
            entries[relative_path] = file_path.read_bytes()
    return entries


def infer_repo_root(entry_paths: list[str]) -> str:
    mule_path = next((entry_path for entry_path in entry_paths if "src/main/mule/" in normalize_path(entry_path)), None)
    if not mule_path:
        raise ValueError("输入中没有识别到 src/main/mule 目录。当前版本只支持标准 Mule repo。")
    marker = "src/main/mule/"
    index = normalize_path(mule_path).index(marker)
    return normalize_path(mule_path)[: index - 1] if index > 0 and normalize_path(mule_path)[index - 1] == "/" else normalize_path(mule_path)[:index]


def decode_text(value: bytes) -> str:
    return value.decode("utf-8", errors="ignore")


def parse_request_configs(xml_entries: list[dict[str, str]]) -> dict[str, dict[str, Any]]:
    configs: dict[str, dict[str, Any]] = {}
    for xml_entry in xml_entries:
        blocks = parse_xml_blocks(xml_entry["text"], "http:request-config")
        for block in blocks:
            connection_match = re.search(r"<http:request-connection\b([^>]*)>", block["body"])
            connection_attributes = parse_attributes(connection_match.group(1)) if connection_match else {}
            config_name = block["attributes"].get("name")
            if not config_name:
                continue
            configs[config_name] = {
                "name": config_name,
                "host": connection_attributes.get("host", ""),
                "protocol": connection_attributes.get("protocol", ""),
                "port": connection_attributes.get("port", ""),
                "basePath": block["attributes"].get("basePath", ""),
                "responseTimeout": block["attributes"].get("responseTimeout", ""),
            }
    return configs


def parse_flows(xml_entries: list[dict[str, str]]) -> dict[str, dict[str, Any]]:
    flows: dict[str, dict[str, Any]] = {}
    for xml_entry in xml_entries:
        flow_blocks = parse_xml_blocks(xml_entry["text"], "flow") + parse_xml_blocks(xml_entry["text"], "sub-flow")
        for block in flow_blocks:
            flow_name = block["attributes"].get("name")
            if not flow_name:
                continue
            flows[flow_name] = {
                "name": flow_name,
                "filePath": xml_entry["path"],
                "flowRefs": parse_flow_refs(block["body"]),
                "httpRequests": parse_http_requests(block["body"]),
                "wscConsumes": parse_wsc_consumes(block["body"]),
                "dbCalls": parse_db_calls(block["body"]),
                "setVariables": parse_set_variables(block["body"]),
                "hasApiKitRouter": bool(re.search(r"<apikit:router\b", block["body"])),
            }
    return flows


def extract_api_name(property_map: dict[str, Any], repo_name: str, pom_metadata: dict[str, str]) -> str:
    return str(property_map.get("api.name") or pom_metadata.get("name") or pom_metadata.get("artifactId") or property_map.get("project.name") or repo_name)


def extract_business_group(property_map: dict[str, Any], fallback_candidates: list[str], env_properties_path: str | None = None) -> tuple[str, str]:
    keys = ["bg.name", "bg_name", "business.group", "business_group", "businessGroup", "anypoint.business.group", "anypoint.business_group"]
    region_hint = infer_region_from_env_properties_path(env_properties_path)
    region_candidates = [candidate for candidate in fallback_candidates if region_hint and candidate.lower().endswith(f"-{region_hint}")]
    region_business_group = pick_dominant_business_group(region_candidates)
    for key in keys:
        value = str(property_map.get(key, "")).strip()
        if value:
            if region_business_group and region_hint and not value.lower().endswith(f"-{region_hint}"):
                return region_business_group, "inferred"
            return value, "explicit"
    if region_business_group:
        return region_business_group, "inferred"
    fallback_value = pick_dominant_business_group(fallback_candidates)
    return (fallback_value, "inferred") if fallback_value else ("", "")


def build_property_maps(entries: dict[str, bytes], repo_root: str, requested_env: str | None) -> tuple[list[dict[str, Any]], list[str]]:
    resources_root = join_path(repo_root, "src", "main", "resources")
    property_files = [path for path in entries.keys() if normalize_path(path).startswith(f"{resources_root}/") and re.search(r"\.(yaml|yml|properties)$", path, re.I)]
    shared_property_map: dict[str, Any] = {}
    generic_properties_path = next((file_path for file_path in property_files if basename(file_path).lower() == "properties.yaml"), None)
    if generic_properties_path:
        parsed = yaml.safe_load(decode_text(entries[generic_properties_path])) or {}
        shared_property_map.update(flatten_object(parsed))
    project_properties_path = join_path(repo_root, "project.properties")
    if project_properties_path in entries:
        shared_property_map.update(parse_properties_text(decode_text(entries[project_properties_path])))
    env_paths = select_env_property_files(property_files, requested_env)
    if env_paths:
        variants = []
        for env_path in env_paths:
            parsed = yaml.safe_load(decode_text(entries[env_path])) or {}
            variants.append({"envPropertiesPath": env_path, "propertyMap": {**shared_property_map, **flatten_object(parsed)}})
        return variants, env_paths
    return [{"envPropertiesPath": None, "propertyMap": dict(shared_property_map)}], []


def convert_entries_to_result(entries: dict[str, bytes], source_name: str, env: str | None = None, api_name: str | None = None) -> dict[str, Any]:
    repo_root = infer_repo_root(list(entries.keys()))
    repo_name = basename(repo_root or source_name.replace(".zip", ""))
    pom_path = join_path(repo_root, "pom.xml")
    pom_metadata = parse_pom_metadata(decode_text(entries[pom_path])) if pom_path in entries else {"artifactId": "", "name": ""}
    mule_root = join_path(repo_root, "src", "main", "mule")
    xml_paths = [path for path in entries.keys() if normalize_path(path).startswith(f"{mule_root}/") and path.lower().endswith(".xml")]
    if not xml_paths:
        raise ValueError("输入中没有识别到 Mule XML 文件。请确认是完整 repo 或 zip。")
    xml_entries = [{"path": entry_path, "text": decode_text(entries[entry_path])} for entry_path in xml_paths]
    property_map_variants, env_properties_paths = build_property_maps(entries, repo_root, env)
    request_configs = parse_request_configs(xml_entries)
    flows = parse_flows(xml_entries)
    reverse_lookup = build_reverse_lookup_metadata(flows, property_map_variants)
    relations: list[dict[str, Any]] = []
    current_apis: set[str] = set()
    current_business_groups: set[str] = set()
    current_business_group_sources: set[str] = set()
    for variant in property_map_variants:
        property_map = variant["propertyMap"]
        env_properties_path = variant["envPropertiesPath"]
        request_config_business_groups = [infer_business_group_from_path(resolve_property_value(config.get("basePath", ""), property_map)) for config in request_configs.values()]
        current_api = api_name or extract_api_name(property_map, repo_name, pom_metadata)
        current_business_group, current_business_group_source = extract_business_group(property_map, request_config_business_groups, env_properties_path)
        current_apis.add(current_api)
        if current_business_group:
            current_business_groups.add(current_business_group)
        if current_business_group_source:
            current_business_group_sources.add(current_business_group_source)
        for flow in flows.values():
            endpoint = parse_api_kit_flow_name(flow["name"])
            if not endpoint:
                continue
            context = {"method": endpoint["method"], "rawRequestPath": endpoint["path"], "vars": {}, "uriParams": extract_path_placeholders(endpoint["path"]), "queryParams": {}}
            downstream_relations = traverse_flow(flow["name"], flows, context, property_map, request_configs)
            for relation in downstream_relations:
                relations.append({
                    "id": len(relations) + 1,
                    "currentApi": current_api,
                    "currentEndpoint": f"{endpoint['method']} {endpoint['path']}",
                    "currentBusinessGroup": current_business_group,
                    "currentBusinessGroupSource": current_business_group_source,
                    "upstreamApi": "",
                    "upstreamEndpoint": "",
                    "upstreamBusinessGroup": "",
                    "upstreamBusinessGroupSource": "",
                    "downstreamApi": relation["downstreamApi"],
                    "downstreamEndpoint": relation["downstreamEndpoint"],
                    "downstreamBusinessGroup": relation.get("downstreamBusinessGroup", ""),
                    "downstreamBusinessGroupSource": relation.get("downstreamBusinessGroupSource", "inferred") if relation.get("downstreamBusinessGroup", "") else "",
                    "protocol": relation.get("protocol", ""),
                    "host": relation.get("host", ""),
                    "port": relation.get("port", ""),
                    "flowName": relation.get("flowName", ""),
                })
    deduplicated_relations = unique_relations(relations)
    
    # 如果没有任何下游关系，但我们识别到了 API 入口，我们至少保留入口信息
    if not deduplicated_relations and current_apis:
        for api in current_apis:
            for flow in flows.values():
                endpoint = parse_api_kit_flow_name(flow["name"])
                if endpoint:
                    deduplicated_relations.append({
                        "id": len(deduplicated_relations) + 1,
                        "currentApi": api,
                        "currentEndpoint": f"{endpoint['method']} {endpoint['path']}",
                        "currentBusinessGroup": next(iter(current_business_groups)) if current_business_groups else "",
                        "currentBusinessGroupSource": next(iter(current_business_group_sources)) if current_business_group_sources else "",
                        "downstreamApi": "Internal Processing",
                        "downstreamEndpoint": "Finish",
                        "downstreamBusinessGroup": "Internal",
                        "downstreamBusinessGroupSource": "explicit",
                    })

    notes = {
        "repoName": repo_name,
        "environment": ", ".join(basename(path) for path in env_properties_paths) if env_properties_paths else "未解析",
        "currentApi": ", ".join(sorted(current_apis)),
        "currentBusinessGroup": ", ".join(sorted(current_business_groups)),
        "downstreamSummaries": sorted({to_summary_url(relation) for relation in deduplicated_relations}),
    }
    workbook_bytes = build_workbook_bytes(deduplicated_relations, notes)
    graph_model = create_graph_model(deduplicated_relations, {"sourceName": source_name, "sheetName": "Relations", "loadedAt": None})
    return {
        "relations": deduplicated_relations,
        "notes": notes,
        "workbookBytes": workbook_bytes,
        "outputFileName": f"{repo_name}-visual-metric.xlsx",
        "graphModel": graph_model,
        "reverseLookup": reverse_lookup,
    }


def resolve_api_placeholder(placeholder: str, current_apis_map: dict[str, str]) -> str | None:
    # 提取占位符中的 API 标识符，例如 {papi.appointment.basePath} -> appointment
    match = re.search(r"\{(eapi|papi|sapi|xapi)\.([\w-]+)\.basePath\}", placeholder, re.I)
    if not match:
        return None
    
    layer, api_id = match.group(1).lower(), match.group(2).lower()
    
    # 在当前已解析的 API 列表中寻找最匹配的 ID 或名字
    for raw_name in current_apis_map.keys():
        normalized = raw_name.lower()
        if api_id in normalized or normalized in api_id:
            return current_apis_map[raw_name]
    return None


def split_identifier_tokens(value: str) -> list[str]:
    normalized = re.sub(r"[^A-Za-z0-9]+", " ", str(value or "")).strip()
    parts: list[str] = []
    for chunk in normalized.split():
        parts.extend(re.findall(r"[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+", chunk))
    return [part.lower() for part in parts if part]


def extract_path_segments(path_value: str) -> list[str]:
    raw = re.sub(r"\{[^}]+\}", "", str(path_value or ""))
    return [segment.lower() for segment in raw.split("/") if segment]


def extract_property_key_from_placeholder(path_value: str) -> str:
    matched = re.search(r"\{([^{}]+)\}", str(path_value or ""))
    return matched.group(1) if matched else ""


def normalize_semantic_key(value: str) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())


def build_endpoint_semantic_keys(method: str, endpoint_path: str) -> set[str]:
    segments = extract_path_segments(endpoint_path)
    joined_segments = "".join(segments)
    method_lower = method.lower()
    return {
        normalize_semantic_key(f"{method_lower}{joined_segments}"),
        normalize_semantic_key(joined_segments),
    }


def extract_explicit_placeholder_key(raw_downstream_endpoint: str) -> str:
    raw_path = re.sub(r"^[A-Z]+\s+", "", str(raw_downstream_endpoint or ""))
    property_key = extract_property_key_from_placeholder(raw_path)
    if ".paths." not in property_key:
        return ""
    return property_key.split(".")[-1]


def resolve_downstream_endpoint_with_explicit_evidence(
    method: str,
    raw_downstream_endpoint: str,
    candidates: list[str],
) -> str:
    placeholder_suffix = extract_explicit_placeholder_key(raw_downstream_endpoint)
    if not placeholder_suffix:
        return raw_downstream_endpoint
    placeholder_key = normalize_semantic_key(placeholder_suffix)

    matched_candidates = [
        candidate
        for candidate in candidates
        if placeholder_key in build_endpoint_semantic_keys(method, candidate)
    ]
    if len(matched_candidates) != 1:
        return raw_downstream_endpoint
    return f"{method} {matched_candidates[0]}"


def add_unique(target: dict[str, list[str]], key: str, value: str) -> None:
    if not key or not value:
        return
    target.setdefault(key, [])
    if value not in target[key]:
        target[key].append(value)


def merge_list_map(target: dict[str, list[str]], source: dict[str, list[str]]) -> dict[str, list[str]]:
    for key, values in source.items():
        for value in values:
            add_unique(target, key, value)
    return target


def build_current_endpoint_inventory_from_flows(flows: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    inventory: dict[str, list[str]] = {}
    for flow in flows.values():
        endpoint = parse_api_kit_flow_name(flow.get("name", ""))
        if not endpoint:
            continue
        add_unique(inventory, endpoint["method"], endpoint["path"])
    return inventory


def build_property_path_evidence(property_map_variants: list[dict[str, Any]]) -> dict[str, dict[str, list[str]]]:
    by_full_key: dict[str, list[str]] = {}
    by_suffix: dict[str, list[str]] = {}
    for variant in property_map_variants:
        property_map = variant.get("propertyMap", {})
        for key, value in property_map.items():
            raw_key = str(key or "").strip()
            raw_value = str(value or "").strip()
            if ".paths." not in raw_key:
                continue
            if not raw_value:
                continue
            normalized_value = sanitize_endpoint_path(raw_value)
            if not normalized_value:
                continue
            path_value = normalized_value if normalized_value.startswith("/") else f"/{normalized_value}"
            add_unique(by_full_key, normalize_semantic_key(raw_key), path_value)
            add_unique(by_suffix, normalize_semantic_key(raw_key.split(".")[-1]), path_value)
    return {"byFullKey": by_full_key, "bySuffix": by_suffix}


def build_semantic_endpoint_key_inventory(endpoint_inventory: dict[str, list[str]]) -> dict[str, dict[str, list[str]]]:
    semantic_inventory: dict[str, dict[str, list[str]]] = {}
    for method, paths in endpoint_inventory.items():
        method_inventory: dict[str, list[str]] = {}
        for path in paths:
            for semantic_key in build_endpoint_semantic_keys(method, path):
                add_unique(method_inventory, semantic_key, path)
        semantic_inventory[method] = method_inventory
    return semantic_inventory


def build_reverse_lookup_metadata(flows: dict[str, dict[str, Any]], property_map_variants: list[dict[str, Any]]) -> dict[str, Any]:
    endpoint_inventory = build_current_endpoint_inventory_from_flows(flows)
    property_evidence = build_property_path_evidence(property_map_variants)
    semantic_inventory = build_semantic_endpoint_key_inventory(endpoint_inventory)
    return {
        "endpointInventory": endpoint_inventory,
        "propertyPathsByFullKey": property_evidence["byFullKey"],
        "propertyPathsBySuffix": property_evidence["bySuffix"],
        "semanticEndpointPaths": semantic_inventory,
    }


def resolve_downstream_endpoint_with_reverse_lookup(
    raw_downstream_endpoint: str,
    reverse_lookup: dict[str, Any],
) -> str:
    match = re.match(r"^([A-Z]+)\s+(.+)$", str(raw_downstream_endpoint or ""))
    if not match:
        return raw_downstream_endpoint
    method, path_value = match.group(1), match.group(2)
    if "{" not in path_value:
        return raw_downstream_endpoint

    property_key = extract_property_key_from_placeholder(path_value)
    if not property_key:
        return raw_downstream_endpoint

    normalized_full_key = normalize_semantic_key(property_key)
    normalized_suffix = normalize_semantic_key(property_key.split(".")[-1])

    endpoint_inventory = reverse_lookup.get("endpointInventory", {})
    method_candidates = endpoint_inventory.get(method, [])
    method_candidate_set = set(method_candidates)

    def unique_method_candidate(candidates: list[str]) -> str | None:
        filtered = [candidate for candidate in candidates if candidate in method_candidate_set]
        return filtered[0] if len(filtered) == 1 else None

    # Evidence type 1: exact property full-key => direct path value
    direct_full = unique_method_candidate(reverse_lookup.get("propertyPathsByFullKey", {}).get(normalized_full_key, []))
    if direct_full:
        return f"{method} {direct_full}"

    # Evidence type 2: exact property suffix => direct path value
    direct_suffix = unique_method_candidate(reverse_lookup.get("propertyPathsBySuffix", {}).get(normalized_suffix, []))
    if direct_suffix:
        return f"{method} {direct_suffix}"

    # Evidence type 3: exact placeholder suffix => parsed APIKit endpoint semantic key
    semantic_candidates = reverse_lookup.get("semanticEndpointPaths", {}).get(method, {}).get(normalized_suffix, [])
    semantic_match = unique_method_candidate(semantic_candidates)
    if semantic_match:
        return f"{method} {semantic_match}"

    return raw_downstream_endpoint


def build_api_endpoint_inventory(relations: list[dict[str, Any]], api_name_to_reverse_lookup: dict[str, dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
    inventory: dict[str, dict[str, list[str]]] = {}
    for relation in relations:
        current_api = relation.get("currentApi", "")
        endpoint = relation.get("currentEndpoint", "")
        match = re.match(r"^([A-Z]+)\s+(.+)$", endpoint)
        if not current_api or not match:
            continue
        method, path_value = match.group(1), match.group(2)
        api_key = normalize_api_token(current_api)
        inventory.setdefault(api_key, {}).setdefault(method, [])
        if path_value not in inventory[api_key][method]:
            inventory[api_key][method].append(path_value)
    enriched_inventory: dict[str, dict[str, Any]] = {}
    for api_key, method_map in inventory.items():
        enriched_inventory[api_key] = {"endpoints": method_map, "reverseLookup": {}}
    if api_name_to_reverse_lookup:
        for api_name, reverse_lookup in api_name_to_reverse_lookup.items():
            api_key = normalize_api_token(api_name)
            enriched_inventory.setdefault(api_key, {"endpoints": {}, "reverseLookup": {}})
            enriched_inventory[api_key]["reverseLookup"] = reverse_lookup
    return enriched_inventory


def resolve_downstream_endpoint_with_inventory(
    downstream_api: str,
    raw_downstream_endpoint: str,
    api_endpoint_inventory: dict[str, dict[str, Any]],
) -> str:
    match = re.match(r"^([A-Z]+)\s+(.+)$", str(raw_downstream_endpoint or ""))
    if not match:
        return raw_downstream_endpoint
    method, path_value = match.group(1), match.group(2)
    if "{" not in path_value:
        return raw_downstream_endpoint
    api_inventory = api_endpoint_inventory.get(normalize_api_token(downstream_api), {})
    candidates = api_inventory.get("endpoints", {}).get(method, [])
    if not candidates:
        return raw_downstream_endpoint
    resolved = resolve_downstream_endpoint_with_explicit_evidence(method, raw_downstream_endpoint, candidates)
    if resolved != raw_downstream_endpoint:
        return resolved
    reverse_lookup = api_inventory.get("reverseLookup", {})
    if reverse_lookup:
        return resolve_downstream_endpoint_with_reverse_lookup(raw_downstream_endpoint, reverse_lookup)
    return raw_downstream_endpoint


def convert_zip_files_to_result(files: list[tuple[str, bytes]], env: str | None = None, api_name: str | None = None) -> dict[str, Any]:
    if not files:
        raise ValueError("请至少选择一个 Mule repo zip 文件。")

    individual_results: list[dict[str, Any]] = []
    api_id_to_name_map: dict[str, str] = {}
    canonical_name_by_identity: dict[str, str] = {}
    preferred_bg_by_identity: dict[str, str] = {}
    reverse_lookup_by_canonical_api: dict[str, dict[str, Any]] = {}

    for name, content in files:
        result = convert_entries_to_result(load_zip_entries(content), name, env=env, api_name=api_name)
        individual_results.append(result)
        current_api_name = str(result.get("notes", {}).get("currentApi", "")).strip()
        current_bg = str(result.get("notes", {}).get("currentBusinessGroup", "")).strip()
        if not current_api_name:
            continue

        identity = normalize_api_identity(current_api_name)
        canonical_name_by_identity.setdefault(identity, current_api_name)
        canonical_name = canonical_name_by_identity[identity]
        reverse_lookup_by_canonical_api.setdefault(canonical_name, result.get("reverseLookup", {}))
        if current_bg:
            preferred_bg_by_identity[identity] = current_bg

        api_id_to_name_map[current_api_name.lower()] = canonical_name
        api_id_to_name_map[normalize_api_token(current_api_name)] = canonical_name
        api_id_to_name_map[identity] = canonical_name

    all_relations: list[dict[str, Any]] = []
    for result in individual_results:
        for relation in result.get("relations", []):
            normalized_relation = dict(relation)
            current_name = normalized_relation.get("currentApi", "")
            current_identity = normalize_api_identity(current_name)
            canonical_current = canonical_name_by_identity.get(current_identity, current_name)
            normalized_relation["currentApi"] = canonical_current

            if preferred_bg_by_identity.get(current_identity):
                normalized_relation["currentBusinessGroup"] = preferred_bg_by_identity[current_identity]
                normalized_relation["currentBusinessGroupSource"] = "explicit"

            placeholder = normalized_relation.get("downstreamApi", "")
            resolved_api_name = resolve_api_placeholder(placeholder, api_id_to_name_map)
            if resolved_api_name:
                downstream_identity = normalize_api_identity(resolved_api_name)
                canonical_downstream = canonical_name_by_identity.get(downstream_identity, resolved_api_name)
                normalized_relation["downstreamApi"] = canonical_downstream
                if preferred_bg_by_identity.get(downstream_identity):
                    normalized_relation["downstreamBusinessGroup"] = preferred_bg_by_identity[downstream_identity]
                    normalized_relation["downstreamBusinessGroupSource"] = "explicit"

            all_relations.append(normalized_relation)

    endpoint_inventory = build_api_endpoint_inventory(all_relations, reverse_lookup_by_canonical_api)
    for relation in all_relations:
        relation["downstreamEndpoint"] = resolve_downstream_endpoint_with_inventory(
            relation.get("downstreamApi", ""),
            relation.get("downstreamEndpoint", ""),
            endpoint_inventory,
        )

    normalized_relations = [
        relation
        for relation in all_relations
        if not is_self_reference_relation(relation.get("currentApi", ""), relation.get("downstreamApi", ""))
    ]
    deduplicated_relations = unique_relations(normalized_relations)

    repo_names = [str(result.get("notes", {}).get("repoName", "")).strip() for result in individual_results if str(result.get("notes", {}).get("repoName", "")).strip()]
    environments = [str(result.get("notes", {}).get("environment", "")).strip() for result in individual_results if str(result.get("notes", {}).get("environment", "")).strip()]
    current_apis = sorted({relation.get("currentApi", "") for relation in deduplicated_relations if relation.get("currentApi", "")})
    business_groups = sorted({relation.get("currentBusinessGroup", "") for relation in deduplicated_relations if relation.get("currentBusinessGroup", "")})
    downstream_summaries = sorted({to_summary_url(relation) for relation in deduplicated_relations})

    notes = {
        "repoName": ", ".join(repo_names),
        "environment": ", ".join(sorted(set(environments))) or "未解析",
        "currentApi": ", ".join(current_apis),
        "currentBusinessGroup": ", ".join(business_groups),
        "downstreamSummaries": downstream_summaries,
    }
    workbook_bytes = build_workbook_bytes(deduplicated_relations, notes, title="Generated from Mule repo zip scan")
    output_file_name = f"{Path(files[0][0]).stem}-and-{len(files) - 1}-more-visual-metric.xlsx" if len(files) > 1 else f"{Path(files[0][0]).stem}-visual-metric.xlsx"
    graph_model = create_graph_model(deduplicated_relations, {"sourceName": output_file_name, "sheetName": "Relations", "loadedAt": None})
    return {"relations": deduplicated_relations, "notes": notes, "workbookBytes": workbook_bytes, "outputFileName": output_file_name, "graphModel": graph_model}


def convert_repo_path_to_result(repo_path: Path, env: str | None = None, api_name: str | None = None) -> dict[str, Any]:
    if repo_path.is_dir():
        entries = load_directory_entries(repo_path)
        return convert_entries_to_result(entries, repo_path.name, env=env, api_name=api_name)
    if repo_path.is_file() and repo_path.suffix.lower() == ".zip":
        return convert_entries_to_result(load_zip_entries(repo_path.read_bytes()), repo_path.name, env=env, api_name=api_name)
    raise ValueError(f"当前只支持目录或 .zip 文件: {repo_path}")
