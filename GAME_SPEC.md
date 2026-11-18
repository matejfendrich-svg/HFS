# GAME_SPEC.md — Rotor Logger (kompletní zadání)

> Zkrácený věrný přepis zadání pro vývojáře; plný originál je v historii zadání.
> Veškeré konstanty žijí v `src/config.ts`.

## 1. Vize
Klidná nezávislá 3D letová hra pro desktopový prohlížeč (PC/Mac, klávesnice + myš).
Pilotuješ jeden vrtulník a převážíš pokácené kmeny z kopcovitého zalesněného terénu
na odkládací plochu pomocí podvěšeného navijáku (long-line logging). Žádné časovače ani
tresty; hodnocení formou přátelských „pilotních poznámek“ s odměnou. Nálada: „klidný
večerní letový simulátor“ ve výtvarném jazyce low-poly (vše generováno kódem).

## 2. Technologie
WebGL2 přes three.js (ESM z npm), projekt ve Vite, TypeScript strict. Finální build =
JEDEN `dist/index.html` (plugin `vite-plugin-singlefile`), spustitelný přes `file://`
na macOS offline. Žádné CDN/fetch/externí assety. Lokálně: `npm run dev`, `npm run build`.
Vlastní fyzikální model (žádný externí engine), vlastní Verletův řešič lana.

## 3. Svět
- Terén 2 km × 2 km, procedurální vrstvený value noise, konfigurovatelný seed, barvy
  podle sklonu/výšky.
- > 5 000 stromů (InstancedMesh, 2–3 jehličnany), kolize kmene s trupem i rotorovým diskem.
- Těžební oblast s 8–12 kmeny (kvádr se zakulacenými konci, barevná značka u paty).
- Odkládací plocha: kruh z latí + vlaječka; doručení = uvolnění nákladu uvnitř kruhu ±2 m.
- Startovní heliport s hangárem (vizuálně).
- Kolize: vrtulník × terén, × stromy, lano × terén (nesmí pod zem).

## 4. Fyzika vrtulníku (základní kámen)
Model Sikorsky-S-64-třídy „létající jeřáb“ (fiktivní Skyhaul SH-6, viz §8): prázdná
hmotnost ~9 000 kg, palivo ~2 000 kg, MTOW ~17 400 kg, hák max 8 000 kg, 2× ~3 000 kW,
rotor Ø 21,9 m. Zjednodušená teorie momentu + prvky BEMT, jednotky SI:
- Vztlak `T = C_T·ρ·A·(ΩR)²`, C_T kolektivem 0–0,0095, listy −2° až +12°.
- Odpor draku `½ρv²C_D·A` (+ náklad 1,5 m²), ocasní rotor kryje `Q = P/Ω` vč. reakce
  pedálů při změně výkonu, gravitace vč. spotřeby paliva.
- Povinné jevy: přízemní efekt do ~1,2× do 1,2 D, translační vztlak při 8–12 m/s,
  vírový kruh (> 8 m/s sestup při malé rychlosti), asymetrie vztlaku/retreating blade
  stall ve vysoké rychlosti, setrvačnost (drží rychlost, žádné auto-brzdění), governor
  Ω s propady při přetížení kolektivem.
- Energetická bilance `E = ½mv² + mgh + ½IΩ²`: kolektiv čerpá/šetří Ω, plná autorotace
  (výpadek motoru → rotor nezastaví, řízený sestup ~1500–2000 ft/min, flare přistání),
  HUD ukazuje Ω % a varuje pod 90 %.
- Malé kmitání od turbulence, „visení“ pod rotorem, chvění podle Ω a zátěže.
  Volitelné režimy Assist (gyro hover, měkké přistání) / Real.

## 5. Ovládání — stíhačkové myší řízení
Myš = virtuální páka: vzdálenost od středu obrazovky (procentuálně) = výchylka.
`targetPitch = −dy·maxPitch` (±30°, až ±45°), `targetRoll = dx·maxRoll` (±50°),
proporcionálně, expo 0–0,5 (výchozí 0,2), mrtvá zóna 3–5 %, trim klávesou C.
Cyklika = P·chyba − D·rychlost s limity 60°/s (pitch), 90°/s (roll). Kolektiv W/S
(nebo kolečko), pedály A/D (alt Q/E). Kamera 3. osoba s dofukováním, přepínané pohledy,
volný rozhled při držení pravého tlačítka. Přijetí: 10 % myši = ~10 % náklonu; 100 % =
maximum; puštění = setrvalý let; vše na fixním kroku 1/120 s.

## 6. Naviják, lano, hák
- Horní konec lana vždy přesně na závěsném bodu pod trupem; spodní na háku/kmenu.
- Plná fyzika: řetěz N=24 bodů, Verlet, 4–8 iterací, vlastní tíha (~2 kg/m), odpor
  vzduchu, downwash rotoru, délka navijákem R/V 2 m/s v rozsahu 3–40 m, brzda navijáku,
  kolize s terénem/kmenem, přetržení při rázu > ~2× 8 000 kg (klidné oznámení, kmen lze
  znovu zvednout).
- Chycení: hák do 1,5 m od paty kmene pod vrtulníkem → výzva + mezerník (tolerantní).
- Uvolnění mezerníkem; uvnitř kruhu ±2 m = doručeno, jinak kmen zůstane ležet.
- Zpětná vazba: tah lana na závěsný bod vytváří moment (kyvadlo nákladu), hmotnost
  kmene 1 000–3 000 kg snižuje akceleraci; HUD ukazuje zatížení % a varuje při překročení
  dostupného vztlaku.

## 7. Herní smyčka
Studený start na heliportu (E: startér → zážeh → náběh), let do těžební oblasti,
zachycení v hoveru, přelet na plochu, uvolnění, pilotní poznámky na konci směny
(8–12 kmenů): plynulost, přesnost, bezpečná výška → 1–3 křížky + odměna; peníze se
ukládají (později obchod — jen příprava).

## 8. Vrtulník — předpis (silueta musí být rozpoznatelná na první pohled)
Těžký dvoumotorový „létající jeřáb“ podle vzoru S-64 Skycrane, ale bez reálných značek:
fiktivní název/im.atrikulace, oranžovo-bílé schéma. Hranatá přední gondola (kokpit),
dlouhá otevřená kostra bez krytů, dva odkryté motory nad trupem, šestilistý hlavní rotor
Ø 21,9 m (trup ~21,5 m, výška ~5,7 m), čtyřlistý ocasní rotor na štíhlém rameni, pevný
trojkolový podvozek, závěsný bod pod těžištěm, zadní stanoviště load-masttera (jen
silueta). Low-poly 2 500–5 000 tris, flat shading, tmavá kokpitová skla, při vysokých Ω
rotor jako poloprůhledný disk. Typy vrtulníků jako data v `config.ts` (seznam).

## 9. Zvuk, HUD, den/noc
Procedurální Web Audio: rotor (průchod listů podle Ω), motor (šum + pásmo), vítr podle
rychlosti, skřípání lana při napětí; M = ticho. HUD: panel vpravo dole (NR %, kolektiv %,
výška nad terénem, rychlost, zatížení %), horní proužek s cílem a kompasem, radiogramy
dispečera, vše v zaoblených panelech se SVG ikonami. Světelný cyklus dne/noci, mlha, vítr.

## 10. Plán fází (dodáváno postupně, každá fáze funkční build)
0 kostra+120 Hz · 1 terén/stromy · 2 letový model · 3 myší řízení · 4 naviják MVP ·
5 fyzika lana · 6 mise/skóre · 7 autorotace+palivo+den/noc · 8 zvuk/polish/nastavení.
Po každé fázi commit (+tag) a krátké shrnutí.

## 11. Akceptační kritéria
Vzlet/hover/přelet/přistání „letí jako vrtulník“; proporcionální myš (6.7a–d); kmen
zachytit/převézt/odložit s vlivem na let; lano vždy správně uchyceno a mimo terén;
autorotace umožní kontrolované přistání; 60 fps; všechny konstanty v `config.ts`;
README; silueta podle předpisu; git + GitHub včetně releasu se spustitelným
`dist/index.html`.

## 12. Pozdější rozšíření (nyní jen rozhraní)
Svazky kmenů, delší lano, poryvy větru, rotorové proudění na vegetaci, BINGO palivo,
kariéra/obchod/druhý typ, flightbook, gamepad, záznam letu, auto-ukládání (localStorage).

## 13. Ladicí nástroje
F1 nápověda, F3 telemetrie, F5 rychlé uložení; numerický test stability energie před
laděním pocitu (viz `test/`).
