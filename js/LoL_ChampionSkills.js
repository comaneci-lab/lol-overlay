const CHAMPION_SKILLS_GAME_DATA_URL = "/allgamedata";
const CHAMPION_SKILLS_INDEX_URL = "/champions";
const CHAMPION_SKILLS_DATA_URL = "/champion";
const CHAMPION_SKILLS_DATA_DRAGON_VERSION = "16.22.1";
const CHAMPION_SKILLS_ROLES = [
    "TOP",
    "JUNGLE",
    "MIDDLE",
    "BOTTOM",
    "UTILITY"
];
const CHAMPION_SKILLS_TEAMS = ["ORDER", "CHAOS"];

const championSkillsCanvas = document.getElementById("overlay-canvas");
const championSkillsIndex = new Map();
const championSkillsData = new Map();
let championSkillsUpdateInProgress = false;
let championSkillsBoardRendered = false;
let championSkillsEndPollFailures = 0;

function normalizeChampionSkillsRole(position) {
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

function groupChampionSkillsPlayers(players) {
    const teams = Object.fromEntries(
        CHAMPION_SKILLS_TEAMS.map(team => [team, new Map()])
    );

    for (const team of CHAMPION_SKILLS_TEAMS) {
        const teamPlayers = players.filter(
            player => String(player?.team ?? "").toUpperCase() === team
        );
        const assignedPlayers = new Set();
        const rolePlayers = teams[team];

        for (const player of teamPlayers) {
            const role = normalizeChampionSkillsRole(player?.position);
            if (role && !rolePlayers.has(role)) {
                rolePlayers.set(role, player);
                assignedPlayers.add(player);
            }
        }

        for (const role of CHAMPION_SKILLS_ROLES) {
            if (rolePlayers.has(role)) continue;
            const player = teamPlayers.find(candidate => !assignedPlayers.has(candidate));
            if (!player) continue;
            rolePlayers.set(role, player);
            assignedPlayers.add(player);
        }
    }

    return teams;
}

async function loadChampionSkillsIndex() {
    const response = await fetch(CHAMPION_SKILLS_INDEX_URL, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`champion index request failed: status ${response.status}`);
    }

    const result = await response.json();
    const champions = result?.data?.data;
    if (result?.ok !== true || !champions || typeof champions !== "object") {
        throw new Error("champion index response has an invalid format");
    }

    for (const champion of Object.values(champions)) {
        if (!champion?.id) continue;
        championSkillsIndex.set(String(champion.id).toLowerCase(), champion.id);
        if (champion.name) {
            championSkillsIndex.set(String(champion.name).toLowerCase(), champion.id);
        }
    }
}

function resolveChampionSkillsId(championName) {
    const name = String(championName ?? "").trim();
    if (!name) return null;
    return championSkillsIndex.get(name.toLowerCase()) ??
        (/^[A-Za-z0-9]+$/.test(name) && name !== "Unknown" ? name : null);
}

async function loadChampionSkillsData(championId) {
    if (championSkillsData.has(championId)) {
        return championSkillsData.get(championId);
    }

    const dataPromise = (async () => {
        const response = await fetch(
            `${CHAMPION_SKILLS_DATA_URL}/${encodeURIComponent(championId)}`,
            { cache: "no-store" }
        );
        if (!response.ok) {
            throw new Error(`${championId} request failed: status ${response.status}`);
        }

        const result = await response.json();
        const champion = result?.data?.data?.[championId];
        if (result?.ok !== true || !champion) {
            throw new Error(`${championId} response has an invalid format`);
        }
        return champion;
    })()
        .then(champion => {
            championSkillsData.set(championId, champion);
            return champion;
        })
        .catch(error => {
            console.error("failed to load champion skills", error);
            championSkillsData.set(championId, null);
            return null;
        });

    championSkillsData.set(championId, dataPromise);
    return dataPromise;
}

function cleanChampionSkillText(text) {
    return String(text ?? "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/?[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
}

function createChampionSkillsImage(src, alt, className) {
    const image = document.createElement("img");
    image.className = className;
    image.src = src;
    image.alt = alt;
    image.loading = "lazy";
    return image;
}

function createChampionSkillItem(skill, key, iconUrl) {
    const item = document.createElement("li");
    item.className = "champion-skills-ability";

    item.appendChild(createChampionSkillsImage(
        iconUrl,
        skill.name ?? key,
        "champion-skills-ability-icon"
    ));

    const keyLabel = document.createElement("span");
    keyLabel.className = "champion-skills-ability-key";
    keyLabel.textContent = key;
    item.appendChild(keyLabel);

    const name = document.createElement("strong");
    name.className = "champion-skills-ability-name";
    name.append(document.createTextNode(skill.name ?? "スキル"));

    const cooldown = typeof skill.cooldownBurn === "string" && skill.cooldownBurn.trim()
        ? skill.cooldownBurn.trim()
        : Array.isArray(skill.cooldown)
            ? skill.cooldown.join("/")
            : "";
    if (cooldown) {
        const cooldownLabel = document.createElement("span");
        cooldownLabel.className = "champion-skills-ability-cooldown";
        cooldownLabel.textContent = `（${cooldown}）`;
        name.appendChild(cooldownLabel);
    }
    item.appendChild(name);

    const description = cleanChampionSkillText(skill.description || skill.tooltip);
    if (description) {
        const detail = document.createElement("p");
        detail.className = "champion-skills-ability-detail";
        detail.textContent = description;
        item.appendChild(detail);
    }

    return item;
}

function createChampionSkillsAbilities(champion) {
    const abilities = document.createElement("ol");
    abilities.className = "champion-skills-abilities";

    if (champion?.passive) {
        const icon = champion.passive.image?.full;
        if (icon) {
            abilities.appendChild(createChampionSkillItem(
                champion.passive,
                "P",
                `https://ddragon.leagueoflegends.com/cdn/${CHAMPION_SKILLS_DATA_DRAGON_VERSION}/img/passive/${encodeURIComponent(icon)}`
            ));
        }
    }

    for (const [index, spell] of (champion?.spells ?? []).entries()) {
        const key = ["Q", "W", "E", "R"][index] ?? String(index + 1);
        const icon = spell.image?.full;
        if (!icon) continue;
        abilities.appendChild(createChampionSkillItem(
            spell,
            key,
            `https://ddragon.leagueoflegends.com/cdn/${CHAMPION_SKILLS_DATA_DRAGON_VERSION}/img/spell/${encodeURIComponent(icon)}`
        ));
    }

    if (abilities.childElementCount === 0) {
        const unavailable = document.createElement("li");
        unavailable.className = "champion-skills-message";
        unavailable.textContent = "スキル情報を取得できません";
        abilities.appendChild(unavailable);
    }
    return abilities;
}

function createChampionSkillsPlayerCard(player) {
    const card = document.createElement("article");
    card.className = "champion-skills-player";

    if (!player) {
        card.classList.add("champion-skills-player-empty");
        card.textContent = "プレイヤー情報なし";
        return card;
    }

    const championId = resolveChampionSkillsId(player.championName);
    const champion = championId ? championSkillsData.get(championId) : null;
    const championData = champion instanceof Promise ? null : champion;
    const championName = championData?.name ?? player.championName ?? "不明";
    const identity = document.createElement("div");
    identity.className = "champion-skills-identity";

    if (championId) {
        const image = createChampionSkillsImage(
            `../assets/champion/${encodeURIComponent(championId)}.png`,
            championName,
            "champion-skills-champion-icon"
        );
        image.onerror = () => {
            image.onerror = null;
            image.src = `https://ddragon.leagueoflegends.com/cdn/${CHAMPION_SKILLS_DATA_DRAGON_VERSION}/img/champion/${encodeURIComponent(championId)}.png`;
        };
        identity.appendChild(image);
    }

    const name = document.createElement("strong");
    name.className = "champion-skills-champion-name";
    name.textContent = championName;
    identity.appendChild(name);
    card.appendChild(identity);

    if (championData) {
        card.appendChild(createChampionSkillsAbilities(championData));
    } else {
        const message = document.createElement("p");
        message.className = "champion-skills-message";
        const requestFailed = championId && championSkillsData.has(championId) && champion === null;
        message.textContent = !championId
            ? "チャンピオン情報なし"
            : requestFailed
                ? "スキル情報を取得できません"
                : "スキル情報を読み込み中...";
        card.appendChild(message);
    }
    return card;
}

function renderChampionSkillsBoard(teams) {
    championSkillsCanvas.replaceChildren();
    championSkillsCanvas.classList.remove("champion-skills-unavailable");

    const board = document.createElement("main");
    board.className = "champion-skills-board";

    const descriptionToggle = document.createElement("button");
    descriptionToggle.className = "champion-skills-description-toggle";
    descriptionToggle.type = "button";
    descriptionToggle.textContent = "スキル説明を表示";
    descriptionToggle.setAttribute("aria-expanded", "false");
    descriptionToggle.addEventListener("click", () => {
        const descriptionsVisible = board.classList.toggle(
            "champion-skills-descriptions-visible"
        );
        descriptionToggle.textContent = descriptionsVisible
            ? "スキル説明を隠す"
            : "スキル説明を表示";
        descriptionToggle.setAttribute("aria-expanded", String(descriptionsVisible));
    });
    board.appendChild(descriptionToggle);

    for (const role of CHAMPION_SKILLS_ROLES) {
        for (const team of CHAMPION_SKILLS_TEAMS) {
            const card = createChampionSkillsPlayerCard(teams[team].get(role));
            card.classList.add(`champion-skills-player-${team.toLowerCase()}`);
            board.appendChild(card);
        }
    }

    championSkillsCanvas.appendChild(board);
}

function handleChampionSkillsGameEnded() {
    championSkillsBoardRendered = false;
    championSkillsEndPollFailures = 0;
    showChampionSkillsMessage("試合データを待っています");
}

function handleChampionSkillsGameUnavailable() {
    if (!championSkillsBoardRendered) return;

    championSkillsEndPollFailures += 1;
    if (championSkillsEndPollFailures >= 3) {
        handleChampionSkillsGameEnded();
    }
}

function showChampionSkillsMessage(message, isError = false) {
    championSkillsCanvas.replaceChildren();
    championSkillsCanvas.classList.toggle("champion-skills-unavailable", isError);
    const status = document.createElement("p");
    status.className = "champion-skills-status";
    status.textContent = message;
    championSkillsCanvas.appendChild(status);
}

async function updateChampionSkills() {
    if (championSkillsUpdateInProgress) return;
    championSkillsUpdateInProgress = true;

    try {
        let result;
        try {
            const response = await fetch(CHAMPION_SKILLS_GAME_DATA_URL, { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`game data request failed: status ${response.status}`);
            }
            result = await response.json();
        } catch (error) {
            console.error("failed to fetch champion skills game data", error);
            if (championSkillsBoardRendered) {
                handleChampionSkillsGameUnavailable();
            } else {
                showChampionSkillsMessage("チャンピオン情報の取得に失敗しました", true);
            }
            return;
        }

        if (result?.ok !== true) {
            handleChampionSkillsGameUnavailable();
            return;
        }

        const players = result?.data?.allPlayers;
        if (!Array.isArray(players)) {
            throw new Error("game data response has an invalid allPlayers field");
        }
        if (players.length === 0) {
            if (championSkillsBoardRendered) {
                handleChampionSkillsGameEnded();
            }
            return;
        }

        championSkillsEndPollFailures = 0;
        if (championSkillsBoardRendered) return;

        showChampionSkillsMessage("スキル情報を読み込み中...");
        if (championSkillsIndex.size === 0) {
            await loadChampionSkillsIndex();
        }

        const teams = groupChampionSkillsPlayers(players);
        const championIds = new Set();
        for (const player of players) {
            const championId = resolveChampionSkillsId(player?.championName);
            if (championId && !championSkillsData.has(championId)) {
                championIds.add(championId);
            }
        }
        await Promise.all([...championIds].map(loadChampionSkillsData));
        renderChampionSkillsBoard(teams);
        championSkillsBoardRendered = true;
    } catch (error) {
        console.error("failed to update champion skills overlay", error);
        if (!championSkillsBoardRendered) {
            showChampionSkillsMessage("チャンピオン情報の取得に失敗しました", true);
        }
    } finally {
        championSkillsUpdateInProgress = false;
    }
}

showChampionSkillsMessage("試合データを待っています");
updateChampionSkills();
window.setInterval(updateChampionSkills, 1000);
