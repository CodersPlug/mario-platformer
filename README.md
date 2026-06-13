# Mario Platformer MVP

2D side-scrolling platformer built in Unity 6 LTS.

---

## Project Setup

See `SETUP.md` for first-time Unity Hub and Physics 2D configuration.

---

## Scene Wiring Guide

Follow these steps in order inside the Unity Editor after creating the scene (`Level1`).

---

### Step 1 — Tilemap Level

1. **GameObject > 2D Object > Tilemap > Rectangular** — rename to `Ground`
2. On the Grid > Ground object:
   - Add **TilemapCollider2D**
   - Add **Composite Collider 2D** (this auto-adds a Rigidbody2D — set it to **Static**)
   - On TilemapCollider2D, enable **Used By Composite**
3. Set the Ground object's **Layer** to `Ground`
4. Open **Tile Palette** (Window > 2D > Tile Palette), create a palette, import any 2D tile sprites
5. Paint a ground row, some floating platforms, and leave at least one gap (pit) for fall deaths

---

### Step 2 — Player GameObject

1. **GameObject > 2D Object > Sprite** — rename to `Player`
2. Assign a placeholder sprite (e.g. the default Unity square)
3. Add components:
   - **Rigidbody2D**: Collision Detection = Continuous, Freeze Rotation Z = ✓
   - **CapsuleCollider2D**: adjust to fit sprite
   - **PlayerMovement**
   - **PlayerHealth**
4. Set Player's **Layer** to `Player`
5. Add **Tag**: `Player`
6. Create an empty child GameObject named `GroundCheck`:
   - Position it at the bottom of the player capsule (e.g. Y = -0.55)
   - Drag it into **PlayerMovement > Ground Check** field in the Inspector
7. Set **PlayerMovement > Ground Layer** to `Ground`
8. Create an empty GameObject named `SpawnPoint`, position it above the start of the level
9. Drag SpawnPoint into **PlayerHealth > Spawn Point** in the Inspector

---

### Step 3 — Camera Follow

1. Select **Main Camera**
2. Add **CameraFollow** script
3. Drag `Player` into the **Target** field
4. Set **Offset** to `(0, 2, -10)` — keeps camera slightly ahead vertically

---

### Step 4 — Enemy Prefab

1. **GameObject > 2D Object > Sprite** — rename to `Enemy`
2. Assign a placeholder sprite (different color from player)
3. Add components:
   - **Rigidbody2D**: Body Type = Kinematic
   - **BoxCollider2D**
   - **EnemyPatrol**
4. Set Layer to `Enemy`
5. Set **EnemyPatrol > Ground Layer** to `Ground`
6. Drag into **Prefabs/** folder to make a prefab
7. Place 1-2 enemies on platforms in the scene

---

### Step 5 — Coin Prefab

1. **GameObject > 2D Object > Sprite** — rename to `Coin`
2. Assign a yellow circle sprite (or any placeholder)
3. Add:
   - **CircleCollider2D**: Is Trigger = ✓
   - **Coin** script
4. Drag into **Prefabs/** to make a prefab
5. Scatter 5–10 coins across the level

---

### Step 6 — Death Zone

1. **GameObject > Create Empty** — rename to `DeathZone`
2. Add **BoxCollider2D**: Is Trigger = ✓
3. Scale it wide (e.g. X = 100, Y = 1) and place it **below** the level (e.g. Y = -10)
4. Add **DeathZone** script

---

### Step 7 — Managers

1. **GameObject > Create Empty** — rename to `GameManager`
2. Add **GameManager** script

3. **GameObject > UI > Canvas** — rename to `UICanvas`
   - Canvas: Screen Space - Overlay
4. Inside canvas add two **UI > Text - TextMeshPro** objects:
   - `CoinsLabel` — top-left corner, default text `Coins: 0`
   - `LivesLabel` — below coins, default text `Lives: 3`
5. **GameObject > Create Empty** — rename to `UIManager`
6. Add **UIManager** script
7. Drag `CoinsLabel` and `LivesLabel` into the Inspector fields

---

### Step 8 — TextMeshPro Package

If TMPro is missing (import error):
- Window > Package Manager > Unity Registry → search `TextMeshPro` → Install

---

## Script Map

| Script | GameObject | Purpose |
|--------|-----------|---------|
| `PlayerMovement` | Player | Move, jump, ground detection |
| `PlayerHealth` | Player | Lives, damage, respawn |
| `CameraFollow` | Main Camera | Smooth follow |
| `EnemyPatrol` | Enemy prefab | Walk, edge turn, stomp/hit |
| `Coin` | Coin prefab | Collect trigger |
| `GameManager` | GameManager | Score + lives state |
| `UIManager` | UIManager | Update HUD labels |
| `DeathZone` | DeathZone | Kill player on fall |

---

## First Playable Checklist

- [ ] Player moves left/right with arrow keys or WASD
- [ ] Player jumps with Space, cannot double-jump
- [ ] Player lands on tilemap platforms without sinking
- [ ] Camera follows player smoothly
- [ ] Enemy walks and turns at edges
- [ ] Stomping enemy destroys it and bounces player
- [ ] Side-touching enemy removes one life (player blinks)
- [ ] Falling into pit removes one life, player respawns at SpawnPoint
- [ ] Coins disappear on touch and increment coin counter on screen
- [ ] At 0 lives, scene reloads

---

## What Remains (Post-MVP)

- Animated sprites (Animator Controller)
- Sound effects (AudioSource on Player, Coin, Enemy)
- Multiple levels with scene transitions
- Moving platforms
- Power-ups (mushroom → grow/shrink)
