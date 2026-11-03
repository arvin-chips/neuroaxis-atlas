"""Download the NLM Visible Human "Additional Head Images" CT series (463 gzip'd
DICOM slices, J.001.gz … J.463.gz) and unpack it for build_case.py.

  python -I scripts/ct-anatomy/fetch_visible_human_ct.py --out assets-src/ct/vhp-cat
  python -I scripts/ct-anatomy/build_case.py --input assets-src/ct/vhp-cat \\
      --id vhp-head --title "Visible Human head CT" \\
      --source "NLM Visible Human Project — Additional Head Images CT" \\
      --source-url https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/MR_CT_DICOM/CAT/ \\
      --license "NLM Terms and Conditions" --credit "Courtesy of the U.S. National Library of Medicine" --segment

Terms: https://www.nlm.nih.gov/databases/download/terms_and_conditions.html — keep the
credit line "Courtesy of the U.S. National Library of Medicine" and state that the data
may not be NLM's most current version. NeuroAxis' audit notes that this archive's
header reverses anterior/posterior: open the case and check that the face is at the
top of the axial view; if not, rebuild with --flip-ap.
"""
from __future__ import annotations

import argparse
import gzip
import time
import urllib.request
from pathlib import Path

BASE = "https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/MR_CT_DICOM/CAT/"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--count", type=int, default=463)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for i in range(1, args.count + 1):
        dst = args.out / f"J.{i:03d}.dcm"
        if dst.exists() and dst.stat().st_size > 0:
            continue
        url = f"{BASE}J.{i:03d}.gz"
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    dst.write_bytes(gzip.decompress(r.read()))
                break
            except Exception as e:  # network hiccup: back off and retry
                if attempt == 3:
                    raise SystemExit(f"failed {url}: {e}")
                time.sleep(2 ** (attempt + 1))
        print(f"\r{i}/{args.count}", end="", flush=True)
    print("\ndone:", args.out)


if __name__ == "__main__":
    main()
