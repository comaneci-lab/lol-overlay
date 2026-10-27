const markerLayer = document.getElementById("champion-map-markers");
const championMarkers = new Map();
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
        TOP: false,
        JUNGLE: false,
        MIDDLE: false,
        BOTTOM: false,
        UTILITY: false
    }
};

const championRoutes = {
    TOP: [[10, 90], [14, 69], [21, 48], [34, 29], [55, 16], [78, 12], [70, 13], [48, 20], [32, 34], [20, 52]],
    JUNGLE: [[10, 90], [22, 78], [35, 67], [46, 54], [58, 45], [73, 31], [88, 12], [62, 41], [50, 51], [39, 63], [26, 75]],
    MIDDLE: [[10, 90], [26, 74], [42, 58], [50, 50], [58, 42], [74, 26], [90, 10], [58, 42], [50, 50]],
    BOTTOM: [[10, 90], [29, 90], [49, 85], [68, 73], [82, 56], [90, 32], [64, 63], [48, 77], [29, 86]],
    UTILITY: [[10, 90], [29, 90], [49, 85], [68, 73], [82, 56], [90, 32], [63, 63], [47, 78], [28, 87]]
};

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
    const response = await fetch("http://localhost:8888/champions", { cache: "no-store" });
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
        const iconPath = `assets/champion/${encodeURIComponent(championIcon)}.png`;
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
        const response = await fetch("http://localhost:8888/allgamedata", { cache: "no-store" });
        if (!response.ok) throw new Error(`game data status ${response.status}`);
        const result = await response.json();
        const data = result?.data;
        const players = data?.allPlayers;
        const myTeam = getMyTeam(data, players ?? []);
        const gameMode = data?.gameData?.gameMode;
        const gameTime = Number(data?.gameData?.gameTime ?? data?.gameData?.gametime);

        if (result?.ok !== true || !Array.isArray(players) || !Number.isFinite(gameTime)) {
            throw new Error("invalid game data received for champion overlay");
        }
        if (!["CLASSIC", "PRACTICETOOL"].includes(gameMode)) {
            markerLayer.replaceChildren();
            championMarkers.clear();
            return;
        }
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
