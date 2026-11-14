const PLAYER_RUNES_GAME_DATA_URL = "/allgamedata";
const PLAYER_RUNES_METADATA_URL = "/runes";
const PLAYER_RUNES_DISPLAY_DURATION = 10000;
const PLAYER_RUNE_STAT_SHARDS = {
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
const PLAYER_RUNE_STAT_SHARDS_BY_DESCRIPTION = {
    StatModHealthScaling: PLAYER_RUNE_STAT_SHARDS[5001],
    StatModHealth: {
        name: "体力",
        icon: "StatModsHealthScalingIcon.png"
    }
};

const playerRunesCanvas = document.getElementById("overlay-canvas");
let playerRunesPollTimer = null;
let playerRunesUpdateInProgress = false;
let playerRunesShown = false;

function createPlayerRuneImage(iconPath, name, className = "") {
    const image = document.createElement("img");
    image.className = className;
    image.src = `../assets/${iconPath}`;
    image.alt = name;
    image.title = name;
    return image;
}

function createPlayerRuneSection(title, tree, runes, runeMetadata, keystone = null) {
    const section = document.createElement("section");
    section.className = "player-runes-section";

    const heading = document.createElement("h2");
    heading.className = "player-runes-heading";
    if (tree?.icon) {
        heading.appendChild(createPlayerRuneImage(tree.icon, tree.displayName, "player-runes-tree-icon"));
    }
    const headingText = document.createElement("span");
    headingText.textContent = `${title}ルーン - ${tree?.displayName ?? "ルーン"}`;
    heading.appendChild(headingText);
    section.appendChild(heading);

    const runeList = document.createElement("div");
    runeList.className = "player-runes-list";
    if (keystone) {
        const metadata = runeMetadata.get(Number(keystone.id));
        const item = document.createElement("div");
        item.className = "player-runes-item player-runes-keystone";
        const name = keystone.displayName ?? metadata?.name ?? `Rune ${keystone.id}`;
        if (metadata?.icon) {
            item.appendChild(createPlayerRuneImage(
                metadata.icon,
                name,
                "player-runes-keystone-icon"
            ));
        }
        const label = document.createElement("span");
        label.textContent = name;
        item.appendChild(label);
        runeList.appendChild(item);
    }

    for (const rune of runes) {
        const metadata = runeMetadata.get(Number(rune.id));
        if (keystone && Number(rune.id) === Number(keystone.id)) continue;

        const item = document.createElement("div");
        item.className = "player-runes-item";
        const name = rune.displayName ?? metadata?.name ?? `Rune ${rune.id}`;

        if (metadata?.icon) {
            item.appendChild(createPlayerRuneImage(metadata.icon, name, "player-runes-icon"));
        }
        const label = document.createElement("span");
        label.textContent = name;
        item.appendChild(label);
        runeList.appendChild(item);
    }
    section.appendChild(runeList);
    return section;
}

function createPlayerRuneShardsSection(statRunes) {
    const section = document.createElement("section");
    section.className = "player-runes-shards";

    const shardList = document.createElement("div");
    shardList.className = "player-runes-shard-list";
    for (const shard of statRunes) {
        const description = String(shard.rawDescription ?? "").replace(/^perk_tooltip_/, "");
        const metadata = PLAYER_RUNE_STAT_SHARDS_BY_DESCRIPTION[description] ??
            PLAYER_RUNE_STAT_SHARDS[Number(shard.id)];
        const item = document.createElement("div");
        item.className = "player-runes-item";

        if (metadata) {
            item.appendChild(createPlayerRuneImage(
                `perk-images/StatMods/${metadata.icon}`,
                metadata.name,
                "player-runes-icon"
            ));
        }
        const label = document.createElement("span");
        label.textContent = metadata?.name ?? shard.rawDescription ?? `Shard ${shard.id}`;
        item.appendChild(label);
        shardList.appendChild(item);
    }

    section.appendChild(shardList);
    return section;
}

function renderPlayerRunes(activePlayer, fullRunes, runeMetadata, runeTrees) {
    playerRunesCanvas.replaceChildren();

    const card = document.createElement("div");
    card.className = "player-runes-card";

    if (activePlayer.championName) {
        const title = document.createElement("h1");
        title.className = "player-runes-title";
        title.textContent = activePlayer.championName;
        card.appendChild(title);
    }

    const primaryTree = fullRunes.primaryRuneTree;
    const secondaryTree = fullRunes.secondaryRuneTree;
    const generalRunes = Array.isArray(fullRunes.generalRunes) ? fullRunes.generalRunes : [];
    const primaryRunes = [];
    const secondaryRunes = [];

    for (const rune of generalRunes) {
        const metadata = runeMetadata.get(Number(rune.id));
        if (metadata?.treeId === Number(primaryTree?.id)) {
            primaryRunes.push(rune);
        } else if (metadata?.treeId === Number(secondaryTree?.id)) {
            secondaryRunes.push(rune);
        }
    }

    const keystone = fullRunes.keystone;
    const layout = document.createElement("div");
    layout.className = "player-runes-layout";

    const runeGroupHeading = document.createElement("h2");
    runeGroupHeading.className = "player-runes-group-heading";
    runeGroupHeading.textContent = "ルーン";
    layout.appendChild(runeGroupHeading);

    const shardGroupHeading = document.createElement("h2");
    shardGroupHeading.className = "player-runes-group-heading";
    shardGroupHeading.textContent = "シャード";
    layout.appendChild(shardGroupHeading);

    layout.appendChild(createPlayerRuneSection(
        "メイン",
        { ...primaryTree, icon: runeTrees.get(Number(primaryTree?.id))?.icon },
        primaryRunes,
        runeMetadata,
        keystone
    ));
    layout.appendChild(createPlayerRuneSection(
        "サブ",
        { ...secondaryTree, icon: runeTrees.get(Number(secondaryTree?.id))?.icon },
        secondaryRunes,
        runeMetadata
    ));
    if (Array.isArray(fullRunes.statRunes) && fullRunes.statRunes.length > 0) {
        layout.appendChild(createPlayerRuneShardsSection(fullRunes.statRunes));
    }
    card.appendChild(layout);

    playerRunesCanvas.appendChild(card);
    playerRunesCanvas.hidden = false;
    window.setTimeout(() => {
        playerRunesCanvas.hidden = true;
    }, PLAYER_RUNES_DISPLAY_DURATION);
}

async function loadPlayerRuneMetadata() {
    const response = await fetch(PLAYER_RUNES_METADATA_URL, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`rune metadata request failed: status ${response.status}`);
    }

    const result = await response.json();
    if (!Array.isArray(result?.data)) {
        throw new Error("rune metadata response has an invalid format");
    }

    const runeMetadata = new Map();
    const runeTrees = new Map();
    for (const tree of result.data) {
        runeTrees.set(Number(tree.id), tree);
        for (const slot of tree.slots ?? []) {
            for (const rune of slot.runes ?? []) {
                runeMetadata.set(Number(rune.id), { ...rune, treeId: Number(tree.id) });
            }
        }
    }
    return { runeMetadata, runeTrees };
}

async function updatePlayerRunes() {
    if (playerRunesUpdateInProgress || playerRunesShown) return;
    playerRunesUpdateInProgress = true;

    try {
        const response = await fetch(PLAYER_RUNES_GAME_DATA_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`game data request failed: status ${response.status}`);
        }

        const result = await response.json();
        const data = result?.data;
        const events = data?.events?.Events;
        if (result?.ok !== true || !Array.isArray(events) ||
            !events.some(event => event?.EventName === "GameStart")) {
            return;
        }

        const activePlayer = data.activePlayer;
        const fullRunes = activePlayer?.fullRunes;
        if (!activePlayer || !Array.isArray(fullRunes?.generalRunes) ||
            !fullRunes.primaryRuneTree || !fullRunes.secondaryRuneTree) {
            return;
        }

        const { runeMetadata, runeTrees } = await loadPlayerRuneMetadata();
        renderPlayerRunes(activePlayer, fullRunes, runeMetadata, runeTrees);
        playerRunesShown = true;
        window.clearInterval(playerRunesPollTimer);
        playerRunesPollTimer = null;
    } catch (error) {
        console.error("failed to update player runes overlay", error);
    } finally {
        playerRunesUpdateInProgress = false;
    }
}

playerRunesCanvas.hidden = true;
updatePlayerRunes();
playerRunesPollTimer = window.setInterval(updatePlayerRunes, 1000);
