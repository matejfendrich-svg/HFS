# DECISIONS.md — rozhodnutí při vývoji

Zde jsou zaznamenána všechna nejednoznačná rozhodnutí konzervativně ve prospěch
realismu a spolehlivosti (viz zadání, úvod). Odpovídající konstanty jsou vždy
v `src/config.ts`.

1. **Kamera „chase“ 17 m / 5 m místo 6 m / 2 m ze zadání.** Zadání uvádí cca 6 m za
   strojem, ale model má trup 21,5 m a rotor Ø 21,9 m — kamera v 6 m by byla uvnitř
   ocasního ramene. Zvoleno 17 m / 5 m (`CAMERA.chaseDist/chaseHeight`), stále blízko
   a „za zády“. Další pohledy: kokpit, shora, z boku (klávesa X).
2. **Repository.** Hra běží v existující preselektované repository (HFS) na větvi
   `vibe/…` s draft PR; zadání §16 žádalo novou repo „rotor-logger“, ale session
   scope předepisuje preselektovanou repo a zákaz vytváření nových repozitářů.
   Release artefakt `dist/index.html` lze přiložit k releasu později.
3. **Mrtvá zóna myši bez přepočtu rozsahu.** Aby kritérium 6.7a platilo přesně
   (10 % vzdálenost = ~10 % maxima při expo 0), mrtvá zóna 4 % jen vynuluje střed,
   zbytek rozsahu se neškáluje (`deadZone` v `utils/math.ts`).
4. **Napětí lana v PBD.** V čistém PBD s tíhou jako zrychlením korekce prvního
   segmentu neodpovídají fyzikálnímu tahu (hmotnost pod bodem se "nerozloží" vzhůru).
   Proto se tah počítá z bilance sil pod bodem 0 (statická tíha podělená cosinusem
   úhlu lana) + elastický ráz z dalekodosahového omezení hák↔závěs + setrvačný člen.
   Ověřeno testem: zavěšený kmen 2000 kg → tah 19,68 kN = přesně m·g.
5. **Dalekodosahové omezení lana.** Hák nesmí být od závěsného bodu dál než délka
   lana — bez toho těžký náklad při 6 iteracích "propadne" a lano se natahuje bez
   konce. Toto omezení zároveň dává elastický ráz při škubnutí (přetržení při > 2×
   nosnost háku, testováno).
6. **Autorotace — test s dopřednou rychlostí.** Čistě svislá autorotace má v reálu
   vysokou rychlost sestupu (brzdění dělá hlavně dopředná rychlost + rotor). Test
   autorotace proto používá 25 m/s dopředu + mírné klopení: Ω drží 107–112 %,
   klesání se ustálí ~9–19 m/s, energie soustavy klesá monotónně (žádné vytváření).
7. **Test energie „< 1 %/min“ ze zadání.** V uzavřené soustave vrtulník+rotor předává
   energii i indukovanému proudění vzduchu (T·v_i) — to je fyzikální propad, ne
   numerický drift. Test proto ověřuje, že energie **nikdy neroste** (≤ +0,1 %) a že
   úbytek je řádově fyzikální; numerická stabilita je tím vyloučena.
8. **Tvrdý náraz při crash ztrácí kinetickou energii** (náraz spotřebuje energii —
   bez toho by energie po crashi "zamrzla" ve vysoké rychlosti). Po crashi nouzový
   reset na heliport bez penalizace (duch zadání).
9. **Assist režim** drží hover jen při neutrální páce (nezasahuje do aktivního letu)
   a omezuje rychlost sestupu těsně nad zemí (< 3 m, max 2 m/s) = změkčené přistání.
10. **Studený start** sekvence: startér (8 % Ω) → zážeh → náběh na nominál (~19 s
    celkem, `startSequence` v configu). Vzlet je možný až při plných otáčkách.
11. **Safari/macOS přes file://:** build je jeden inline HTML (`vite-plugin-singlefile`),
    žádné ES moduly přes file://, žádné externí zdroje (ověřeno: v `dist/index.html`
    nejsou žádné http(s) odkazy kromě SVG namespace). Pokud Safari při lokálním testu
    hlásí problém s WebGL, povol jej v Develop → Show Feature Flags / nastavení vývojáře.
12. **Fiktivní označení:** typ „Skyhaul SH-6“, imatrikulace „OK-LGX“ — žádné reálné
    ochranné známky, loga ani texty z referenční fotografie; oranžovo-bílé schéma ponecháno.
13. **Zvuk až po gestu uživatele** (tlačítko na úvodní obrazovce) kvůli autoplay policy
    prohlížečů; vše procedurální přes Web Audio.
14. **Ukládání** (F5, automaticky po směně): localStorage klíče `rotor-logger-save-v1`
    (peníze, směna) a `rotor-logger-settings-v1` (nastavení). Export/import připraven
    později (oddíl 13 zadání).
15. **Výkon:** terén 144² buněk (flat shading), ~6 500 stromů ve 3 druzích × 2
    instancované sady, stíny jen v boxu 160 m kolem vrtulníku (2048 px). Cíl 60 fps
    na průměrném notebooku; fyzika běží na fixním kroku 120 Hz nezávisle na fps.
16. **Letové režimy (požadavek zadavatele):** výchozí režim je `stabilized`
    (DJI Mavic-like: vyšší tlumení náklonu, auto-level při neutrální páce, útlum
    vodorovné rychlosti, méně vizuálního chvění) — `manual` zůstává plně realistický
    (setrvačnost, bez útlumu). `hover` drží pozici a výšku, `autopilot` letí sám na cíl
    mise (kmen / odkládací plocha) jednoduchým P-regulátorem a u cíle přejde do hoveru.
    Režim se cykluje klávesou P nebo volí v panelu nastavení (O).
17. **Nastavení „témat“ (O):** čas dne (auto cyklus / den / soumrak / noc — přepíše
    herní hodiny), vítr (3 úrovně násobící základní vítr), bouřka (3,2× poryvy, liják
    jako částice kolem kamery, náhodné blesky se zábleskem světla, tmavší mlha, 2,5×
    turbulence), test režim (zapne telemetrii F3). Vše se ukládá do localStorage.
18. **Ovládání lana:** kromě R/V také `Shift` + kolečko myši (impulzní), délka lana
    je trvale v HUD; hák ovládáš mezerníkem (chycení do 1,5 m pod vrtulníkem).
19. **Detailnější model:** příhradovina kostry z 8 na 14 polí se střídavými
    diagonálami, detaily motorů (sání, tryska, potrubí), rotorová hlava (talíř +
    táhla), panely dveří, pitot, anténa, zrcátka, pouzdro navijáku, poziční světla
    (červená/zelená/bílá + blikající maják, viditelnější v noci). Počet trojúhelníků
    se loguje do konzole a respektuje limit 5 000 (`RENDER.heliMaxTris`).
20. **Hratelný single-file build je commitnutý v kořeni repozitáře jako
    `rotor-logger.html`** (stejně jako u FSS — celá hra v jednom HTML přímo v repo).
    `npm run pack` ho po buildu aktualizuje; `dist/` zůstává v .gitignore.
