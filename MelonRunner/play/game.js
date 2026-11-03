/* Melon Libre — web sandbox inspired by Melon Sandbox physics + puppeteering.
   Original character Azulín (no Sonic IP). Touch-first for iPad / GitHub Pages. */
(function () {
  "use strict";

  if (typeof Matter === "undefined") {
    document.body.innerHTML = "<p style='padding:2rem;color:#fff'>No se pudo cargar Matter.js.</p>";
    return;
  }

  const {
    Engine,
    Render,
    Runner,
    Bodies,
    Body,
    Composite,
    Constraint,
    Mouse,
    MouseConstraint,
    Events,
    Query,
    Vector,
  } = Matter;

  const canvas = document.getElementById("world");
  const scorePill = document.getElementById("scorePill");
  const modePill = document.getElementById("modePill");

  const state = {
    tool: "hand",
    spawnKind: "azulin",
    gravityOn: true,
    paused: false,
    mode: "sandbox", // sandbox | runner
    score: 0,
    runnerHero: null,
    runnerAlive: false,
    spawnAt: null,
    cameraX: 0,
    cameraY: 0,
    floorY: 420,
  };

  const SAVE_KEY = "melon-libre-azulin-v1";
  const WORLD_W = 4000;
  let mouseConstraint = null;
  let mouse = null;

  function floorY() {
    return state.floorY;
  }

  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1;

  const render = Render.create({
    canvas,
    engine,
    options: {
      width: 1,
      height: 1,
      wireframes: false,
      background: "transparent",
      showSleeping: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    },
  });

  const runner = Runner.create();
  Runner.run(runner, engine);
  Render.run(render);

  function syncMouseToCamera() {
    if (!mouse || !render.options.width || !render.options.height) return;
    Mouse.setOffset(mouse, {
      x: render.bounds.min.x,
      y: render.bounds.min.y,
    });
    Mouse.setScale(mouse, {
      x: (render.bounds.max.x - render.bounds.min.x) / render.options.width,
      y: (render.bounds.max.y - render.bounds.min.y) / render.options.height,
    });
  }

  /** Keep the physics floor in the lower part of the canvas (fixes iPad short viewports). */
  function layoutCamera() {
    const w = render.options.width;
    const h = render.options.height;
    if (w < 2 || h < 2) return;
    const floorScreenY = Math.min(h - 48, Math.max(h * 0.78, h - 90));
    const camTop = floorY() - floorScreenY;
    state.cameraY = camTop;
    Render.lookAt(render, {
      min: { x: state.cameraX, y: camTop },
      max: { x: state.cameraX + w, y: camTop + h },
    });
    syncMouseToCamera();
  }

  function resize() {
    const wrap = canvas.parentElement;
    const w = Math.max(320, wrap.clientWidth);
    const h = Math.max(220, wrap.clientHeight);
    render.options.width = w;
    render.options.height = h;
    render.options.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * render.options.pixelRatio;
    canvas.height = h * render.options.pixelRatio;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    Render.setPixelRatio(render, render.options.pixelRatio);

    const prevFloor = state.floorY;
    // Anchor floor near the bottom of the playfield height.
    state.floorY = Math.max(200, h - 56);
    const dy = state.floorY - prevFloor;
    if (Math.abs(dy) > 0.5) {
      shiftWorldForFloor(dy);
    }
    layoutCamera();
  }

  function shiftWorldForFloor(dy) {
    const bodies = Composite.allBodies(engine.world);
    for (const b of bodies) {
      if (!b.plugin || !b.plugin.melon) continue;
      const kind = b.plugin.melon.kind;
      if (kind === "world" || kind === "platform" || kind === "obstacle") {
        Body.setPosition(b, { x: b.position.x, y: b.position.y + dy });
        continue;
      }
      // Keep resting props / livings on the ground when the floor moves.
      if (b.position.y > prevFloorNear(dy) - 120) {
        Body.setPosition(b, { x: b.position.x, y: b.position.y + dy });
        Body.setVelocity(b, { x: b.velocity.x, y: 0 });
      }
    }
  }

  function prevFloorNear(dy) {
    return state.floorY - dy;
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    setTimeout(resize, 200);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize);
  }

  function tag(body, meta) {
    body.plugin = body.plugin || {};
    body.plugin.melon = Object.assign({ kind: "prop", deletable: true, freezeable: true }, meta);
    return body;
  }

  function isStaticFloor(body) {
    return body && body.plugin && body.plugin.melon && body.plugin.melon.kind === "world";
  }

  function clearDynamic() {
    state.runnerHero = null;
    state.runnerAlive = false;
    state.score = 0;
    updateHud();
  }

  function buildWorldFloor() {
    Composite.clear(engine.world, false);
    // Composite.clear removes the mouse constraint — put it back.
    if (mouseConstraint) Composite.add(engine.world, mouseConstraint);

    const thickness = 80;
    const fy = floorY();
    const floor = Bodies.rectangle(WORLD_W / 2, fy + thickness / 2, WORLD_W, thickness, {
      isStatic: true,
      friction: 0.9,
      render: { fillStyle: "#5f8f45", strokeStyle: "#3f6a2c", lineWidth: 2 },
    });
    tag(floor, { kind: "world", deletable: false, freezeable: false });

    const left = Bodies.rectangle(-40, fy - 200, 80, 800, {
      isStatic: true,
      render: { visible: false },
    });
    tag(left, { kind: "world", deletable: false });

    Composite.add(engine.world, [floor, left]);

    // Starter platforms / Melon-like playground props
    for (let i = 0; i < 8; i++) {
      const x = 220 + i * 180;
      const box = Bodies.rectangle(x, fy - 30 - (i % 3) * 10, 44, 44, {
        restitution: 0.1,
        friction: 0.7,
        density: 0.002,
        render: { fillStyle: "#c48a4a", strokeStyle: "#7a5228", lineWidth: 2 },
      });
      tag(box, { kind: "crate", name: "caja" });
      Composite.add(engine.world, box);
    }
  }

  function styleLivingPart(color) {
    return { fillStyle: color, strokeStyle: "#1b3a5c", lineWidth: 2 };
  }

  function spawnAzulin(x, y, opts) {
    opts = opts || {};
    const scale = opts.scale || 1;
    const group = Body.nextGroup(true);
    const head = Bodies.circle(x, y - 28 * scale, 16 * scale, {
      collisionFilter: { group },
      restitution: 0.05,
      friction: 0.8,
      density: 0.0012,
      render: styleLivingPart("#3a8dff"),
    });
    const torso = Bodies.rectangle(x, y, 22 * scale, 28 * scale, {
      collisionFilter: { group },
      chamfer: { radius: 6 },
      density: 0.0015,
      render: styleLivingPart("#3a8dff"),
    });
    const belly = Bodies.circle(x, y + 4 * scale, 8 * scale, {
      collisionFilter: { group },
      isSensor: true,
      render: styleLivingPart("#f5e6c8"),
    });
    const legL = Bodies.rectangle(x - 8 * scale, y + 28 * scale, 10 * scale, 20 * scale, {
      collisionFilter: { group },
      density: 0.001,
      render: styleLivingPart("#e85a4f"),
    });
    const legR = Bodies.rectangle(x + 8 * scale, y + 28 * scale, 10 * scale, 20 * scale, {
      collisionFilter: { group },
      density: 0.001,
      render: styleLivingPart("#e85a4f"),
    });
    const armL = Bodies.rectangle(x - 20 * scale, y - 2 * scale, 16 * scale, 8 * scale, {
      collisionFilter: { group },
      density: 0.0008,
      render: styleLivingPart("#f0f0f0"),
    });
    const armR = Bodies.rectangle(x + 20 * scale, y - 2 * scale, 16 * scale, 8 * scale, {
      collisionFilter: { group },
      density: 0.0008,
      render: styleLivingPart("#f0f0f0"),
    });

    const parts = [torso, head, belly, legL, legR, armL, armR];
    for (const p of parts) {
      tag(p, { kind: "azulin", name: "Azulin", ragdoll: true, hero: !!opts.hero });
    }

    const constraints = [
      Constraint.create({ bodyA: head, bodyB: torso, pointA: { x: 0, y: 14 * scale }, pointB: { x: 0, y: -12 * scale }, stiffness: 0.7, damping: 0.1, length: 2, render: { visible: false } }),
      Constraint.create({ bodyA: belly, bodyB: torso, stiffness: 1, length: 0, render: { visible: false } }),
      Constraint.create({ bodyA: legL, bodyB: torso, pointA: { x: 0, y: -8 * scale }, pointB: { x: -6 * scale, y: 12 * scale }, stiffness: 0.55, damping: 0.08, length: 2, render: { visible: false } }),
      Constraint.create({ bodyA: legR, bodyB: torso, pointA: { x: 0, y: -8 * scale }, pointB: { x: 6 * scale, y: 12 * scale }, stiffness: 0.55, damping: 0.08, length: 2, render: { visible: false } }),
      Constraint.create({ bodyA: armL, bodyB: torso, pointA: { x: 6 * scale, y: 0 }, pointB: { x: -10 * scale, y: -4 * scale }, stiffness: 0.4, length: 2, render: { visible: false } }),
      Constraint.create({ bodyA: armR, bodyB: torso, pointA: { x: -6 * scale, y: 0 }, pointB: { x: 10 * scale, y: -4 * scale }, stiffness: 0.4, length: 2, render: { visible: false } }),
    ];

    Composite.add(engine.world, parts.concat(constraints));
    Body.setAngularVelocity(torso, 0);
    if (opts.hero) {
      state.runnerHero = torso;
      state.runnerAlive = true;
    }
    return torso;
  }

  function spawnProp(kind, x, y) {
    let body;
    switch (kind) {
      case "azulin":
        return spawnAzulin(x, y);
      case "crate":
        body = Bodies.rectangle(x, y, 48, 48, {
          restitution: 0.05,
          friction: 0.8,
          density: 0.002,
          render: { fillStyle: "#c48a4a", strokeStyle: "#7a5228", lineWidth: 2 },
        });
        tag(body, { kind: "crate" });
        break;
      case "ball":
        body = Bodies.circle(x, y, 22, {
          restitution: 0.85,
          friction: 0.05,
          density: 0.001,
          render: { fillStyle: "#ff6b6b", strokeStyle: "#9b3030", lineWidth: 2 },
        });
        tag(body, { kind: "ball" });
        break;
      case "plank":
        body = Bodies.rectangle(x, y, 120, 16, {
          friction: 0.7,
          density: 0.0015,
          render: { fillStyle: "#d7b07a", strokeStyle: "#8a6a3d", lineWidth: 2 },
        });
        tag(body, { kind: "plank" });
        break;
      case "cone":
        body = Bodies.polygon(x, y, 3, 28, {
          friction: 0.6,
          density: 0.0012,
          render: { fillStyle: "#ff9f43", strokeStyle: "#a85b10", lineWidth: 2 },
        });
        tag(body, { kind: "cone" });
        break;
      case "barrel":
        body = Bodies.rectangle(x, y, 36, 52, {
          chamfer: { radius: 8 },
          friction: 0.5,
          density: 0.0022,
          render: { fillStyle: "#6c8cff", strokeStyle: "#2f458f", lineWidth: 2 },
        });
        tag(body, { kind: "barrel" });
        break;
      case "block":
        body = Bodies.rectangle(x, y, 56, 56, {
          friction: 0.9,
          density: 0.003,
          render: { fillStyle: "#8899aa", strokeStyle: "#445566", lineWidth: 2 },
        });
        tag(body, { kind: "block" });
        break;
      case "balloon":
        body = Bodies.circle(x, y, 20, {
          restitution: 0.2,
          frictionAir: 0.02,
          density: 0.0002,
          render: { fillStyle: "#ff7eb6", strokeStyle: "#b03b74", lineWidth: 2 },
        });
        tag(body, { kind: "balloon", buoyancy: true });
        break;
      case "spring": {
        const a = Bodies.rectangle(x, y - 20, 18, 18, {
          density: 0.001,
          render: { fillStyle: "#3ecf8e", strokeStyle: "#1c7a52", lineWidth: 2 },
        });
        const b = Bodies.rectangle(x, y + 20, 18, 18, {
          density: 0.001,
          render: { fillStyle: "#3ecf8e", strokeStyle: "#1c7a52", lineWidth: 2 },
        });
        tag(a, { kind: "spring" });
        tag(b, { kind: "spring" });
        const spring = Constraint.create({
          bodyA: a,
          bodyB: b,
          stiffness: 0.08,
          damping: 0.02,
          length: 50,
          render: { strokeStyle: "#9dffa8", lineWidth: 2, type: "spring" },
        });
        Composite.add(engine.world, [a, b, spring]);
        return a;
      }
      case "wheel":
        body = Bodies.circle(x, y, 26, {
          restitution: 0.3,
          friction: 0.9,
          density: 0.0014,
          render: { fillStyle: "#333", strokeStyle: "#aaa", lineWidth: 3 },
        });
        tag(body, { kind: "wheel" });
        break;
      case "bomb": {
        // Impulse puff — Melon-like push without gore
        const puff = Bodies.circle(x, y, 10, {
          isSensor: true,
          render: { fillStyle: "#ffe566", strokeStyle: "#c9a400", lineWidth: 2 },
        });
        tag(puff, { kind: "bomb", deletable: true });
        Composite.add(engine.world, puff);
        setTimeout(function () {
          const hits = Query.region(Composite.allBodies(engine.world), {
            min: { x: x - 90, y: y - 90 },
            max: { x: x + 90, y: y + 90 },
          });
          for (const h of hits) {
            if (h.isStatic) continue;
            const force = Vector.mult(Vector.normalise(Vector.sub(h.position, { x, y })), 0.08 * h.mass);
            Body.applyForce(h, h.position, force);
          }
          Composite.remove(engine.world, puff);
        }, 80);
        return puff;
      }
      case "platform":
        body = Bodies.rectangle(x, y, 160, 22, {
          isStatic: true,
          friction: 0.95,
          render: { fillStyle: "#6e9b5a", strokeStyle: "#3f6a2c", lineWidth: 2 },
        });
        tag(body, { kind: "platform", freezeable: false });
        break;
      default:
        return null;
    }
    Composite.add(engine.world, body);
    return body;
  }

  // Mouse / touch puppeteering
  mouse = Mouse.create(canvas);
  mouse.pixelRatio = render.options.pixelRatio;
  mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: {
      stiffness: 0.2,
      damping: 0.1,
      render: { visible: false },
    },
  });
  Composite.add(engine.world, mouseConstraint);
  render.mouse = mouse;

  Events.on(mouseConstraint, "startdrag", function () {
    if (state.tool !== "hand") {
      mouseConstraint.constraint.bodyB = null;
      mouseConstraint.body = null;
    }
  });

  function canvasToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x =
      ((clientX - rect.left) / rect.width) * render.options.width + state.cameraX;
    const y =
      ((clientY - rect.top) / rect.height) * render.options.height + state.cameraY;
    return { x, y };
  }

  function bodyAt(pos) {
    const hits = Query.point(Composite.allBodies(engine.world), pos);
    for (let i = hits.length - 1; i >= 0; i--) {
      const b = hits[i];
      if (isStaticFloor(b) && state.tool !== "spawn") continue;
      return b;
    }
    return null;
  }

  function onPointerTap(clientX, clientY) {
    const pos = canvasToWorld(clientX, clientY);
    if (state.tool === "spawn") {
      spawnProp(state.spawnKind, pos.x, pos.y);
      return;
    }
    const hit = bodyAt(pos);
    if (!hit) return;
    const meta = hit.plugin && hit.plugin.melon;
    if (state.tool === "delete") {
      if (meta && meta.deletable === false) return;
      // Remove connected ragdoll parts
      if (meta && meta.ragdoll) {
        const all = Composite.allBodies(engine.world);
        for (const b of all) {
          if (b.plugin && b.plugin.melon && b.plugin.melon.ragdoll && b.plugin.melon.name === meta.name) {
            Composite.remove(engine.world, b);
          }
        }
        const cons = Composite.allConstraints(engine.world);
        for (const c of cons) {
          if (!c.bodyA || !c.bodyB) continue;
          if (!Composite.get(engine.world, c.bodyA.id, "body") || !Composite.get(engine.world, c.bodyB.id, "body")) {
            Composite.remove(engine.world, c);
          }
        }
      } else {
        Composite.remove(engine.world, hit);
      }
      return;
    }
    if (state.tool === "freeze") {
      if (meta && meta.freezeable === false) return;
      Body.setStatic(hit, !hit.isStatic);
      hit.render.opacity = hit.isStatic ? 0.7 : 1;
    }
  }

  canvas.addEventListener(
    "pointerup",
    function (ev) {
      if (state.tool === "hand") return;
      // Ignore if dragged far
      onPointerTap(ev.clientX, ev.clientY);
    },
    { passive: true }
  );

  // Keyboard jump helper for runner
  window.addEventListener("keydown", function (ev) {
    if (ev.code === "Space" || ev.code === "ArrowUp" || ev.code === "KeyW") {
      ev.preventDefault();
      runnerJump();
    }
    if (ev.code === "KeyG") toggleGravity();
    if (ev.code === "KeyP") togglePause();
  });

  canvas.addEventListener(
    "pointerdown",
    function (ev) {
      if (state.mode === "runner" && state.tool === "hand") {
        runnerJump();
      }
    },
    { passive: true }
  );

  function runnerJump() {
    const hero = state.runnerHero;
    if (!hero || !state.runnerAlive) return;
    if (hero.velocity.y > -0.2 && hero.velocity.y < 0.55 && hero.position.y > floorY() - 80) {
      Body.setVelocity(hero, { x: Math.max(hero.velocity.x, 4.2), y: -9.5 });
    }
  }

  function updateHud() {
    scorePill.textContent = "Score " + Math.floor(state.score);
    modePill.textContent = state.mode === "runner" ? "Runner" : "Sandbox";
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll("#tools [data-tool]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tool") === tool);
    });
    mouseConstraint.collisionFilter.mask = tool === "hand" ? 0xffffffff : 0;
  }

  function toggleGravity() {
    state.gravityOn = !state.gravityOn;
    engine.gravity.y = state.gravityOn ? 1 : 0;
    document.getElementById("btnGravity").classList.toggle("active", state.gravityOn);
  }

  function togglePause() {
    state.paused = !state.paused;
    if (state.paused) Runner.stop(runner);
    else Runner.run(runner, engine);
    document.getElementById("btnPause").classList.toggle("active", state.paused);
  }

  function startRunner() {
    clearDynamic();
    // Keep floor — rebuild clean course
    buildWorldFloor();
    state.mode = "runner";
    state.cameraX = 0;
    state.score = 0;
    setTool("hand");

    // Long ground already; add gaps + obstacles
    for (let i = 0; i < 18; i++) {
      const x = 500 + i * 160;
      if (i % 5 === 4) {
        // pit: remove floor coverage by elevated platforms only
        const plat = Bodies.rectangle(x + 80, floorY() - 40, 100, 20, {
          isStatic: true,
          friction: 1,
          render: { fillStyle: "#6e9b5a", strokeStyle: "#3f6a2c", lineWidth: 2 },
        });
        tag(plat, { kind: "platform" });
        Composite.add(engine.world, plat);
        continue;
      }
      const oh = 30 + (i % 3) * 18;
      const obst = Bodies.rectangle(x, floorY() - oh / 2 - 2, 34, oh, {
        isStatic: true,
        friction: 0.8,
        render: { fillStyle: "#c48a4a", strokeStyle: "#7a5228", lineWidth: 2 },
      });
      tag(obst, { kind: "obstacle", deletable: true });
      Composite.add(engine.world, obst);
    }

    spawnAzulin(120, floorY() - 70, { hero: true });
    updateHud();
    resize();
  }

  function serializeWorld() {
    const bodies = Composite.allBodies(engine.world)
      .filter(function (b) {
        return b.plugin && b.plugin.melon && b.plugin.melon.kind !== "world";
      })
      .map(function (b) {
        return {
          kind: b.plugin.melon.kind,
          x: b.position.x,
          y: b.position.y,
          angle: b.angle,
          isStatic: b.isStatic,
          vx: b.velocity.x,
          vy: b.velocity.y,
        };
      });
    return JSON.stringify({ mode: state.mode, score: state.score, bodies: bodies });
  }

  function loadWorld(json) {
    let data;
    try {
      data = JSON.parse(json);
    } catch (e) {
      return;
    }
    buildWorldFloor();
    state.mode = data.mode || "sandbox";
    state.score = data.score || 0;
    for (const item of data.bodies || []) {
      if (item.kind === "azulin") {
        const torso = spawnAzulin(item.x, item.y, { hero: state.mode === "runner" });
        Body.setAngle(torso, item.angle || 0);
      } else if (item.kind === "obstacle" || item.kind === "platform") {
        const b = spawnProp(item.kind === "obstacle" ? "block" : "platform", item.x, item.y);
        if (b && item.isStatic) Body.setStatic(b, true);
      } else if (item.kind !== "spring" && item.kind !== "bomb") {
        const b = spawnProp(item.kind, item.x, item.y);
        if (b) {
          Body.setAngle(b, item.angle || 0);
          if (item.isStatic) Body.setStatic(b, true);
        }
      }
    }
    updateHud();
  }

  // Camera follow in runner + buoyancy
  Events.on(engine, "beforeUpdate", function () {
    // Balloon buoyancy nudge
    const bodies = Composite.allBodies(engine.world);
    for (const b of bodies) {
      if (b.plugin && b.plugin.melon && b.plugin.melon.buoyancy) {
        Body.applyForce(b, b.position, { x: 0, y: -0.0025 * b.mass });
      }
    }

    if (state.mode === "runner" && state.runnerHero && state.runnerAlive) {
      const hero = state.runnerHero;
      Body.setVelocity(hero, { x: Math.max(hero.velocity.x, 3.8), y: hero.velocity.y });
      Body.setAngularVelocity(hero, hero.angularVelocity * 0.9);
      state.score = Math.max(state.score, hero.position.x - 120);
      const targetCam = hero.position.x - render.options.width * 0.3;
      state.cameraX = Math.max(0, targetCam);
      layoutCamera();
      updateHud();
      if (hero.position.y > floorY() + 120) {
        state.runnerAlive = false;
        setTimeout(startRunner, 600);
      }
    }
  });

  // UI wiring
  document.getElementById("tools").addEventListener("click", function (ev) {
    const t = ev.target.closest("[data-tool]");
    if (t) {
      setTool(t.getAttribute("data-tool"));
      return;
    }
  });

  document.getElementById("btnGravity").addEventListener("click", toggleGravity);
  document.getElementById("btnPause").addEventListener("click", togglePause);
  document.getElementById("btnClear").addEventListener("click", function () {
    state.mode = "sandbox";
    buildWorldFloor();
    state.cameraX = 0;
    resize();
    updateHud();
  });
  document.getElementById("btnRunner").addEventListener("click", startRunner);
  document.getElementById("btnSave").addEventListener("click", function () {
    localStorage.setItem(SAVE_KEY, serializeWorld());
    modePill.textContent = "Guardado";
    setTimeout(updateHud, 800);
  });
  document.getElementById("btnLoad").addEventListener("click", function () {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) loadWorld(raw);
  });

  document.getElementById("spawnGrid").addEventListener("click", function (ev) {
    const btn = ev.target.closest("[data-spawn]");
    if (!btn) return;
    state.spawnKind = btn.getAttribute("data-spawn");
    document.querySelectorAll("#spawnGrid [data-spawn]").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
    setTool("spawn");
  });

  // Boot — size first so floorY matches the iPad viewport
  document.getElementById("btnGravity").classList.add("active");
  resize();
  buildWorldFloor();
  spawnAzulin(160, floorY() - 70);
  layoutCamera();
  setTool("hand");
  updateHud();
})();
