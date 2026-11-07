# Azulín — spec visual (Editor Melon)

Personaje **original** para el runner. No uses nombre, logos, poses ni sprites de Sonic / Sega.

## Identidad

| Campo | Valor |
|-------|--------|
| Nombre del mod | `Azulin` |
| Silueta | Erizo pequeño, compacto, bipedo |
| Actitud | Alegre, corredor, sin armas |

## Paleta

| Parte | Color aprox. | Hex guía |
|-------|----------------|----------|
| Pelaje cuerpo | Azul medio | `#3A8DFF` |
| Barriga / hocico | Crema claro | `#F5E6C8` |
| Ojos | Blanco + pupila negra grande | `#FFFFFF` / `#1A1A1A` |
| Zapatillas | Rojo coral + suela blanca | `#E85A4F` / `#F7F7F7` |
| Guantes / manos | Blanco suave | `#F0F0F0` |
| Contorno | Azul noche fino | `#1B3A5C` |

## Silueta (evitar look de marca)

- Espinas **cortas y redondeadas** (3–5 bulbos), no abanico largo trademark.
- Sin anillos, sin “S”, sin zapatos con correa blanca exacta de marca.
- Cabeza redonda; orejas/espinas integradas al cráneo, no púas afiladas de tip.
- Proporción kids: cabeza grande (~40% altura), piernas cortas.

## Canvas pixel

1. Abrí Pixel Studio (u otro) → canvas **32×32** o **48×48**.
2. Dibujá de perfil mirando a la **derecha** (dirección del auto-run).
3. Exportá PNG.
4. En Melon → **Editor** → Create New → base living/humanoide o brick + living params.
5. **Select texture** → cargá el PNG.
6. Ajustá **colliders** al torso + pies (que no atraviese el suelo).
7. Nombre del archivo/mod: `Azulin`. Guardá `.melmod`.

## Checklist anti-IP

- [ ] No dice “Sonic”, “Speed”, “Gotta”, etc.
- [ ] No copia pose clásica de punta de pie + brazo atrás de marketing Sega
- [ ] No usa emerald / rings como ítems de marca
- [ ] Nombre visible en Workshop: solo `Azulin` o `MelonRunner Azulin`
