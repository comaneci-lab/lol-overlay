const markerLayer = document.getElementById("champion-map-markers");
const championMarkers = new Map();
const towerMarkers = new Map();
const minionMarkers = new Map();
const destroyedTowerKeys = new Set();
let minions = [];
let minionSimulationTime = 0;
let nextMinionWaveTime = 65;
let minionWaveNumber = 0;
let lastOverlayGameTime = null;
let championIconsByName = null;
let assignedRoles = new Map();
let refreshInProgress = false;
let lastReportedError = "";
const visibilitySettings = {
    ALLY: {
        TOP: true,
        JUNGLE: true,
        MIDDLE: true,
        BOTTOM: true,
        UTILITY: true
    },
    ENEMY: {
        TOP: true,
        JUNGLE: true,
        MIDDLE: true,
        BOTTOM: true,
        UTILITY: true
    }
};
const teamMarkerVisibilitySettings = {
    TOWER: {
        ALLY: true,
        ENEMY: true
    },
    MINION: {
        ALLY: true,
        ENEMY: true
    }
};

const championRoutes = {
    TOP: [[10, 90], [14, 69], [21, 48], [34, 29], [55, 16], [78, 12], [70, 13], [48, 20], [32, 34], [20, 52]],
    JUNGLE: [[10, 90], [22, 78], [35, 67], [46, 54], [58, 45], [73, 31], [88, 12], [62, 41], [50, 51], [39, 63], [26, 75]],
    MIDDLE: [[10, 90], [26, 74], [42, 58], [50, 50], [58, 42], [74, 26], [90, 10], [58, 42], [50, 50]],
    BOTTOM: [[10, 90], [29, 90], [49, 85], [68, 73], [82, 56], [90, 32], [64, 63], [48, 77], [29, 86]],
    UTILITY: [[10, 90], [29, 90], [49, 85], [68, 73], [82, 56], [90, 32], [63, 63], [47, 78], [28, 87]]
};

const laneRoutes = {
    TOP: [[10, 90], [10, 72], [12, 50], [17, 30], [30, 16], [52, 10], [75, 10], [90, 10]],
    MIDDLE: [[10, 90], [30, 70], [50, 50], [70, 30], [90, 10]],
    BOTTOM: [[10, 90], [30, 90], [50, 88], [70, 80], [84, 64], [90, 44], [90, 25], [90, 10]]
};

const laneNamesByEventCode = {
    ORDER: {
        2: "TOP",
        1: "MIDDLE",
        0: "BOTTOM"
    },
    CHAOS: {
        0: "BOTTOM",
        1: "MIDDLE",
        2: "TOP"
    }
};
// P1 is the inhibitor tower, P2 the inner tower, and P3 the outer tower.
// Progress runs from the ORDER base (0) to the CHAOS base (1).
const towerDefinitionsByLane = {
    TOP: {
        1: { name: "INHIBITOR", progress: 0.14 },
        2: { name: "INNER", progress: 0.25 },
        3: { name: "OUTER", progress: 0.42 }
    },
    MIDDLE: {
        1: { name: "INHIBITOR", progress: 0.20 },
        2: { name: "INNER", progress: 0.30 },
        3: { name: "OUTER", progress: 0.41 },
        4: { name: "NEXUS_1", progress: 0.11 },
        5: { name: "NEXUS_2", progress: 0.08 }
    },
    BOTTOM: {
        1: { name: "INHIBITOR", progress: 0.14 },
        2: { name: "INNER", progress: 0.25 },
        3: { name: "OUTER", progress: 0.42 }
    },
};
// Position offsets are minimap percentage points, keyed like ORDER_TOP_2.
const towerHorizontalOffsets = {
    ORDER_TOP_3: -5.0,
    ORDER_TOP_2: -1.0,
    ORDER_TOP_1: -0.0,
    CHAOS_BOTTOM_1: 0.0,
    CHAOS_BOTTOM_2: 0.0,
    CHAOS_BOTTOM_3: 8.0,
    ORDER_MIDDLE_4: 0.0,
    ORDER_MIDDLE_5: -2.0,
    CHAOS_TOP_2: -1.0,
    CHAOS_TOP_3: -1.0,
    CHAOS_MIDDLE_4: 1.0,
    CHAOS_MIDDLE_5: 1.0,
    ORDER_BOTTOM_1: 3.0,
    ORDER_BOTTOM_2: 2.0,
    ORDER_BOTTOM_3: 4.0,
};
const towerVerticalOffsets = {
    ORDER_TOP_3: -3.0,
    ORDER_BOTTOM_1: 0.0,
    ORDER_BOTTOM_2: 1.0,
    ORDER_BOTTOM_3: 8.0,
    CHAOS_TOP_1: -0.0,
    CHAOS_TOP_2: 1.0,
    CHAOS_TOP_3: -5.0,
    CHAOS_MIDDLE_4: -5.0,
    CHAOS_MIDDLE_5: -0.0,
    CHAOS_BOTTOM_3: 3.0,
    ORDER_MIDDLE_4: 2.0,
    ORDER_MIDDLE_5: -3.0,
};
const minionSpeed = 1.7;
const minionWaveSpacing = 2;
const minionCollisionDistance = 0.025;
const minionCollisionDelay = 3;
const firstMinionWaveTime = 65;
const fourteenthMinuteWaveTime = 14 * 60;
const twentyFifthMinuteWaveTime = 25 * 60;
const lastThirtySecondWaveTime = fourteenthMinuteWaveTime - 25;
const lastTwentyFifthSecondWaveTime = 30 * 60 - 10;

function getNextMinionWaveTime(previousWaveTime) {
    if (previousWaveTime >= lastTwentyFifthSecondWaveTime) return previousWaveTime + 20;
    if (previousWaveTime >= lastThirtySecondWaveTime) return previousWaveTime + 25;
    return previousWaveTime + 30;
}

function isCannonWave(waveNumber, spawnTime) {
    if (spawnTime <= fourteenthMinuteWaveTime) return waveNumber % 3 === 0;
    if (spawnTime < twentyFifthMinuteWaveTime) return waveNumber % 2 === 0;
    return true;
}

function getRouteLength(route) {
    return route.reduce((length, point, index) => {
        const next = route[index + 1];
        return next ? length + Math.hypot(next[0] - point[0], next[1] - point[1]) : length;
    }, 0);
}

function getPositionOnLane(route, progress) {
    const routeLength = getRouteLength(route);
    let remaining = routeLength * Math.max(0, Math.min(1, progress));

    for (let index = 0; index < route.length - 1; index++) {
        const start = route[index];
        const end = route[index + 1];
        const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (remaining <= length) {
            const segmentProgress = length === 0 ? 0 : remaining / length;
            return [
                start[0] + (end[0] - start[0]) * segmentProgress,
                start[1] + (end[1] - start[1]) * segmentProgress
            ];
        }
        remaining -= length;
    }

    return route[route.length - 1];
}

function getTowerKey(team, lane, tier) {
    return `${team}_${lane}_${tier}`;
}

function getTowerProgress(lane, tier) {
    return towerDefinitionsByLane[lane][tier].progress;
}

function getMinionCollisionProgress(lane, destroyedTowers) {
    let orderFrontier = 0;
    let chaosFrontier = 1;

    for (const tier of Object.keys(towerDefinitionsByLane[lane]).map(Number)) {
        if (!destroyedTowers.has(getTowerKey("ORDER", lane, tier))) {
            orderFrontier = Math.max(orderFrontier, getTowerProgress(lane, tier));
        }
        if (!destroyedTowers.has(getTowerKey("CHAOS", lane, tier))) {
            chaosFrontier = Math.min(chaosFrontier, 1 - getTowerProgress(lane, tier));
        }
    }

    return (orderFrontier + chaosFrontier) / 2;
}

function getLaneOffsetAtProgress(lane, progress) {
    const anchors = [
        { progress: 0, x: 0, y: 0 },
        { progress: 1, x: 0, y: 0 }
    ];
    const tiers = Object.keys(towerDefinitionsByLane[lane]).map(Number);

    for (const team of ["ORDER", "CHAOS"]) {
        for (const tier of tiers) {
            const key = getTowerKey(team, lane, tier);
            anchors.push({
                progress: team === "ORDER"
                    ? getTowerProgress(lane, tier)
                    : 1 - getTowerProgress(lane, tier),
                x: towerHorizontalOffsets[key] ?? 0,
                y: towerVerticalOffsets[key] ?? 0
            });
        }
    }

    anchors.sort((a, b) => a.progress - b.progress);
    for (let index = 1; index < anchors.length; index++) {
        const end = anchors[index];
        if (progress > end.progress) continue;

        const start = anchors[index - 1];
        const span = end.progress - start.progress;
        const ratio = span === 0 ? 0 : (progress - start.progress) / span;
        return [
            start.x + (end.x - start.x) * ratio,
            start.y + (end.y - start.y) * ratio
        ];
    }

    return [0, 0];
}

function getPositionOnLaneWithTowerOffsets(lane, progress) {
    const [x, y] = getPositionOnLane(laneRoutes[lane], progress);
    const [offsetX, offsetY] = getLaneOffsetAtProgress(lane, progress);
    return [x + offsetX, y + offsetY];
}

function getDestroyedTowers(events) {
    const destroyedTowers = new Set();
    for (const event of events) {
        if (event?.EventName !== "TurretKilled" || typeof event.TurretKilled !== "string") continue;
        const match = event.TurretKilled.match(/Turret_T(Order|Chaos)_L([0-2])_P([1-5])(?:_|$)/);

        if (!match) continue;

        const team = match[1] === "Order" ? "ORDER" : "CHAOS";
        const lane = laneNamesByEventCode[team][Number(match[2])];
        const tier = Number(match[3]);
        destroyedTowers.add(getTowerKey(team, lane, tier));
    }
    return destroyedTowers;
}

function getTowerDefinitions() {
    const towers = [];
    for (const team of ["ORDER", "CHAOS"]) {
        for (const [lane, definitions] of Object.entries(towerDefinitionsByLane)) {
            for (const tier of Object.keys(definitions).map(Number)) {
                towers.push({ team, lane, tier });
            }
        }
    }
    return towers;
}

function updateTowerMarkers(events, myTeam) {
    for (const key of getDestroyedTowers(events)) {
        destroyedTowerKeys.add(key);
    }
    const activeKeys = new Set();

    for (const tower of getTowerDefinitions()) {
        const key = getTowerKey(tower.team, tower.lane, tower.tier);
        if (destroyedTowerKeys.has(key)) continue;

        const ownProgress = getTowerProgress(tower.lane, tower.tier);
        const progress = tower.team === "ORDER" ? ownProgress : 1 - ownProgress;
        const [x, y] = getPositionOnLaneWithTowerOffsets(tower.lane, progress);
        let marker = towerMarkers.get(key);

        if (!marker) {
            marker = document.createElement("img");
            marker.className = `tower-icon ${tower.team.toLowerCase()}`;
            marker.src = "../assets/icon_tower.png";
            marker.alt = "";
            marker.draggable = false;
            marker.addEventListener("error", () => {
                marker.hidden = true;
            });
            markerLayer.appendChild(marker);
            towerMarkers.set(key, marker);
        }

        marker.style.left = `${x}%`;
        marker.style.top = `${y}%`;
        const towerName = towerDefinitionsByLane[tower.lane][tower.tier].name;
        marker.title = `${tower.team} ${tower.lane} ${towerName} (P${tower.tier})`;
        const side = myTeam ? (tower.team === myTeam ? "ALLY" : "ENEMY") : null;
        const isVisible = !side || teamMarkerVisibilitySettings.TOWER[side];
        marker.hidden = !isVisible;
        if (isVisible && marker.parentElement !== markerLayer) {
            markerLayer.appendChild(marker);
        } else if (!isVisible && marker.parentElement === markerLayer) {
            marker.remove();
        }
        activeKeys.add(key);
    }

    for (const [key, marker] of towerMarkers) {
        if (!activeKeys.has(key)) {
            marker.remove();
            towerMarkers.delete(key);
        }
    }

    return destroyedTowerKeys;
}

function createMinionWave(lane, waveNumber, spawnTime) {
    for (const team of ["ORDER", "CHAOS"]) {
        const direction = team === "ORDER" ? 1 : -1;
        const types = ["melee", "melee", "melee", "caster", "caster", "caster"];
        if (isCannonWave(waveNumber, spawnTime)) types.push("cannon");

        types.forEach((type, index) => {
            const id = `${lane}_${waveNumber}_${team}_${index}`;
            const minion = {
                id,
                lane,
                team,
                type,
                direction,
                progress: team === "ORDER" ? 0.035 : 0.965,
                collisionAt: null
            };
            const routeLength = getRouteLength(laneRoutes[lane]);
            minion.progress -= direction * index * minionWaveSpacing / routeLength;
            minions.push(minion);
        });
    }
}

function minionReachedTower(minion, previousProgress, progress, destroyedTowers) {
    const enemyTeam = minion.team === "ORDER" ? "CHAOS" : "ORDER";
    const tiers = Object.keys(towerDefinitionsByLane[minion.lane]).map(Number);
    for (const tier of tiers) {
        const key = getTowerKey(enemyTeam, minion.lane, tier);
        if (destroyedTowers.has(key)) continue;

        const towerProgress = enemyTeam === "ORDER"
            ? getTowerProgress(minion.lane, tier)
            : 1 - getTowerProgress(minion.lane, tier);
        const isOnEnemySide = minion.team === "ORDER"
            ? towerProgress > 0.5
            : towerProgress < 0.5;
        if (!isOnEnemySide) continue;

        const reached = minion.direction > 0
            ? previousProgress < towerProgress && progress >= towerProgress
            : previousProgress > towerProgress && progress <= towerProgress;
        if (reached) return true;
    }
    return false;
}

function simulateMinions(gameTime, destroyedTowers) {
    if (gameTime < minionSimulationTime - 2) {
        minions = [];
        minionSimulationTime = 0;
        nextMinionWaveTime = firstMinionWaveTime;
        minionWaveNumber = 0;
    }

    while (minionSimulationTime < gameTime) {
        const delta = Math.min(1, gameTime - minionSimulationTime);
        const nextTime = minionSimulationTime + delta;
        while (nextMinionWaveTime <= nextTime) {
            minionWaveNumber++;
            for (const lane of Object.keys(laneRoutes)) {
                createMinionWave(lane, minionWaveNumber, nextMinionWaveTime);
            }
            nextMinionWaveTime = getNextMinionWaveTime(nextMinionWaveTime);
        }

        for (const minion of minions) {
            if (minion.collisionAt !== null) continue;
            const lane = minion.lane;
            const routeLength = getRouteLength(laneRoutes[lane]);
            const collisionProgress = getMinionCollisionProgress(lane, destroyedTowers);
            const orderSpawnProgress = 0.035;
            const chaosSpawnProgress = 0.965;
            const averageProgressSpeed = minionSpeed / routeLength;
            const meetingTime = (chaosSpawnProgress - orderSpawnProgress) / (2 * averageProgressSpeed);
            const distanceToMeeting = minion.team === "ORDER"
                ? collisionProgress - orderSpawnProgress
                : chaosSpawnProgress - collisionProgress;
            const progressSpeed = distanceToMeeting / meetingTime;
            const previousProgress = minion.progress;
            minion.progress += minion.direction * progressSpeed * delta;
            if (minionReachedTower(minion, previousProgress, minion.progress, destroyedTowers)) {
                minion.collisionAt = nextTime - minionCollisionDelay;
                minion.reachedTower = true;
            }
        }

        for (const lane of Object.keys(laneRoutes)) {
            const laneMinions = minions.filter(minion =>
                minion.lane === lane && minion.collisionAt === null
            );
            for (const minion of laneMinions) {
                const opponent = laneMinions.find(candidate =>
                    candidate.team !== minion.team &&
                    Math.abs(candidate.progress - minion.progress) <= minionCollisionDistance
                );
                if (opponent) {
                    minion.collisionAt = nextTime;
                    opponent.collisionAt = nextTime;
                }
            }
        }

        minions = minions.filter(minion =>
            minion.collisionAt === null ||
            (!minion.reachedTower && nextTime - minion.collisionAt < minionCollisionDelay)
        );
        minionSimulationTime = nextTime;
    }
}

function updateMinionMarkers(gameTime, destroyedTowers, myTeam) {
    simulateMinions(gameTime, destroyedTowers);
    const activeKeys = new Set();

    for (const minion of minions) {
        const [x, y] = getPositionOnLaneWithTowerOffsets(minion.lane, minion.progress);
        let marker = minionMarkers.get(minion.id);
        if (!marker) {
            marker = document.createElement("span");
            marker.className = `minion-icon ${minion.team.toLowerCase()} ${minion.type}`;
            marker.setAttribute("aria-hidden", "true");
            markerLayer.appendChild(marker);
            minionMarkers.set(minion.id, marker);
        }

        marker.style.left = `${x}%`;
        marker.style.top = `${y}%`;
        const side = myTeam ? (minion.team === myTeam ? "ALLY" : "ENEMY") : null;
        const isVisible = !side || teamMarkerVisibilitySettings.MINION[side];
        marker.hidden = !isVisible;
        if (isVisible && marker.parentElement !== markerLayer) {
            markerLayer.appendChild(marker);
        } else if (!isVisible && marker.parentElement === markerLayer) {
            marker.remove();
        }
        activeKeys.add(minion.id);
    }

    for (const [key, marker] of minionMarkers) {
        if (!activeKeys.has(key)) {
            marker.remove();
            minionMarkers.delete(key);
        }
    }
}

function resetMapMarkers() {
    markerLayer.replaceChildren();
    championMarkers.clear();
    towerMarkers.clear();
    minionMarkers.clear();
    destroyedTowerKeys.clear();
    minions = [];
    minionSimulationTime = 0;
    nextMinionWaveTime = firstMinionWaveTime;
    minionWaveNumber = 0;
}

function assignChampionRoles(players) {
    assignedRoles = new Map();
    const roleNames = Object.keys(championRoutes);

    for (const team of ["ORDER", "CHAOS"]) {
        const teamPlayers = players.filter(player => player.team === team);
        const usedRoles = new Set();

        for (const player of teamPlayers) {
            const role = String(player.position ?? "").trim().toUpperCase();
            if (roleNames.includes(role) && !usedRoles.has(role)) {
                assignedRoles.set(getChampionKey(player), role);
                usedRoles.add(role);
            }
        }

        for (const player of teamPlayers) {
            const key = getChampionKey(player);
            if (assignedRoles.has(key)) continue;
            const role = roleNames.find(candidate => !usedRoles.has(candidate)) ?? "MIDDLE";
            assignedRoles.set(key, role);
            usedRoles.add(role);
        }
    }
}

function getChampionKey(player) {
    return `${player.riotId ?? player.summonerName ?? player.championName ?? "Unknown"}_${player.team ?? "Unknown"}`;
}

function getMyTeam(data, players) {
    const activePlayer = data?.activePlayer;
    if (["ORDER", "CHAOS"].includes(activePlayer?.team)) {
        return activePlayer.team;
    }

    const activePlayerIds = [
        activePlayer?.riotId,
        activePlayer?.riotIdGameName,
        activePlayer?.summonerName
    ]
        .filter(id => typeof id === "string" && id.trim())
        .map(id => id.trim().toLowerCase());

    const player = players.find(candidate =>
        [candidate.riotId, candidate.riotIdGameName, candidate.summonerName]
            .some(id => typeof id === "string" && activePlayerIds.includes(id.trim().toLowerCase()))
    );
    return ["ORDER", "CHAOS"].includes(player?.team) ? player.team : null;
}

function getPositionOnRoute(route, gameTime, role, playerKey) {
    const cycleSeconds = role === "JUNGLE" ? 165 : role === "TOP" ? 245 : 210;
    const offset = [...playerKey].reduce((sum, character) => sum + character.charCodeAt(0), 0) % cycleSeconds;
    const progress = ((gameTime + offset) % cycleSeconds) / cycleSeconds;
    const lengths = route.map((point, index) => {
        const next = route[(index + 1) % route.length];
        return Math.hypot(next[0] - point[0], next[1] - point[1]);
    });
    const totalLength = lengths.reduce((sum, length) => sum + length, 0);
    let remaining = totalLength * progress;

    for (let index = 0; index < route.length; index++) {
        const start = route[index];
        const end = route[(index + 1) % route.length];
        const length = lengths[index];
        if (remaining <= length) {
            const segmentProgress = length === 0 ? 0 : remaining / length;
            return [
                start[0] + (end[0] - start[0]) * segmentProgress,
                start[1] + (end[1] - start[1]) * segmentProgress
            ];
        }
        remaining -= length;
    }

    return route[0];
}

async function loadChampionIcons() {
    const response = await fetch("/champions", { cache: "no-store" });
    if (!response.ok) throw new Error(`champion list status ${response.status}`);
    const result = await response.json();
    const champions = result?.data?.data;
    if (result?.ok !== true || !champions || typeof champions !== "object") {
        throw new Error("invalid champion list received");
    }

    championIconsByName = new Map(
        Object.values(champions).map(champion => [champion.name, champion.id])
    );
}

function updateChampionMarkers(players, gameTime, myTeam) {
    const activeKeys = new Set();

    for (const player of players) {
        if (!["ORDER", "CHAOS"].includes(player.team)) continue;
        const key = getChampionKey(player);
        const role = assignedRoles.get(key) ?? "MIDDLE";
        const championName = player.championName || "Unknown";
        const championIcon = championIconsByName.get(championName) ?? championName;
        let marker = championMarkers.get(key);

        if (!marker) {
            marker = document.createElement("img");
            marker.className = `champion-icon ${player.team.toLowerCase()}`;
            marker.alt = "";
            marker.draggable = false;
            marker.addEventListener("error", () => {
                marker.dataset.imageError = "true";
                marker.hidden = true;
            });
            markerLayer.appendChild(marker);
            championMarkers.set(key, marker);
        }

        marker.dataset.role = role;
        marker.dataset.team = player.team;
        marker.title = championName;
        const iconPath = `../assets/champion/${encodeURIComponent(championIcon)}.png`;
        if (marker.getAttribute("src") !== iconPath) {
            marker.dataset.imageError = "false";
            marker.src = iconPath;
        }

        let [x, y] = getPositionOnRoute(championRoutes[role], gameTime, role, key);
        if (player.team === "CHAOS") {
            x = 100 - x;
            y = 100 - y;
        }
        marker.style.left = `${x}%`;
        marker.style.top = `${y}%`;
        const side = myTeam
            ? player.team === myTeam ? "ALLY" : "ENEMY"
            : null;
        const isVisible = marker.dataset.imageError !== "true" &&
            (!side || visibilitySettings[side][role] !== false);
        marker.hidden = !isVisible;
        if (isVisible && marker.parentElement !== markerLayer) {
            markerLayer.appendChild(marker);
        } else if (!isVisible && marker.parentElement === markerLayer) {
            marker.remove();
        }
        activeKeys.add(key);
    }

    for (const [key, marker] of championMarkers) {
        if (!activeKeys.has(key)) {
            marker.remove();
            championMarkers.delete(key);
        }
    }
}

async function refreshChampionOverlay() {
    if (refreshInProgress) return;
    refreshInProgress = true;

    try {
        const response = await fetch("/allgamedata", { cache: "no-store" });
        if (!response.ok) throw new Error(`game data status ${response.status}`);
        const result = await response.json();
        const data = result?.data;
        const players = data?.allPlayers;
        const myTeam = getMyTeam(data, players ?? []);
        const gameMode = data?.gameData?.gameMode;
        const gameTime = Number(data?.gameData?.gameTime ?? data?.gameData?.gametime);
        const events = data?.events?.Events ?? [];

        if (result?.ok !== true || !Array.isArray(players) || !Array.isArray(events) || !Number.isFinite(gameTime)) {
            throw new Error("invalid game data received for champion overlay");
        }
        if (lastOverlayGameTime !== null && gameTime < lastOverlayGameTime - 2) {
            resetMapMarkers();
        }
        lastOverlayGameTime = gameTime;
        if (!["CLASSIC", "PRACTICETOOL"].includes(gameMode)) {
            resetMapMarkers();
            return;
        }
        const destroyedTowers = updateTowerMarkers(events, myTeam);
        updateMinionMarkers(gameTime, destroyedTowers, myTeam);
        if (!championIconsByName) await loadChampionIcons();
        assignChampionRoles(players);
        updateChampionMarkers(players, gameTime, myTeam);
        lastReportedError = "";
    } catch (error) {
        if (lastReportedError !== error.message) {
            console.error("failed to update champion overlay", error);
            lastReportedError = error.message;
        }
    } finally {
        refreshInProgress = false;
    }
}

refreshChampionOverlay();
setInterval(refreshChampionOverlay, 1000);
