from __future__ import annotations

import argparse
from pathlib import Path

from .services.mule_parser import convert_repo_path_to_result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scan Mule repo/zip and export visual metric workbook.")
    parser.add_argument("--repo", required=True, help="Mule repo directory or zip path")
    parser.add_argument("--output", required=True, help="Output xlsx path")
    parser.add_argument("--env", default=None, help="Optional env name")
    parser.add_argument("--api-name", default=None, help="Optional current API name override")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    repo_path = Path(args.repo).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    result = convert_repo_path_to_result(repo_path, env=args.env, api_name=args.api_name)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(result["workbookBytes"])
    print(output_path)


if __name__ == "__main__":
    main()
