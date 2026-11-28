const ALLGANEDATA_URL = "/allgamedata";

let championMap = null;
let itemMap = null;
let summonerSpellMap = null;
let runeIconMap = null;

let playerTeamMap = {};
let assignedPositions = new Map();
let isGameInitialized = false;
let CurrentEventID = 0;
let liveClientDataAvailable = false;
let gameStarted = false;
let currentGameMode = "";
let latestGameData = null;
window.playerDict = {};
window.isSpectatorMode = false;
// ブラウザで参照できるように window に設定
window.myTeam = null;

function getPlayerDict() {
    return window.playerDict;
}

function getGameTime(data) {
    return Number(data?.gameData?.gameTime ?? data?.gameData?.gametime);
}

function getGameMode(data) {
    return String(data?.gameData?.gameMode ?? "").trim().toUpperCase();
}

function isAllowedGameMode(data, modes) {
    const mode = getGameMode(data);
    return Array.from(modes ?? []).some(candidate =>
        String(candidate).trim().toUpperCase() === mode
    );
}

function findGameEvent(events, name) {
    return Array.isArray(events) ? events.find(event => event?.EventName === name) : undefined;
}

function hasGameEvent(events, name) {
    return findGameEvent(events, name) !== undefined;
}

function isGameStarted(data) {
    return hasGameEvent(data?.events?.Events, "GameStart");
}

function isGameEnded(data) {
    return hasGameEvent(data?.events?.Events, "GameEnd");
}

function getRawPlayerIdentities(player) {
    const values = typeof player === "string"
        ? [player]
        : [player?.riotIdGameName, player?.summonerName, player?.riotId];
    return [...new Set(values.filter(value => typeof value === "string" && value.trim())
        .map(value => value.trim().toLowerCase()))];
}

function getPlayerIdentities(player) {
    return [...new Set(getRawPlayerIdentities(player).flatMap(identity =>
        [identity, identity.split("#", 1)[0].trim()].filter(Boolean)
    ))];
}

function isSamePlayer(a, b) {
    const fullA = getRawPlayerIdentities(a).filter(identity => identity.includes("#"));
    const fullB = getRawPlayerIdentities(b).filter(identity => identity.includes("#"));
    if (fullA.length && fullB.length) {
        return fullA.some(identity => fullB.includes(identity));
    }
    const identities = new Set(getPlayerIdentities(a));
    return getPlayerIdentities(b).some(identity => identities.has(identity));
}

function findActivePlayer(data) {
    if (!Array.isArray(data?.allPlayers)) return undefined;
    const activeFull = new Set(getRawPlayerIdentities(data?.activePlayer)
        .filter(identity => identity.includes("#")));
    const exact = data.allPlayers.filter(player => getRawPlayerIdentities(player)
        .some(identity => activeFull.has(identity)));
    if (exact.length) return exact.length === 1 ? exact[0] : undefined;
    const matches = data.allPlayers.filter(player => isSamePlayer(player, data?.activePlayer));
    return matches.length === 1 ? matches[0] : undefined;
}

function isOrderTeam(team) {
    return String(team ?? "").trim().toUpperCase() === "ORDER";
}

function isChaosTeam(team) {
    return String(team ?? "").trim().toUpperCase() === "CHAOS";
}

function getMyTeam(data) {
    if (data?.isSpectatorMode === true || isSpectatorGameData(data)) return "ORDER";
    const activeTeam = data?.activePlayer?.team;
    const team = isOrderTeam(activeTeam) || isChaosTeam(activeTeam)
        ? activeTeam : findActivePlayer(data)?.team;
    return isChaosTeam(team) ? "CHAOS" : "ORDER";
}

function getEnemyTeam(team) {
    return isOrderTeam(team) ? "CHAOS" : isChaosTeam(team) ? "ORDER" : undefined;
}

function isAllyTeam(team) {
    const myTeam = window.isSpectatorMode ? "ORDER" : window.myTeam;
    return (isOrderTeam(team) && isOrderTeam(myTeam)) ||
        (isChaosTeam(team) && isChaosTeam(myTeam));
}

function isSpectatorGameData(data) {
    if (getGameMode(data) === "SPECTATOR") return true;

    const activePlayer = data?.activePlayer;
    if (!activePlayer) return true;

    if (isOrderTeam(activePlayer.team) || isChaosTeam(activePlayer.team)) return false;
    return !findActivePlayer(data);
}

function setPlayerDict(playerDict) {
    window.playerDict = playerDict;
    window.dispatchEvent(new Event("playerdictupdated"));
}

function setOverlayDataAvailable(available) {
    if (!available) {
        currentGameMode = "";
        latestGameData = null;
        setGameStarted(false);
    }
    if (!available && liveClientDataAvailable) {
        isGameInitialized = false;
        playerTeamMap = {};
        assignedPositions = new Map();
        CurrentEventID = 0;
        window.isSpectatorMode = false;
        teamStats = {
            ORDER: {
                HordeKill: 0,
                HeraldKill: 0,
                DragonKill: 0,
                BaronKill: 0,
                TurretKilled: 0,
                ChampionKill: 0,
                teamGold: 0,
                BaronBuffUntil: 0,
                ElderBuffUntil: 0,
                Dragons: {}
            },
            CHAOS: {
                HordeKill: 0,
                HeraldKill: 0,
                DragonKill: 0,
                BaronKill: 0,
                TurretKilled: 0,
                ChampionKill: 0,
                teamGold: 0,
                BaronBuffUntil: 0,
                ElderBuffUntil: 0,
                Dragons: {}
            }
        };
        window.myTeam = null;
    }

    liveClientDataAvailable = available;
    document.getElementById("overlay-canvas")
        ?.classList.toggle("live-client-data-unavailable", !available);
}

function setGameStarted(started) {
    gameStarted = started;
    document.getElementById("overlay-canvas")
        ?.classList.toggle("game-start-pending", !started);
}

let teamStats = {
    ORDER: {
        HordeKill: 0,
        HeraldKill: 0,
        DragonKill: 0,
        BaronKill: 0,
        TurretKilled: 0,
        ChampionKill: 0,
        teamGold: 0,
        BaronBuffUntil: 0,
        ElderBuffUntil: 0,
        Dragons: {}
    },
    CHAOS: {
        HordeKill: 0,
        HeraldKill: 0,
        DragonKill: 0,
        BaronKill: 0,
        TurretKilled: 0,
        ChampionKill: 0,
        teamGold: 0,
        BaronBuffUntil: 0,
        ElderBuffUntil: 0,
        Dragons: {}
    }
};

async function initializeCommon() {
    championMap = await loadChampionMapFromProxy();
    // console.log("championMap loaded:", championMap);

    // ★ item.json は Flask の /items から取得
    itemMap = await loadItemMapFromProxy();
    // console.log("itemMap loaded:", itemMap);

    // ★ summoner_spells.json も Flask の /summoner_spells から取得
    summonerSpellMap = await loadSummonerSpellMapFromProxy();
    // console.log("summonerSpellMap loaded:", summonerSpellMap);

    // ★ runesReforged.json も Flask の /runes から取得
    runeIconMap = await loadRuneIconMapFromProxy();
    // console.log("runeIconMap loaded:", runeIconMap);
    
}

async function loadItemMapFromProxy() {
    const res = await fetch("/items", { cache: "no-store" });
    const json = await res.json();

    if (!json.ok) {
        console.error("item.json の取得に失敗:", json.error);
        return {};
    }

    const data = json.data.data; // DDragon の item.json の data 部分

    const itemMap = {};

    for (const [id, item] of Object.entries(data)) {
        itemMap[Number(id)] = {
        name: item.name,
        total_gold: item.gold?.total ?? 0,
        };
    }

    return itemMap;
}

async function loadChampionMapFromProxy() {
    const res = await fetch("/champions", { cache: "no-store" });
    const json = await res.json();

    if (!json.ok) {
        console.error("champion.json の取得に失敗:", json.error);
        return {};
    }

    const data = json.data.data;

    const map = {};

    for (const [_, item] of Object.entries(data)) {
        map[item.name] = item.id;
        // 例: championMap["エイトロックス"] = "Aatrox"
    }

    return map;
}

async function loadSummonerSpellMapFromProxy() {
    const res = await fetch("/summoner_spells", { cache: "no-store" });
    const json = await res.json();

    if (!json.ok) {
        console.error("summoner_spells.json の取得に失敗:", json.error);
        return { idToName: {}, nameToId: {} };
    }

    const data = json.data.data;

    const idToName = {};  // 例: "SummonerBarrier" → "バリア"
    const nameToId = {};  // 例: "バリア" → "SummonerBarrier"

    for (const [_, spell] of Object.entries(data)) {
        const id = spell.id;     // "SummonerBarrier"
        const name = spell.name; // "バリア"

        idToName[id] = name;
        nameToId[name] = id;
    }

    return { idToName, nameToId };
}

async function loadRuneIconMapFromProxy() {
    const res = await fetch("/runes", { cache: "no-store" });
    const json = await res.json();

    const runeTrees = json.data; // ← ここが重要！画像から確認した構造に合わせて修正

    if (!Array.isArray(runeTrees)) {
        console.error("ルーンデータの形式が不正です:", runeTrees);
        return {};
    }

    const map = {};

    for (const tree of runeTrees) {
        map[tree.name] = `../assets/${tree.icon}`; // 例: "覇道" → "assets/perk-images/Styles/7200_Domination.png"

        for (const slot of tree.slots) {
            for (const rune of slot.runes) {
                map[rune.name] = `../assets/${rune.icon}`; // 例: "電撃" → "assets/perk-images/Styles/Domination/Electrocute/Electrocute.png"
            }
        }
    }

    return map;
}



async function fetchLiveGameData() {
    const response = await fetch(ALLGANEDATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("API fetch failed: " + response.status);
    return response.json();
}

// Poll immediately, then after each completed poll. Unavailability is reported once
// per outage and retains event history; a clock rewind, changed GameStart, or a new
// event list after an ended game resets it. Missing GameStart also resets it.
// Callbacks receive unwrapped data (onEvent receives event, data); they may be async.
// onData runs for every valid response, including responses without an events array.
function createGameLifecycleWatcher({ onData, onStart, onEnd, onEvent, onUnavailable, intervalMs = 1000 } = {}) {
    let running = false;
    let inFlight = false;
    let timer = null;
    let generation = 0;
    let available = null;
    let started = false;
    let ended = false;
    let lastTime = NaN;
    let startEvent = null;
    let seenEvents = new Set();

    function reset() {
        started = false;
        ended = false;
        lastTime = NaN;
        startEvent = null;
        seenEvents = new Set();
    }

    async function notify(callback, ...args) {
        if (!callback) return;
        try {
            await callback(...args);
        } catch (error) {
            console.error("game lifecycle callback error:", error);
        }
    }

    function schedule(delay) {
        if (running && timer === null && !inFlight) {
            timer = setTimeout(() => {
                timer = null;
                poll();
            }, delay);
        }
    }

    async function poll() {
        if (!running || inFlight) return;
        inFlight = true;
        const currentGeneration = generation;
        const active = () => running && generation === currentGeneration;
        try {
            const root = await fetchLiveGameData();
            if (!active()) return;
            if (root?.ok !== true || !root.data || typeof root.data !== "object") {
                throw new Error("Live game data unavailable");
            }
            const data = root.data;
            const time = getGameTime(data);
            const hasEvents = Array.isArray(data?.events?.Events);
            const currentStart = findGameEvent(data?.events?.Events, "GameStart");
            const hasStart = !!currentStart;
            const startChanged = currentStart && startEvent &&
                ["EventID", "EventTime"].some(key => currentStart[key] != null &&
                    startEvent[key] != null && String(currentStart[key]) !== String(startEvent[key]));
            if ((Number.isFinite(time) && Number.isFinite(lastTime) && time < lastTime) ||
                (started && hasEvents && !hasStart) || startChanged ||
                (ended && hasStart && !isGameEnded(data))) reset();
            if (Number.isFinite(time)) lastTime = time;
            if (currentStart) {
                startEvent = {
                    EventID: currentStart.EventID ?? startEvent?.EventID,
                    EventTime: currentStart.EventTime ?? startEvent?.EventTime
                };
            }
            available = true;

            await notify(onData, data);
            if (!active()) return;
            if (hasStart && !started) {
                started = true;
                await notify(onStart, data);
                if (!active()) return;
            }
            const events = Array.isArray(data?.events?.Events) ? data.events.Events : [];
            for (const [index, event] of events.entries()) {
                if (!event || typeof event !== "object") continue;
                const key = event.EventID != null
                    ? `id:${event.EventID}` : `index:${index}:${JSON.stringify(event)}`;
                if (seenEvents.has(key)) continue;
                seenEvents.add(key);
                await notify(onEvent, event, data);
                if (!active()) return;
            }
            if (isGameEnded(data) && !ended) {
                ended = true;
                await notify(onEnd, data);
            }
        } catch (error) {
            if (active() && available !== false) {
                available = false;
                await notify(onUnavailable, error);
            }
        } finally {
            inFlight = false;
            if (running) schedule(currentGeneration === generation ? intervalMs : 0);
        }
    }

    const watcher = {
        start() {
            if (running) return;
            running = true;
            generation++;
            if (!inFlight) poll();
        },
        stop() {
            running = false;
            generation++;
            if (timer !== null) clearTimeout(timer);
            timer = null;
        }
    };
    watcher.start();
    return watcher;
}

async function fetchGameData() {
    try {
        const dataRoot = await fetchLiveGameData();
        // console.log("API raw response:", dataRoot);

        if (dataRoot?.ok !== true || !Array.isArray(dataRoot.data?.allPlayers)) {
            setOverlayDataAvailable(false);
            return null;
        }

        currentGameMode = getGameMode(dataRoot.data);
        setGameStarted(isGameStarted(dataRoot.data));
        window.isSpectatorMode = isSpectatorGameData(dataRoot.data);
        setOverlayDataAvailable(true);
        latestGameData = dataRoot.data;

        return dataRoot;

    } catch (error) {
        // エラーが発生した場合の処理
        console.error("fetchGameData error:", error);
        setOverlayDataAvailable(false);

        return null;
    }
}

function assignPlayerPositions(players) {
    const positions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
    const positionsByPlayer = new Map();

    for (const team of ["ORDER", "CHAOS"]) {
        const teamPlayers = players.filter(player => player.team === team);
        const usedPositions = new Set();

        for (const player of teamPlayers) {
            const position = String(player.position ?? "").trim().toUpperCase();
            if (positions.includes(position) && !usedPositions.has(position)) {
                positionsByPlayer.set(`${player.riotId ?? player.summonerName ?? "Unknown"}_${player.team ?? "Unknown"}`, position);
                usedPositions.add(position);
            }
        }

        teamPlayers.forEach((player, index) => {
            const playerKey = `${player.riotId ?? player.summonerName ?? "Unknown"}_${player.team ?? "Unknown"}`;
            if (positionsByPlayer.has(playerKey)) return;

            const preferredPosition = positions[index];
            const position = preferredPosition && !usedPositions.has(preferredPosition)
                ? preferredPosition
                : positions.find(candidate => !usedPositions.has(candidate));

            positionsByPlayer.set(playerKey, position ?? "");
            if (position) usedPositions.add(position);
        });
    }

    return positionsByPlayer;
}

// Python build_player_data の JS 版
async function updataGameData(playersData) {

    const playerDict = {};

    for (const player of playersData) {
        const riotid = player.riotId ?? player.summonerName ?? "Unknown";
        const champName = player.championName ?? "Unknown";
        const team = player.team ?? "Unknown";
        const position = assignedPositions.get(`${riotid}_${team}`) ?? player.position ?? "";

        if (position !== player.position) {
            // console.log(`[ASSIGN POSITION] team=${team}, champ=${champName}, assigned="${position}"`);
        }

        // アイテム処理
        const itemsRaw = player.items ?? [];
        const items = [];
        let totalPrice = 0;

        for (const item of itemsRaw) {
            const itemId = item.itemID;
            const meta = itemMap[itemId] ?? {};

            const itemName = meta.name ?? item.displayName ?? "不明";
            const price = meta.total_gold ?? item.price ?? 0;
            const count = item.count ?? 1;
            const slot = item.slot ?? -1;

            totalPrice += price * count;

            items.push({
                itemID: itemId,
                itemName,
                count,
                slot,
                price
            });
        }

        // ★ デバッグ：champName を表示
        // console.log(`[CHAMP] riotid=${riotid}, champName=${champName}:${championMap[champName] ?? "アイコンなし"}`);

        // ルーン処理
        const runes = player.runes ?? {};
        const keystone = runes.keystone?.displayName ?? "";
        const primaryRuneTree = runes.primaryRuneTree?.displayName ?? "";
        const secondaryRuneTree = runes.secondaryRuneTree?.displayName ?? "";

        // サモスペ処理
        const spells = player.summonerSpells ?? {};
        const summonerSpellOneData = spells.summonerSpellOne ?? {};
        const summonerSpellTwoData = spells.summonerSpellTwo ?? {};
        const summonerSpellOne = summonerSpellOneData.displayName ?? "";
        const summonerSpellTwo = summonerSpellTwoData.displayName ?? "";

        playerDict[`${riotid}_${team}`] = {
            championName: champName,
            championIcon: championMap[champName] ?? champName, // ★ champion.json からアイコン名を取得
            position,
            team,
            items,
            total_price: totalPrice,
            level: player.level ?? "",
            scores: player.scores ?? {},
            isDead: player.isDead ?? false,
            respawnTimer: player.respawnTimer,

            // ルーンやサモスペも必要に応じてここに追加
            // keystone,
            runes: {
                keystone,
                primaryRuneTree,
                secondaryRuneTree
            },
            summonerSpells: {
                summonerSpellOne,
                summonerSpellTwo,
                summonerSpellOneRawDescription: summonerSpellOneData.rawDescription ?? "",
                summonerSpellTwoRawDescription: summonerSpellTwoData.rawDescription ?? ""
            }
            // primaryRuneTree,
        };

    }

    setPlayerDict(playerDict);
    return playerDict;
}

let isRefreshingPlayerDict = false;

async function refreshPlayerDict() {
    if (isRefreshingPlayerDict) return;
    isRefreshingPlayerDict = true;

    try {
        const gameData = await fetchGameData();
        if (!gameData) {
            setPlayerDict({});
            return;
        }

        const players = gameData.data.allPlayers;
        if (!isGameInitialized) {
            initPlayerTeamMap(gameData);
            assignedPositions = assignPlayerPositions(players);
            isGameInitialized = true;
        }
        await updataGameData(players);
    } finally {
        isRefreshingPlayerDict = false;
    }
}

function makePlayerTeamMap(players) {
    const teams = Object.create(null);
    players.forEach(p => {
        for (const identity of getPlayerIdentities(p)) {
            teams[identity] = p.team;
        }
    });
    return teams;
}

function initPlayerTeamMap(dataRoot) {
    const data = dataRoot?.data;
    playerTeamMap = makePlayerTeamMap(Array.isArray(data?.allPlayers) ? data.allPlayers : []);
    window.myTeam = getMyTeam(data);
}



function applyEvent(ev, gameTime) {
    const killer = typeof ev.KillerName === "string" ? ev.KillerName.trim().toLowerCase() : "";
    const team = ev.KillerTeam ?? playerTeamMap[killer] ?? playerTeamMap[killer.split("#", 1)[0]];
    if (!team) return;
    if (team !== "ORDER" && team !== "CHAOS") return;

    const t = teamStats[team];
    const eventTime = ev.EventTime != null && Number.isFinite(Number(ev.EventTime))
        ? Number(ev.EventTime)
        : gameTime;

    switch (ev.EventName) {
        case "HordeKill":
            t.HordeKill++;
            break;
        case "HeraldKill":
            t.HeraldKill++;
            break;
        case "DragonKill":
            t.DragonKill++;
            t.Dragons[t.DragonKill] = ev.DragonType;
            if (String(ev.DragonType).toLowerCase() === "elder" && Number.isFinite(eventTime)) {
                t.ElderBuffUntil = eventTime + 150;
            }
            break;
        case "BaronKill":
            t.BaronKill++;
            if (Number.isFinite(eventTime)) {
                t.BaronBuffUntil = eventTime + 180;
            }
            break;
        case "TurretKilled":
            t.TurretKilled++;
            break;
        case "ChampionKill":
            t.ChampionKill++;
            break;
    }
}

async function updateEvents() {
    try {

        const dataRoot = await fetchLiveGameData();
        const data = dataRoot.data;

        const events = data?.events?.Events ?? [];
        const gameTime = getGameTime(data);
        window.isSpectatorMode = data?.isSpectatorMode === true || isSpectatorGameData(data);

        if (Object.keys(playerTeamMap).length === 0 && Array.isArray(data?.allPlayers)) {
            initPlayerTeamMap(dataRoot);
        }

        if (window.isSpectatorMode) {
            const manualTeams = data?.spectatorData?.teams;
            if (!manualTeams?.ORDER || !manualTeams?.CHAOS) {
                throw new Error("観戦モードの手動データがありません。");
            }

            for (const team of ["ORDER", "CHAOS"]) {
                const manualStats = manualTeams[team];
                const stats = teamStats[team];
                stats.HordeKill = Number(manualStats.HordeKill);
                stats.HeraldKill = Number(manualStats.HeraldKill);
                stats.DragonKill = Number(manualStats.DragonKill);
                stats.BaronKill = Number(manualStats.BaronKill);
                stats.Dragons = Object.fromEntries(
                    (manualStats.Dragons ?? []).slice(0, 4).map((dragon, index) => [index + 1, dragon])
                );
                stats.BaronBuffUntil = Number(manualStats.BaronBuffUntil ?? 0);
                stats.ElderBuffUntil = Number(manualStats.ElderBuffUntil ?? 0);
            }
            return;
        }

        // 新規イベントだけ処理
        for (const ev of events) {
            if (ev.EventID > CurrentEventID) {
                applyEvent(ev, gameTime);
            }
        }

        if (events.length > 0) {
            CurrentEventID = events[events.length - 1].EventID;
        }

    } catch (e) {
        console.error("updateEvents error:", e);
    }
}
