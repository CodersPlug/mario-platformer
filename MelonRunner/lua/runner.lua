-- Melon Runner — Azulín
-- Paste into a Lua Chip (Mechanisms). Wire inputs.entity.player to Azulín's body.
-- Jump: tap/activate the chip, or press Space / W / Up on devices with keyboard.

-- ============================================================
-- CONFIG (override with chip num inputs)
-- ============================================================
local DEFAULT_SPEED = 7
local DEFAULT_JUMP = 12
local DEFAULT_FLOOR_Y = -8
local LOOKAHEAD = 14
local SPAWN_EVERY = 90
local CLEAN_BEHIND = 12
local GROUND_VY = 0.45
local COYOTE_TICKS = 4

-- Obstacle spawn ids (vanilla Melon). Change if your build uses different names.
local OBSTACLE_IDS = {
    "crate_wood",
    "crate_wood",
    "plastic_plate",
}

-- ============================================================
-- STATE
-- ============================================================
local tick = 0
local startX = 0
local startY = 0
local startSet = false
local jumpQueued = false
local coyote = 0
local obstacleIds = {}
local pendingSpawns = {}
local lastScorePrint = -1
local cameraBound = false
local wasGrounded = false

-- ============================================================
-- HELPERS
-- ============================================================
local function numInput(name, default)
    local v = inputs.num[name]
    if v == nil then
        return default
    end
    return v
end

local function getPlayer()
    local id = inputs.entity.player
    if id == nil then
        return nil
    end
    local e = Entity(id)
    if e == nil or e._nil then
        return nil
    end
    return e
end

local function queueJump()
    jumpQueued = true
end

local function isJumpPressed()
    if jumpQueued then
        return true
    end
    -- Keyboard helpers (PC / some builds). Safe-guarded.
    local ok, down = pcall(function()
        if input == nil then
            return false
        end
        if input.keyDown ~= nil then
            return input.keyDown("space")
                or input.keyDown("w")
                or input.keyDown("up")
        end
        if input.key ~= nil then
            return input.key("space") or input.key("w") or input.key("up")
        end
        return false
    end)
    return ok and down
end

local function clearObstacles()
    for i = 1, #obstacleIds do
        local id = obstacleIds[i]
        local e = Entity(id)
        if e and not e._nil then
            pcall(function()
                e:delete()
            end)
        end
    end
    obstacleIds = {}
    pendingSpawns = {}
end

local function rememberObstacle(entities)
    if entities == nil then
        return
    end
    for i = 1, #entities do
        local e = entities[i]
        if e and not e._nil then
            local id = nil
            local ok, result = pcall(function()
                return e:getId()
            end)
            if ok then
                id = result
            end
            if id ~= nil then
                obstacleIds[#obstacleIds + 1] = id
                pcall(function()
                    e:freezeRotation(1)
                end)
            end
        end
    end
end

local function cleanupBehind(playerX)
    local keep = {}
    for i = 1, #obstacleIds do
        local id = obstacleIds[i]
        local e = Entity(id)
        local drop = false
        if e == nil or e._nil then
            drop = true
        else
            local ok, x = pcall(function()
                local px = e:getPosition()
                return px
            end)
            if ok and x ~= nil and x < playerX - CLEAN_BEHIND then
                pcall(function()
                    e:delete()
                end)
                drop = true
            end
        end
        if not drop then
            keep[#keep + 1] = id
        end
    end
    obstacleIds = keep
end

local function pickObstacleId()
    local i = (tick % #OBSTACLE_IDS) + 1
    return OBSTACLE_IDS[i]
end

local function spawnObstacleAhead(player)
    local px, py = player:getPosition()
    local kind = pickObstacleId()
    local ox = px + LOOKAHEAD
    local oy = startY + 0.6
    -- Alternate height: every other spawn is a low hop barrier
    if (tick / SPAWN_EVERY) % 2 < 1 then
        oy = startY + 0.5
    else
        oy = startY + 1.4
    end
    local req = nil
    local ok, result = pcall(function()
        return spawn.create(kind, ox, oy)
    end)
    if ok then
        req = result
    end
    if req ~= nil then
        pendingSpawns[req] = true
    else
        print("Azulin runner: spawn failed for " .. tostring(kind))
    end
end

local function bindCamera(player)
    if cameraBound then
        return
    end
    pcall(function()
        if camera ~= nil and camera.follow ~= nil then
            local id = player:getId()
            camera.follow(id)
            cameraBound = true
        end
    end)
end

local function resetRun(player)
    clearObstacles()
    jumpQueued = false
    coyote = 0
    tick = 0
    lastScorePrint = -1
    if startSet then
        pcall(function()
            player:setPosition(startX, startY)
            player:setVelocity(0, 0)
            player:setAngle(0)
        end)
    end
    print("Azulin runner: reset")
end

local function setupPlayer(player)
    pcall(function()
        player:freezeRotation(1)
        player:setGravityScale(1)
        player:setDraggable(0)
        player:setAngularVelocity(0)
        player:setAngle(0)
    end)
    if not startSet then
        local x, y = player:getPosition()
        startX = x
        startY = y
        startSet = true
        print("Azulin runner: start at " .. tostring(x) .. ", " .. tostring(y))
    end
    bindCamera(player)
end

-- ============================================================
-- LIFECYCLE
-- ============================================================
function OnInit()
    tick = 0
    jumpQueued = false
    print("Azulin runner: OnInit — wire player entity, activate chip to jump")
end

function OnActivated()
    queueJump()
end

function OnSpawned(requestId, entities)
    if pendingSpawns[requestId] then
        pendingSpawns[requestId] = nil
        rememberObstacle(entities)
    end
end

function OnTick()
    tick = tick + 1

    local player = getPlayer()
    if player == nil then
        outputs.num.score = 0
        outputs.string.status = "wire player"
        return
    end

    setupPlayer(player)

    local speed = numInput("speed", DEFAULT_SPEED)
    local jumpForce = numInput("jump", DEFAULT_JUMP)
    local floorY = numInput("floorY", DEFAULT_FLOOR_Y)

    local px, py = player:getPosition()
    local vx, vy = player:getVelocity()

    -- Ground / coyote
    local grounded = math.abs(vy) <= GROUND_VY and py <= startY + 0.35
    if grounded then
        coyote = COYOTE_TICKS
        wasGrounded = true
    else
        if coyote > 0 then
            coyote = coyote - 1
        end
        wasGrounded = false
    end

    -- Jump
    local wantJump = isJumpPressed()
    if wantJump and coyote > 0 then
        vy = jumpForce
        coyote = 0
        jumpQueued = false
    else
        jumpQueued = false
    end

    -- Auto-run (keep vertical from physics / jump)
    player:setVelocity(speed, vy)
    pcall(function()
        player:setAngularVelocity(0)
        player:setAngle(0)
    end)

    -- Obstacles
    if tick > 30 and tick % SPAWN_EVERY == 0 then
        spawnObstacleAhead(player)
    end
    cleanupBehind(px)

    -- Score
    local score = math.max(0, math.floor(px - startX))
    outputs.num.score = score
    outputs.string.status = "run"
    if score > 0 and score % 10 == 0 and score ~= lastScorePrint then
        lastScorePrint = score
        print("Azulin score: " .. tostring(score))
    end

    -- Fail: fell below floor
    if py < floorY then
        outputs.string.status = "fail"
        resetRun(player)
        return
    end

    -- Soft fail: blasted far below start or spun out of lane
    if startSet and py < startY - 6 then
        outputs.string.status = "fail"
        resetRun(player)
    end
end

function OnDestroy()
    clearObstacles()
    pcall(function()
        if camera ~= nil and camera.unfollow ~= nil then
            camera.unfollow()
        end
    end)
end
