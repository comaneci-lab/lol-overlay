const OBJECT_TIMER_URL = "/allgamedata";
const OBJECT_TIMER_LEAD_TIME = 3 * 60;

const OBJECT_TIMER_DEFINITIONS = [
    { id: "dragon", eventName: "DragonKill", initialSpawnAt: 5 * 60, respawnTime: 5 * 60, respawnTimeAfterFifthKill: 6 * 60, icon: "../assets/icon_dragon.png" },
    { id: "voidclub", eventName: "HordeKill", initialSpawnAt: 8 * 60, despawnAt: 14 * 60 + 45, respawnTime: null, icon: "../assets/icon_voidclub.png" },
    { id: "herald", eventName: "HeraldKill", initialSpawnAt: 15 * 60, despawnAt: 19 * 60 + 45, respawnTime: null, icon: "../assets/icon_herald.png" },
    { id: "baron", eventName: "BaronKill", initialSpawnAt: 20 * 60, respawnTime: 6 * 60, icon: "../assets/icon_baron.png" }
];

const objectTimerWidget = document.createElement("div");
objectTimerWidget.className = "object-timer-widget";
objectTimerWidget.setAttribute("aria-label", "オブジェクト出現タイマー");
objectTimerWidget.hidden = true;

const objectTimerCards = new Map();
for (const object of OBJECT_TIMER_DEFINITIONS) {
    const card = document.createElement("div");
    card.className = "object-timer-card";
    card.hidden = true;

    const icon = document.createElement("img");
    icon.src = object.icon;
    icon.alt = object.id;

    const time = document.createElement("span");
    time.className = "object-timer-time";

    card.append(icon, time);
    objectTimerWidget.appendChild(card);
    objectTimerCards.set(object.id, { card, time });
}

document.getElementById("overlay-canvas").appendChild(objectTimerWidget);

let lastObjectTimerGameTime = null;
let objectTimerGameStarted = false;
let isUpdatingObjectTimers = false;
let objectTimerInvalidDataLogged = false;
let objectTimerNextSpawnAt = {};
let objectTimerLastKillAt = {};
let objectTimerKillCounts = {};
let objectTimerKilledOnce = new Set();
let objectTimerSeenEvents = new Set();
let lastObjectTimerWasSpectator = null;

function resetObjectTimerState() {
    objectTimerNextSpawnAt = Object.fromEntries(
        OBJECT_TIMER_DEFINITIONS.map(object => [object.id, object.initialSpawnAt])
    );
    objectTimerLastKillAt = {};
    objectTimerKillCounts = {};
    objectTimerKilledOnce = new Set();
    objectTimerSeenEvents = new Set();
}

function formatObjectTimer(seconds) {
    const roundedSeconds = Math.ceil(Math.abs(seconds));
    const minutes = Math.floor(roundedSeconds / 60);
    const remainingSeconds = roundedSeconds % 60;
    const sign = seconds < 0 ? "-" : "";
    return `${sign}${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function processObjectTimerEvents(events, gameTime) {
    for (let index = 0; index < events.length; index++) {
        const event = events[index];
        const object = OBJECT_TIMER_DEFINITIONS.find(
            candidate => candidate.eventName === event?.EventName
        );
        if (!object) continue;

        const eventKey = String(event.EventID ?? `${event.EventName}-${index}`);
        if (objectTimerSeenEvents.has(eventKey)) continue;
        objectTimerSeenEvents.add(eventKey);

        const eventTime = event.EventTime != null && Number.isFinite(Number(event.EventTime))
            ? Number(event.EventTime)
            : gameTime;
        const killCount = (objectTimerKillCounts[object.id] ?? 0) + 1;
        objectTimerKillCounts[object.id] = killCount;

        if (object.respawnTime === null) {
            objectTimerKilledOnce.add(object.id);
            continue;
        }

        const previousKillAt = objectTimerLastKillAt[object.id];
        if (previousKillAt === undefined || eventTime > previousKillAt) {
            objectTimerLastKillAt[object.id] = eventTime;
            const respawnTime = object.respawnTimeAfterFifthKill && killCount >= 5
                ? object.respawnTimeAfterFifthKill
                : object.respawnTime;
            objectTimerNextSpawnAt[object.id] = eventTime + respawnTime;
        }
    }
}

function processSpectatorObjectiveData(spectatorData) {
    const teams = spectatorData?.teams;
    const objectives = spectatorData?.objectives;
    if (!teams?.ORDER || !teams?.CHAOS || !objectives) {
        throw new Error("観戦モードのオブジェクトデータがありません。");
    }

    const getTotalKills = field => {
        const orderCount = Number(teams.ORDER[field]);
        const chaosCount = Number(teams.CHAOS[field]);
        if (!Number.isInteger(orderCount) || orderCount < 0 ||
            !Number.isInteger(chaosCount) || chaosCount < 0) {
            throw new Error(`観戦モードの${field}取得数が不正です。`);
        }
        return orderCount + chaosCount;
    };

    const dragonKillCount = getTotalKills("DragonKill");
    const baronKillCount = getTotalKills("BaronKill");
    objectTimerKillCounts = {
        dragon: dragonKillCount,
        baron: baronKillCount
    };
    objectTimerNextSpawnAt = Object.fromEntries(
        OBJECT_TIMER_DEFINITIONS.map(object => [object.id, object.initialSpawnAt])
    );
    objectTimerLastKillAt = {};
    objectTimerKilledOnce = new Set();
    objectTimerSeenEvents = new Set();

    for (const [id, killCount] of [["dragon", dragonKillCount], ["baron", baronKillCount]]) {
        if (killCount === 0) continue;

        const lastKillAtValue = objectives[id]?.lastKillAt;
        if (lastKillAtValue == null) continue;
        const lastKillAt = Number(lastKillAtValue);
        if (!Number.isFinite(lastKillAt) || lastKillAt < 0) {
            throw new Error(`観戦モードの${id}最終撃破時刻が不正です。`);
        }

        const object = OBJECT_TIMER_DEFINITIONS.find(candidate => candidate.id === id);
        const respawnTime = object.respawnTimeAfterFifthKill && killCount >= 5
            ? object.respawnTimeAfterFifthKill
            : object.respawnTime;
        objectTimerLastKillAt[id] = lastKillAt;
        objectTimerNextSpawnAt[id] = lastKillAt + respawnTime;
    }

    if (getTotalKills("HordeKill") > 0) objectTimerKilledOnce.add("voidclub");
    if (getTotalKills("HeraldKill") > 0) objectTimerKilledOnce.add("herald");
}

function renderObjectTimers(gameTime) {
    for (const object of OBJECT_TIMER_DEFINITIONS) {
        const { card, time } = objectTimerCards.get(object.id);
        const isOneTimeObjectiveKilled = objectTimerKilledOnce.has(object.id);
        const spawnAt = objectTimerNextSpawnAt[object.id];
        const remainingTime = spawnAt - gameTime;
        const isBeforeDespawnTime = object.despawnAt === undefined || gameTime < object.despawnAt;
        const hasRespawnTimer = objectTimerLastKillAt[object.id] !== undefined;
        const shouldShow = !isOneTimeObjectiveKilled &&
            isBeforeDespawnTime &&
            (hasRespawnTimer || gameTime >= spawnAt - OBJECT_TIMER_LEAD_TIME);

        card.hidden = !shouldShow;
        if (shouldShow) {
            time.textContent = formatObjectTimer(remainingTime);
        }
    }
}

async function updateObjectTimers() {
    if (isUpdatingObjectTimers) return;
    isUpdatingObjectTimers = true;

    try {
        const response = await fetch(OBJECT_TIMER_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`status ${response.status}`);
        }

        const gameDataResponse = await response.json();
        const data = gameDataResponse?.data;
        const gameTime = Number(data?.gameData?.gameTime ?? data?.gameData?.gametime);
        const gameMode = String(data?.gameData?.gameMode ?? "").toUpperCase();
        const isSpectatorMode = data?.isSpectatorMode === true ||
            gameMode === "SPECTATOR" || !data?.activePlayer;
        window.isSpectatorMode = isSpectatorMode;
        if (gameDataResponse?.ok !== true || !Array.isArray(data?.allPlayers) ||
            !Number.isFinite(gameTime) ||
            (!isSpectatorMode && !Array.isArray(data?.events?.Events))) {
            objectTimerWidget.hidden = true;
            if (!objectTimerInvalidDataLogged) {
                console.error("invalid game data received for object timers", gameDataResponse);
                objectTimerInvalidDataLogged = true;
            }
            return;
        }

        if (isSpectatorMode && !data?.spectatorData) {
            objectTimerWidget.hidden = true;
            objectTimerInvalidDataLogged = false;
            return;
        }

        objectTimerInvalidDataLogged = false;
        if (lastObjectTimerWasSpectator !== isSpectatorMode || !objectTimerGameStarted || (
            lastObjectTimerGameTime !== null && gameTime < lastObjectTimerGameTime - 5
        )) {
            resetObjectTimerState();
            objectTimerGameStarted = true;
        }

        lastObjectTimerWasSpectator = isSpectatorMode;
        lastObjectTimerGameTime = gameTime;
        if (isSpectatorMode) {
            processSpectatorObjectiveData(data.spectatorData);
        } else {
            processObjectTimerEvents(data.events.Events, gameTime);
        }
        renderObjectTimers(gameTime);
        objectTimerWidget.hidden = false;
    } catch (error) {
        objectTimerWidget.hidden = true;
        console.error("failed to update object timers", error);
    } finally {
        isUpdatingObjectTimers = false;
    }
}

updateObjectTimers();
setInterval(updateObjectTimers, 1000);
