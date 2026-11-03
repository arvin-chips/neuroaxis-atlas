"""Build the bundled demo case from the Visible Human head CT already shipped
with NeuroAxis (src/assets/imaging/ct.bin).

That grid was resampled into the atlas' canonical space with an anisotropic
registration (see its manifest `sampling.patientLpsToAtlasAu`). Here the
inverse of that affine is applied so the demo case is back in true physical
millimetres (DICOM LPS), i.e. no anatomical stretching.

Limits that are carried into case.json and shown in the viewer:
  * the source grid is pre-windowed to -20..100 HU (8-bit), so bone and wide
    windows cannot be reproduced and anything outside that range is clipped;
  * the effective resolution is that of the atlas grid (~1.1-1.6 mm);
  * it is a cadaveric head (Visible Human Project), not a clinical scan.

Usage:  python -I scripts/ct-anatomy/import_neuroaxis_vh.py [--spacing 1.0]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates, binary_fill_holes, label as cc_label

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ctcase import write_case, register_case  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spacing", type=float, default=1.0)
    ap.add_argument("--out", default=str(ROOT / "public" / "ct-cases"))
    args = ap.parse_args()

    man = json.loads((ROOT / "src/assets/imaging/ct-manifest.json").read_text())
    nx, ny, nz = man["dims"]
    src = np.fromfile(ROOT / "src/assets/imaging/ct.bin", np.uint8).reshape(nz, ny, nx)
    o = np.array(man["originAu"], float)
    s = np.array(man["spacingAu"], float)
    A = np.array(man["sampling"]["patientLpsToAtlasAu"], float).reshape(4, 4)
    w0, w1 = man["intensity"]["window"]

    # Physical extent: map the 8 corners of the atlas grid back to LPS mm.
    Ainv = np.linalg.inv(A)
    corners = np.array([[i, j, k] for i in (0, nx - 1) for j in (0, ny - 1) for k in (0, nz - 1)], float)
    au = o + corners * s
    lps = (Ainv @ np.c_[au, np.ones(len(au))].T).T[:, :3]
    lo, hi = lps.min(0), lps.max(0)
    sp = args.spacing
    gx = np.arange(lo[0], hi[0] + 1e-6, sp)
    gy = np.arange(lo[1], hi[1] + 1e-6, sp)
    gz = np.arange(lo[2], hi[2] + 1e-6, sp)
    Z, Y, X = np.meshgrid(gz, gy, gx, indexing="ij")
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel(), np.ones(X.size)])
    AU = (A @ P)[:3]
    idx = (AU - o[:, None]) / s[:, None]          # fractional (i, j, k)
    coords = idx[::-1]                             # map_coordinates wants (k, j, i)
    val = map_coordinates(src.astype(np.float32), coords, order=1, mode="constant", cval=0.0)
    nodata = map_coordinates((src == 0).astype(np.float32), coords, order=0, mode="constant", cval=1.0) > 0.5
    hu = w0 + val * (w1 - w0) / 255.0
    hu[nodata] = -1024.0
    hu = hu.reshape(Z.shape)

    # Crop to the head (largest component of in-window tissue), 6 mm margin.
    body = hu > (w0 + 1.0)
    lab, n = cc_label(body)
    if n:
        sizes = np.bincount(lab.ravel())[1:]
        body = binary_fill_holes(lab == (np.argmax(sizes) + 1))
    zz, yy, xx = np.nonzero(body)
    m = int(round(6 / sp))
    sl = tuple(slice(max(0, a.min() - m), b + m + 1) for a, b in
               ((zz, zz.max()), (yy, yy.max()), (xx, xx.max())))
    hu = hu[sl]
    origin_lps = [float(gx[sl[2].start]), float(gy[sl[1].start]), float(gz[sl[0].start])]

    meta = {
        "id": "vhp-head-demo",
        "title": "Visible Human head CT (demo, brain window only)",
        "summary": "Real CT of a cadaveric head from the NLM Visible Human Project, recovered from "
                   "the NeuroAxis atlas grid into physical millimetres. Brain window only; no segmentation bundled.",
        "modality": "CT",
        "source": man["source"],
        "sourceUrl": man["sourceUrl"],
        "license": man["license"],
        "termsUrl": man["termsUrl"],
        "credit": man["credit"],
        "attribution": man["attribution"],
        "originLps": origin_lps,
        "intensity": {
            "calibrated": False,
            "validRangeHU": [w0, w1],
            "note": "Source was stored pre-windowed to -20..100 HU (8-bit). Values outside that range are clipped, "
                    "so bone/subdural/wide windows cannot show real detail. Rebuild from the original DICOM "
                    "(scripts/ct-anatomy/build_case.py) for a fully calibrated volume.",
        },
        "limitations": [
            "Cadaveric specimen: grey/white contrast and ventricular size differ from a living patient.",
            "Resampled twice (atlas grid then back to mm); fine detail below ~1.5 mm is lost.",
            "No TotalSegmentator labels are bundled — run build_case.py on the source DICOM to add them.",
        ],
        "provenance": "scripts/ct-anatomy/import_neuroaxis_vh.py from src/assets/imaging/ct.bin "
                      f"(sha256 {man['dataSha256'][:16]}…)",
    }
    levels_path = Path(__file__).with_name("vhp-head-demo.levels.json")
    extra = json.loads(levels_path.read_text()) if levels_path.exists() else {}
    out = Path(args.out)
    case = write_case(out / meta["id"], hu, (sp, sp, sp), meta,
                      levels=extra.get("levels"), landmarks=extra.get("landmarks"))
    register_case(out, meta["id"])
    print(meta["id"], "dims", case["dims"], "origin", [round(v, 1) for v in origin_lps])


if __name__ == "__main__":
    main()
