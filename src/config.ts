// ============================================================================
// ROTOR LOGGER — centrální konfigurace.
// VŠECHNY laditelné konstanty jsou zde (oddíl 3 zadání): žádná magická čísla
// v logice. Každé nejasné rozhodnutí je zdokumentováno komentářem zde nebo
// v DECISIONS.md.
// Jednotky: SI (m, kg, s, rad, W), úhly v radiánech (kde není uvedeno jinak).
// ============================================================================

export const WORLD = {
  seed: 20241118,               // konfigurovatelný seed světa (oddíl 4.1)
  size: 4000,                   // terén 4 km x 4 km [m]
  terrainSegments: 288,         // mřížka výškové mapy (2× více polygonů než 144)
  noise: {
    octaves: 5,
    baseFrequency: 1 / 700,     // měřítko největší vlny terénu (větší mapa = větší kopce)
    persistence: 0.5,
    amplitude: 110,             // výška kopců [m]
    ridgeBoost: 0.12,           // mírné hřebeny — krajina je uhlazená
    baseLift: 20,               // celkové nadzdvižení, aby údolí neklesla pod hladinu
    smoothRadius: 6,            // mírné vyhlazení výškové mapy (m)
  },
  // vodní toky: řeka přes celou mapu + přítok + jezero (vykreslí se pod vodní hladinou)
  water: {
    river: { zBase: -700, amp1: 520, f1: 0.0011, amp2: 160, f2: 0.0037, width: 34, depth: 5 },
    stream: { xBase: 1400, amp: 110, f: 0.009, width: 11, depth: 3, zFrom: -300, zTo: 1060 },
    lake: { x: 1400, z: 1300, r: 240, depth: 7 },
    levelOffset: -4,           // hladina = surová výška v referenčním bodě řeky + offset
  },
  treeCount: 9000,              // hustší výskyt stromů na 4×4 km
  treeMinDist: 6,               // min. rozestup stromů [m]
  treeClearings: [             // bezlesé plochy: heliport, paseka, těžba
    { x: 0, z: 0, r: 60 },        // startovní heliport (střed světa)
    { x: 1000, z: -800, r: 85 },  // odkládací plocha
    { x: -1200, z: 900, r: 115 }, // těžební oblast
  ],
  heliport: { x: 0, z: 0 },     // startovní pozice (výšku dopočítá terén)
  dropZone: { x: 1000, z: -800, radius: 10, tolerance: 2 }, // kruh z latí ±2 m
  loggingArea: { x: -1200, z: 900, radius: 95 },
} as const;

export const TREES = {
  species: 3,                   // varianty smrku (oddíl 4.2)
  minScale: 0.8,
  maxScale: 2.1,                // vyšší stromy
  trunkRadius: 0.34,            // základní poloměr kmene před škálováním
  trunkHeight: 4.4,             // vyšší kmen
  crownHeight: 15.0,            // delší úzká koruna smrku
  crownCones: 3,                // 3 přesazené kužely = typický smrk
  collisionRadiusFactor: 1.15,  // kolizní kužel kmene o trochu širší než vizuál
} as const;

// ---------------------------------------------------------------------------
// Typy vrtulníků — strukturováno jako seznam, aby šel později přidat další
// typ bez zásahu do fyzikálního kódu (oddíly 13 a 15).
// Fyzikální předpis: těžký dvoumotorový "létající jeřáb" podle vzoru
// Sikorsky S-64 Skycrane (bez ochranných známek — fiktivní typ „Skyhaul SH-6“).
// ---------------------------------------------------------------------------
export interface HeliTypeConfig {
  id: string;
  name: string;               // fiktivní název typu (žádné reálné značky)
  registration: string;       // fiktivní imatrikulace
  massEmpty: number;          // prázdná hmotnost [kg] ~ 9 000
  fuelMax: number;            // palivo [kg] ~ 2 000
  mtow: number;               // max. vzletová hmotnost [kg] ~ 17 400
  hookMaxLoad: number;        // max. zátěž háku [kg] ~ 8 000
  engines: number;            // počet motorů
  enginePowerKw: number;      // výkon každého motoru [kW] ~ 3 000
  rotorDiameter: number;      // průměr hlavního rotoru [m] = 21,9
  rotorRpmNom: number;        // nominální otáčky rotoru [rpm] ~ 185
  rotorBlades: number;        // šest úzkých listů
  tailRotorBlades: number;    // čtyřlistý ocasní rotor
  bladeChord: number;         // tětiva listu [m]
  rotorInertia: number;       // moment setrvačnosti rotoru [kg m^2]
  solidity: number;           // plnost disku σ
  profilePowerCd: number;     // odporový koeficient profilu listu
  dragCdA: number;            // efektivní plocha odporu draku C_D·A [m^2]
  loadDragCdA: number;        // přídavná plocha nákladu [m^2] ~ 1,5
  hubHeight: number;          // výška rotorové hlavy nad těžištěm [m]
  attachOffsetY: number;      // závěsný bod pod těžištěm (záporné y tělesa) [m]
  gearRadius: number;         // poloměr "koule" trupu pro kolizi [m]
  inertia: { x: number; y: number; z: number }; // momenty setrvačnosti trupu
  fuselageLength: number;     // délka trupu [m] ~ 21,5
  fuselageHeight: number;     // výška [m] ~ 5,7
  startSequence: { crankS: number; ignitionS: number; spoolS: number };
}

export const HELI_TYPES: HeliTypeConfig[] = [
  {
    id: 'skyhaul-sh6',
    name: 'Skyhaul SH-6',
    registration: 'OK-LGX',
    massEmpty: 9000,
    fuelMax: 2000,
    mtow: 17400,
    hookMaxLoad: 8000,
    engines: 2,
    enginePowerKw: 3000,
    rotorDiameter: 21.9,
    rotorRpmNom: 185,
    rotorBlades: 6,
    tailRotorBlades: 4,
    bladeChord: 0.42,
    rotorInertia: 55000,
    solidity: 0.073,
    profilePowerCd: 0.011,
    dragCdA: 6.2,
    loadDragCdA: 1.5,
    hubHeight: 3.1,
    attachOffsetY: -1.6,
    gearRadius: 2.3,
    inertia: { x: 42000, y: 85000, z: 46000 },
    fuselageLength: 21.5,
    fuselageHeight: 5.7,
    startSequence: { crankS: 3.0, ignitionS: 2.0, spoolS: 14.0 },
  },
];
export const HELI_TYPE_INDEX = 0; // tento projekt zatím jen jeden typ

// ---------------------------------------------------------------------------
// Fyzika letu (oddíl 5) — zjednodušená teorie momentu + prvky BEMT.
// ---------------------------------------------------------------------------
export const PHYSICS = {
  dt: 1 / 120,                  // fixní fyzikální krok 120 Hz (oddíl 6.7d)
  gravity: 9.81,
  airDensity: 1.225,            // ρ [kg/m^3]
  cTMax: 0.0095,                // max. koeficient vztlaku C_T (kolektiv 100 %)
  cTExponent: 1.15,             // mírná nelinearita kolektivu (menší citlivost dole)
  bladePitchMinDeg: -2,         // rozsah listů −2° až +12° (oddíl 5.1)
  bladePitchMaxDeg: 12,
  inducedSolveIterations: 4,    // iterace indukované rychlosti (teorie momentu)
  // Přízemní efekt (oddíl 5.2): jemné nadlehčení do ~1,2× do výšky ~1,2 D.
  groundEffect: { maxBoost: 0.22, heightScale: 0.55 }, // výška měřena u hlavy rotoru, v jednotkách průměru rotoru
  // Translační vztlak (ETL) při cca 8–12 m/s (oddíl 5.2).
  etl: { maxBoost: 0.15, start: 7, full: 14, fadeStart: 26, fadeFull: 42 },
  // Vírový kruh (vortex ring state): kolaps vztlaku při prudkém svislém sestupu.
  vortexRing: { descentStart: 8, descentFull: 16, minThrustFrac: 0.45, minHorizSpeed: 10, minFactor: 0.55 },
  // Asymetrie vztlaku / ústup listu (retreating blade stall) ve vysoké rychlosti.
  retreatingStall: { start: 38, full: 55, maxAuthorityLoss: 0.55, buffetAmp: 0.012 },
  maxSpeed: 62,                 // Vne herní [m/s] ~ 120 kt
  // Governor otáček rotoru: při přetížení kolektivem Ω mírně propadá.
  // Změkčení přes první řád s prodlevou lagS — náběh i pokles Ω působí hladce (17.7).
  governor: { gain: 2.2e7, maxPowerFrac: 1.0, lagS: 1.2 },
  rotorMinFrac: 0.55,           // pod touto frakcí Ω_nom "rotorový stall" (varování)
  // Řídicí vrstva náklonu (oddíl 6.2): cyklika = P·chyba − D·rychlost.
  attitude: {
    kP: 5.0,
    kD: 7.5,
    maxPitchRateDegS: 60,       // limit rychlosti náklonu podélně
    maxRollRateDegS: 90,        // limit rychlosti náklonu příčně
    maxYawRateDegS: 45,         // pedály
    maxPitchDeg: 45,            // hard limit náklonu (myš může žádat 30, strop 45)
    maxRollDeg: 50,
    reactionTorqueCoupling: 2.5e-6, // vliv změny výkonu motoru na zatáčení (oddíl 5.1)
  },
  // Turbulence (oddíl 5.4, revidováno): POUZE nízkofrekvenční pomalý drift
  // rychlosti/polohy (perioda sekundy, Δv < ±0,3 m/s) — žádné chvění trupu.
  // Vypínatelné přes turbulence_intensity (0 = vypnuto, výchozí velmi nízká).
  turbulence_intensity: 0.12,   // 0..1, škála driftu (maxDeltaV 0,3 m/s)
  turbulence_maxDeltaV: 0.3,    // m/s
  turbulence_freq: 0.22,        // Hz, nízkofrekvenční
  buffet: { amp: 0.012 },       // jen kamerové mikro-otřesy (< 0,2°), NE na trup
  // Kolize: tvrdý náraz při přistání.
  crash: { maxSinkRate: 8, rotorStrikeOmegaFrac: 0.5, restitution: 0.25, groundFriction: 0.86 },
  fuel: { kgPerKwPerS: 0.000078, minFlowKgS: 0.02 }, // ~280 kg/h při plném výkonu
  // Testovatelnost: vypnutí aerodynamického odporu pro numerický test energie.
  debugDisableDrag: false,
} as const;

// ---------------------------------------------------------------------------
// Ovládání — „stíhačkové“ myší řízení (oddíl 6). Myš = virtuální páka:
// vzdálenost od středu obrazovky = proporcionální výchylka (kritéria 6.7a–d).
// ---------------------------------------------------------------------------
export const CONTROLS = {
  maxPitchDeg: 30,              // maxPitch cca ±30° (lze až ±45°)
  maxRollDeg: 50,               // maxRoll cca ±50°
  expoDefault: 0.2,             // exponenciální křivka 0,0–0,5, výchozí 0,2
  expoCurve: 2.0,               // out = sign(in)·|in|^(1+expo·expoCurve)
  deadZone: 0.05,               // mrtvá zóna 5 % (oddíl 6, bod 2b)
  stickRadiusFrac: 0.42,        // poloměr virtuální páky jako zlomek min(w,h)
  stickSmoothingTau: 0.1,       // dolnopropustní filtr polohy páky 80–120 ms (6.2b)
  stickSmoothingDefault: 0.1,
  targetRateLimitDegS: 150,     // limit rychlosti změny cílového náklonu (6.2b)
  sensitivityDefault: 1.0,      // násobič citlivosti myši
  invertYDefault: false,        // konvence myš nahoru = příď dolů (stíhačky)
  trimStep: 0.02,               // krok trimu
  keys: {
    collectiveUp: ['KeyW'], collectiveDown: ['KeyS'],
    pedalLeft: ['KeyA'], pedalRight: ['KeyD'],
    pedalLeftAlt: ['KeyQ'], pedalRightAlt: ['KeyE'],
    winchOut: ['KeyR'], winchIn: ['KeyV'],       // vysunout / zatáhnout lano
    hook: ['Space'],
    engine: ['KeyE'],             // studený start / vypnutí (oddíl 8.1)
    trim: ['KeyC'],               // trim přesune aktuální výchylku myši
    mute: ['KeyM'],
    help: ['F1'], telemetry: ['F3'], quickSave: ['F5'],
    engineCutTest: ['KeyT'],      // testovací výpadek motoru (oddíl 5.3)
    cameraView: ['KeyX'],
    hookCam: ['KeyH'],            // pohled na naviják: hlavní → PiP → celá obrazovka (6.5d)
    zoomIn: ['Equal', 'NumpadAdd'], zoomOut: ['Minus', 'NumpadSub'],
    pause: ['Escape'],
    nextShift: ['Enter'],
    settings: ['KeyO'],           // panel nastavení (čas, vítr, bouřka, test, režim letu)
    modeCycle: ['KeyP'],          // cykluje letový režim Manual/Stabilizovaný/Hover/Autopilot
  },
} as const;

// Měkký kolektiv s držením výšky (oddíl 6, body 3 a 3b):
// W/S dává příkaz vertikální RYCHLOSTI (náběh vyRamp), kolektiv řídí měkký
// uzavřený regulátor; po puštění W/S se drží výška (cílová vy → 0, měkké zásahy).
export const ALT_HOLD = {
  vyRamp: 1.5,        // (m/s) za sekundu držení klávesy
  climbMax: 5,        // m/s
  sinkMax: -8,        // m/s
  kADes: 1.2,         // P regulátor cílové vertikální rychlosti → cílové zrychlení [1/s]
  aDesMax: 3,         // max cílové vertikální zrychlení [m/s²]
  kAColl: 0.3,        // zesílení zpětné vazby zrychlení → kolektiv [1/(m/s²)]
  maxCollRate: 0.3,   // max rychlost přestavby kolektivu [1/s]
  holdDecay: 0.5,     // jak rychle cílová vy přejde na 0 po puštění (alt-hold)
} as const;

// ---------------------------------------------------------------------------
// Naviják, lano, hák (oddíl 7) — vlastní Verletův řešič.
// ---------------------------------------------------------------------------
export const ROPE = {
  points: 24,                   // N bodů lana
  minLength: 3,                 // [m]
  maxLength: 40,                // [m]
  winchSpeed: 2.0,              // rychlost navijáku [m/s]
  massPerMeter: 2.0,            // ocelové lano [kg/m]
  iterations: 6,                // relaxační iterace na krok (4–8)
  damping: 0.985,               // tlumení lana
  airDrag: 0.6,                 // odpor vzduchu lana [kg/m^2-ish]
  downwashGain: 1.4,            // vliv rotorového proudění (oddíl 7.2)
  breakTensionFactor: 2.0,      // přetržení při ~2× nosnosti háku (16 000 kgf) rázem
  pickupRadius: 1.5,            // tolerantní chycení do 1,5 m od paty kmene
  pickupBelowHeli: 2.0,         // hák musí být pod vrtulníkem
  hookRadius: 0.35,             // vizuální koule háku [m]
  sagInit: 0.02,                // počáteční průvěs při startu
} as const;

// ---------------------------------------------------------------------------
// Kmeny a mise (oddíly 4.3, 8).
// ---------------------------------------------------------------------------
export const MISSION = {
  logsMin: 8,
  logsMax: 12,
  logLength: [6, 11],           // délka kmene [m]
  logDiameter: [0.45, 0.8],
  logMass: [1000, 3000],        // hmotnost kmene [kg]
  reportMoneyBase: 150,         // základ odměny za směnu [Kč]
  reportMoneyPerLog: 60,
  reportBonusPerCross: 120,     // 1–3 křížky → bonus (oddíl 8.4)
  saveKey: 'rotor-logger-save-v1',
} as const;

// ---------------------------------------------------------------------------
// Kamera, čas, počasí, zvuk, HUD.
// ---------------------------------------------------------------------------
export const CAMERA = {
  // POZNÁMKA (viz DECISIONS.md): zadání uvádí 6 m za strojem, ale SH-6 má trup
  // 21,5 m a rotor 21,9 m — 6 m by byla kamera uvnitř ocasu. Základ 17 m / 5 m,
  // zoom kolečkem (při volném rozhledu) nebo +/- v rozmezí zoomMin–zoomMax.
  chaseDist: 17,
  chaseHeight: 5,
  lookAhead: 6,
  smoothingTau: 0.3,            // vyhlazení polohy i orientace, τ = 0,3 s (6.5a)
  rollFactor: 0.25,             // kamera přebírá jen 20–30 % roll stroje (6.5c)
  zoomMin: 8,
  zoomMax: 30,
  zoomDefault: 17,
  fovDefault: 62,
  fovMin: 40,
  fovMax: 90,
  microShakeMaxDeg: 0.2,        // jediné povolené chvění — kamerové, < 0,2°; jen ve větru (17.3)
  realignSpeed: 10,             // m/s — při vyšší rychlosti se kamera sama srovná za stroj (17.1)
  views: ['chase', 'cockpit', 'high', 'side'],
  hookCamModes: ['pip', 'full', 'off'] as const, // H cykluje; PiP v pravém horním rohu (17.2)
  hookCamPipFrac: 0.26,         // šířka obrazu v obrazu jako zlomek šířky okna
};
export type HookCamMode = (typeof CAMERA.hookCamModes)[number];

export const TIME = {
  dayLengthMin: 24,             // délka dne ve hře (reálných minut)
  startHour: 18.4,              // „klidný večerní“ start ~18:25
  sunElevationDeg: 8,           // elevace slunce na začátku
};

export const WEATHER = {
  windBase: { x: 1.2, z: 0.6 }, // základní vítr [m/s]
  gustAmp: 1.6,                 // amplituda poryvů
  gustFreq: 0.05,               // frekvence poryvů [Hz-ish]
  // úrovně větru volitelné v nastavení (násobek základního)
  windLevels: [0, 1, 2.2] as readonly number[], // Bez větru / Mírný / Silný
  // bouřka: silné poryvy, liják, blesky, temnější mlha (nastavení „Bouřka“)
  storm: {
    gustMultiplier: 3.2,
    turbulenceMultiplier: 2.5,
    rainCount: 1800,
    rainSpeed: 22,              // rychlost kapek [m/s]
    lightningChancePerS: 0.25,  // pravděpodobnost blesku za sekundu
    lightningBoost: 3.0,        // násobek světla při blesku
    fogDarken: 0.55,
  },
} as const;

// Čas dne volitelný v nastavení („Den/Noc“ apod.); auto = cyklus přes TIME.dayLengthMin
export const TIME_OF_DAY = {
  presets: ['auto', 'day', 'dusk', 'night'] as const,
  hours: { day: 12.0, dusk: 18.5, night: 0.5 } as const,
} as const;
export type TimeOfDayPreset = (typeof TIME_OF_DAY.presets)[number];

// Letové režimy (požadavek zadavatele): POUZE dva — manual (plný realismus)
// a stabilized („přibitější“, tlumení). Autopilot/hover odstraněny.
export const FLIGHT_MODES = ['manual', 'stabilized'] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

export const GAMEPLAY = {
  modeDefault: 'stabilized' as FlightMode,
  // POZNÁMKA: žádný auto-level — po puštění myši drží vrtulník ustálený náklon (6.7c).
  stabilized: { kPMultiplier: 1.4, kDMultiplier: 2.4, horizDamp: 1.2, vertDamp: 0.5, vibScale: 0.35 },
  // ovládání lana navíc přes Shift + kolečko myši (kromě R/V)
  wheelWinchWithShift: true,
} as const;

// Grafické předvolby + počet generovaných stromů (samostatné nastavení grafiky)
export const GRAPHICS = {
  qualities: ['low', 'medium', 'high'] as const,
  qualityDefault: 'high' as const,
  presets: {
    low: { pixelRatio: 1, shadows: false, shadowMapSize: 1024, fogFarMul: 0.55 },
    medium: { pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, fogFarMul: 0.8 },
    high: { pixelRatio: 2, shadows: true, shadowMapSize: 2048, fogFarMul: 1.0 },
  },
  treeCountMin: 2000,
  treeCountMax: 12000,
  treeCountDefault: 9000,
} as const;
export type GraphicsQuality = (typeof GRAPHICS.qualities)[number];

export const AUDIO = {
  masterVolume: 0.8,
  rotorVolume: 0.5,
  engineVolume: 0.4,
  windVolume: 0.35,
  ropeVolume: 0.25,
};

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  shadowBox: 160,               // velikost stínového boxu kolem vrtulníku [m]
  fogNear: 300,
  fogFar: 2800,                 // větší mapa 4×4 km
  skyRadius: 8000,
  heliMaxTris: 5000,            // rozpočet trojúhelníků modelu vrtulníku
};

export const SETTINGS_DEFAULTS = {
  // POZNÁMKA (oddíl 5.4/17.3): režimy Assist/Real byly odstraněny — řídicí vrstva
  // je jedna a stálá (filtrovaná myš, držení výšky, změkčený governor), vždy zapnutá.
  invertY: CONTROLS.invertYDefault,
  expo: CONTROLS.expoDefault,
  sensitivity: CONTROLS.sensitivityDefault,
  stickSmoothing: CONTROLS.stickSmoothingDefault, // τ filtru páky [s]
  fov: CAMERA.fovDefault,
  zoom: CAMERA.zoomDefault,
  hookCam: 'pip' as HookCamMode, // výchozí: obraz v obrazu v pravém horním rohu (17.2)
  graphicsQuality: GRAPHICS.qualityDefault as GraphicsQuality,
  treeCount: GRAPHICS.treeCountDefault,
  muted: false,
  // „témata“ a režimy v panelu nastavení (klávesa O)
  timeOfDay: 'auto' as TimeOfDayPreset,
  windLevel: 1,                 // index do WEATHER.windLevels
  storm: false,
  testMode: false,
  mode: GAMEPLAY.modeDefault,
};
