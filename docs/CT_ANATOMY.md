# CT Anatomy — normal head CT on original DICOM data

`ct-anatomy.html` is the CT learning page of NeuroAxis. It shows real, de-identified clinical
head CT with the original stored pixel values, and uses the NeuroAxis structure records for
function, connections and blood supply.

## Data

The images are **not** in this repository. They are in the separate `ct-anatomy-data`
repository (original DICOM + `MANIFEST.json`, lossless viewer chunks, annotations, pipeline,
tests). Its `viewer/` folder must be served at `<base>/ct-data/` (or pass `?data=<url>`).
For local development: `ln -s /path/to/ct-anatomy-data/viewer public/ct-data` (ignored by git).

| Exam | Series | Use |
|---|---|---|
| **Patient A** — CQ500-CT-235 | 5 mm axial, STANDARD kernel (40 images) | primary axial learning |
| | 0.625 mm thin, STANDARD kernel (320 images) | detail, coronal and sagittal views |
| **Patient B** — CQ500-CT-298 (a different person) | 0.625 mm thin, BONE kernel (413 images) | skull and skull-base anatomy |

Licence: CQ500, CC BY-NC-SA 4.0 plus the qure.ai EULA (non-commercial; share-alike for
derived data). Cite Chilamkurthy et al., Lancet 2018.

## Image handling

- Pixels are the DICOM stored values (signed 16-bit). HU = stored × RescaleSlope + RescaleIntercept.
  PixelPaddingValue pixels (outside the reconstruction circle) display black.
- Windowing is the DICOM PS3.3 C.11.2.1.2.1 linear VOI function on HU, implemented as a lookup
  table. Presets: Brain W80/L40, Subdural W215/L75, Stroke W35/L35, Bone W2800/L600, Soft
  tissue W350/L40, plus the window stored in the DICOM header; free level/width sliders.
- Zoom: Fit, 100 % (one CT pixel per CSS pixel), 200 %, 400 %, pinch. Enlarged pixels are drawn
  with nearest-neighbour (blocks), never interpolated. No sharpening, denoising or upscaling.
- Coronal and sagittal images are rows/columns of the original thin volume, displayed with their
  true pixel aspect (0.430 × 0.625 mm for Patient A).
- Overlays (crosshair, landmarks, levels, measurements) are drawn on a separate canvas.

## Loading and memory

`src/ct/data.ts` fetches ~3 MB chunks only when a slice in them is needed, decodes slices on
demand (native `DecompressionStream('deflate-raw')`, fflate fallback) into a 40-slice cache and
prefetches neighbours. The full thin volume (168 MB for Patient A, 216 MB for Patient B) is built
only when coronal/sagittal is requested and is released when switching patient or with
“Release 3-plane volume”.

## Offline

Served over https or localhost, “Save all exams for offline” stores the app and all 58 data files
(~150 MB) in Cache Storage; `public/ct-sw.js` then serves them with no network (data
cache-first, app network-first).

## Touch

One finger: swipe up/down to scroll images, tap to place the crosshair and read HU / landmark.
Two fingers: pinch to zoom, drag to pan. Slider and ▲▼ buttons under the image. Controls are in
the ☰ drawer on tablets.

## Files

```
ct-anatomy.html           page entry (Vite multi-page input)
src/ct/data.ts            data index, chunk fetch, lossless decode, slice cache, volume
src/ct/geometry.ts        patient ↔ pixel geometry, reformats, DICOM VOI LUT
src/ct/Viewport.tsx       image + overlay canvases, zoom/pan, touch and mouse input
src/ct/CtApp.tsx          layout, exams/series, panels, quiz, offline
src/ct/content.ts         teaching text (levels, windows, structures, arteries, clinical)
src/ct/quiz.ts            level and landmark questions from annotations
src/ct/offline.ts, public/ct-sw.js   offline cache
```
