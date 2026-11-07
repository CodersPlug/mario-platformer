# Azulín

Sandbox 2D **jugable en el iPad** (GitHub Pages), inspirado en Melon Sandbox: gravedad, física, puppeteering (arrastrar/tirar), spawner con iconos y ragdoll **Azulín**.

**Programa cognitivo Polgár (juegos digitales, físicos e híbridos):**  
[`programa-polgar.md`](programa-polgar.md) · catálogo: [`catalogo-juegos.md`](catalogo-juegos.md) · tablero: [`tablero-semanal.md`](tablero-semanal.md)  
Azulín es **una** ficha digital del catálogo (D1), no el laboratorio principal del programa.  
Google Nest participa como asistente de ritual / idiomas / ritmo (apartado en el programa).

No usa IP de Sonic. No requiere la app Melon.

## Jugar en el iPad

**Azulín:** https://codersplug.github.io/mario-platformer/  
**Cuando sea vieja** (selfie + slider de edad): https://codersplug.github.io/mario-platformer/futura/

Safari → Add to Home Screen si querés. Publicado desde `gh-pages`.

### Local

```bash
cd MelonRunner/play && python3 -m http.server 8080
# otra terminal:
cd MelonRunner/futura && python3 -m http.server 8081
```

Azulín: `http://localhost:8080` · Futura: `http://localhost:8081`

## Qué imita de Melon

| Característica Melon | En Azulín |
|----------------------|----------------|
| Física 2D + gravedad | Matter.js, botón Gravedad on/off |
| Puppeteering / drag | Herramienta **Mano** (dedo / mouse), impulso al soltar |
| Spawner de ítems | Dock: Azulín, caja, pelota, tabla, cono, barril, bloque, globo, resorte, rueda, empuje, piso |
| Living ragdoll | **Azulín** (partes + constraints) |
| Borrar / congelar | Herramientas **Borrar** y **Congelar** |
| Pausa / limpiar mundo | Botones **Pausa** y **Limpiar** |
| Saves | **Guardar** / **Cargar** (`localStorage`) |
| Mini-juego / escena | **Runner**: auto-run, salto (tap/Space), obstáculos, score, reset al caer |
| Táctil iPad | UI 44px+, `100dvh`, sin hover obligatorio |

No clona Workshop, Lua Chip nativo, armas ni gore de Melon (orientado a juego familiar). El script Lua de referencia para la app Melon real sigue en [`lua/runner.lua`](lua/runner.lua).

## Archivos

| Ruta | Rol |
|------|-----|
| [`play/index.html`](play/index.html) | Shell táctil |
| [`play/style.css`](play/style.css) | Layout iPad |
| [`play/game.js`](play/game.js) | Motor sandbox + runner |
| [`lua/runner.lua`](lua/runner.lua) | Misma lógica para Lua Chip (app Melon) |
| [`lua/azulin_notes.md`](lua/azulin_notes.md) | Spec visual Azulín |
| [`programa-polgar.md`](programa-polgar.md) | Curriculum Polgár multi-juego |
| [`catalogo-juegos.md`](catalogo-juegos.md) | Fichas digital / físico / híbrido |
| [`tablero-semanal.md`](tablero-semanal.md) | Log semanal (modalidad + pantalla) |
| [`futura/`](futura/) | App web iPad: selfie → edad → slider |

## Controles

- **Mano**: arrastrá cuerpos (puppeteer).
- **Colocar**: elegí ítem abajo y tocá el mundo.
- **Runner**: tocá la pantalla o Space para saltar; la cámara sigue a Azulín.
- **G** gravedad · **P** pausa (teclado).
