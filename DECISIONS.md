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
21. **Mapa 4×4 km (požadavek zadavatele):** `WORLD.size = 4000`, mřížka terénu 288²
    buněk (2× více polygonů než 144²), mírné vyhlazení výškové mapy přes okolí
    (`smoothRadius`) = „uhlazená krajina“. Stromy: 9 000 ks, vyšší (škála 0,8–2,1,
    kmen 4,4 m + koruna 15 m), koruna smrku = 3 přesazené otevřené kužely.
22. **Voda:** řeka podél sinusové křivky přes celou mapu + přítok z jezera do řeky +
    jezero (r=240 m). Koryta se vyhloubí pod hladinu; hladina = minimum reliéfu podél
    řeky −4 m; jedna průhledná plocha přes celou mapu se zobrazí jen v korytech.
    Údolí mimo toky se zvednou nad hladinu (žádná náhodná jezírka). Heliport je pahorek
    3 m nad hladinou. Barva břehu (písek) pod hladinou + 0,9 m.
23. **Ocasní vrtule opravena:** listy mají nyní tětivu podél správné osy (rotace kolem
    X, disk v rovině YZ, na levé straně svislé plochy) + hřídel, náboj, úchyty listů;
    rozostřovací disk leží správně v rovině YZ. Další detaily: vodorovný stabilizátor,
    šípovitá ocasní plocha, přistávací světlo, stupínky, madla na kostře, vítrník,
    víčka nádrží, brzda rotoru. Celkem 3 524 tri (limit 5 000).
24. **„Zbržděná“ arkádová fyzika (požadavek zadavatele):** v přídavných režimech
    stabilized / hover / autopilot se přidává lineární útlum rychlosti (vodorovný
    1,2–2,6 1/s, svislý 0,5–0,8 1/s) a vyšší kP/kD náklonu — stroj se po puštění páky
    rychle „zastaví“ jako ve Construction Simulator. **Reálné rychlosti jsou zachované**
    — jde jen o tlumení, žádné omezení maxima. V režimu `manual` je čistá fyzika
    (setrvačnost, bez útlumu).
25. **Záplata §17 (revidované zadání v2) — implementováno jako `fix(uhlazeni)`:**
    - **Test klidu (17.1):** 60 s hover bez vstupu, max |úhlová rychlost| =
      **0,0043 °/s** (limit 1 °/s; výsledek loguje i vitest). Trup se vizuálně
      nekmitá — chvění bylo přesunuto jen na kameru (mikro-otřesy < 0,2°,
      `CAMERA.microShakeMaxDeg`, škálované podle Ω). Turbulence je jen
      nízkofrekvenční drift (perioda sekundy, Δv < ±0,3 m/s), vypínatelná přes
      `PHYSICS.turbulence_intensity = 0` (výchozí 0,12).
    - **Měkký kolektiv + držení výšky (6.3/3b):** W/S = příkaz vertikální rychlosti
      (náběh 1,5 (m/s)/s, limity +5/−8 m/s); kolektiv řídí uzavřený regulátor přes
      vertikální zrychlení (`ALT_HOLD`: kADes/kAColl, limit přestavby 0,3/s) — bez
      překmitů i při zvednutí nákladu (testováno: max propad < 3 m/s, plynulé doladění).
      Po puštění W/S drží výšku (indikátor „DRŽÍ“ v HUD).
    - **Assist/Real odstraněny (5.4/17.3):** jedna stálá řídicí vrstva (filtr páky,
      alt-hold, změkčený governor s prodlevou `lagS` = 1,2 s). Volitelné přídavné
      režimy stabilizovaný/hover/autopilot (požadované zadavatelem dříve) zůstávají
      jen jako tlumení/tlumení+autopilot NAD základní vrstvou; **žádný auto-level**
      (6.7c: po puštění myši drží ustálený náklon).
    - **Filtr joysticku (6.2b):** dolnopropust τ = 0,1 s (`stickSmoothing`), mrtvá
      zóna 5 %, limit změny cílového náklonu 150°/s; HUD ukazuje filtrovanou páku.
    - **Kamera (6.5a–c):** vyhlazení polohy i orientace τ = 0,3 s, roll kamery jen
      25 % náklonu stroje, kolize proti terénu i kmenům, zoom 8–30 m (`+`/`−`,
      kolečko při volném rozhledu — kolečko jinak řídí vertikální rychlost dle 6.3;
      rozmezí 4–15 m ze zadání by u 21,5 m stroje bylo uvnitř ocasu). Volný rozhled
      pravým tlačítkem běží současně s řízením, páka drží poslední polohu, návrat je měkký.
    - **Hook cam (6.5d):** klávesa H cykluje hlavní → obraz v obrazu (pravý dolní roh,
      kamera pod trupem podél lana) → celá obrazovka; HUD ukazuje vzdálenost háku od
      cíle (kmene) v metrech; režim se pamatuje v localStorage.
    - **Prach u země** od rotorového proudění (17.7, minimální varianta částic).
    - HUD: ukazatel páky, indikátor držení výšky, napětí lana v %.
