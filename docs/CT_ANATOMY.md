# CT Anatomy — normal head CT, level by level

`ct-anatomy.html` is a second page of NeuroAxis for learning **normal non-contrast
head CT anatomy** on real scans. It uses NeuroAxis for the anatomical framework
(structure records, function, connections, blood supply), TotalSegmentator for
segmentation, and real CT volumes for the images.

Open it at `/<base>/ct-anatomy.html` (dev: <http://localhost:5173/neuroaxis-atlas/ct-anatomy.html>),
or with the **CT Anatomy** button in the atlas header.

## What it does

| Feature | How |
| --- | --- |
| Scroll axial CT, foramen magnum → vertex | Mouse wheel (Shift = 5 slices), ↑/↓, PgUp/PgDn |
| Three planes | Axial / coronal / sagittal from one volume; click a thumbnail (or `a`, `o`, `s`) to make it the main view. Click to move the crosshair; all planes follow. |
| Windowing | Brain (L40/W80), Subdural (L75/W215), Stroke (L35/W35), Bone (L600/W2800), Soft tissue (L40/W350); keys `1`–`5`; right-drag or Shift-drag for free W/L. HU readout under the cursor. |
| Anatomical labelling | TotalSegmentator labels drawn as colour fill or outline, with text labels placed on each slice (one per side for paired structures); point landmarks (e.g. pineal, fourth ventricle) from the case file. Hover shows the structure name. |
| Structure isolation | “iso” next to a structure (or *Isolate on scan*) shows only that label and dims the rest of the image; per-structure visibility check boxes. |
| Level recognition | Nine reference levels (C1–C2, foramen magnum, medulla, pons/4th ventricle, midbrain/suprasellar cistern, third ventricle/basal ganglia, lateral ventricle bodies, centrum semiovale, vertex). The current level is shown on the scan and in the *Level* tab with how to recognise it and what to identify; the levels are drawn as lines on the coronal/sagittal views. |
| Clinical correlations | *Clinical* tab: EDH, SDH, SAH, IVH, hypertensive ICH sites, MCA/ASPECTS, ACA/PCA, lacunes, midline shift, uncal and tonsillar herniation, hydrocephalus vs atrophy, normal densities that mimic blood. Each topic highlights the relevant structures on the normal scan, sets the suggested window and jumps to the level. No pathology is synthesised. |
| Quiz | *Name the level*, *Name the (outlined) structure*, *Find the structure* (click on it). |
| Measure | `M`, then drag: distance in mm (midline shift, Evans index, temporal horn width). |
| Offline | *Save all cases offline* stores the page and every case in the browser cache; a service worker (`public/ct-sw.js`) serves them with no connection. For a fully local copy: `npm run build` and serve `dist/` with any static server (`npx vite preview`). |

## Cases

Cases live in `public/ct-cases/<id>/` and are listed in `public/ct-cases/index.json`:

```
case.json    geometry, provenance, licence, label table, levels, landmarks
volume.bin   gzip'd little-endian int16 Hounsfield units, LPS grid, x fastest
labels.bin   optional gzip'd uint8 label map on the same grid
```

Grid axes: +x patient left, +y posterior, +z superior (DICOM LPS index order), so an
axial slice drawn as rows×columns is already in radiological convention.

### Bundled demo: `vhp-head-demo`

The only head CT available offline in this repository is the NLM Visible Human
head CT that NeuroAxis already ships (`src/assets/imaging/ct.bin`).
`scripts/ct-anatomy/import_neuroaxis_vh.py` inverts NeuroAxis' atlas registration so the
demo is in true millimetres again. Its limits are shown in the app:

* it was stored pre-windowed to −20…100 HU, so **only the brain and stroke windows are meaningful** (the others are disabled for this case);
* it is a cadaveric head with ~1.1–1.6 mm effective resolution and little grey/white contrast;
* it has **no segmentation**: the nine levels and five landmarks in
  `scripts/ct-anatomy/vhp-head-demo.levels.json` were placed by eye (approximate).

It exists so the module runs out of the box. Real teaching cases should be built with
the pipeline below.

### Building a case from a real normal CT

```bash
pip install -r scripts/ct-anatomy/requirements.txt
pip install totalsegmentator            # for --segment
totalseg_set_license -l <key>           # brain_structures needs the free academic licence

python -I scripts/ct-anatomy/build_case.py \
  --input /path/to/DICOM_series_or_ct.nii.gz \
  --id normal-01 --title "Normal non-contrast head CT 1" \
  --source "<dataset>, <study id>" --source-url <url> \
  --license "<licence>" --credit "<required credit line>" \
  --segment
```

The builder reorients to LPS, resamples to 0.8 mm isotropic (`--spacing`), keeps
calibrated HU, crops to the head and runs three TotalSegmentator tasks:

| task | licence | labels used |
| --- | --- | --- |
| `brain_structures` | free academic licence | brainstem, subarachnoid space, venous sinuses, septum pellucidum, cerebellum, caudate, lentiform nucleus, insular cortex, internal capsule, ventricles, central sulcus, frontal/parietal/occipital/temporal lobes, thalamus |
| `head_glands_cavities` | Apache-2.0 | eyes, optic nerves, auditory canals, nasal cavity, nasopharynx |
| `craniofacial_structures` | Apache-2.0 | skull, frontal and maxillary sinuses, mandible |

Use `--seg-dir` instead of `--segment` to import TotalSegmentator output you already
have (`<dir>/<task>/<structure>.nii.gz`). The segmentation is automatic and is
labelled as such in the app.

Level anchors are **suggested automatically** from the labels (marked `*` in the
app). Review them in the *Data* tab: scroll to the right slice, *Set to axial N*,
add landmarks at the cursor, *Copy JSON*, save it as
`scripts/ct-anatomy/<id>.levels.json` and rebuild with `--levels scripts/ct-anatomy/<id>.levels.json`.

### Where to get genuine normal head CT

| source | licence | helper |
| --- | --- | --- |
| NLM Visible Human “Additional Head Images” CT (the full-HU original of the demo) | NLM Terms and Conditions — credit “Courtesy of the U.S. National Library of Medicine” | `scripts/ct-anatomy/fetch_visible_human_ct.py` (header reverses A/P per the NeuroAxis audit — check and use `--flip-ap` if needed) |
| CQ500 (qure.ai) — 491 non-contrast head CTs with three radiologist reads | CC BY-NC-SA 4.0 (non-commercial) | `scripts/ct-anatomy/select_cq500_normals.py --reads reads.csv` lists studies all readers called normal |
| Your institution's de-identified normal scans | per local approval | `build_case.py --input <DICOM dir>` (patient tags are never copied) |

Only commit cases you are allowed to redistribute; keep the dataset's licence and
credit in `--license` / `--credit` (shown under every view).

## Files

```
ct-anatomy.html                 page entry (Vite multi-page input)
src/ct/content.ts               levels, windows, structure and clinical teaching text
src/ct/volume.ts                case loading, LPS slice geometry
src/ct/SliceView.tsx            canvas renderer: windowing, overlay, labels, landmarks, measure
src/ct/CtApp.tsx                layout, panels, quiz, author tools
src/ct/quiz.ts                  question generators
src/ct/atlas.ts                 NeuroAxis structure records (no three.js)
src/ct/offline.ts, public/ct-sw.js   offline cache
scripts/ct-anatomy/             case builder, demo importer, dataset helpers
```

The teaching text is an educational summary of standard neuroradiology anatomy;
clinical patterns are typical locations, not diagnostic rules.
