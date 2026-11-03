# Melon Runner — Azulín

Auto-runner 2D para **Melon Sandbox** (Lua Chip): Azulín corre solo hacia la derecha, salta obstáculos y reinicia si cae.

Melon no se edita desde Cursor. Acá están el script y la guía; vos armás el save en el juego.

## Archivos

| Archivo | Uso |
|---------|-----|
| [`lua/runner.lua`](lua/runner.lua) | Pegar en el Lua Chip |
| [`lua/azulin_notes.md`](lua/azulin_notes.md) | Spec del avatar (Editor) |

Sitio Melon: https://melonsandbox.com/

---

## 1. Avatar Azulín (Editor)

1. Abrí Melon → menú **Editor**.
2. **Create New** → elegí una base living/humanoide (o template similar).
3. Seguí [`lua/azulin_notes.md`](lua/azulin_notes.md): textura original azul, sin marca Sonic.
4. Ajustá colliders, guardá el mod como **`Azulin`**.
5. Cargá el mod una vez en el juego antes de usarlo en el mapa.

---

## 2. Mapa del runner

1. Nuevo mapa / save vacío.
2. Construí un **suelo largo** a la derecha (placas, brick, terreno continuo). Dejá al menos un **hoyo** opcional para probar el fail.
3. Spawn **Azulín** al inicio del suelo (pies apoyados).
4. Congelá / anclá el suelo para que no se mueva.

---

## 3. Lua Chip

1. Inventario → **Mechanisms** → **Lua Chip** → spawn cerca del inicio.
2. Abrí el chip → **Open Editor**.
3. Borrá el código de ejemplo.
4. Pegá el contenido completo de [`lua/runner.lua`](lua/runner.lua).
5. Guardá / aplicá el script (autosave del chip si está verde).

### Inputs (aparecen al compilar el script)

| Input | Tipo | Cable / valor |
|-------|------|----------------|
| `player` | entity | Cuerpo de Azulín (rainbow rope → chip) |
| `speed` | num | Opcional; default **7** |
| `jump` | num | Opcional; default **12** |
| `floorY` | num | Opcional; Y bajo la cual falla (default **-8**) |

### Outputs

| Output | Significado |
|--------|-------------|
| `score` | Distancia recorrida (entero) |
| `status` | `run` / `fail` / `wire player` |

### Salto

- **Activar el chip** (toque / activate) → encola un salto (`OnActivated`).
- En PC: **Space**, **W** o **Up** si `input` está disponible en tu build.

---

## 4. Wiring

1. Seleccioná Azulín → conectá el cable de **entity** al input `player` del chip (conectar el ítem al chip).
2. Opcional: fijá `speed` / `jump` / `floorY` en los pines numéricos.
3. Dejá el chip **activado** o tocálo cada vez que quieras saltar (según cómo uses activate en tu device).

---

## 5. Cómo se juega

- Azulín **corre solo** a la derecha.
- Tocá / activá el chip (o Space) para **saltar**.
- Cada ~90 ticks spawnea un obstáculo adelante (`crate_wood` / `plastic_plate`).
- Si cae bajo `floorY` (o muy por debajo del start), **reset** a la posición inicial y limpia obstáculos.
- Score = distancia en X desde el start (consola cada 10 unidades).

Si `spawn.create` falla en tu versión, cambiá los ids en `OBSTACLE_IDS` dentro de `runner.lua` por nombres que existan en `spawn.getItems()` (imprimilos una vez desde un chip de prueba).

---

## 6. Checklist playtest

- [ ] Azulín aparece con textura propia y no se cae a través del suelo
- [ ] Chip compilado sin errores en consola
- [ ] Cable `player` conectado (`status` ≠ `wire player`)
- [ ] Corre solo a la derecha
- [ ] Salto responde a activate / Space
- [ ] Aparecen cajas/placas adelante
- [ ] Obstáculos viejos se borran detrás
- [ ] Caer al vacío reinicia y limpia obstáculos
- [ ] `score` sube al avanzar
- [ ] Save guardado como **`MelonRunner-Azulin`**

---

## 7. Guardar

Melon → guardar save / mapa como **`MelonRunner-Azulin`**.  
Workshop: solo si lo pedís después (no incluido en este entregable).

---

## Notas

- Sin armas ni gore: solo carrera y obstáculos.
- Sin IP Sonic: personaje y textos usan solo **Azulín**.
- API varía por versión de Melon; el script usa `pcall` en cámara, input y delete para no romper el tick si falta un método.
