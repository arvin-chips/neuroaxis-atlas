"""Shared writer for CT Anatomy teaching cases.

A case is a folder under public/ct-cases/<id>/ containing

  case.json    metadata (geometry, provenance, label table, levels, landmarks)
  volume.bin   gzip-compressed little-endian int16 Hounsfield units
  labels.bin   optional gzip-compressed uint8 label map on the same grid

Grid convention (DICOM LPS index order, C-order array [z, y, x]):
  x (fastest) increases toward patient LEFT
  y           increases toward patient POSTERIOR
  z (slowest) increases toward patient SUPERIOR
so axial slice z drawn with column=x, row=y is already in radiological
display convention (patient right on screen left, anterior at top).
"""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

# App-wide label ids. Values are stable across cases so the viewer, the quiz
# and the teaching content can refer to them. 1-16 mirror the TotalSegmentator
# `brain_structures` task numbering; 20+ come from the open head tasks.
LABELS: dict[int, dict] = {
    1: {"key": "brainstem", "name": "Brainstem", "color": "#e8a33d", "midline": True},
    2: {"key": "subarachnoid_space", "name": "Subarachnoid space / cisterns", "color": "#4fb3d9", "midline": True},
    3: {"key": "venous_sinuses", "name": "Venous sinuses & dural folds", "color": "#7a5cff", "midline": True},
    4: {"key": "septum_pellucidum", "name": "Septum pellucidum", "color": "#ff6fb1", "midline": True},
    5: {"key": "cerebellum", "name": "Cerebellum", "color": "#8bc34a"},
    6: {"key": "caudate_nucleus", "name": "Caudate nucleus", "color": "#ff9800"},
    7: {"key": "lentiform_nucleus", "name": "Lentiform nucleus", "color": "#f44336"},
    8: {"key": "insular_cortex", "name": "Insular cortex", "color": "#cddc39"},
    9: {"key": "internal_capsule", "name": "Internal capsule", "color": "#ffffff"},
    10: {"key": "ventricle", "name": "Ventricular system", "color": "#00bcd4"},
    11: {"key": "central_sulcus", "name": "Central sulcus", "color": "#e040fb"},
    12: {"key": "frontal_lobe", "name": "Frontal lobe", "color": "#5c6bc0"},
    13: {"key": "parietal_lobe", "name": "Parietal lobe", "color": "#26a69a"},
    14: {"key": "occipital_lobe", "name": "Occipital lobe", "color": "#ab47bc"},
    15: {"key": "temporal_lobe", "name": "Temporal lobe", "color": "#66bb6a"},
    16: {"key": "thalamus", "name": "Thalamus", "color": "#ffd54f"},
    # head_glands_cavities (open licence)
    20: {"key": "eye", "name": "Globe (eye)", "color": "#90caf9"},
    21: {"key": "optic_nerve", "name": "Optic nerve", "color": "#fff176"},
    22: {"key": "auditory_canal", "name": "External auditory canal", "color": "#b0bec5"},
    23: {"key": "nasal_cavity", "name": "Nasal cavity", "color": "#80deea"},
    24: {"key": "nasopharynx", "name": "Nasopharynx", "color": "#80cbc4", "midline": True},
    # craniofacial_structures (open licence)
    30: {"key": "skull", "name": "Skull (calvarium & skull base)", "color": "#eeeeee", "midline": True},
    31: {"key": "sinus_frontal", "name": "Frontal sinus", "color": "#4dd0e1"},
    32: {"key": "sinus_maxillary", "name": "Maxillary sinus", "color": "#4db6ac"},
    33: {"key": "mandible", "name": "Mandible", "color": "#bcaaa4", "midline": True},
}

# TotalSegmentator task -> {source label name: app label id}
TASK_MAPS: dict[str, dict[str, int]] = {
    "brain_structures": {v["key"]: k for k, v in LABELS.items() if k <= 16},
    "head_glands_cavities": {
        "eye_left": 20, "eye_right": 20, "optic_nerve_left": 21, "optic_nerve_right": 21,
        "auditory_canal_left": 22, "auditory_canal_right": 22,
        "nasal_cavity_left": 23, "nasal_cavity_right": 23, "nasopharynx": 24,
    },
    "craniofacial_structures": {
        "skull": 30, "sinus_frontal": 31, "sinus_maxillary": 32, "mandible": 33,
    },
}


def _write_gz(path: Path, arr: np.ndarray) -> str:
    raw = np.ascontiguousarray(arr).tobytes()
    path.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    return hashlib.sha256(raw).hexdigest()


def write_case(
    outdir: Path,
    hu: np.ndarray,
    spacing_xyz: tuple[float, float, float],
    meta: dict,
    labels: np.ndarray | None = None,
    levels: list[dict] | None = None,
    landmarks: list[dict] | None = None,
) -> dict:
    """Write a case folder. `hu` and `labels` are [z, y, x] arrays on the LPS grid."""
    outdir.mkdir(parents=True, exist_ok=True)
    hu16 = np.clip(np.rint(hu), -1024, 3071).astype("<i2")
    nz, ny, nx = hu16.shape
    case = {
        "schema": "ct-anatomy-case/1",
        **meta,
        "dims": [nx, ny, nz],
        "spacing": [float(s) for s in spacing_xyz],
        "axes": "LPS: +x patient left, +y posterior, +z superior; volume.bin is x-fastest",
        "volume": {"file": "volume.bin", "dtype": "int16", "compression": "gzip",
                   "sha256Raw": _write_gz(outdir / "volume.bin", hu16)},
        "levels": levels or [],
        "landmarks": landmarks or [],
    }
    if labels is not None:
        lab = labels.astype(np.uint8)
        present = sorted(int(v) for v in np.unique(lab) if v)
        case["labels"] = {
            "file": "labels.bin", "dtype": "uint8", "compression": "gzip",
            "sha256Raw": _write_gz(outdir / "labels.bin", lab),
            "table": {str(k): LABELS[k] for k in present if k in LABELS},
        }
    (outdir / "case.json").write_text(json.dumps(case, indent=1, ensure_ascii=False) + "\n")
    return case


def register_case(cases_root: Path, case_id: str) -> None:
    """Add/update the case in public/ct-cases/index.json."""
    idx_path = cases_root / "index.json"
    index = json.loads(idx_path.read_text()) if idx_path.exists() else {"cases": []}
    case = json.loads((cases_root / case_id / "case.json").read_text())
    entry = {"id": case_id, "title": case.get("title", case_id),
             "summary": case.get("summary", ""), "hasLabels": "labels" in case,
             "huCalibrated": case.get("intensity", {}).get("calibrated", True)}
    index["cases"] = [c for c in index["cases"] if c["id"] != case_id] + [entry]
    idx_path.write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
