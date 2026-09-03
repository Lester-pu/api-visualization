from __future__ import annotations

import base64

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .services.mule_parser import convert_zip_files_to_result
from .services.workbook_service import parse_workbook_bytes


router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/workbook/parse")
async def parse_workbook(file: UploadFile = File(...)) -> dict:
    try:
        data = await file.read()
        graph_model = parse_workbook_bytes(data, source_name=file.filename or "uploaded.xlsx")
        return {"graph": graph_model}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/mule/scan")
async def scan_mule_zips(files: list[UploadFile] = File(...), env: str | None = Form(default=None), api_name: str | None = Form(default=None)) -> dict:
    try:
        normalized_files: list[tuple[str, bytes]] = []
        for file in files:
            if not file.filename:
                continue
            normalized_files.append((file.filename, await file.read()))
        result = convert_zip_files_to_result(normalized_files, env=env, api_name=api_name)
        return {
            "graph": result["graphModel"],
            "notes": result["notes"],
            "workbookFileName": result["outputFileName"],
            "workbookBase64": base64.b64encode(result["workbookBytes"]).decode("ascii"),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
