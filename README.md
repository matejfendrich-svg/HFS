# Rotor Logger

Klidná nezávislá 3D letová hra pro desktopový prohlížeč: pilotuješ těžký dvoumotorový
vrtulník („létající jeřáb“, fiktivní typ **Skyhaul SH-6** podle proporcí těžkého
crane-helikoptéru) a převážíš pokácené kmeny z kopcovitého lesa na odkládací plochu
pomocí podvěšeného navijáku (long-line logging). Žádné časovače ani tresty — hra hodnotí
plynulost, přesnost a bezpečnost přátelskými „pilotními poznámkami“ s odměnou.

Vizuální styl: low-poly, flat-shaded, vše generované kódem (žádné externí assety,
procedurální textury i zvuk). WebGL2 přes three.js, TypeScript, Vite.

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
| myš | cyklika — čím dál od středu, tím větší náklon (myš nahoru = příď dolů, lze invertovat) |
| `W` / `S` (nebo kolečko myši) | kolektiv — více / méně vztlaku |
| `A` / `D` (alt. `Q` / `E`) | pedály (zatáčení) |
| `R` / `V` (nebo `Shift`+kolečko) | naviják — vysunout / zatáhnout lano (3–40 m, 2 m/s) |
| `mezerník` | zajistit / uvolnit hák u kmene |
| `E` | studený start motoru (startér → zážeh → náběh) / vypnutí |
| `T` | testovací výpadek motoru (autorotace) |
| `C` | trim — aktuální výchylka myši se stane nulou |
| `X` | přepnout kameru (chase / kokpit / shora / z boku) |
| pravé tlačítko myši (držet) | volný rozhled |
| `O` | **panel nastavení**: čas dne (auto/den/soumrak/noc), vítr (bez/mírný/silný), **bouřka** (poryvy + liják + blesky), test režim, režim letu |
| `P` | cyklovat režim letu: **Stabilizovaný** (DJI-like: tlumení, auto-level, méně kmitání) → **Hover** (držení pozice a výšky) → **Autopilot** (let na cíl mise) → **Manual** (plný realismus) |
| `G` | režim Assist (měkké přistání) / Real |
| `F1` / `F3` / `F5` | nápověda / telemetrie / rychlé uložení |
| `M` | ztlumit zvuk · `Esc` pauza · `Enter` další směna po zprávě |

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
