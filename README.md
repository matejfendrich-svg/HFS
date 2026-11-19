# Rotor Logger

Klidná nezávislá 3D letová hra pro desktopový prohlížeč: pilotuješ těžký dvoumotorový
vrtulník („létající jeřáb“, fiktivní typ **Skyhaul SH-6** podle proporcí těžkého
crane-helikoptéru) a převážíš pokácené kmeny z kopcovitého lesa na odkládací plochu
pomocí podvěšeného navijáku (long-line logging). Žádné časovače ani tresty — hra hodnotí
plynulost, přesnost a bezpečnost přátelskými „pilotními poznámkami“ s odměnou.

Vizuální styl: low-poly, flat-shaded, vše generované kódem (žádné externí assety,
procedurální textury i zvuk). WebGL2 přes three.js, TypeScript, Vite.

Svět: **4×4 km** uhlazený kopcovitý terén (288² buněk, value noise), **9 000 vyšších
smrků** (3 přesazené kužely), **řeka s přítokem a jezero** (vodní hladina přes celou mapu),
těžební oblast, odkládací plocha a heliport. Režimy letu: Stabilizovaný (výchozí, arkádově
zbržděný jako Construction Simulator — reálné rychlosti zůstávají), Hover, Autopilot, Manual.

Kompletní zadání: [GAME_SPEC.md](GAME_SPEC.md) · rozhodnutí při vývoji: [DECISIONS.md](DECISIONS.md)

## Instalace a spuštění

```bash
npm install
npm run dev        # vývojový server na localhost (Vite)
```

### Finální build — jeden soubor

```bash
npm run build      # → dist/index.html (veškerý JS/CSS inline, ~570 kB)
npm run pack       # build + zkopíruje ho jako rotor-logger.html do kořene repozitáře
```

**Hratelný soubor je přímo v repozitáři: [`rotor-logger.html`](rotor-logger.html)**
(jako u FSS — celá hra v jednom HTML). Otevři ho na macOS **dvojklikem ze složky** nebo
přímo z GitHubu — běží přes protokol `file://`, plně offline v Safari i Chrome (WebGL2
je v obou podporován; v Safari případně povol vývojářské nastavení WebGL — viz
DECISIONS.md). Žádné CDN, žádné fetch ze sítě. `dist/` zůstává build artefakt v .gitignore.

### Testy a kontrola typů

```bash
npm test           # vitest: energie/autorotace, start motoru, hover, myš, lano
npm run typecheck  # tsc --noEmit (strict)
```

## Ovládání

Mentální model: **myš je páka cykliky** (vzdálenost od středu obrazovky = proporcionální
náklon), klávesy jsou kolektiv a pedály.

| Vstup | Akce |
| --- | --- |
| myš | cyklika — čím dál od středu, tím větší náklon; poloha páky je **filtrovaná** (dolnopropust τ ~0,1 s + mrtvá zóna 5 % + limit změny), ukazatel páky je kolem středu obrazovky |
| `W` / `S` (nebo kolečko myši) | **příkaz vertikální rychlosti** (plynulý náběh, +5/−8 m/s); po puštění **držení výšky** (indikátor v HUD) — měkký kolektiv, žádné skoky |
| `A` / `D` (alt. `Q` / `E`) | pedály — zatáčení (yaw), jako levá páka na FPV ovladači; myš řídí jen pitch+roll (pravá páka) |
| `R` / `V` (nebo `Shift`+kolečko) | naviják — vysunout / zatáhnout lano (3–40 m, 2 m/s) |
| `mezerník` | zajistit / uvolnit hák u kmene |
| `E` | studený start motoru (startér → zážeh → náběh) / vypnutí |
| `T` | testovací výpadek motoru (autorotace) |
| `C` | trim — aktuální výchylka myši se stane nulou |
| `X` | přepnout kameru (chase / kokpit / shora / z boku) |
| `H` | hook cam: obraz z kamery na vrtulníku dolů na lano je **trvale v pravém horním rohu** (obraz v obrazu); H přepíná na celou obrazovku / vypne, HUD ukazuje vzdálenost hák–cíl |
| `+` / `−` (nebo kolečko při rozhledu) | zoom kamery |
| pravé tlačítko myši (držet) | volný rozhled současně s řízením (páka drží poslední polohu) |
| `O` | **panel nastavení**: čas dne, vítr, bouřka, test režim, režim letu, vyhlazení páky, FOV, zoom + **grafika**: kvalita (nízká/střední/vysoká) a počet generovaných stromů (2 000–12 000) |
| `P` | přepnout mezi **dvěma režimy**: Stabilizovaný / Manual (autopilot odstraněn) |
| `F1` / `F3` / `F5` | nápověda / telemetrie / rychlé uložení |
| `M` | ztlumit zvuk · `Esc` pauza · `Enter` další směna po zprávě |

Trup se **bez větru vůbec nerozklepe**; lehké kamerové chvění (< 0,2°) až ve větru/bouřce. Kamera se při vyšší rychlosti sama srovná do normálního pohledu ze 3. osoby. Světlo je nastaveno světleji (vidět i za soumraku/v noci).

Kliknutím na herní plochu se zamkne kurzor (pointer lock); `Esc` ho uvolní.

## Cíl hry

Směna = 8–12 kmenů. Nastartuj studeně (`E`), doletět do těžební oblasti (oranžový kruh
na západě, cíl ukazuje maják a kompasový proužek nahoře), zavěs nad značku kmene
(`mezerník` při výzvě), přeletět na odkládací plochu (vlaječka na východě) a uvolnit
náklad uvnitř kruhu. Na konci směny dostaneš pilotní poznámky (1–3 křížky) a odměnu;
peníze se ukládají do localStorage.

## Struktura projektu

```
src/
  main.ts                  herní smyčka, fixní krok 120 Hz + interpolace, kamera, den/noc
  config.ts                VŠECHNY laditelné konstanty (hmoty, výkony, křivky, délky)
  world/terrain.ts         výšková mapa 2×2 km, instancované stromy, kolize, plochy
  world/logs.ts            pokácené kmeny se značkou u paty
  helicopter/flightModel.ts  fyzika rotoru a draku (teorie momentu + BEMT, autorotace)
  helicopter/controls.ts     „stíhačkové“ myší řízení, trim, nastavení
  helicopter/heliModel.ts    procedurální low-poly model Skyhaul SH-6
  rope/ropeSim.ts            naviják + Verletovo lano + hák + přetržení
  game/mission.ts            mise, radiogramy, pilotní poznámky, ukládání
  ui/hud.ts                  HUD, radiogramy, překryvy
  audio/sound.ts             procedurální Web Audio (rotor, motor, vítr, lano)
test/                      vitest — fyzika, ovládání, lano
```

## Licence

MIT
