/* Azulín — kids physics sandbox (inspired by Melon Sandbox).
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
  } = Matter;

  const canvas = document.getElementById("world");

  const state = {
    tool: "hand", // hand | spawn
    spawnKind: "barrel",
    cameraX: 0,
    cameraY: 0,
    floorY: 420,
    azulinParts: [],
    azulinTorso: null,
    azulinLegs: { L: null, R: null },
    azulinArms: { L: null, R: null },
    azulinScale: 1,
    didDrag: false,
    draggingAzulin: false,
    walkPhase: 0,
    lastStepSign: 0,
    dragSpeed: 0,
    prevMouse: null,
    lastTap: { t: 0, x: 0, y: 0, id: null },
    walls: null,
  };

  const DOUBLE_TAP_MS = 320;
  const DOUBLE_TAP_DIST = 36;
  // Thick floor so fast throws / drags cannot tunnel through.
  const WALL_T = 160;
  const WALL_BOUNCE = 0.92;
  const FLOOR_SURFACE_PAD = 0.5;
  let mouseConstraint = null;
  let mouse = null;

  function floorY() {
    return state.floorY;
  }

  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1;
  // More solver passes → fewer bodies sinking into the static floor.
  engine.positionIterations = 12;
  engine.velocityIterations = 10;
  engine.constraintIterations = 4;

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
    syncBounds();
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

  function makeWall(x, y, w, h, fill, opts) {
    opts = opts || {};
    const wall = Bodies.rectangle(x, y, w, h, {
      isStatic: true,
      restitution: opts.restitution != null ? opts.restitution : WALL_BOUNCE,
      friction: opts.friction != null ? opts.friction : 0.05,
      frictionStatic: opts.frictionStatic != null ? opts.frictionStatic : 0.05,
      render: {
        fillStyle: fill || "#ffb7e0",
        strokeStyle: "#ff7eb6",
        lineWidth: 2,
      },
    });
    tag(wall, { kind: "world", deletable: false, freezeable: false });
    return wall;
  }

  function removeWalls() {
    if (!state.walls) return;
    const list = [
      state.walls.floor,
      state.walls.ceiling,
      state.walls.left,
      state.walls.right,
    ];
    for (let i = 0; i < list.length; i++) {
      if (list[i]) Composite.remove(engine.world, list[i]);
    }
    state.walls = null;
  }

  function placeBoundsWalls() {
    const w = Math.max(320, render.options.width || 800);
    const h = Math.max(220, render.options.height || 500);
    const fy = floorY();
    const cx = state.cameraX;
    const cy = state.cameraY || 0;
    const midX = cx + w / 2;
    const midY = cy + h / 2;

    removeWalls();

    // Floor top surface stays at fy; body is deep so nothing tunnels under.
    const floor = makeWall(midX, fy + WALL_T / 2, w + WALL_T * 2, WALL_T, "#7fe28a", {
      restitution: 0.15,
      friction: 0.9,
      frictionStatic: 1,
    });
    floor.render.strokeStyle = "#2f9e55";
    const ceiling = makeWall(midX, cy - WALL_T / 2, w + WALL_T * 2, WALL_T, "#fff4a8");
    const left = makeWall(cx - WALL_T / 2, midY, WALL_T, h + WALL_T * 2, "#ffb7e0");
    const right = makeWall(cx + w + WALL_T / 2, midY, WALL_T, h + WALL_T * 2, "#9af0e0");

    state.walls = { floor: floor, ceiling: ceiling, left: left, right: right };
    Composite.add(engine.world, [floor, ceiling, left, right]);
  }

  /** Hard stop: no dynamic body may cross the floor surface (drag / tunneling). */
  function containBodiesAboveFloor() {
    const surface = floorY() - FLOOR_SURFACE_PAD;
    const bodies = Composite.allBodies(engine.world);
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (!body || body.isStatic) continue;
      const overflow = body.bounds.max.y - surface;
      if (overflow <= 0) continue;
      Body.translate(body, { x: 0, y: -overflow });
      if (body.velocity.y > 0) {
        Body.setVelocity(body, { x: body.velocity.x, y: 0 });
      }
    }
  }

  /** Keep the mouse grab target on / above the floor so drag cannot pull through. */
  function clampMouseAboveFloor() {
    if (!mouse) return;
    const limit = floorY() - 8;
    if (mouse.position.y > limit) {
      mouse.position.y = limit;
    }
  }

  function buildWorldFloor() {
    Composite.clear(engine.world, false);
    // Composite.clear removes the mouse constraint — put it back.
    if (mouseConstraint) Composite.add(engine.world, mouseConstraint);
    state.walls = null;
    placeBoundsWalls();
  }

  /** Keep bounce walls glued to the visible playfield. */
  function syncBounds() {
    placeBoundsWalls();
  }

  function removeAllAzulin() {
    const bodies = Composite.allBodies(engine.world);
    for (const b of bodies.slice()) {
      if (b.plugin && b.plugin.melon && b.plugin.melon.kind === "azulin") {
        Composite.remove(engine.world, b);
      }
    }
    const cons = Composite.allConstraints(engine.world);
    for (const c of cons.slice()) {
      if (c.label === "Mouse Constraint") continue;
      if (!c.bodyA || !c.bodyB) {
        Composite.remove(engine.world, c);
        continue;
      }
      const aGone = !Composite.get(engine.world, c.bodyA.id, "body");
      const bGone = !Composite.get(engine.world, c.bodyB.id, "body");
      if (aGone || bGone) Composite.remove(engine.world, c);
    }
    state.azulinParts = [];
    state.azulinTorso = null;
    state.azulinLegs = { L: null, R: null };
    state.azulinArms = { L: null, R: null };
    state.walkPhase = 0;
    state.lastStepSign = 0;
    state.draggingAzulin = false;
  }

  function sfx(name, arg) {
    if (window.MelonSFX && typeof window.MelonSFX[name] === "function") {
      window.MelonSFX[name](arg);
    }
  }

  function isAzulinBody(body) {
    return !!(body && body.plugin && body.plugin.melon && body.plugin.melon.kind === "azulin");
  }

  function restartScene() {
    sfx("restart");
    state.cameraX = 0;
    buildWorldFloor();
    ensureSingleAzulin(160, floorY() - 70);
    setTool("hand");
    resize();
  }

  function deleteBody(hit) {
    if (!hit) return false;
    const meta = hit.plugin && hit.plugin.melon;
    if (!meta || meta.kind === "world" || meta.kind === "azulin" || meta.deletable === false) {
      return false;
    }
    Composite.remove(engine.world, hit);
    sfx("erase");
    return true;
  }

  function ensureSingleAzulin(x, y, opts) {
    removeAllAzulin();
    return spawnAzulin(x != null ? x : 160, y != null ? y : floorY() - 70, opts || {});
  }

  function keepAzulinUpright() {
    const parts = state.azulinParts;
    if (!parts || !parts.length) return;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p || p.isStatic) continue;
      Body.setAngularVelocity(p, 0);
    }
  }

  /** Hip / shoulder attach points on torso (match spawn constraints). */
  function limbAttach(scale) {
    return {
      legLocal: { x: 0, y: -8 * scale },
      armLLocal: { x: 6 * scale, y: 0 },
      armRLocal: { x: -6 * scale, y: 0 },
      hipY: 12 * scale,
      hipX: 6 * scale,
      shoulderY: -4 * scale,
      shoulderX: 10 * scale,
    };
  }

  /** Place a limb so its joint (local attach) sits on the torso attach and swings around it. */
  function poseLimb(limb, jointX, jointY, localAttach, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const lx = localAttach.x;
    const ly = localAttach.y;
    // worldCenter = joint - rotate(localAttach, angle)
    const cx = jointX - (lx * c - ly * s);
    const cy = jointY - (lx * s + ly * c);
    Body.setAngle(limb, angle);
    Body.setPosition(limb, { x: cx, y: cy });
    Body.setAngularVelocity(limb, 0);
    Body.setVelocity(limb, { x: 0, y: 0 });
  }

  /** Sample drag speed from mouse motion (more reliable than body velocity while grabbed). */
  function sampleDragSpeed() {
    if (!state.draggingAzulin || !mouse) {
      state.prevMouse = null;
      state.dragSpeed *= 0.85;
      if (state.dragSpeed < 0.05) state.dragSpeed = 0;
      return state.dragSpeed;
    }
    const mx = mouse.position.x;
    const my = mouse.position.y;
    if (state.prevMouse) {
      const instant = Math.hypot(mx - state.prevMouse.x, my - state.prevMouse.y);
      state.dragSpeed = state.dragSpeed * 0.55 + instant * 0.45;
    }
    state.prevMouse = { x: mx, y: my };
    return state.dragSpeed;
  }

  /** Legs walk/run while Azulín is dragged; faster drag → run stride + brighter steps. */
  function animateAzulinGait() {
    const torso = state.azulinTorso;
    const legL = state.azulinLegs.L;
    const legR = state.azulinLegs.R;
    const armL = state.azulinArms.L;
    const armR = state.azulinArms.R;
    if (!torso || !legL || !legR) return;

    keepAzulinUpright();

    // Head / torso / belly stay straight.
    for (let i = 0; i < state.azulinParts.length; i++) {
      const p = state.azulinParts[i];
      if (!p || p === legL || p === legR || p === armL || p === armR) continue;
      Body.setAngle(p, 0);
      Body.setAngularVelocity(p, 0);
    }

    const scale = state.azulinScale || 1;
    const a = limbAttach(scale);
    const tx = torso.position.x;
    const ty = torso.position.y;

    const speed = sampleDragSpeed();
    const active = state.draggingAzulin && speed > 0.35;
    if (!active) {
      poseLimb(legL, tx - a.hipX, ty + a.hipY, a.legLocal, 0);
      poseLimb(legR, tx + a.hipX, ty + a.hipY, a.legLocal, 0);
      if (armL) poseLimb(armL, tx - a.shoulderX, ty + a.shoulderY, a.armLLocal, 0);
      if (armR) poseLimb(armR, tx + a.shoulderX, ty + a.shoulderY, a.armRLocal, 0);
      state.lastStepSign = 0;
      return;
    }

    // px/frame thresholds: walk vs run (big strides so kids clearly see it)
    const running = speed >= 3.2;
    const stride = running ? 1.15 : 0.72;
    const phaseStep = Math.min(0.62, speed * (running ? 0.32 : 0.18));
    state.walkPhase += phaseStep;
    const wave = Math.sin(state.walkPhase);
    const swing = wave * stride;

    poseLimb(legL, tx - a.hipX, ty + a.hipY, a.legLocal, swing);
    poseLimb(legR, tx + a.hipX, ty + a.hipY, a.legLocal, -swing);
    if (armL) poseLimb(armL, tx - a.shoulderX, ty + a.shoulderY, a.armLLocal, -swing * 0.7);
    if (armR) poseLimb(armR, tx + a.shoulderX, ty + a.shoulderY, a.armRLocal, swing * 0.7);

    // Footstep on each half-cycle (when a foot "lands")
    const sign = wave >= 0 ? 1 : -1;
    if (sign !== state.lastStepSign && state.lastStepSign !== 0) {
      sfx("step", running);
    }
    state.lastStepSign = sign;
  }

  function styleLivingPart(color, stroke) {
    return { fillStyle: color, strokeStyle: stroke || "#5a3d8a", lineWidth: 3 };
  }

  function spawnAzulin(x, y, opts) {
    opts = opts || {};
    // Slightly larger default so kids can grab him on iPad.
    const scale = opts.scale || 1.35;
    state.azulinScale = scale;
    const group = Body.nextGroup(true);
    const head = Bodies.circle(x, y - 28 * scale, 16 * scale, {
      collisionFilter: { group },
      restitution: 0.05,
      friction: 0.8,
      density: 0.0012,
      render: styleLivingPart("#5ab0ff"),
    });
    const torso = Bodies.rectangle(x, y, 22 * scale, 28 * scale, {
      collisionFilter: { group },
      chamfer: { radius: 8 },
      density: 0.0015,
      render: styleLivingPart("#62b6ff"),
    });
    const belly = Bodies.circle(x, y + 4 * scale, 8 * scale, {
      collisionFilter: { group },
      isSensor: true,
      render: styleLivingPart("#ffe8a8", "#e0b84a"),
    });
    const legL = Bodies.rectangle(x - 8 * scale, y + 28 * scale, 10 * scale, 20 * scale, {
      collisionFilter: { group },
      density: 0.001,
      render: styleLivingPart("#ff6eb4", "#d63d88"),
    });
    const legR = Bodies.rectangle(x + 8 * scale, y + 28 * scale, 10 * scale, 20 * scale, {
      collisionFilter: { group },
      density: 0.001,
      render: styleLivingPart("#ff6eb4", "#d63d88"),
    });
    const armL = Bodies.rectangle(x - 20 * scale, y - 2 * scale, 16 * scale, 8 * scale, {
      collisionFilter: { group },
      density: 0.0008,
      render: styleLivingPart("#fff7f0", "#f0b8d0"),
    });
    const armR = Bodies.rectangle(x + 20 * scale, y - 2 * scale, 16 * scale, 8 * scale, {
      collisionFilter: { group },
      density: 0.0008,
      render: styleLivingPart("#fff7f0", "#f0b8d0"),
    });

    const parts = [torso, head, belly, legL, legR, armL, armR];
    for (const p of parts) {
      tag(p, {
        kind: "azulin",
        name: "Azulin",
        ragdoll: true,
        hero: !!opts.hero,
        deletable: false,
        freezeable: true,
      });
      // Stay upright: no tumbling when hit / dragged.
      Body.set(p, { inertia: Infinity, frictionAir: 0.08 });
      Body.setAngle(p, 0);
      Body.setAngularVelocity(p, 0);
    }
    tag(legL, Object.assign({}, legL.plugin.melon, { limb: "legL" }));
    tag(legR, Object.assign({}, legR.plugin.melon, { limb: "legR" }));
    tag(armL, Object.assign({}, armL.plugin.melon, { limb: "armL" }));
    tag(armR, Object.assign({}, armR.plugin.melon, { limb: "armR" }));

    const constraints = [
      Constraint.create({ bodyA: head, bodyB: torso, pointA: { x: 0, y: 14 * scale }, pointB: { x: 0, y: -12 * scale }, stiffness: 1, damping: 0.2, length: 2, render: { visible: false } }),
      Constraint.create({ bodyA: belly, bodyB: torso, stiffness: 1, length: 0, render: { visible: false } }),
      Constraint.create({ bodyA: legL, bodyB: torso, pointA: { x: 0, y: -8 * scale }, pointB: { x: -6 * scale, y: 12 * scale }, stiffness: 1, damping: 0.2, length: 2, render: { visible: false } }),
      Constraint.create({ bodyA: legR, bodyB: torso, pointA: { x: 0, y: -8 * scale }, pointB: { x: 6 * scale, y: 12 * scale }, stiffness: 1, damping: 0.2, length: 2, render: { visible: false } }),
      Constraint.create({ bodyA: armL, bodyB: torso, pointA: { x: 6 * scale, y: 0 }, pointB: { x: -10 * scale, y: -4 * scale }, stiffness: 1, damping: 0.2, length: 2, render: { visible: false } }),
      Constraint.create({ bodyA: armR, bodyB: torso, pointA: { x: -6 * scale, y: 0 }, pointB: { x: 10 * scale, y: -4 * scale }, stiffness: 1, damping: 0.2, length: 2, render: { visible: false } }),
    ];

    Composite.add(engine.world, parts.concat(constraints));
    state.azulinParts = parts;
    state.azulinTorso = torso;
    state.azulinLegs = { L: legL, R: legR };
    state.azulinArms = { L: armL, R: armR };
    state.walkPhase = 0;
    state.lastStepSign = 0;
    animateAzulinGait();
    return torso;
  }

  const ALLOWED_SPAWN = {
    barrel: true,
    crate: true,
    ball: true,
    plank: true,
    cone: true,
  };

  function clampInPlayfield(x, y, pad) {
    const p = pad || 40;
    const w = render.options.width || 800;
    const h = render.options.height || 500;
    const minX = state.cameraX + p;
    const maxX = state.cameraX + w - p;
    const minY = state.cameraY + p;
    const maxY = floorY() - p;
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  }

  function spawnProp(kind, x, y) {
    if (!ALLOWED_SPAWN[kind]) return null;
    const c = clampInPlayfield(x, y, 36);
    x = c.x;
    y = c.y;
    let body;
    switch (kind) {
      case "crate":
        body = Bodies.rectangle(x, y, 48, 48, {
          restitution: 0.55,
          friction: 0.35,
          density: 0.002,
          render: { fillStyle: "#ffb347", strokeStyle: "#e07a20", lineWidth: 3 },
        });
        tag(body, { kind: "crate" });
        break;
      case "ball":
        body = Bodies.circle(x, y, 22, {
          restitution: 0.95,
          friction: 0.02,
          density: 0.001,
          render: { fillStyle: "#ff5fa2", strokeStyle: "#d63d88", lineWidth: 3 },
        });
        tag(body, { kind: "ball" });
        break;
      case "plank":
        body = Bodies.rectangle(x, y, 120, 16, {
          restitution: 0.45,
          friction: 0.35,
          density: 0.0015,
          render: { fillStyle: "#ffd24a", strokeStyle: "#e0a800", lineWidth: 3 },
        });
        tag(body, { kind: "plank" });
        break;
      case "cone":
        body = Bodies.polygon(x, y, 3, 28, {
          restitution: 0.5,
          friction: 0.3,
          density: 0.0012,
          render: { fillStyle: "#ff9f43", strokeStyle: "#e07a20", lineWidth: 3 },
        });
        tag(body, { kind: "cone" });
        break;
      case "barrel":
        body = Bodies.rectangle(x, y, 36, 52, {
          chamfer: { radius: 10 },
          restitution: 0.6,
          friction: 0.25,
          density: 0.0022,
          render: { fillStyle: "#7aa0ff", strokeStyle: "#4568d4", lineWidth: 3 },
        });
        tag(body, { kind: "barrel" });
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

  Events.on(mouseConstraint, "startdrag", function (ev) {
    state.didDrag = true;
    const body = (ev && ev.body) || mouseConstraint.body;
    state.draggingAzulin = isAzulinBody(body);
    state.dragSpeed = 0;
    state.prevMouse = null;
    state.walkPhase = 0;
    state.lastStepSign = 0;
    sfx("grab");
    if (state.tool !== "hand") {
      mouseConstraint.constraint.bodyB = null;
      mouseConstraint.body = null;
      state.draggingAzulin = false;
    }
  });

  Events.on(mouseConstraint, "enddrag", function () {
    // Throw SFX for props; Azulín already played footsteps while dragged.
    if (!state.draggingAzulin) {
      sfx("throw");
    }
    state.draggingAzulin = false;
    state.dragSpeed = 0;
    state.prevMouse = null;
    state.lastStepSign = 0;
    // Keep drag flag briefly so the matching pointerup ignores tap/delete.
    setTimeout(function () {
      state.didDrag = false;
    }, 40);
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
      if (isStaticFloor(b)) continue;
      return b;
    }
    return null;
  }

  function setTool(tool) {
    state.tool = tool;
    if (mouseConstraint) {
      mouseConstraint.collisionFilter.mask = tool === "hand" ? 0xffffffff : 0;
    }
    // Hand mode: no spawn icon looks "selected" (avoids accidental spawn taps).
    document.querySelectorAll("#spawnGrid [data-spawn]").forEach(function (b) {
      if (tool === "hand") {
        b.classList.remove("active");
      } else {
        b.classList.toggle("active", b.getAttribute("data-spawn") === state.spawnKind);
      }
    });
  }

  function isDoubleTap(now, pos, hit) {
    const prev = state.lastTap;
    const dt = now - prev.t;
    const dist = Math.hypot(pos.x - prev.x, pos.y - prev.y);
    const sameTarget = hit && prev.id != null && hit.id === prev.id;
    return dt > 0 && dt <= DOUBLE_TAP_MS && dist <= DOUBLE_TAP_DIST && sameTarget;
  }

  function rememberTap(now, pos, hit) {
    state.lastTap = {
      t: now,
      x: pos.x,
      y: pos.y,
      id: hit ? hit.id : null,
    };
  }

  function onCanvasPointerUp(ev) {
    const pos = canvasToWorld(ev.clientX, ev.clientY);
    const now = performance.now();

    if (state.tool === "spawn") {
      spawnProp(state.spawnKind, pos.x, pos.y);
      sfx("place");
      setTool("hand");
      state.lastTap = { t: 0, x: 0, y: 0, id: null };
      return;
    }

    if (state.didDrag) {
      state.lastTap = { t: 0, x: 0, y: 0, id: null };
      return;
    }

    const hit = bodyAt(pos);
    if (hit && isDoubleTap(now, pos, hit)) {
      deleteBody(hit);
      state.lastTap = { t: 0, x: 0, y: 0, id: null };
      return;
    }
    rememberTap(now, pos, hit);
  }

  canvas.addEventListener("pointerup", onCanvasPointerUp, { passive: true });

  canvas.addEventListener(
    "dblclick",
    function (ev) {
      ev.preventDefault();
      const pos = canvasToWorld(ev.clientX, ev.clientY);
      deleteBody(bodyAt(pos));
      state.lastTap = { t: 0, x: 0, y: 0, id: null };
    },
    { passive: false }
  );

  Events.on(engine, "beforeUpdate", function () {
    clampMouseAboveFloor();
  });

  // afterUpdate: pose wins over constraint solver so legs visibly swing;
  // then clamp so nothing (props / Azulín) can sink through the floor.
  Events.on(engine, "afterUpdate", function () {
    animateAzulinGait();
    containBodiesAboveFloor();
  });

  document.getElementById("btnRestart").addEventListener("click", restartScene);

  document.getElementById("spawnGrid").addEventListener("click", function (ev) {
    const btn = ev.target.closest("[data-spawn]");
    if (!btn) return;
    state.spawnKind = btn.getAttribute("data-spawn");
    document.querySelectorAll("#spawnGrid [data-spawn]").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
    sfx("select");
    setTool("spawn");
  });

  // iOS/Safari: unlock audio on first gesture
  function unlockAudioOnce() {
    sfx("unlock");
    window.removeEventListener("pointerdown", unlockAudioOnce, true);
  }
  window.addEventListener("pointerdown", unlockAudioOnce, true);

  // Boot — gravity always on; size first so floorY matches the iPad viewport
  engine.gravity.y = 1;
  resize();
  buildWorldFloor();
  ensureSingleAzulin(160, floorY() - 70);
  layoutCamera();
  setTool("hand");

  // Debug/test bridge (Playwright + console)
  window.__azulin = {
    floorY: function () {
      return floorY();
    },
    spawnProp: function (kind, x, y) {
      return spawnProp(kind, x, y);
    },
    propBounds: function () {
      const fy = floorY();
      const out = [];
      const bodies = Composite.allBodies(engine.world);
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (!b || b.isStatic) continue;
        const meta = b.plugin && b.plugin.melon;
        out.push({
          kind: meta ? meta.kind : "?",
          maxY: b.bounds.max.y,
          minY: b.bounds.min.y,
          throughFloor: b.bounds.max.y > fy + 1,
        });
      }
      return { floorY: fy, bodies: out };
    },
    snapshot: function () {
      const L = state.azulinLegs.L;
      const R = state.azulinLegs.R;
      const t = state.azulinTorso;
      return {
        tool: state.tool,
        dragging: state.draggingAzulin,
        dragSpeed: state.dragSpeed,
        walkPhase: state.walkPhase,
        legL: L ? L.angle : null,
        legR: R ? R.angle : null,
        torso: t ? { x: t.position.x, y: t.position.y } : null,
        floorY: floorY(),
      };
    },
    worldToClient: function (wx, wy) {
      const rect = canvas.getBoundingClientRect();
      const x =
        ((wx - state.cameraX) / render.options.width) * rect.width + rect.left;
      const y =
        ((wy - state.cameraY) / render.options.height) * rect.height + rect.top;
      return { x, y };
    },
  };
})();
