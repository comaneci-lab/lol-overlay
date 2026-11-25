const POST_GAME_THUMBNAIL_URL = "/allgamedata";
const POST_GAME_THUMBNAIL_ALLOWED_GAME_MODES = ["CLASSIC", "PRACTICETOOL", "SPECTATOR", "ARAM"];
const POST_GAME_THUMBNAIL_POLL_INTERVAL = 1000;
const POST_GAME_THUMBNAIL_UNAVAILABLE_LIMIT = 3;
const POST_GAME_THUMBNAIL_SKILLS = ["Q", "W", "E", "R"];
const POST_GAME_THUMBNAIL_ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const POST_GAME_THUMBNAIL_SKIN_PREFIXES = [
    "game_character_skin_displayname_",
    "game_character_displayname_"
];
const POST_GAME_THUMBNAIL_STAT_SHARDS = {
    5001: { name: "体力自動増加", icon: "StatModsHealthScalingIcon.png" },
    5002: { name: "物理防御", icon: "StatModsArmorIcon.png" },
    5003: { name: "魔法防御", icon: "StatModsMagicResIcon.png" },
    5005: { name: "攻撃速度", icon: "StatModsAttackSpeedIcon.png" },
    5007: { name: "スキルヘイスト", icon: "StatModsCDRScalingIcon.png" },
    5008: { name: "アダプティブフォース", icon: "StatModsAdaptiveForceIcon.png" },
    5010: { name: "移動速度", icon: "StatModsMovementSpeedIcon.png" },
    5011: { name: "体力", icon: "StatModsHealthPlusIcon.png" },
    5013: { name: "行動妨害耐性", icon: "StatModsTenacityIcon.png" }
};
const POST_GAME_THUMBNAIL_SHARDS_BY_DESCRIPTION = {
    StatModHealthScaling: POST_GAME_THUMBNAIL_STAT_SHARDS[5001],
    StatModHealth: {
        name: "体力",
        icon: "StatModsHealthScalingIcon.png"
    }
};

const postGameThumbnailCanvas = document.getElementById("overlay-canvas");
const postGameThumbnailWidget = document.createElement("main");
postGameThumbnailWidget.className = "post-game-thumbnail";
postGameThumbnailWidget.hidden = true;
postGameThumbnailCanvas.appendChild(postGameThumbnailWidget);

let postGameThumbnailStarted = false;
let postGameThumbnailEnded = false;
let postGameThumbnailStartEventId = null;
let postGameThumbnailLastSkillLevels = null;
let postGameThumbnailSkillSequence = [];
let postGameThumbnailPurchases = [];
let postGameThumbnailLastItemCounts = null;
let postGameThumbnailMissingInitialItems = false;
let postGameThumbnailLastGameTime = null;
let postGameThumbnailSkillIcons = {};
let postGameThumbnailChampionName = null;
let postGameThumbnailChampionIconRequest = null;
let postGameThumbnailActivePlayer = null;
let postGameThumbnailRosterPlayer = null;
let postGameThumbnailOpponent = null;
let postGameThumbnailFullRunes = null;
let postGameThumbnailStatRunes = [];
let postGameThumbnailRuneMetadata = null;
let postGameThumbnailRuneMetadataRequest = null;
let postGameThumbnailRuneMetadataRetryAt = 0;
let postGameThumbnailUnavailableCount = 0;
let postGameThumbnailUpdateInProgress = false;
let postGameThumbnailHeader = null;
let postGameThumbnailSummary = null;

function resetPostGameThumbnail(startEventId = null) {
    postGameThumbnailStarted = startEventId !== null;
    postGameThumbnailEnded = false;
    postGameThumbnailStartEventId = startEventId;
    postGameThumbnailLastSkillLevels = null;
    postGameThumbnailSkillSequence = [];
    postGameThumbnailPurchases = [];
    postGameThumbnailLastItemCounts = null;
    postGameThumbnailMissingInitialItems = false;
    postGameThumbnailLastGameTime = null;
    postGameThumbnailSkillIcons = {};
    postGameThumbnailChampionName = null;
    postGameThumbnailChampionIconRequest = null;
    postGameThumbnailActivePlayer = null;
    postGameThumbnailRosterPlayer = null;
    postGameThumbnailOpponent = null;
    postGameThumbnailFullRunes = null;
    postGameThumbnailStatRunes = [];
    postGameThumbnailHeader = null;
    postGameThumbnailSummary = null;
    postGameThumbnailWidget.hidden = true;
    postGameThumbnailWidget.replaceChildren();
}

function normalizePostGameThumbnailIdentity(identity) {
    if (typeof identity !== "string" || !identity.trim()) return [];
    const normalized = identity.trim().toLowerCase();
    return [normalized, normalized.split("#", 1)[0]];
}

function findPostGameThumbnailPlayer(activePlayer, players) {
    const identities = new Set([
        activePlayer?.riotIdGameName,
        activePlayer?.summonerName,
        activePlayer?.riotId
    ].flatMap(normalizePostGameThumbnailIdentity));
    const activeTeam = String(activePlayer?.team ?? "").toUpperCase();
    const activeChampion = String(activePlayer?.championName ?? "").trim().toLowerCase();

    let matchedPlayer = players.find(player => {
        const playerIdentities = [
            player?.riotIdGameName,
            player?.summonerName,
            player?.riotId
        ].flatMap(normalizePostGameThumbnailIdentity);
        return playerIdentities.some(identity => identities.has(identity));
    });
    if (!matchedPlayer && activeTeam && activeChampion) {
        matchedPlayer = players.find(player =>
            String(player?.team ?? "").toUpperCase() === activeTeam &&
            String(player?.championName ?? "").trim().toLowerCase() === activeChampion
        );
    }
    return matchedPlayer ?? null;
}

function normalizePostGameThumbnailRole(position) {
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

function getPostGameThumbnailMatchup(players, activePlayer, rosterPlayer) {
    const teams = new Map(["ORDER", "CHAOS"].map(team => [
        team,
        { players: [], roles: new Map() }
    ]));
    for (const player of players) {
        const team = teams.get(String(player?.team ?? "").toUpperCase());
        if (team) team.players.push(player);
    }

    const assignedRoles = new Map();
    for (const team of teams.values()) {
        for (const player of team.players) {
            const role = normalizePostGameThumbnailRole(player?.position);
            if (role && !team.roles.has(role)) {
                team.roles.set(role, player);
                assignedRoles.set(player, role);
            }
        }
        const assignedPlayers = new Set(team.roles.values());
        for (const role of POST_GAME_THUMBNAIL_ROLES) {
            if (team.roles.has(role)) continue;
            const player = team.players.find(candidate => !assignedPlayers.has(candidate));
            if (!player) continue;
            team.roles.set(role, player);
            assignedPlayers.add(player);
            assignedRoles.set(player, role);
        }
    }

    const activeTeamName = String(activePlayer?.team ?? rosterPlayer?.team ?? "").toUpperCase();
    const opponentTeam = teams.get(activeTeamName === "ORDER" ? "CHAOS" : "ORDER");
    const role = assignedRoles.get(rosterPlayer) ??
        normalizePostGameThumbnailRole(rosterPlayer?.position ?? activePlayer?.position);
    return {
        role,
        opponent: role ? opponentTeam?.roles.get(role) ?? null : null
    };
}

function getPostGameThumbnailItemCounts(items) {
    const counts = new Map();
    if (!Array.isArray(items)) return counts;
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

function recordPostGameThumbnailInventory(items, gameTime) {
    if (!Array.isArray(items)) return;
    const currentCounts = getPostGameThumbnailItemCounts(items);
    if (postGameThumbnailLastItemCounts === null) {
        postGameThumbnailLastItemCounts = currentCounts;
        postGameThumbnailMissingInitialItems = [...currentCounts.values()]
            .some(count => count > 0);
        return;
    }
    if (!Number.isFinite(gameTime)) return;
    for (const [itemId, count] of currentCounts) {
        const previousCount = postGameThumbnailLastItemCounts.get(itemId) ?? 0;
        for (let added = previousCount; added < count; added += 1) {
            postGameThumbnailPurchases.push({ itemId, time: gameTime });
        }
    }
    postGameThumbnailLastItemCounts = currentCounts;
}

function recordPostGameThumbnailSkills(abilities) {
    const currentLevels = new Map();
    for (const key of POST_GAME_THUMBNAIL_SKILLS) {
        const level = Number(abilities?.[key]?.abilityLevel);
        if (Number.isInteger(level) && level >= 0) currentLevels.set(key, level);
    }
    if (currentLevels.size === 0) return;
    if (postGameThumbnailLastSkillLevels === null) {
        postGameThumbnailLastSkillLevels = currentLevels;
        const alreadyAllocated = [...currentLevels.values()]
            .reduce((total, level) => total + level, 0);
        postGameThumbnailSkillSequence = Array(alreadyAllocated).fill(null);
        return;
    }
    for (const key of POST_GAME_THUMBNAIL_SKILLS) {
        const previousLevel = postGameThumbnailLastSkillLevels.get(key) ?? 0;
        const currentLevel = currentLevels.get(key) ?? previousLevel;
        for (let level = previousLevel; level < currentLevel; level += 1) {
            postGameThumbnailSkillSequence.push(key);
        }
    }
    postGameThumbnailLastSkillLevels = currentLevels;
}

async function loadPostGameThumbnailSkillIcons(championName) {
    if (postGameThumbnailChampionName === championName &&
        postGameThumbnailChampionIconRequest) {
        return postGameThumbnailChampionIconRequest;
    }
    postGameThumbnailChampionName = championName;
    postGameThumbnailChampionIconRequest = (async () => {
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
        postGameThumbnailSkillIcons = Object.fromEntries(
            champion.spells.slice(0, POST_GAME_THUMBNAIL_SKILLS.length)
                .map((spell, index) => [
                    POST_GAME_THUMBNAIL_SKILLS[index],
                    spell?.image?.full
                ])
                .filter(([, icon]) => typeof icon === "string" && icon)
        );
        if (Object.keys(postGameThumbnailSkillIcons).length === 0) {
            throw new Error("champion skill icons were not available");
        }
        renderPostGameThumbnail();
    })();
    return postGameThumbnailChampionIconRequest;
}

function getPostGameThumbnailSkinName(player) {
    const rawSkinName = player?.rawSkinName;
    if (typeof rawSkinName !== "string") return null;
    const prefix = POST_GAME_THUMBNAIL_SKIN_PREFIXES.find(candidate =>
        rawSkinName.startsWith(candidate)
    );
    if (!prefix) return null;
    let skinName = rawSkinName.slice(prefix.length);
    if (!/_\d+$/.test(skinName)) skinName += "_0";
    return /^[A-Za-z0-9_]+$/.test(skinName) ? skinName : null;
}

function createPostGameThumbnailPlayer(side) {
    const panel = document.createElement("section");
    panel.className = `post-game-player post-game-player-${side}`;
    const image = document.createElement("img");
    image.className = "post-game-player-image";
    image.hidden = true;
    const details = document.createElement("div");
    details.className = "post-game-player-details";
    const kda = document.createElement("strong");
    kda.className = "post-game-player-kda";
    details.appendChild(kda);
    panel.append(image, details);
    return { side, panel, image, kda, skinName: undefined };
}

function updatePostGameThumbnailPlayer(state, player) {
    const { side, image, kda } = state;
    image.alt = player?.championName ?? side;
    const skinName = getPostGameThumbnailSkinName(player);
    if (state.skinName !== skinName) {
        state.skinName = skinName;
        image.hidden = true;
        image.onload = null;
        image.onerror = null;
        const loadSkin = name => {
            image.onerror = () => {
                image.onerror = null;
                const defaultSkinName = `${name.replace(/_\d+$/, "")}_0`;
                if (defaultSkinName !== name) {
                    loadSkin(defaultSkinName);
                    return;
                }
                image.hidden = true;
                console.error("failed to load post-game thumbnail splash art", {
                    side,
                    splashArtName: `${name}.jpg`
                });
            };
            image.onload = () => {
                image.hidden = false;
                image.onload = null;
                image.onerror = null;
            };
            image.src = `../assets/centered/${name}.jpg`;
        };
        if (skinName) {
            loadSkin(skinName);
        } else {
            image.removeAttribute("src");
        }
    }
    const scores = player?.scores;
    const values = [scores?.kills, scores?.deaths, scores?.assists].map(value =>
        Number.isInteger(value) && value >= 0 ? value : "-"
    );
    kda.textContent = `KDA：${values.join("/")}`;
}

async function loadPostGameThumbnailRuneMetadata() {
    if (postGameThumbnailRuneMetadata || postGameThumbnailRuneMetadataRequest ||
        Date.now() < postGameThumbnailRuneMetadataRetryAt) return;
    postGameThumbnailRuneMetadataRequest = (async () => {
        const response = await fetch("/runes", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`rune metadata request failed: status ${response.status}`);
        }
        const result = await response.json();
        if (result?.ok !== true || !Array.isArray(result.data)) {
            throw new Error("rune metadata response has an invalid format");
        }
        const runes = new Map();
        for (const tree of result.data) {
            for (const slot of tree.slots ?? []) {
                for (const rune of slot.runes ?? []) {
                    runes.set(Number(rune.id), { ...rune, treeId: Number(tree.id) });
                }
            }
        }
        postGameThumbnailRuneMetadata = runes;
        renderPostGameThumbnail();
    })();
    try {
        await postGameThumbnailRuneMetadataRequest;
    } catch (error) {
        postGameThumbnailRuneMetadataRetryAt = Date.now() + 10000;
        console.error("failed to load post-game thumbnail rune metadata", error);
    } finally {
        postGameThumbnailRuneMetadataRequest = null;
    }
}

function createPostGameThumbnailRuneItem(rune) {
    const metadata = postGameThumbnailRuneMetadata?.get(Number(rune.id));
    const name = rune.displayName ?? metadata?.name ?? `Rune ${rune.id}`;
    const item = document.createElement("div");
    item.className = "post-game-rune";
    if (metadata?.icon) {
        const image = document.createElement("img");
        image.src = `../assets/${metadata.icon}`;
        image.alt = name;
        image.title = name;
        item.appendChild(image);
    }
    const label = document.createElement("span");
    label.textContent = name;
    item.appendChild(label);
    return item;
}

function createPostGameThumbnailRunes() {
    const section = document.createElement("section");
    section.className = "post-game-section post-game-runes-section";
    const heading = document.createElement("h2");
    heading.textContent = "ルーン・シャード";
    section.appendChild(heading);

    const fullRunes = postGameThumbnailFullRunes;
    const generalRunes = Array.isArray(fullRunes?.generalRunes) ? fullRunes.generalRunes : [];
    const keystone = fullRunes?.keystone;
    const runes = keystone
        ? [keystone, ...generalRunes.filter(rune => Number(rune.id) !== Number(keystone.id))]
        : generalRunes;
    const groups = [
        { name: "メイン", id: Number(fullRunes?.primaryRuneTree?.id), runes: [] },
        { name: "サブ", id: Number(fullRunes?.secondaryRuneTree?.id), runes: [] }
    ];
    const unclassified = [];
    for (const rune of runes) {
        const metadata = postGameThumbnailRuneMetadata?.get(Number(rune.id));
        const group = groups.find(candidate => candidate.id === metadata?.treeId);
        if (group) {
            group.runes.push(rune);
        } else if (keystone && Number(rune.id) === Number(keystone.id)) {
            groups[0].runes.push(rune);
        } else {
            unclassified.push(rune);
        }
    }
    if (unclassified.length) groups.push({ name: "ルーン", runes: unclassified });

    for (const group of groups) {
        if (!group.runes.length) continue;
        const row = document.createElement("div");
        row.className = "post-game-rune-row";
        const label = document.createElement("span");
        label.className = "post-game-rune-group-label";
        label.textContent = group.name;
        row.appendChild(label);
        const list = document.createElement("div");
        list.className = "post-game-rune-list";
        for (const rune of group.runes) list.appendChild(createPostGameThumbnailRuneItem(rune));
        row.appendChild(list);
        section.appendChild(row);
    }
    if (runes.length === 0) {
        const empty = document.createElement("p");
        empty.className = "post-game-empty";
        empty.textContent = "ルーン情報を取得できませんでした";
        section.appendChild(empty);
    }
    section.appendChild(createPostGameThumbnailShards());
    return section;
}

function createPostGameThumbnailShards() {
    const section = document.createElement("div");
    section.className = "post-game-rune-row post-game-shards-section";
    const heading = document.createElement("span");
    heading.className = "post-game-rune-group-label";
    heading.textContent = "シャード";
    section.appendChild(heading);
    const list = document.createElement("div");
    list.className = "post-game-shards";
    for (const shard of postGameThumbnailStatRunes) {
        const description = String(shard?.rawDescription ?? "").replace(/^perk_tooltip_/, "");
        const metadata = POST_GAME_THUMBNAIL_SHARDS_BY_DESCRIPTION[description] ??
            POST_GAME_THUMBNAIL_STAT_SHARDS[Number(shard?.id)];
        const item = document.createElement("div");
        item.className = "post-game-shard";
        if (metadata) {
            const image = document.createElement("img");
            image.src = `../assets/perk-images/StatMods/${metadata.icon}`;
            image.alt = metadata.name;
            item.appendChild(image);
        }
        const label = document.createElement("span");
        label.textContent = metadata?.name ?? shard?.rawDescription ?? `Shard ${shard?.id}`;
        item.appendChild(label);
        list.appendChild(item);
    }
    if (postGameThumbnailStatRunes.length === 0) {
        const empty = document.createElement("p");
        empty.className = "post-game-empty";
        empty.textContent = "シャード情報を取得できませんでした";
        list.appendChild(empty);
    }
    section.appendChild(list);
    return section;
}

function createPostGameThumbnailSkillBoard() {
    const board = document.createElement("div");
    board.className = "post-game-skill-board";
    for (const key of POST_GAME_THUMBNAIL_SKILLS) {
        const row = document.createElement("div");
        row.className = "post-game-skill-row";
        const iconName = postGameThumbnailSkillIcons[key];
        if (iconName) {
            const icon = document.createElement("img");
            icon.className = "post-game-skill-icon";
            icon.src = `../assets/spell/${encodeURIComponent(iconName)}`;
            icon.alt = key;
            row.appendChild(icon);
        } else {
            const label = document.createElement("span");
            label.className = "post-game-skill-icon post-game-skill-label";
            label.textContent = key;
            row.appendChild(label);
        }
        for (let index = 0; index < 18; index += 1) {
            const cell = document.createElement("span");
            cell.className = "post-game-skill-cell";
            if (postGameThumbnailSkillSequence[index] === key) {
                cell.classList.add("post-game-skill-learned");
                cell.textContent = String(index + 1);
            } else if (postGameThumbnailSkillSequence[index] === null) {
                cell.classList.add("post-game-skill-unknown");
            }
            row.appendChild(cell);
        }
        board.appendChild(row);
    }
    return board;
}

function createPostGameThumbnailItems() {
    const timeline = document.createElement("div");
    timeline.className = "post-game-items";
    const purchasesByMinute = new Map();
    for (const purchase of postGameThumbnailPurchases) {
        const minute = Math.floor(purchase.time / 60);
        if (!purchasesByMinute.has(minute)) purchasesByMinute.set(minute, []);
        purchasesByMinute.get(minute).push(purchase);
    }
    for (const [minute, purchases] of purchasesByMinute) {
        const group = document.createElement("div");
        group.className = "post-game-item-group";
        const icons = document.createElement("div");
        icons.className = "post-game-item-icons";
        for (const purchase of purchases) {
            const image = document.createElement("img");
            image.src = `../assets/items/${purchase.itemId}.png`;
            image.alt = String(purchase.itemId);
            image.title = String(purchase.itemId);
            image.onerror = () => {
                image.hidden = true;
            };
            icons.appendChild(image);
        }
        const label = document.createElement("span");
        label.textContent = `${minute}分`;
        group.append(icons, label);
        timeline.appendChild(group);
    }
    if (purchasesByMinute.size === 0) {
        const empty = document.createElement("p");
        empty.className = "post-game-empty";
        empty.textContent = "アイテム購入データがありません";
        timeline.appendChild(empty);
    }
    return timeline;
}

function renderPostGameThumbnail() {
    if (!postGameThumbnailEnded) return;
    if (!postGameThumbnailHeader) {
        const matchup = document.createElement("div");
        matchup.className = "post-game-matchup";
        const active = createPostGameThumbnailPlayer("active");
        const opponent = createPostGameThumbnailPlayer("opponent");
        const versus = document.createElement("span");
        versus.className = "post-game-versus";
        versus.textContent = "VS";
        matchup.append(active.panel, versus, opponent.panel);
        postGameThumbnailSummary = document.createElement("div");
        postGameThumbnailSummary.className = "post-game-summary";
        postGameThumbnailWidget.append(matchup, postGameThumbnailSummary);
        postGameThumbnailHeader = { active, opponent };
    }
    updatePostGameThumbnailPlayer(
        postGameThumbnailHeader.active,
        postGameThumbnailRosterPlayer
            ? { ...postGameThumbnailActivePlayer, ...postGameThumbnailRosterPlayer }
            : postGameThumbnailActivePlayer
    );
    updatePostGameThumbnailPlayer(postGameThumbnailHeader.opponent, postGameThumbnailOpponent);

    const runes = createPostGameThumbnailRunes();
    const orders = document.createElement("section");
    orders.className = "post-game-section post-game-orders-section";
    const skillHeading = document.createElement("h2");
    skillHeading.textContent = "スキルオーダー";
    orders.appendChild(skillHeading);
    if (postGameThumbnailSkillSequence.includes(null)) {
        const note = document.createElement("p");
        note.className = "post-game-note";
        note.textContent = "取得開始前のスキル順は不明です";
        orders.appendChild(note);
    }
    orders.appendChild(createPostGameThumbnailSkillBoard());
    const itemsHeading = document.createElement("h2");
    itemsHeading.textContent = "アイテムオーダー";
    orders.appendChild(itemsHeading);
    if (postGameThumbnailMissingInitialItems) {
        const note = document.createElement("p");
        note.className = "post-game-note";
        note.textContent = "取得開始前に所持していたアイテムは表示されません";
        orders.appendChild(note);
    }
    orders.appendChild(createPostGameThumbnailItems());
    postGameThumbnailSummary.replaceChildren(runes, orders);
    postGameThumbnailWidget.hidden = false;
}

function handlePostGameThumbnailUnavailable(error) {
    postGameThumbnailUnavailableCount += 1;
    if (error && postGameThumbnailUnavailableCount === 1) {
        console.error("failed to fetch post-game thumbnail game data", error);
    }
    if (postGameThumbnailUnavailableCount >= POST_GAME_THUMBNAIL_UNAVAILABLE_LIMIT) {
        resetPostGameThumbnail();
    }
}

async function updatePostGameThumbnail() {
    if (postGameThumbnailUpdateInProgress) return;
    postGameThumbnailUpdateInProgress = true;
    try {
        let response;
        try {
            response = await fetch(POST_GAME_THUMBNAIL_URL, { cache: "no-store" });
        } catch (error) {
            handlePostGameThumbnailUnavailable(error);
            return;
        }
        if (!response.ok) {
            handlePostGameThumbnailUnavailable(new Error(`status ${response.status}`));
            return;
        }
        let result;
        try {
            result = await response.json();
        } catch (error) {
            handlePostGameThumbnailUnavailable(error);
            return;
        }
        const data = result?.data;
        const events = data?.events?.Events;
        if (result?.ok !== true || !Array.isArray(events)) {
            handlePostGameThumbnailUnavailable(new Error(
                result?.error ?? "game data response has an invalid format"
            ));
            return;
        }
        postGameThumbnailUnavailableCount = 0;
        const gameMode = String(data?.gameData?.gameMode ?? "").trim().toUpperCase();
        if (!POST_GAME_THUMBNAIL_ALLOWED_GAME_MODES.includes(gameMode)) {
            resetPostGameThumbnail();
            return;
        }

        const gameStart = events.find(event => event?.EventName === "GameStart");
        if (gameStart) {
            const startEventId = String(gameStart.EventID ?? gameStart.EventTime ?? "GameStart");
            if (!postGameThumbnailStarted || postGameThumbnailStartEventId !== startEventId) {
                resetPostGameThumbnail(startEventId);
            }
        }
        if (!postGameThumbnailStarted) return;

        const players = Array.isArray(data.allPlayers) ? data.allPlayers : [];
        const activePlayer = data.activePlayer ?? {};
        const rosterPlayer = findPostGameThumbnailPlayer(activePlayer, players);
        const matchup = getPostGameThumbnailMatchup(players, activePlayer, rosterPlayer);
        postGameThumbnailActivePlayer = activePlayer;
        postGameThumbnailRosterPlayer = rosterPlayer;
        postGameThumbnailOpponent = matchup.opponent;
        const fullRunes = activePlayer.fullRunes ?? rosterPlayer?.fullRunes;
        if (Array.isArray(fullRunes?.generalRunes) && fullRunes.generalRunes.length > 0) {
            postGameThumbnailFullRunes = fullRunes;
            loadPostGameThumbnailRuneMetadata();
        }
        if (Array.isArray(fullRunes?.statRunes) && fullRunes.statRunes.length > 0) {
            postGameThumbnailStatRunes = fullRunes.statRunes;
        }

        const gameTime = Number(data?.gameData?.gameTime ?? data?.gameData?.gametime);
        if (Number.isFinite(gameTime)) postGameThumbnailLastGameTime = gameTime;
        recordPostGameThumbnailInventory(
            rosterPlayer?.items ?? activePlayer.items,
            postGameThumbnailLastGameTime
        );
        const championName = String(
            activePlayer.championName ?? rosterPlayer?.championName ?? ""
        ).trim();
        if (championName && postGameThumbnailChampionName !== championName) {
            loadPostGameThumbnailSkillIcons(championName).catch(error =>
                console.error("failed to load post-game thumbnail skill icons", error)
            );
        }
        recordPostGameThumbnailSkills(activePlayer.abilities);
        if (events.some(event => event?.EventName === "GameEnd")) {
            postGameThumbnailEnded = true;
        }
        renderPostGameThumbnail();
    } catch (error) {
        console.error("failed to update post-game thumbnail overlay", error);
    } finally {
        postGameThumbnailUpdateInProgress = false;
    }
}

updatePostGameThumbnail();
window.setInterval(updatePostGameThumbnail, POST_GAME_THUMBNAIL_POLL_INTERVAL);
