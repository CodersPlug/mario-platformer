# Mario Platformer MVP — Unity Setup Guide

## 1. Create the Unity Project

1. Open Unity Hub
2. New Project → **2D (Built-in Render Pipeline)** template → Unity 6 LTS
3. Set location to this folder: `Documents/Projects/Gamer`
4. Name: `MarioPlatformer`

Unity will generate `Assets/`, `Packages/`, `ProjectSettings/` inside this folder.
All scripts in `Assets/Scripts/` are already created — Unity will compile them automatically.

---

## 2. Physics 2D Settings

Edit > Project Settings > Physics 2D:
- **Gravity Y** = `-25` (tighter jump feel than the default -9.81)

---

## 3. Input Manager

Edit > Project Settings > Player > Other Settings:
- **Active Input Handling** = `Input Manager (Old)` (Legacy)

---

## 4. Layers

Edit > Project Settings > Tags and Layers, add:
- Layer 6: `Ground`
- Layer 7: `Enemy`
- Layer 8: `Coin`

---

## 5. Scene Setup (Level1)

See README.md for per-step scene wiring instructions.
