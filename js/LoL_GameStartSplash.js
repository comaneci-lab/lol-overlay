const GAME_START_SPLASH_URL = "/allgamedata";
const GAME_START_SPLASH_ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const GAME_START_SPLASH_SKIN_PREFIXES = [
    "game_character_skin_displayname_",
    "game_character_displayname_"
];
const GAME_START_SPLASH_DURATION = 3000;

const gameStartSplashCanvas = document.getElementById("overlay-canvas");
const gameStartSplashImages = {
    ORDER: document.createElement("img"),
    CHAOS: document.createElement("img")
};

for (const [team, image] of Object.entries(gameStartSplashImages)) {
    image.className = `game-start-splash-image game-start-splash-${team.toLowerCase()}`;
    image.alt = `${team} splash art`;
    image.hidden = true;
    gameStartSplashCanvas.appendChild(image);
}

let gameStartSplashPollTimer = null;
let gameStartSplashUpdateInProgress = false;

function normalizeGameStartSplashPosition(position) {
    const aliases = {
        TOP: "TOP",
        JUNGLE: "JUNGLE",
        MIDDLE: "MIDDLE",
        MID: "MIDDLE",
        BOTTOM: "BOTTOM",
        BOT: "BOTTOM",
        ADC: "BOTTOM",
        DUO_CARRY: "BOTTOM",
        UTILITY: "UTILITY",
        SUPPORT: "UTILITY",
        DUO_SUPPORT: "UTILITY"
    };
    return aliases[String(position ?? "").trim().toUpperCase()] ?? null;
}

function getGameStartSplashPlayersByRole(players) {
    const playersByTeam = {};
    const assignments = [];

    for (const team of ["ORDER", "CHAOS"]) {
        const teamPlayers = players.filter(
            player => String(player?.team ?? "").toUpperCase() === team
        );
        const rolePlayers = new Map();
        const assignedPlayers = new Set();

        for (const player of teamPlayers) {
            const role = normalizeGameStartSplashPosition(player?.position);
            if (role && !rolePlayers.has(role)) {
                rolePlayers.set(role, player);
                assignedPlayers.add(player);
                assignments.push({ team, role, player, assignment: "position" });
            }
        }

        for (const role of GAME_START_SPLASH_ROLES) {
            if (rolePlayers.has(role)) continue;
            const player = teamPlayers.find(candidate => !assignedPlayers.has(candidate));
            if (!player) continue;
            rolePlayers.set(role, player);
            assignedPlayers.add(player);
            assignments.push({ team, role, player, assignment: "fallback" });
        }

        playersByTeam[team] = rolePlayers;
    }

    console.groupCollapsed("[GameStartSplash] role assignments");
    console.table(assignments.map(({ team, role, player, assignment }) => ({
        team,
        role,
        assignment,
        position: player.position ?? "",
        player: player.riotIdGameName ?? player.summonerName ?? player.championName ?? "",
        rawSkinName: player.rawSkinName ?? ""
    })));
    console.groupEnd();

    return playersByTeam;
}

function getGameStartSplashSkinName(player) {
    const rawSkinName = player?.rawSkinName;
    if (typeof rawSkinName !== "string") {
        return null;
    }

    const prefix = GAME_START_SPLASH_SKIN_PREFIXES.find(
        candidate => rawSkinName.startsWith(candidate)
    );
    if (!prefix) return null;

    let skinName = rawSkinName.slice(prefix.length);

    if (!/_\d+$/.test(skinName)) {
        skinName += "_0";
    }
    return /^[A-Za-z0-9_]+$/.test(skinName) ? skinName : null;
}

function loadGameStartSplashImage(team, image, player, role, roleIndex) {
    const skinName = getGameStartSplashSkinName(player);
    image.hidden = true;
    image.classList.remove("game-start-splash-animated");
    image.onload = null;
    image.onerror = null;

    if (!skinName) {
        console.warn("[GameStartSplash] skip image: skin name unavailable", {
            team,
            role,
            roleIndex,
            position: player?.position,
            rawSkinName: player?.rawSkinName
        });
        return Promise.resolve(false);
    }

    const splashArtName = `${skinName}.jpg`;
    image.dataset.roleIndex = String(roleIndex);

    return new Promise(resolve => {
        const tryLoad = (name, isFallback = false) => {
            const attemptStartedAt = performance.now();
            const attemptedFileName = `${name}.jpg`;
            console.log("[GameStartSplash] image load started", {
                team, role, roleIndex, splashArtName: attemptedFileName, isFallback
            });

            image.onload = () => {
                image.onload = null;
                image.onerror = null;
                console.log("[GameStartSplash] image loaded", {
                    team,
                    role,
                    roleIndex,
                    splashArtName: attemptedFileName,
                    isFallback,
                    loadDurationMs: Math.round(performance.now() - attemptStartedAt)
                });
                resolve(true);
            };
            image.onerror = () => {
                image.onload = null;
                image.onerror = null;

                const defaultSkinName = `${name.replace(/_\d+$/, "")}_0`;
                if (!isFallback && defaultSkinName !== name) {
                    console.warn("[GameStartSplash] image missing; trying default skin", {
                        team,
                        role,
                        roleIndex,
                        missingSplashArt: attemptedFileName,
                        defaultSplashArt: `${defaultSkinName}.jpg`
                    });
                    tryLoad(defaultSkinName, true);
                    return;
                }

                console.error("[GameStartSplash] image load failed", {
                    team, role, roleIndex, splashArtName: attemptedFileName
                });
                resolve(false);
            };
            image.src = `../assets/loading/${attemptedFileName}`;
        };

        tryLoad(skinName);
    });
}

async function showGameStartSplashRole(playersByTeam, roleIndex) {
    if (roleIndex >= GAME_START_SPLASH_ROLES.length) {
        for (const image of Object.values(gameStartSplashImages)) {
            image.hidden = true;
        }
        return;
    }

    const role = GAME_START_SPLASH_ROLES[roleIndex];
    const roleStartedAt = performance.now();
    console.log("[GameStartSplash] role started", { role, roleIndex });
    const images = Object.entries(gameStartSplashImages);
    const loadedImages = await Promise.all(images.map(([team, image]) =>
        loadGameStartSplashImage(
            team,
            image,
            playersByTeam[team].get(role),
            role,
            roleIndex
        )
    ));
    const visibleImages = images
        .filter((_, index) => loadedImages[index])
        .map(([, image]) => image);

    for (const image of visibleImages) {
        image.hidden = false;
        image.classList.add("game-start-splash-animated");
    }
    console.log("[GameStartSplash] display started", {
        role,
        roleIndex,
        teams: images
            .filter((_, index) => loadedImages[index])
            .map(([team]) => team)
    });
    if (visibleImages.length > 0) {
        await new Promise(resolve =>
            window.setTimeout(resolve, GAME_START_SPLASH_DURATION)
        );
    } else {
        console.warn("[GameStartSplash] no images loaded for role", { role, roleIndex });
    }
    for (const image of visibleImages) {
        image.hidden = true;
        image.classList.remove("game-start-splash-animated");
    }
    console.log("[GameStartSplash] display ended", {
        role,
        roleIndex,
        elapsedMs: Math.round(performance.now() - roleStartedAt)
    });

    await showGameStartSplashRole(playersByTeam, roleIndex + 1);
}

async function updateGameStartSplash() {
    if (gameStartSplashUpdateInProgress) return;
    gameStartSplashUpdateInProgress = true;

    try {
        const response = await fetch(GAME_START_SPLASH_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`status ${response.status}`);
        }

        const gameDataResponse = await response.json();
        const data = gameDataResponse?.data;
        const events = data?.events?.Events;
        if (gameDataResponse?.ok !== true || !Array.isArray(events) ||
            !events.some(event => event?.EventName === "GameStart")) {
            return;
        }
        if (!Array.isArray(data?.allPlayers)) {
            throw new Error("allPlayers was not available after GameStart");
        }

        window.clearInterval(gameStartSplashPollTimer);
        gameStartSplashPollTimer = null;
        const playersByTeam = getGameStartSplashPlayersByRole(data.allPlayers);
        showGameStartSplashRole(playersByTeam, 0);
    } catch (error) {
        console.error("failed to update game-start splash overlay", error);
    } finally {
        gameStartSplashUpdateInProgress = false;
    }
}

updateGameStartSplash();
gameStartSplashPollTimer = window.setInterval(updateGameStartSplash, 1000);
