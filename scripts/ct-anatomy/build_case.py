"""Build a CT Anatomy teaching case from a real head CT.

  python -I scripts/ct-anatomy/build_case.py \
      --input /data/ct/normal-01/DICOM          # DICOM series folder, or a .nii/.nii.gz file
      --id normal-01 --title "Normal non-contrast head CT #1" \
      --source "CQ500 (qure.ai), case CQ500CT###" --license "CC BY-NC-SA 4.0" \
      --segment                                  # run TotalSegmentator (needs `pip install totalsegmentator`)

Steps
  1. read the series (SimpleITK), reorient to DICOM LPS, resample to --spacing mm
     (default 0.8 mm isotropic) with linear interpolation; HU are kept calibrated
  2. crop to the head (largest body component, 8 mm margin)
  3. optionally run TotalSegmentator:
       brain_structures        (licensed task; free academic licence: totalseg_set_license -l ...)
       head_glands_cavities    (open)   eyes, optic nerves, auditory canals, nasal cavity
       craniofacial_structures (open)   skull, frontal/maxillary sinuses, mandible
     or import existing label maps with --seg-dir (a folder of TotalSegmentator outputs)
  4. suggest anatomical levels from the labels (written as "auto"; review them in the
     viewer's Author panel and save them with --levels)
  5. write public/ct-cases/<id>/ and register it in public/ct-cases/index.json

Only use scans you are licensed to redistribute, and only de-identified data:
patient tags are never copied into case.json.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ctcase import LABELS, TASK_MAPS, register_case, write_case  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

try:
    import SimpleITK as sitk
except ImportError:  # pragma: no cover
    sys.exit("SimpleITK is required:  pip install SimpleITK scipy")
from scipy.ndimage import binary_fill_holes, label as cc_label  # noqa: E402


def read_image(path: Path) -> "sitk.Image":
    if path.is_dir():
        reader = sitk.ImageSeriesReader()
        series = reader.GetGDCMSeriesIDs(str(path))
        if not series:
            sys.exit(f"no DICOM series in {path}")
        # pick the series with the most slices (the thin axial reconstruction)
        files = max((reader.GetGDCMSeriesFileNames(str(path), s) for s in series), key=len)
        reader.SetFileNames(files)
        img = reader.Execute()
    else:
        img = sitk.ReadImage(str(path))
    return sitk.Cast(img, sitk.sitkFloat32)


def to_lps_grid(img: "sitk.Image", spacing: float) -> "sitk.Image":
    img = sitk.DICOMOrient(img, "LPS")
    size = [int(round(sz * sp / spacing)) for sz, sp in zip(img.GetSize(), img.GetSpacing())]
    # Resample onto an axis-aligned LPS grid (also removes any gantry tilt shear).
    ref = sitk.Image(size, sitk.sitkFloat32)
    ref.SetSpacing([spacing] * 3)
    ref.SetOrigin(img.GetOrigin())
    ref.SetDirection((1, 0, 0, 0, 1, 0, 0, 0, 1))
    return sitk.Resample(img, ref, sitk.Transform(), sitk.sitkLinear, -1024.0, sitk.sitkFloat32)


def head_crop(hu: np.ndarray, margin: int):
    body = hu > -300
    lab, n = cc_label(body)
    if n == 0:
        return tuple(slice(0, s) for s in hu.shape)
    sizes = np.bincount(lab.ravel())[1:]
    body = binary_fill_holes(lab == (np.argmax(sizes) + 1))
    idx = np.nonzero(body)
    return tuple(slice(max(0, int(a.min()) - margin), min(s, int(a.max()) + margin + 1))
                 for a, s in zip(idx, hu.shape))


def run_totalsegmentator(nifti: Path, outdir: Path, tasks: list[str], fast: bool) -> None:
    for task in tasks:
        cmd = ["TotalSegmentator", "-i", str(nifti), "-o", str(outdir / task), "--task", task]
        if fast and task == "total":
            cmd.append("--fast")
        print("+", " ".join(cmd), flush=True)
        subprocess.run(cmd, check=True)


def merge_labels(seg_dir: Path, ref: "sitk.Image") -> np.ndarray:
    """Merge per-structure TotalSegmentator masks (seg_dir/<task>/<name>.nii.gz) onto ref grid.
    Later tasks never overwrite brain_structures voxels."""
    out = np.zeros(sitk.GetArrayFromImage(ref).shape, np.uint8)
    for task in ("brain_structures", "head_glands_cavities", "craniofacial_structures"):
        tdir = seg_dir / task
        if not tdir.is_dir():
            continue
        for name, lab in TASK_MAPS[task].items():
            f = tdir / f"{name}.nii.gz"
            if not f.exists():
                continue
            m = sitk.Resample(sitk.DICOMOrient(sitk.ReadImage(str(f)), "LPS"), ref, sitk.Transform(),
                              sitk.sitkNearestNeighbor, 0, sitk.sitkUInt8)
            arr = sitk.GetArrayFromImage(m) > 0
            write = arr & ((out == 0) if task != "brain_structures" else True)
            out[write] = lab
    return out


def suggest_levels(lab: np.ndarray, hu: np.ndarray) -> list[dict]:
    """Heuristic level anchors (z indices) from segmentation; marked source=auto."""
    z_area = {k: (lab == k).sum(axis=(1, 2)) for k in (1, 5, 6, 7, 10, 16, 12, 13)}

    def zr(k):
        nz = np.nonzero(z_area[k])[0]
        return (int(nz.min()), int(nz.max())) if nz.size else None

    lv: dict[str, int] = {}
    bs, cb, th, vent = zr(1), zr(5), zr(16), zr(10)
    if bs:
        lo, hi = bs
        span = hi - lo
        lv["foramen-magnum"] = lo + int(0.08 * span)
        lv["medulla"] = lo + int(0.25 * span)
        lv["pons"] = lo + int(0.55 * span)
        lv["midbrain"] = lo + int(0.88 * span)
        lv["craniocervical"] = max(0, lv["foramen-magnum"] - 10)
    if th:
        bg = z_area[16] + z_area[7]
        lv["third-ventricle"] = int(np.argmax(bg))
    if vent and th:
        above = np.arange(lab.shape[0]) > th[1]
        va = np.where(above, z_area[10], 0)
        if va.any():
            lv["lateral-ventricles"] = int(np.argmax(va))
    brain = (z_area[12] + z_area[13]) > 0
    if brain.any():
        top = int(np.nonzero(brain)[0].max())
        lv["vertex"] = max(0, top - 8)
        if "lateral-ventricles" in lv:
            lv["centrum-semiovale"] = (lv["lateral-ventricles"] + lv["vertex"]) // 2 + 4
    order = ["craniocervical", "foramen-magnum", "medulla", "pons", "midbrain", "third-ventricle",
             "lateral-ventricles", "centrum-semiovale", "vertex"]
    return [{"id": k, "z": int(lv[k]), "source": "auto"} for k in order if k in lv]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--summary", default="")
    ap.add_argument("--source", required=True, help="dataset + case identifier")
    ap.add_argument("--source-url", default="")
    ap.add_argument("--license", required=True)
    ap.add_argument("--credit", default="")
    ap.add_argument("--spacing", type=float, default=0.8)
    ap.add_argument("--segment", action="store_true", help="run TotalSegmentator")
    ap.add_argument("--tasks", default="brain_structures,head_glands_cavities,craniofacial_structures")
    ap.add_argument("--seg-dir", type=Path, help="existing TotalSegmentator output root (<task>/<name>.nii.gz)")
    ap.add_argument("--levels", type=Path, help="JSON with reviewed {levels, landmarks} to embed")
    ap.add_argument("--flip-ap", action="store_true",
                    help="mirror anterior/posterior after reorientation (for archives with a known wrong header)")
    ap.add_argument("--flip-lr", action="store_true", help="mirror left/right (same purpose)")
    ap.add_argument("--out", type=Path, default=ROOT / "public" / "ct-cases")
    args = ap.parse_args()

    img = to_lps_grid(read_image(args.input), args.spacing)
    hu_full = sitk.GetArrayFromImage(img)  # [z, y, x]
    sl = head_crop(hu_full, int(round(8 / args.spacing)))
    hu = hu_full[sl]
    if args.flip_ap:
        hu = hu[:, ::-1, :]
    if args.flip_lr:
        hu = hu[:, :, ::-1]
    origin = img.TransformIndexToPhysicalPoint([sl[2].start, sl[1].start, sl[0].start])
    print(f"volume {hu.shape[::-1]} @ {args.spacing} mm, HU {hu.min():.0f}..{hu.max():.0f}")

    labels = None
    seg_dir = args.seg_dir
    with tempfile.TemporaryDirectory() as tmp:
        if args.segment:
            nii = Path(tmp) / "ct.nii.gz"
            sitk.WriteImage(img, str(nii))
            seg_dir = Path(tmp) / "seg"
            run_totalsegmentator(nii, seg_dir, [t.strip() for t in args.tasks.split(",") if t.strip()], False)
        if seg_dir:
            labels = merge_labels(seg_dir, img)[sl]
            if args.flip_ap:
                labels = labels[:, ::-1, :]
            if args.flip_lr:
                labels = labels[:, :, ::-1]
            present = sorted(int(v) for v in np.unique(labels) if v)
            print("labels:", ", ".join(LABELS[k]["key"] for k in present))

    reviewed = json.loads(args.levels.read_text()) if args.levels else {}
    levels = reviewed.get("levels") or (suggest_levels(labels, hu) if labels is not None else [])
    meta = {
        "id": args.id, "title": args.title, "summary": args.summary, "modality": "CT",
        "source": args.source, "sourceUrl": args.source_url, "license": args.license,
        "credit": args.credit, "originLps": [float(v) for v in origin],
        "intensity": {"calibrated": True},
        "segmentation": ({"tool": "TotalSegmentator", "tasks": args.tasks.split(","),
                          "note": "Automatic segmentation — not manually corrected unless stated."}
                         if labels is not None else None),
        "provenance": f"scripts/ct-anatomy/build_case.py --spacing {args.spacing}"
                      + (" --flip-ap" if args.flip_ap else "") + (" --flip-lr" if args.flip_lr else ""),
    }
    write_case(args.out / args.id, hu, (args.spacing,) * 3, meta, labels=labels,
               levels=levels, landmarks=reviewed.get("landmarks"))
    register_case(args.out, args.id)
    print("wrote", args.out / args.id)


if __name__ == "__main__":
    main()
