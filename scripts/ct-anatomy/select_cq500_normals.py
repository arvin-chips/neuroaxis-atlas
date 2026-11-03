"""List CQ500 studies that all three radiologists read as normal.

CQ500 (Chilamkurthy et al., Lancet 2018; http://headctstudy.qure.ai/dataset) is a
public set of 491 non-contrast head CTs, licensed CC BY-NC-SA 4.0. Its reads.csv
has one row per study and per-reader binary columns such as "R1:ICH",
"R2:Fracture", "R3:MidlineShift". A study is "normal" here when every reader
column is 0.

  python -I scripts/ct-anatomy/select_cq500_normals.py --reads reads.csv [--limit 5]

Then download those studies, pick the thin (≤ 1.25 mm) non-contrast axial series
and run build_case.py with --license "CC BY-NC-SA 4.0" and the study name in
--source. Being non-commercial/share-alike, such cases must not be shipped in a
commercial build.
"""
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reads", type=Path, required=True)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    with args.reads.open(newline="") as fh:
        rows = list(csv.DictReader(fh))
    reader_cols = [c for c in rows[0] if re.match(r"^R\d+:", c)]
    if not reader_cols:
        raise SystemExit("no reader columns (R1:..., R2:...) found — is this CQ500 reads.csv?")
    name_col = next((c for c in ("name", "Name", "study", "Study") if c in rows[0]), list(rows[0])[0])
    normals = [r[name_col] for r in rows if all(str(r[c]).strip() in ("0", "0.0", "") for c in reader_cols)]
    if args.limit:
        normals = normals[: args.limit]
    print(f"{len(normals)} studies read as normal by all readers ({len(reader_cols)} reader columns checked)")
    for n in normals:
        print(n)


if __name__ == "__main__":
    main()
