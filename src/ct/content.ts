/**
 * CT Anatomy — authored teaching content.
 *
 * Normal non-contrast head CT anatomy, organised the way it is read: by axial
 * level from the foramen magnum to the vertex. Structure entries are keyed by
 * the app label keys (TotalSegmentator `brain_structures` + open head tasks,
 * see scripts/ct-anatomy/ctcase.py) and by landmark ids, and point at the
 * matching NeuroAxis atlas records for function / connections / blood supply.
 *
 * Clinical correlations describe WHERE to look on a normal scan and what the
 * typical finding looks like. They are educational summaries, not diagnostic
 * rules, and no pathological images are synthesised.
 */

export type Plane = 'axial' | 'coronal' | 'sagittal'

export interface WindowPreset {
  id: string
  name: string
  key: string
  level: number
  width: number
  use: string
}

export const WINDOWS: WindowPreset[] = [
  { id: 'brain', name: 'Brain', key: '1', level: 40, width: 80,
    use: 'Default parenchymal window: grey vs white matter, CSF spaces, acute blood (~50–70 HU) against brain (~25–40 HU).' },
  { id: 'subdural', name: 'Subdural', key: '2', level: 75, width: 215,
    use: 'Wider window that separates a thin hyperdense collection from the equally bright inner table. Use it along the convexities, falx and tentorium.' },
  { id: 'stroke', name: 'Stroke', key: '3', level: 35, width: 35,
    use: 'Very narrow window that exaggerates small grey–white differences: insular ribbon, lentiform nucleus margins, subtle early ischaemic hypodensity.' },
  { id: 'bone', name: 'Bone', key: '4', level: 600, width: 2800,
    use: 'Calvarium, skull base foramina, sutures vs fractures, mastoid and paranasal sinus aeration.' },
  { id: 'soft', name: 'Soft tissue', key: '5', level: 40, width: 350,
    use: 'Scalp, orbits, face and neck soft tissues; scalp haematoma localises the side of impact.' },
]

/* ------------------------------------------------------------------ levels */

export interface LevelInfo {
  id: string
  name: string
  short: string
  recognise: string
  identify: string[]
  structures: string[]   // label keys / landmark ids to highlight
  clinical: string
}

export const LEVELS: LevelInfo[] = [
  {
    id: 'craniocervical', name: 'Craniocervical junction (C1–C2)', short: 'C1–C2',
    recognise: 'Ring of the atlas with the dens of C2 sitting in its anterior arch; the cervical cord, not brain, fills the canal. Parotid glands and pharynx are the soft tissues anteriorly.',
    identify: ['Anterior arch of C1 and the dens', 'Lateral masses of C1', 'Upper cervical cord in the canal', 'Vertebral arteries in the foramina transversaria (bone window)', 'Nasopharynx / oropharynx airway'],
    structures: ['nasopharynx'],
    clinical: 'Atlanto-dental interval and dens fractures are assessed in bone window. This is the lowest slice of a routine head CT.',
  },
  {
    id: 'foramen-magnum', name: 'Foramen magnum', short: 'Foramen magnum',
    recognise: 'A complete bony ring formed by the occipital bone. The medulla (or cervicomedullary junction) lies in its centre surrounded by CSF; the occipital condyles flank it anterolaterally.',
    identify: ['Foramen magnum ring', 'Medulla / cervicomedullary junction', 'Cerebellar tonsils posterolateral to the medulla', 'Cisterna magna behind the tonsils', 'Occipital condyles', 'Mastoid air cells laterally'],
    structures: ['foramen-magnum', 'brainstem', 'cerebellum'],
    clinical: 'Tonsillar herniation: tonsils crowd the foramen magnum and efface the CSF around the medulla. A soft-tissue “plug” filling the ring with no CSF rim is a red flag in a patient with raised intracranial pressure.',
  },
  {
    id: 'medulla', name: 'Medulla & inferior cerebellum', short: 'Medulla',
    recognise: 'Small round medulla anterior to the large cerebellar hemispheres. Jugular foramina and hypoglossal canals are in the skull base; the sigmoid sinuses groove the posterior petrous bone.',
    identify: ['Medulla (anterior, midline)', 'Cerebellar hemispheres and inferior vermis', 'Cisterna magna', 'Jugular foramen and sigmoid sinus groove', 'Mastoid air cells', 'Maxillary sinuses (anterior)'],
    structures: ['brainstem', 'cerebellum', 'sinus_maxillary', 'venous_sinuses'],
    clinical: 'Posterior inferior cerebellar artery (PICA) territory: lateral medulla and inferior cerebellum. Beam-hardening streaks between the dense petrous bones degrade this level — a hypodensity here must be confirmed on another level or with MRI.',
  },
  {
    id: 'pons', name: 'Pons & fourth ventricle', short: 'Pons / 4th ventricle',
    recognise: 'The pons is the broad bulge in front of the fourth ventricle, which is a horizontal slit or “smile” of CSF between pons and vermis. The petrous temporal bones form a V pointing toward the dorsum sellae; the temporal lobes sit in the middle cranial fossae laterally.',
    identify: ['Pons (basis anteriorly, tegmentum posteriorly)', 'Fourth ventricle', 'Middle cerebellar peduncles', 'Prepontine cistern and basilar artery', 'Internal auditory canals (bone window)', 'Temporal lobes in the middle cranial fossae', 'Sphenoid sinus / orbits anteriorly'],
    structures: ['brainstem', 'fourth-ventricle', 'ventricle', 'cerebellum', 'temporal_lobe', 'auditory_canal'],
    clinical: 'The fourth ventricle is the posterior-fossa barometer: if a cerebellar mass or bleed effaces it, look up for dilated temporal horns (obstructive hydrocephalus). Hypertensive haemorrhage can arise in the pons; the “Hounsfield bar” artefact across the pons is a classic mimic.',
  },
  {
    id: 'midbrain', name: 'Midbrain & suprasellar cistern', short: 'Midbrain',
    recognise: 'The midbrain looks like a Mickey-Mouse head: two cerebral peduncles anteriorly, tectum (colliculi) posteriorly, aqueduct between. In front lies the star/pentagon-shaped suprasellar cistern; the ambient cisterns wrap around the midbrain and the quadrigeminal cistern sits behind it.',
    identify: ['Cerebral peduncles', 'Cerebral aqueduct', 'Tectum (quadrigeminal plate)', 'Suprasellar (pentagon) cistern', 'Interpeduncular, ambient and quadrigeminal cisterns', 'Uncus and hippocampus (medial temporal lobe)', 'Temporal horns of the lateral ventricles', 'Sylvian fissures, vermis superiorly'],
    structures: ['brainstem', 'subarachnoid_space', 'temporal_lobe', 'ventricle', 'frontal_lobe', 'cerebellum'],
    clinical: 'The basal cisterns are where subarachnoid blood pools after aneurysm rupture — every limb of the star should be dark CSF. Effacement of the suprasellar or ambient cistern on one side suggests uncal (transtentorial) herniation. Temporal horns wider than ~2 mm without sulcal enlargement suggest hydrocephalus.',
  },
  {
    id: 'third-ventricle', name: 'Third ventricle & basal ganglia', short: 'Basal ganglia',
    recognise: 'The slit-like third ventricle is in the midline between the two thalami. Lateral to each thalamus is the V-shaped internal capsule (anterior limb, genu, posterior limb) and the lens-shaped lentiform nucleus; the caudate head bulges into each frontal horn. The insula and Sylvian fissure are the lateral boundary.',
    identify: ['Frontal horns and septum pellucidum', 'Head of the caudate nucleus', 'Internal capsule — anterior limb, genu, posterior limb', 'Lentiform nucleus (putamen + globus pallidus)', 'Thalamus', 'Third ventricle', 'External capsule, claustrum, extreme capsule', 'Insular cortex and Sylvian fissure', 'Pineal gland (often calcified) and atria with choroid plexus'],
    structures: ['caudate_nucleus', 'lentiform_nucleus', 'internal_capsule', 'thalamus', 'insular_cortex', 'septum_pellucidum', 'ventricle', 'pineal-calcification', 'choroid-glomus-r', 'choroid-glomus-l'],
    clinical: 'This is the ganglionic ASPECTS level (caudate, lentiform, internal capsule, insula, M1–M3) and the commonest site of hypertensive haemorrhage (putamen, thalamus). Midline shift is measured here: perpendicular distance from the septum pellucidum to the ideal midline.',
  },
  {
    id: 'lateral-ventricles', name: 'Bodies of the lateral ventricles', short: 'Lateral ventricles',
    recognise: 'The bodies of the lateral ventricles are two parallel “banana” shapes separated by the septum pellucidum, bounded laterally by the caudate body and roofed by the corpus callosum. Periventricular white matter surrounds them.',
    identify: ['Bodies of the lateral ventricles', 'Body of the caudate nucleus along their lateral walls', 'Corpus callosum (genu anteriorly, splenium posteriorly)', 'Periventricular white matter', 'Falx cerebri in the interhemispheric fissure'],
    structures: ['ventricle', 'caudate_nucleus', 'septum_pellucidum', 'frontal_lobe', 'parietal_lobe', 'occipital_lobe', 'venous_sinuses'],
    clinical: 'Supraganglionic ASPECTS level (M4–M6) is just above the basal ganglia. Periventricular low density is common with small-vessel disease in older adults; ventricular size is compared with sulcal size to separate atrophy from hydrocephalus.',
  },
  {
    id: 'centrum-semiovale', name: 'Centrum semiovale', short: 'Centrum semiovale',
    recognise: 'Above the ventricles: a large oval of white matter in each hemisphere, surrounded by cortex and sulci. No CSF spaces other than sulci and the interhemispheric fissure.',
    identify: ['Centrum semiovale white matter', 'Superior frontal and pre/postcentral gyri', 'Central sulcus', 'Interhemispheric fissure and falx', 'Superior sagittal sinus (posterior midline triangle)'],
    structures: ['frontal_lobe', 'parietal_lobe', 'central_sulcus', 'venous_sinuses'],
    clinical: 'Watershed (border-zone) infarcts lie in a line in the deep white matter between ACA and MCA territories. The superior sagittal sinus should be a normal triangle here — compare density with the arteries when venous thrombosis is suspected.',
  },
  {
    id: 'vertex', name: 'High convexity / vertex', short: 'Vertex',
    recognise: 'Small brain cross-sections dominated by the calvarium, which cuts obliquely and looks thick. The paracentral lobule and the superior ends of the pre- and postcentral gyri meet the falx.',
    identify: ['Precentral gyrus / central sulcus / postcentral gyrus', 'Paracentral lobule', 'Superior sagittal sinus', 'Calvarium cut tangentially', 'Scalp'],
    structures: ['central_sulcus', 'frontal_lobe', 'parietal_lobe', 'venous_sinuses', 'skull'],
    clinical: 'Thin convexity subdural haematomas and small subarachnoid bleeds in high sulci are easy to miss — scroll up to the last slice and use the subdural window. Partial volume of the tangentially cut skull can mimic a thin collection.',
  },
]

/* -------------------------------------------------------------- structures */

export interface StructureInfo {
  key: string
  name: string
  ct: string          // CT appearance
  find: string        // how to find it
  clinical: string
  levels: string[]
  atlas: string[]     // NeuroAxis record ids
}

export const STRUCTURES: Record<string, StructureInfo> = {
  brainstem: {
    key: 'brainstem', name: 'Brainstem',
    ct: 'Soft-tissue density similar to white matter; internal nuclei are not resolved on CT. Outline is defined by the surrounding cisterns.',
    find: 'Medulla in the foramen magnum; pons in front of the fourth ventricle; midbrain at the level of the suprasellar cistern (peduncles + tectum).',
    clinical: 'Pontine haemorrhage (hypertensive), basilar territory infarcts (often invisible on early CT). Duret haemorrhages in the midbrain/pons follow descending transtentorial herniation.',
    levels: ['foramen-magnum', 'medulla', 'pons', 'midbrain'],
    atlas: ['ctx-medulla-surface', 'ctx-pons-surface', 'ctx-midbrain-surface'],
  },
  subarachnoid_space: {
    key: 'subarachnoid_space', name: 'Subarachnoid space / cisterns',
    ct: 'CSF density (0–15 HU), dark on brain window. Includes sulci, Sylvian fissures and the basal cisterns.',
    find: 'Basal cisterns at the midbrain level (suprasellar, interpeduncular, ambient, quadrigeminal), prepontine cistern at the pons, cisterna magna at the foramen magnum.',
    clinical: 'Acute subarachnoid haemorrhage replaces the dark CSF with blood density; check every cistern and Sylvian fissure. Effaced cisterns and sulci indicate raised pressure or swelling.',
    levels: ['foramen-magnum', 'pons', 'midbrain', 'third-ventricle'],
    atlas: [],
  },
  venous_sinuses: {
    key: 'venous_sinuses', name: 'Venous sinuses & dural folds',
    ct: 'Normal flowing blood is mildly hyperdense (~40–50 HU, higher with a high haematocrit). Falx and tentorium are thin linear densities that may calcify.',
    find: 'Superior sagittal sinus as a midline triangle posteriorly at the upper levels; transverse and sigmoid sinuses along the occipital and petrous bones; straight sinus at the tentorial apex.',
    clinical: 'Dense sinus with “cord” sign may indicate thrombosis, but a normal dense sinus is common — compare with arteries. Falx calcification is a normal finding; a thick dense falx can also be interhemispheric subdural blood.',
    levels: ['medulla', 'lateral-ventricles', 'centrum-semiovale', 'vertex'],
    atlas: [],
  },
  septum_pellucidum: {
    key: 'septum_pellucidum', name: 'Septum pellucidum',
    ct: 'Thin midline membrane between the frontal horns / bodies of the lateral ventricles.',
    find: 'Midline between the frontal horns at the basal-ganglia level, continuing up between the ventricular bodies.',
    clinical: 'Reference for midline shift: measure the perpendicular distance from the septum to the midline (line between the anterior and posterior falx attachments). A cavum septi pellucidi is a normal variant.',
    levels: ['third-ventricle', 'lateral-ventricles'],
    atlas: [],
  },
  cerebellum: {
    key: 'cerebellum', name: 'Cerebellum',
    ct: 'Grey-white folia are not resolved on CT; often slightly degraded by beam hardening from the petrous bones.',
    find: 'Posterior fossa behind the brainstem and fourth ventricle, below the tentorium; vermis in the midline.',
    clinical: 'Cerebellar haemorrhage or infarct can compress the fourth ventricle and brainstem — a neurosurgical emergency. Tonsils should stay above the foramen magnum.',
    levels: ['foramen-magnum', 'medulla', 'pons', 'midbrain'],
    atlas: ['ctx-cerebellum', 'surf-vermis', 'nuc-dentate'],
  },
  caudate_nucleus: {
    key: 'caudate_nucleus', name: 'Caudate nucleus',
    ct: 'Grey-matter density (~35–40 HU), slightly brighter than the adjacent internal capsule.',
    find: 'The head bulges into the lateral wall of each frontal horn; the body follows the lateral wall of the ventricular body.',
    clinical: 'Caudate atrophy flattens/enlarges the frontal horns (e.g. Huntington disease). Caudate haemorrhage often ruptures into the ventricle. Supplied by Heubner’s artery and lenticulostriate perforators.',
    levels: ['third-ventricle', 'lateral-ventricles'],
    atlas: ['nuc-caudate-head', 'nuc-caudate-body', 'nuc-caudate-tail'],
  },
  lentiform_nucleus: {
    key: 'lentiform_nucleus', name: 'Lentiform nucleus (putamen + globus pallidus)',
    ct: 'Lens-shaped grey-matter density; the globus pallidus (medial part) is slightly lower in density and is the commonest site of physiological basal-ganglia calcification.',
    find: 'Lateral to the internal capsule, medial to the external capsule and insula, at the third-ventricle level.',
    clinical: 'Putamen is the commonest site of hypertensive haemorrhage. “Obscuration of the lentiform nucleus” is an early sign of MCA infarction — use the stroke window and compare sides.',
    levels: ['third-ventricle'],
    atlas: ['nuc-putamen', 'nuc-globus-pallidus-externus', 'nuc-globus-pallidus-internus'],
  },
  insular_cortex: {
    key: 'insular_cortex', name: 'Insular cortex',
    ct: 'A ribbon of grey matter deep to the Sylvian fissure, outlined by CSF laterally and by the extreme/external capsules medially.',
    find: 'Lateral to the lentiform nucleus at the basal-ganglia level, at the depth of the Sylvian fissure.',
    clinical: '“Loss of the insular ribbon” — the grey matter becoming isodense with white matter — is one of the earliest CT signs of MCA territory infarction (ASPECTS region I).',
    levels: ['third-ventricle'],
    atlas: ['surf-insula'],
  },
  internal_capsule: {
    key: 'internal_capsule', name: 'Internal capsule',
    ct: 'White-matter density, darker than the caudate, lentiform nucleus and thalamus that surround it — the V shape is visible on a good brain window.',
    find: 'Anterior limb between caudate head and lentiform nucleus; genu at the apex of the V; posterior limb between thalamus and lentiform nucleus.',
    clinical: 'Small lacunar infarcts in the posterior limb cause pure motor hemiparesis. Haemorrhage from putamen or thalamus may extend into it.',
    levels: ['third-ventricle'],
    atlas: ['tract-internal-capsule-anterior-limb', 'tract-internal-capsule-genu', 'tract-internal-capsule-posterior-limb'],
  },
  ventricle: {
    key: 'ventricle', name: 'Ventricular system',
    ct: 'CSF density. Choroid plexus in the atria frequently calcifies (glomus), as does the pineal gland behind the third ventricle.',
    find: 'Fourth ventricle at the pons; aqueduct in the midbrain; third ventricle between the thalami; frontal horns, bodies, atria, occipital and temporal horns of the lateral ventricles.',
    clinical: 'Hydrocephalus: rounded frontal horns, dilated temporal horns, Evans index > 0.3. Intraventricular blood layers dependently in the occipital horns. Slit-like or asymmetric ventricles may indicate mass effect.',
    levels: ['pons', 'midbrain', 'third-ventricle', 'lateral-ventricles'],
    atlas: ['vent-lateral-ventricle', 'vent-third-ventricle', 'vent-cerebral-aqueduct', 'vent-fourth-ventricle'],
  },
  central_sulcus: {
    key: 'central_sulcus', name: 'Central sulcus',
    ct: 'A sulcus (CSF) — identify it by its shape, not density.',
    find: 'On high axial slices: the precentral gyrus is thick with a “hand knob” (inverted omega); the superior frontal sulcus ends on the precentral sulcus; the pars marginalis of the cingulate sulcus “bracket” lies just behind it near the midline.',
    clinical: 'Localising motor (precentral) and sensory (postcentral) cortex for convexity lesions and infarcts.',
    levels: ['centrum-semiovale', 'vertex'],
    atlas: ['ctx-precentral-gyrus', 'ctx-postcentral-gyrus', 'ctx-paracentral-lobule'],
  },
  frontal_lobe: {
    key: 'frontal_lobe', name: 'Frontal lobe',
    ct: 'Cortex and white matter; the orbitofrontal surface lies on the orbital roofs and is degraded by partial volume at low levels.',
    find: 'Anterior to the central sulcus; above the orbits at low levels.',
    clinical: 'Contusions favour the orbitofrontal and frontal poles (coup/contrecoup). ACA territory infarcts lie along the medial frontal lobe.',
    levels: ['midbrain', 'third-ventricle', 'lateral-ventricles', 'centrum-semiovale', 'vertex'],
    atlas: ['surf-frontal-lobe'],
  },
  parietal_lobe: {
    key: 'parietal_lobe', name: 'Parietal lobe',
    ct: 'Cortex and white matter at the upper levels behind the central sulcus.',
    find: 'Behind the central sulcus and above the Sylvian fissure; separated from the occipital lobe medially by the parieto-occipital sulcus.',
    clinical: 'Watershed infarcts and lobar haemorrhages (cerebral amyloid angiopathy in older patients).',
    levels: ['lateral-ventricles', 'centrum-semiovale', 'vertex'],
    atlas: ['surf-parietal-lobe'],
  },
  occipital_lobe: {
    key: 'occipital_lobe', name: 'Occipital lobe',
    ct: 'Posterior cortex around the occipital horns; calcarine sulcus medially.',
    find: 'Posterior to the parieto-occipital sulcus, above the tentorium.',
    clinical: 'PCA territory infarct (homonymous hemianopia). Dependent blood in the occipital horns indicates intraventricular haemorrhage.',
    levels: ['third-ventricle', 'lateral-ventricles'],
    atlas: ['surf-occipital-lobe'],
  },
  temporal_lobe: {
    key: 'temporal_lobe', name: 'Temporal lobe',
    ct: 'Sits in the middle cranial fossa; the anterior pole is often degraded by beam hardening from the sphenoid wing and petrous bone.',
    find: 'Lateral to the midbrain and pons, below the Sylvian fissure; the temporal horn and hippocampus lie medially.',
    clinical: 'Temporal pole contusions; uncal herniation (medial temporal lobe pushed over the tentorial edge, effacing the ambient/suprasellar cistern). Extradural haematoma over the temporal squama (middle meningeal artery).',
    levels: ['pons', 'midbrain', 'third-ventricle'],
    atlas: ['surf-temporal-lobe', 'nuc-hippocampus', 'nuc-amygdala'],
  },
  thalamus: {
    key: 'thalamus', name: 'Thalamus',
    ct: 'Grey-matter density, ovoid, bordering the third ventricle medially and the posterior limb of the internal capsule laterally.',
    find: 'Either side of the third ventricle at the basal-ganglia level, behind the genu of the internal capsule.',
    clinical: 'Second commonest site of hypertensive haemorrhage; often extends into the ventricle. Thalamic lacunes (thalamoperforators from PCA / P1).',
    levels: ['third-ventricle'],
    atlas: ['ctx-thalamus-envelope', 'nuc-pulvinar', 'nuc-md', 'nuc-vpl'],
  },
  eye: {
    key: 'eye', name: 'Globe (eye)', ct: 'Fluid-density vitreous, very dense lens.', find: 'Orbits at the level of the sphenoid sinus / pons.', clinical: 'Gaze deviation of both globes can point toward a large hemispheric lesion.', levels: ['pons'], atlas: [],
  },
  optic_nerve: {
    key: 'optic_nerve', name: 'Optic nerve', ct: 'Soft-tissue cord within the intraconal fat.', find: 'From the back of the globe to the optic canal, at the level of the midbrain/pons.', clinical: 'Optic nerve sheath enlargement can accompany raised intracranial pressure.', levels: ['pons', 'midbrain'], atlas: ['ctx-optic-chiasm'],
  },
  auditory_canal: {
    key: 'auditory_canal', name: 'External auditory canal', ct: 'Air-filled canal in the temporal bone.', find: 'Lateral temporal bone at the level of the pons.', clinical: 'Temporal bone fractures (bone window) and blood in the canal after head trauma.', levels: ['pons'], atlas: [],
  },
  nasal_cavity: {
    key: 'nasal_cavity', name: 'Nasal cavity', ct: 'Air with turbinates.', find: 'Anterior midline at the low levels.', clinical: 'Fluid levels in the paranasal sinuses after trauma can indicate a skull-base fracture.', levels: ['medulla', 'pons'], atlas: [],
  },
  nasopharynx: {
    key: 'nasopharynx', name: 'Nasopharynx', ct: 'Airway lined by soft tissue.', find: 'Anterior to the clivus and C1.', clinical: 'Not a brain structure; included for orientation at the lowest slices.', levels: ['craniocervical'], atlas: [],
  },
  skull: {
    key: 'skull', name: 'Skull', ct: 'Cortical bone > 1000 HU; diploë between the inner and outer tables.', find: 'Every level; use the bone window.', clinical: 'Fractures vs sutures/vascular grooves (sutures are symmetric with sclerotic serrated margins). Depressed fractures and pneumocephalus.', levels: ['craniocervical', 'foramen-magnum', 'medulla', 'pons', 'midbrain', 'third-ventricle', 'lateral-ventricles', 'centrum-semiovale', 'vertex'], atlas: [],
  },
  sinus_frontal: {
    key: 'sinus_frontal', name: 'Frontal sinus', ct: 'Air-filled; variable size, may be absent.', find: 'Anterior to the frontal lobes above the orbits.', clinical: 'Posterior wall fractures risk CSF leak.', levels: ['third-ventricle'], atlas: [],
  },
  sinus_maxillary: {
    key: 'sinus_maxillary', name: 'Maxillary sinus', ct: 'Air-filled.', find: 'Below the orbits, at the low levels.', clinical: 'Fluid levels after facial trauma.', levels: ['medulla'], atlas: [],
  },
  mandible: {
    key: 'mandible', name: 'Mandible', ct: 'Bone.', find: 'Lowest slices, anterior.', clinical: 'Orientation only.', levels: ['craniocervical'], atlas: [],
  },
  // landmarks
  'foramen-magnum': {
    key: 'foramen-magnum', name: 'Foramen magnum', ct: 'Complete bony ring in the occipital bone.', find: 'Lowest intracranial level; medulla in the centre.', clinical: 'Tonsillar herniation: tonsils below the ring, no CSF around the medulla.', levels: ['foramen-magnum'], atlas: ['ctx-medulla-surface'],
  },
  'fourth-ventricle': {
    key: 'fourth-ventricle', name: 'Fourth ventricle', ct: 'CSF slit between pons and vermis.', find: 'Pons level, midline.', clinical: 'Effacement → obstructive hydrocephalus; blood here indicates intraventricular extension.', levels: ['pons'], atlas: ['vent-fourth-ventricle'],
  },
  'pineal-calcification': {
    key: 'pineal-calcification', name: 'Pineal gland (calcified)', ct: 'Punctate calcification in the midline behind the third ventricle — common in adults.', find: 'Posterior midline at the third-ventricle level, above the tectum.', clinical: 'A displaced pineal calcification is a historical marker of midline shift; do not mistake it for haemorrhage.', levels: ['third-ventricle'], atlas: ['nuc-pineal-gland'],
  },
  'choroid-glomus-r': {
    key: 'choroid-glomus-r', name: 'Choroid plexus glomus (calcified)', ct: 'Bilateral, roughly symmetric calcification in the atria of the lateral ventricles.', find: 'Atria (trigones) of the lateral ventricles.', clinical: 'Normal finding — not intraventricular haemorrhage (blood layers dependently in the occipital horns instead).', levels: ['third-ventricle', 'lateral-ventricles'], atlas: ['vent-choroid-plexus-lateral', 'vent-lateral-ventricle-atrium'],
  },
}
STRUCTURES['choroid-glomus-l'] = { ...STRUCTURES['choroid-glomus-r'], key: 'choroid-glomus-l' }

const L = (key: string, name: string, ct: string, find: string, clinical: string, levels: string[], atlas: string[] = []): StructureInfo =>
  ({ key, name, ct, find, clinical, levels, atlas })

Object.assign(STRUCTURES, {
  dens: L('dens', 'Dens of C2 (odontoid peg)', 'Dense cortical bone peg articulating with the anterior arch of C1.', 'Lowest slices, centred in the ring of C1, directly behind the anterior arch.', 'Odontoid fractures are assessed on bone window with sagittal and coronal reformats; the atlanto-dental interval should be narrow.', ['craniocervical']),
  'suprasellar-cistern': L('suprasellar-cistern', 'Suprasellar cistern', 'CSF-density star or pentagon in front of the midbrain.', 'Midbrain level, midline, above the sella; its limbs are the interhemispheric fissure, Sylvian fissures and ambient cisterns.', 'First place to look for subarachnoid blood; asymmetric effacement suggests uncal herniation.', ['midbrain']),
  clivus: L('clivus', 'Clivus', 'Sloping midline bone from the dorsum sellae to the foramen magnum.', 'Midline skull base in front of the brainstem; best seen on sagittal bone reformats.', 'Basilar artery and brainstem lie directly behind it; clival fractures are high-energy injuries.', ['pons', 'medulla']),
  'mastoid-r': L('mastoid-r', 'Mastoid air cells', 'Honeycomb of air cells in the mastoid part of the temporal bone.', 'Lateral posterior skull base at the pons/medulla level; bone window.', 'Opacified cells after trauma can indicate a temporal bone fracture; asymmetric pneumatisation is normal.', ['pons', 'medulla']),
  'otic-capsule-r': L('otic-capsule-r', 'Otic capsule (inner ear)', 'Very dense bone enclosing the cochlea and semicircular canals.', 'Petrous temporal bone, medial to the middle ear, at the pons level; bone window.', 'Fractures crossing the otic capsule carry a high risk of sensorineural hearing loss and CSF leak.', ['pons']),
  'internal-occipital-protuberance': L('internal-occipital-protuberance', 'Internal occipital protuberance', 'Midline bony prominence on the inner occipital bone.', 'Posterior midline of the posterior fossa; the confluence of the sinuses lies against it.', 'Landmark for the torcular (confluence of sinuses) and the attachment of the falx cerebelli.', ['pons', 'medulla']),
  'dorsum-sellae': L('dorsum-sellae', 'Dorsum sellae', 'Plate of bone forming the back wall of the pituitary fossa, topped by the posterior clinoid processes.', 'Midline, at the top of the clivus, just below the suprasellar cistern; bone window.', 'Erosion of the dorsum sellae is a classic sign of longstanding raised intracranial pressure or a sellar mass.', ['midbrain']),
  // Arteries on NON-CONTRAST CT (these scans have no contrast; vessels are seen only where CSF or calcium outlines them)
  'vertebral-artery': L('vertebral-artery', 'Vertebral arteries', 'On non-contrast CT: soft-tissue tubes in front of the medulla, often with mural calcification in older patients.', 'Foramen magnum/medulla level, anterolateral to the medulla, converging toward the midline.', 'Vertebral dissection or occlusion causes posterior-circulation stroke (e.g. lateral medullary syndrome).', ['foramen-magnum', 'medulla'], ['vasc-vertebral-artery']),
  'basilar-artery': L('basilar-artery', 'Basilar artery', 'A round soft-tissue dot in the prepontine cistern; a hyperdense basilar is a sign of thrombosis.', 'Pons level, in the CSF in front of the pons, behind the clivus.', 'Basilar occlusion is catastrophic and can be subtle — compare its density with other vessels.', ['pons'], ['vasc-basilar-artery']),
  'internal-carotid-artery': L('internal-carotid-artery', 'Internal carotid arteries (cavernous/supraclinoid)', 'Curved soft-tissue/calcified tubes beside the sella; siphon calcification is very common.', 'Either side of the sella/dorsum sellae at the midbrain level, entering the suprasellar cistern.', 'Calcification marks atherosclerosis; a dense ICA terminus suggests thrombus.', ['midbrain'], ['vasc-internal-carotid-artery']),
  'middle-cerebral-artery': L('middle-cerebral-artery', 'Middle cerebral artery (M1)', 'Horizontal soft-tissue line in the Sylvian fissure CSF; normally similar in density to other vessels.', 'From the suprasellar cistern laterally into the Sylvian fissure at the midbrain level.', 'The hyperdense MCA sign (and the MCA "dot" sign in the fissure) indicates thrombus in acute stroke.', ['midbrain', 'third-ventricle'], ['vasc-middle-cerebral-artery']),
  'anterior-cerebral-artery': L('anterior-cerebral-artery', 'Anterior cerebral arteries', 'Small soft-tissue dots in the anterior interhemispheric fissure.', 'Midline anterior to the suprasellar cistern (A1/ACom) and along the interhemispheric fissure higher up.', 'ACA territory infarcts affect the medial frontal and parietal lobes.', ['midbrain', 'third-ventricle'], ['vasc-anterior-cerebral-artery']),
  'posterior-cerebral-artery': L('posterior-cerebral-artery', 'Posterior cerebral arteries', 'Curvilinear soft-tissue lines in the ambient cisterns around the midbrain.', 'Midbrain level, curving round the cerebral peduncles.', 'PCA infarcts involve the occipital lobe, medial temporal lobe and thalamus.', ['midbrain'], ['vasc-posterior-cerebral-artery']),
})
STRUCTURES['mastoid-l'] = { ...STRUCTURES['mastoid-r'], key: 'mastoid-l' }
STRUCTURES['otic-capsule-l'] = { ...STRUCTURES['otic-capsule-r'], key: 'otic-capsule-l' }

/** Arteries to look for at each level on a non-contrast scan (CTA anatomy pending TopCoW). */
export const LEVEL_ARTERIES: Record<string, string[]> = {
  'foramen-magnum': ['vertebral-artery'],
  medulla: ['vertebral-artery'],
  pons: ['basilar-artery'],
  midbrain: ['internal-carotid-artery', 'middle-cerebral-artery', 'anterior-cerebral-artery', 'posterior-cerebral-artery'],
  'third-ventricle': ['middle-cerebral-artery', 'anterior-cerebral-artery'],
}

/* ------------------------------------------------------------ clinical */

export interface ClinicalTopic {
  id: string
  title: string
  group: 'Haemorrhage' | 'Infarction' | 'Mass effect' | 'Normal mimics'
  window: string
  levels: string[]
  structures: string[]
  where: string
  looks: string
  normalCheck: string
}

export const CLINICAL: ClinicalTopic[] = [
  {
    id: 'edh', title: 'Extradural (epidural) haematoma', group: 'Haemorrhage', window: 'subdural',
    levels: ['midbrain', 'third-ventricle'], structures: ['temporal_lobe', 'skull'],
    where: 'Between inner table and dura, classically over the temporal squama (middle meningeal artery) with an overlying fracture.',
    looks: 'Biconvex (lentiform) hyperdense collection that does not cross suture lines but can cross the midline/dural reflections.',
    normalCheck: 'On a normal scan, scroll the temporal convexities in the subdural window: the brain surface should touch the inner table. Then check the bone window for fractures vs sutures.',
  },
  {
    id: 'sdh', title: 'Subdural haematoma', group: 'Haemorrhage', window: 'subdural',
    levels: ['lateral-ventricles', 'centrum-semiovale', 'vertex'], structures: ['venous_sinuses', 'frontal_lobe', 'parietal_lobe'],
    where: 'Along the convexities, the falx (interhemispheric) and the tentorium, from torn bridging veins.',
    looks: 'Crescentic collection that crosses sutures but not the falx; acute = hyperdense, subacute can be isodense to cortex, chronic = hypodense.',
    normalCheck: 'Normal: thin dense falx and tentorium of uniform thickness. Look for unequal sulci and buckled grey-white interface, which betray an isodense SDH.',
  },
  {
    id: 'sah', title: 'Subarachnoid haemorrhage', group: 'Haemorrhage', window: 'brain',
    levels: ['pons', 'midbrain', 'third-ventricle'], structures: ['subarachnoid_space', 'ventricle'],
    where: 'Basal cisterns (suprasellar, interpeduncular, ambient, quadrigeminal, prepontine), Sylvian fissures, interhemispheric fissure, sulci, and dependent occipital horns.',
    looks: 'Hyperdense blood replacing dark CSF, outlining the cistern/sulcal shapes.',
    normalCheck: 'On a normal scan every limb of the suprasellar “star” and both Sylvian fissures are CSF-dark. Learn their normal shapes at the midbrain level.',
  },
  {
    id: 'ivh', title: 'Intraventricular haemorrhage', group: 'Haemorrhage', window: 'brain',
    levels: ['third-ventricle', 'lateral-ventricles'], structures: ['ventricle', 'choroid-glomus-r', 'choroid-glomus-l'],
    where: 'Dependent occipital horns (blood–CSF level), third and fourth ventricles.',
    looks: 'Layering hyperdensity with a fluid level; casts the ventricle when large.',
    normalCheck: 'Calcified choroid glomus in the atria is normal: dense, round, roughly symmetric and not layering.',
  },
  {
    id: 'ich', title: 'Hypertensive intracerebral haemorrhage — typical sites', group: 'Haemorrhage', window: 'brain',
    levels: ['third-ventricle', 'pons', 'medulla'], structures: ['lentiform_nucleus', 'thalamus', 'brainstem', 'cerebellum'],
    where: 'Putamen (commonest) > thalamus > pons > cerebellum (dentate region). Lobar haemorrhage in the elderly suggests amyloid angiopathy.',
    looks: 'Round/oval hyperdense haematoma (~50–80 HU) with surrounding low-density oedema.',
    normalCheck: 'Know these deep grey nuclei on the normal scan: lentiform nucleus lateral to the internal capsule, thalamus medial to it. Physiological pallidal calcification is symmetric and much denser.',
  },
  {
    id: 'mca', title: 'MCA territory infarct & ASPECTS', group: 'Infarction', window: 'stroke',
    levels: ['third-ventricle', 'lateral-ventricles'], structures: ['insular_cortex', 'lentiform_nucleus', 'caudate_nucleus', 'internal_capsule'],
    where: 'ASPECTS: ganglionic level (caudate, lentiform, internal capsule, insula, M1–M3 cortex) and supraganglionic level (M4–M6). Each region with early ischaemic change subtracts 1 from 10.',
    looks: 'Hyperdense MCA sign, loss of insular ribbon, obscured lentiform nucleus, loss of grey–white differentiation and sulcal effacement.',
    normalCheck: 'In the stroke window, compare left and right insular ribbons and lentiform margins — on a normal scan they are crisp and symmetric.',
  },
  {
    id: 'aca-pca', title: 'ACA and PCA infarcts', group: 'Infarction', window: 'stroke',
    levels: ['lateral-ventricles', 'centrum-semiovale', 'third-ventricle'], structures: ['frontal_lobe', 'parietal_lobe', 'occipital_lobe', 'thalamus'],
    where: 'ACA: medial frontal and parietal lobes along the interhemispheric fissure. PCA: occipital lobe, medial temporal lobe and thalamus.',
    looks: 'Wedge of low density involving cortex and white matter in the territory.',
    normalCheck: 'The parasagittal cortex and occipital poles should match the opposite side in density.',
  },
  {
    id: 'lacune', title: 'Lacunar infarcts', group: 'Infarction', window: 'stroke',
    levels: ['third-ventricle', 'lateral-ventricles', 'pons'], structures: ['internal_capsule', 'lentiform_nucleus', 'thalamus', 'brainstem'],
    where: 'Territories of the deep perforators: internal capsule, lentiform nucleus, thalamus, corona radiata, pons.',
    looks: 'Small (< 15 mm) round low-density foci; old lacunes approach CSF density.',
    normalCheck: 'Perivascular spaces near the anterior commissure/lentiform nucleus are a normal mimic — small, CSF-density and often symmetric.',
  },
  {
    id: 'shift', title: 'Midline shift & subfalcine herniation', group: 'Mass effect', window: 'brain',
    levels: ['third-ventricle', 'lateral-ventricles'], structures: ['septum_pellucidum', 'ventricle', 'venous_sinuses'],
    where: 'Measured at the level of the foramina of Monro: septum pellucidum vs the line joining the falx attachments.',
    looks: 'Septum displaced away from the mass; ipsilateral ventricle compressed, contralateral ventricle may dilate (trapped).',
    normalCheck: 'Use the measure tool on the normal scan: the septum should lie on the midline.',
  },
  {
    id: 'uncal', title: 'Uncal / descending transtentorial herniation', group: 'Mass effect', window: 'brain',
    levels: ['midbrain'], structures: ['subarachnoid_space', 'temporal_lobe', 'brainstem'],
    where: 'Medial temporal lobe (uncus) over the tentorial edge at the midbrain level.',
    looks: 'Effaced ipsilateral suprasellar and ambient cisterns, midbrain compressed and rotated; later Duret haemorrhages.',
    normalCheck: 'Normal: symmetric, open ambient and suprasellar cisterns with the uncus not projecting medially.',
  },
  {
    id: 'tonsillar', title: 'Tonsillar herniation', group: 'Mass effect', window: 'brain',
    levels: ['foramen-magnum'], structures: ['cerebellum', 'brainstem', 'foramen-magnum'],
    where: 'Foramen magnum.',
    looks: 'Cerebellar tonsils fill the foramen magnum and efface the CSF around the medulla and the cisterna magna.',
    normalCheck: 'Normal: CSF visible around the medulla at the foramen magnum; tonsils above or just at the ring.',
  },
  {
    id: 'hydro', title: 'Hydrocephalus vs atrophy', group: 'Mass effect', window: 'brain',
    levels: ['midbrain', 'third-ventricle', 'lateral-ventricles'], structures: ['ventricle', 'subarachnoid_space'],
    where: 'Temporal horns (earliest sign), frontal horns, third ventricle.',
    looks: 'Hydrocephalus: ventricles enlarged out of proportion to sulci, rounded frontal horns, temporal horns > ~2 mm, Evans index > 0.3. Atrophy: ventricles and sulci enlarge together.',
    normalCheck: 'Measure the Evans index on the normal scan: maximal frontal-horn width ÷ maximal internal skull diameter on the same slice.',
  },
  {
    id: 'mimics', title: 'Normal densities that mimic blood', group: 'Normal mimics', window: 'brain',
    levels: ['pons', 'third-ventricle', 'lateral-ventricles', 'vertex'], structures: ['pineal-calcification', 'choroid-glomus-r', 'choroid-glomus-l', 'lentiform_nucleus', 'venous_sinuses'],
    where: 'Pineal, habenula, choroid plexus glomus, globus pallidus, falx/tentorium, dural sinuses; beam hardening between the petrous bones; partial volume of the skull base and vertex.',
    looks: 'Calcification is typically far denser than blood (> 100 HU — check with the bone window or HU readout) and symmetric; artefacts follow streaks/bone edges.',
    normalCheck: 'Hover over each dense focus and read the HU value; switch to bone window — calcification stays bright, acute blood disappears.',
  },
]

export const DEFAULT_WINDOW = WINDOWS[0]
