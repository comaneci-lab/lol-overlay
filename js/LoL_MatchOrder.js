const MATCH_ORDER_ALLOWED_GAME_MODES = ["CLASSIC", "PRACTICETOOL", "SPECTATOR", "ARAM"];
const MATCH_ORDER_POLL_INTERVAL = 1000;
const MATCH_ORDER_UNAVAILABLE_LIMIT = 3;
const MATCH_ORDER_SKILLS = ["Q", "W", "E", "R"];

const matchOrderCanvas = document.getElementById("overlay-canvas");
const matchOrderWidget = document.createElement("main");
matchOrderWidget.className = "match-order-widget";
matchOrderWidget.hidden = true;
matchOrderCanvas.appendChild(matchOrderWidget);

let matchOrderStarted = false;
let matchOrderEnded = false;
let matchOrderStartEventId = null;
let matchOrderLastSkillLevels = null;
let matchOrderSkillSequence = [];
let matchOrderPurchases = [];
let matchOrderLastItemCounts = null;
let matchOrderMissingInitialItems = false;
let matchOrderLastGameTime = null;
let matchOrderSkillIcons = {};
let matchOrderChampionName = null;
let matchOrderChampionIconRequest = null;
let matchOrderUnavailableCount = 0;
let matchOrderUpdateInProgress = false;
let matchOrderRenderedSignature = null;

function resetMatchOrder(startEventId) {
    matchOrderStarted = true;
    matchOrderEnded = false;
    matchOrderStartEventId = startEventId;
    matchOrderLastSkillLevels = null;
    matchOrderSkillSequence = [];
    matchOrderPurchases = [];
    matchOrderLastItemCounts = null;
    matchOrderMissingInitialItems = false;
    matchOrderLastGameTime = null;
    matchOrderSkillIcons = {};
    matchOrderChampionName = null;
    matchOrderChampionIconRequest = null;
    matchOrderRenderedSignature = null;
    matchOrderWidget.hidden = true;
    matchOrderWidget.replaceChildren();
}

function findMatchOrderPlayer(data, players) {
    const activePlayer = data.activePlayer;
    const activeTeam = String(activePlayer?.team ?? "").toUpperCase();
    const activeChampion = String(activePlayer?.championName ?? "").trim().toLowerCase();
    let matchedPlayer = findActivePlayer(data);
    if (!matchedPlayer && activeTeam && activeChampion) {
        matchedPlayer = players.find(player =>
            String(player?.team ?? "").toUpperCase() === activeTeam &&
            String(player?.championName ?? "").trim().toLowerCase() === activeChampion
        );
    }

    return matchedPlayer;
}

function getMatchOrderItemCounts(items) {
    const counts = new Map();
    for (const item of items) {
        const itemId = Number(item?.itemID);
        const count = Number(item?.count ?? 1);
        if (!Number.isInteger(itemId) || itemId <= 0 ||
            !Number.isInteger(count) || count <= 0) {
            continue;
        }
        counts.set(itemId, (counts.get(itemId) ?? 0) + count);
    }
    return counts;
}

function recordMatchOrderInventory(items, gameTime) {
    if (!Array.isArray(items)) return;
    const currentCounts = getMatchOrderItemCounts(items);
    if (matchOrderLastItemCounts === null) {
        matchOrderLastItemCounts = currentCounts;
        matchOrderMissingInitialItems = [...currentCounts.values()]
            .some(count => count > 0);
        return;
    }

    if (!Number.isFinite(gameTime)) return;
    for (const [itemId, count] of currentCounts) {
        const previousCount = matchOrderLastItemCounts.get(itemId) ?? 0;
        for (let added = previousCount; added < count; added += 1) {
            matchOrderPurchases.push({ itemId, time: gameTime });
        }
    }
    matchOrderLastItemCounts = currentCounts;
}

function recordMatchOrderSkills(abilities) {
    const currentLevels = new Map();
    for (const key of MATCH_ORDER_SKILLS) {
        const level = Number(abilities?.[key]?.abilityLevel);
        if (Number.isInteger(level) && level >= 0) {
            currentLevels.set(key, level);
        }
    }
    if (currentLevels.size === 0) return;

    if (matchOrderLastSkillLevels === null) {
        matchOrderLastSkillLevels = currentLevels;
        const alreadyAllocated = [...currentLevels.values()]
            .reduce((total, level) => total + level, 0);
        matchOrderSkillSequence = Array(alreadyAllocated).fill(null);
        return;
    }

    for (const key of MATCH_ORDER_SKILLS) {
        const previousLevel = matchOrderLastSkillLevels.get(key) ?? 0;
        const currentLevel = currentLevels.get(key) ?? previousLevel;
        for (let level = previousLevel; level < currentLevel; level += 1) {
            matchOrderSkillSequence.push(key);
        }
    }
    matchOrderLastSkillLevels = currentLevels;
}

async function loadMatchOrderSkillIcons(championName) {
    if (matchOrderChampionName === championName && matchOrderChampionIconRequest) {
        return matchOrderChampionIconRequest;
    }
    matchOrderChampionName = championName;
    matchOrderChampionIconRequest = (async () => {
        const indexResponse = await fetch("/champions", { cache: "no-store" });
        if (!indexResponse.ok) {
            throw new Error(`champion index request failed: status ${indexResponse.status}`);
        }
        const indexResult = await indexResponse.json();
        const championIndex = indexResult?.data?.data;
        if (indexResult?.ok !== true || !championIndex || typeof championIndex !== "object") {
            throw new Error("champion index response has an invalid format");
        }
        const championEntry = Object.values(championIndex).find(champion =>
            champion?.name === championName || champion?.id === championName
        );
        if (!championEntry?.id) {
            throw new Error(`champion was not found: ${championName}`);
        }

        const championResponse = await fetch(
            `/champion/${encodeURIComponent(championEntry.id)}`,
            { cache: "no-store" }
        );
        if (!championResponse.ok) {
            throw new Error(`champion request failed: status ${championResponse.status}`);
        }
        const championResult = await championResponse.json();
        const champion = championResult?.data?.data?.[championEntry.id];
        if (championResult?.ok !== true || !Array.isArray(champion?.spells)) {
            throw new Error("champion skill response has an invalid format");
        }

        matchOrderSkillIcons = Object.fromEntries(
            champion.spells.slice(0, MATCH_ORDER_SKILLS.length)
                .map((spell, index) => [MATCH_ORDER_SKILLS[index], spell?.image?.full])
                .filter(([, icon]) => typeof icon === "string" && icon)
        );
        if (Object.keys(matchOrderSkillIcons).length === 0) {
            throw new Error("champion skill icons were not available");
        }
        renderMatchOrder();
    })();
    return matchOrderChampionIconRequest;
}

function createMatchOrderHeading(text) {
    const heading = document.createElement("h2");
    heading.className = "match-order-heading";
    heading.textContent = text;
    return heading;
}

function createMatchOrderSkillLabel(key) {
    const label = document.createElement("span");
    label.className = "match-order-skill-icon match-order-skill-label";
    label.textContent = key;
    return label;
}

function createMatchOrderSkillBoard() {
    const board = document.createElement("div");
    board.className = "match-order-skill-board";
    const ranks = 18;

    for (const key of MATCH_ORDER_SKILLS) {
        const row = document.createElement("div");
        row.className = "match-order-skill-row";

        const icon = matchOrderSkillIcons[key];
        if (icon) {
            const image = document.createElement("img");
            image.className = "match-order-skill-icon";
            image.src = `../assets/spell/${encodeURIComponent(icon)}`;
            image.alt = key;
            image.onerror = () => {
                image.onerror = null;
                row.replaceChild(createMatchOrderSkillLabel(key), image);
            };
            row.appendChild(image);
        } else {
            row.appendChild(createMatchOrderSkillLabel(key));
        }

        for (let index = 0; index < ranks; index += 1) {
            const cell = document.createElement("span");
            cell.className = "match-order-skill-cell";
            if (matchOrderSkillSequence[index] === key) {
                cell.classList.add("match-order-skill-learned");
                cell.textContent = String(index + 1);
            }
            row.appendChild(cell);
        }
        board.appendChild(row);
    }
    return board;
}

function createMatchOrderItems() {
    const timeline = document.createElement("div");
    timeline.className = "match-order-items";
    const purchasesByMinute = new Map();
    for (const purchase of matchOrderPurchases) {
        const minute = Math.floor(purchase.time / 60);
        if (!purchasesByMinute.has(minute)) purchasesByMinute.set(minute, []);
        purchasesByMinute.get(minute).push(purchase);
    }

    for (const [minute, purchases] of purchasesByMinute) {
        const group = document.createElement("div");
        group.className = "match-order-item-group";
        const icons = document.createElement("div");
        icons.className = "match-order-item-icons";

        for (const purchase of purchases) {
            const image = document.createElement("img");
            image.className = "match-order-item-icon";
            image.src = `../assets/items/${purchase.itemId}.png`;
            image.alt = String(purchase.itemId);
            image.title = String(purchase.itemId);
            image.onerror = () => {
                image.hidden = true;
            };
            icons.appendChild(image);
        }
        const timeLabel = document.createElement("span");
        timeLabel.className = "match-order-item-time";
        timeLabel.textContent = `${minute} min`;
        group.append(icons, timeLabel);
        timeline.appendChild(group);
    }

    if (purchasesByMinute.size === 0) {
        const empty = document.createElement("p");
        empty.className = "match-order-empty";
        empty.textContent = "アイテム購入データがありません";
        timeline.appendChild(empty);
    }
    return timeline;
}

function renderMatchOrder() {
    if (!matchOrderEnded) {
        matchOrderWidget.hidden = true;
        return;
    }
    const signature = JSON.stringify([
        matchOrderSkillSequence,
        matchOrderPurchases,
        matchOrderSkillIcons,
        matchOrderMissingInitialItems
    ]);
    if (!matchOrderWidget.hidden && signature === matchOrderRenderedSignature) return;

    const skillSection = document.createElement("section");
    skillSection.className = "match-order-section";
    skillSection.appendChild(createMatchOrderHeading("Skill Order"));
    if (matchOrderSkillSequence.includes(null)) {
        const note = document.createElement("p");
        note.className = "match-order-note";
        note.textContent = "取得開始前のスキル順は不明です";
        skillSection.appendChild(note);
    }
    skillSection.appendChild(createMatchOrderSkillBoard());

    const itemSection = document.createElement("section");
    itemSection.className = "match-order-section match-order-items-section";
    itemSection.appendChild(createMatchOrderHeading("Items"));
    if (matchOrderMissingInitialItems) {
        const note = document.createElement("p");
        note.className = "match-order-note";
        note.textContent = "取得開始前に所持していたアイテムは表示されません";
        itemSection.appendChild(note);
    }
    itemSection.appendChild(createMatchOrderItems());

    matchOrderWidget.replaceChildren(skillSection, itemSection);
    matchOrderWidget.hidden = false;
    matchOrderRenderedSignature = signature;
}

function hideMatchOrder() {
    if (matchOrderWidget.hidden) return;
    matchOrderWidget.hidden = true;
    matchOrderWidget.replaceChildren();
    matchOrderRenderedSignature = null;
}

function handleMatchOrderUnavailable(error) {
    matchOrderUnavailableCount += 1;
    if (error && matchOrderUnavailableCount === 1) {
        console.error("failed to fetch match order game data", error);
    }
    if (matchOrderUnavailableCount >= MATCH_ORDER_UNAVAILABLE_LIMIT) {
        hideMatchOrder();
        matchOrderStarted = false;
        matchOrderEnded = false;
        matchOrderStartEventId = null;
    }
}

async function updateMatchOrder() {
    if (matchOrderUpdateInProgress) return;
    matchOrderUpdateInProgress = true;

    try {
        let result;
        try {
            result = await fetchLiveGameData();
        } catch (error) {
            handleMatchOrderUnavailable(error);
            return;
        }
        const data = result?.data;
        const events = data?.events?.Events;
        if (result?.ok !== true || !Array.isArray(events)) {
            handleMatchOrderUnavailable(new Error(
                result?.error ?? "game data response has an invalid format"
            ));
            return;
        }
        matchOrderUnavailableCount = 0;

        if (!isAllowedGameMode(data, MATCH_ORDER_ALLOWED_GAME_MODES)) {
            hideMatchOrder();
            matchOrderStarted = false;
            matchOrderEnded = false;
            matchOrderStartEventId = null;
            return;
        }

        const gameStart = findGameEvent(events, "GameStart");
        if (gameStart) {
            const startEventId = String(gameStart.EventID ?? gameStart.EventTime ?? "GameStart");
            if (!matchOrderStarted || matchOrderStartEventId !== startEventId) {
                resetMatchOrder(startEventId);
            }
        }
        if (!matchOrderStarted) return;

        const players = Array.isArray(data.allPlayers) ? data.allPlayers : [];
        const player = findMatchOrderPlayer(data, players);
        const gameTime = getGameTime(data);
        if (Number.isFinite(gameTime)) matchOrderLastGameTime = gameTime;
        recordMatchOrderInventory(player?.items, matchOrderLastGameTime);
        const championName = String(data.activePlayer?.championName ?? "").trim();
        if (championName && matchOrderChampionName !== championName) {
            loadMatchOrderSkillIcons(championName).catch(error =>
                console.error("failed to load match order skill icons", error)
            );
        }

        recordMatchOrderSkills(data.activePlayer?.abilities);
        if (isGameEnded(data)) {
            matchOrderEnded = true;
        }
        renderMatchOrder();
    } catch (error) {
        console.error("failed to update match order overlay", error);
    } finally {
        matchOrderUpdateInProgress = false;
    }
}

updateMatchOrder();
window.setInterval(updateMatchOrder, MATCH_ORDER_POLL_INTERVAL);
