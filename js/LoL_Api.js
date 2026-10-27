const ALLGANEDATA_URL = "http://localhost:8888/allgamedata";

let championMap = null;
let itemMap = null;
let summonerSpellMap = null;
let runeIconMap = null;

let playerTeamMap = {};
let assignedPositions = new Map();
let isGameInitialized = false;
let CurrentEventID = 0;
let liveClientDataAvailable = false;
window.playerDict = {};
window.isSpectatorMode = false;
// ブラウザで参照できるように window に設定
window.myTeam = null;

function getPlayerDict() {
    return window.playerDict;
}

function isSpectatorGameData(data) {
    const gameMode = String(data?.gameData?.gameMode ?? "").toUpperCase();
    if (gameMode === "SPECTATOR") return true;

    const activePlayer = data?.activePlayer;
    if (!activePlayer) return true;

    const activePlayerTeam = String(activePlayer.team ?? "").toUpperCase();
    if (activePlayerTeam === "ORDER" || activePlayerTeam === "CHAOS") return false;

    const getIdentityVariants = (player) => [player?.riotIdGameName, player?.summonerName, player?.riotId]
        .filter(identity => typeof identity === "string" && identity.trim())
        .flatMap(identity => {
            const normalizedIdentity = identity.trim().toLowerCase();
            return [normalizedIdentity, normalizedIdentity.split("#", 1)[0]];
        });

    const activeIdentities = new Set(getIdentityVariants(activePlayer));
    if (activeIdentities.size === 0) return true;

    return !data.allPlayers.some(player =>
        getIdentityVariants(player).some(identity => activeIdentities.has(identity))
    );
}

function setPlayerDict(playerDict) {
    window.playerDict = playerDict;
    window.dispatchEvent(new Event("playerdictupdated"));
}

function setOverlayDataAvailable(available) {
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
    const res = await fetch("http://localhost:8888/items");
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
    const res = await fetch("http://localhost:8888/champions");
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
    const res = await fetch("http://localhost:8888/summoner_spells");
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
    const res = await fetch("http://localhost:8888/runes");
    const json = await res.json();

    const runeTrees = json.data; // ← ここが重要！画像から確認した構造に合わせて修正

    if (!Array.isArray(runeTrees)) {
        console.error("ルーンデータの形式が不正です:", runeTrees);
        return {};
    }

    const map = {};

    for (const tree of runeTrees) {
        map[tree.name] = `assets/${tree.icon}`; // 例: "覇道" → "assets/perk-images/Styles/7200_Domination.png"

        for (const slot of tree.slots) {
            for (const rune of slot.runes) {
                map[rune.name] = `assets/${rune.icon}`; // 例: "電撃" → "assets/perk-images/Styles/Domination/Electrocute/Electrocute.png"
            }
        }
    }

    return map;
}



async function fetchGameData() {
    try {
        //　LiveClientDataAPIを取得
        const res = await fetch(ALLGANEDATA_URL, { cache: "no-store" });

        // レスポンスのステータスチェック
        if (!res.ok) {
            throw new Error("API fetch failed: " + res.status);
        }

        // レスポンスのデータをJSONとして取得
        const dataRoot = await res.json();
        // console.log("API raw response:", dataRoot);

        if (dataRoot?.ok !== true || !Array.isArray(dataRoot.data?.allPlayers)) {
            setOverlayDataAvailable(false);
            return null;
        }

        window.isSpectatorMode = isSpectatorGameData(dataRoot.data);
        setOverlayDataAvailable(true);

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

function initPlayerTeamMap(dataRoot) {
    const players = dataRoot.data.allPlayers;

    players.forEach(p => {
        const identities = [p.riotIdGameName, p.summonerName, p.riotId];
        for (const identity of identities) {
            if (typeof identity === "string" && identity.trim()) {
                const normalizedIdentity = identity.trim().toLowerCase();
                playerTeamMap[normalizedIdentity] = p.team;
                playerTeamMap[normalizedIdentity.split("#", 1)[0]] = p.team;
            }
        }
    });

    const activePlayer = dataRoot.data?.activePlayer;
    if (activePlayer) {
        const riotId = typeof activePlayer.riotId === "string"
            ? activePlayer.riotId.trim().toLowerCase()
            : "";
        const summonerName = typeof activePlayer.summonerName === "string"
            ? activePlayer.summonerName.trim().toLowerCase()
            : "";
        const team = activePlayer.team ?? playerTeamMap[riotId] ?? playerTeamMap[summonerName];
        window.myTeam = team ?? "ORDER";
    } else {
        window.myTeam = "ORDER";
    }
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

        const res = await fetch(ALLGANEDATA_URL);
        const dataRoot = await res.json();

        const events = dataRoot.data?.events?.Events ?? [];
        const gameTime = Number(dataRoot.data?.gameData?.gameTime ?? dataRoot.data?.gameData?.gametime);

        if (Object.keys(playerTeamMap).length === 0 && Array.isArray(dataRoot.data?.allPlayers)) {
            initPlayerTeamMap(dataRoot);
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
