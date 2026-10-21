const OBJECT_TIMER_URL = "http://localhost:8888/allgamedata";
const OBJECT_TIMER_LEAD_TIME = 3 * 60;

const OBJECT_TIMER_DEFINITIONS = [
    { id: "dragon", eventName: "DragonKill", initialSpawnAt: 5 * 60, respawnTime: 5 * 60, respawnTimeAfterFifthKill: 6 * 60, icon: "assets/icon_dragon.png" },
    { id: "voidclub", eventName: "HordeKill", initialSpawnAt: 8 * 60, despawnAt: 14 * 60 + 45, respawnTime: null, icon: "assets/icon_voidclub.png" },
    { id: "herald", eventName: "HeraldKill", initialSpawnAt: 15 * 60, despawnAt: 19 * 60 + 45, respawnTime: null, icon: "assets/icon_herald.png" },
    { id: "baron", eventName: "BaronKill", initialSpawnAt: 20 * 60, respawnTime: 6 * 60, icon: "assets/icon_baron.png" }
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

function renderObjectTimers(gameTime) {
    for (const object of OBJECT_TIMER_DEFINITIONS) {
        const { card, time } = objectTimerCards.get(object.id);
        const isOneTimeObjectiveKilled = objectTimerKilledOnce.has(object.id);
        const spawnAt = objectTimerNextSpawnAt[object.id];
        const remainingTime = spawnAt - gameTime;
        const isBeforeDespawnTime = object.despawnAt === undefined || gameTime < object.despawnAt;
        const shouldShow = !isOneTimeObjectiveKilled &&
            isBeforeDespawnTime &&
            gameTime >= spawnAt - OBJECT_TIMER_LEAD_TIME;

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
        if (gameDataResponse?.ok !== true || !Number.isFinite(gameTime) || !Array.isArray(data?.events?.Events)) {
            objectTimerWidget.hidden = true;
            if (!objectTimerInvalidDataLogged) {
                console.error("invalid game data received for object timers", gameDataResponse);
                objectTimerInvalidDataLogged = true;
            }
            return;
        }

        objectTimerInvalidDataLogged = false;
        if (!objectTimerGameStarted || (
            lastObjectTimerGameTime !== null && gameTime < lastObjectTimerGameTime - 5
        )) {
            resetObjectTimerState();
            objectTimerGameStarted = true;
        }

        lastObjectTimerGameTime = gameTime;
        processObjectTimerEvents(data.events.Events, gameTime);
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
