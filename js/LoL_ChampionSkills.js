const CHAMPION_SKILLS_GAME_DATA_URL = "/allgamedata";
const CHAMPION_SKILLS_INDEX_URL = "/champions";
const CHAMPION_SKILLS_DATA_URL = "/champion";
const CHAMPION_SKILLS_DATA_DRAGON_VERSION = "16.22.1";
const CHAMPION_SKILLS_LINEUP_STORAGE_KEY = "lol-overlay.champion-skills.lineup";
const CHAMPION_SKILLS_RECENT_STORAGE_KEY = "lol-overlay.champion-skills.recent";
const CHAMPION_SKILLS_ROLES = [
    "TOP",
    "JUNGLE",
    "MIDDLE",
    "BOTTOM",
    "UTILITY"
];
const CHAMPION_SKILLS_TEAMS = ["ORDER", "CHAOS"];
const CHAMPION_SKILLS_ROLE_LABELS = {
    TOP: "TOP",
    JUNGLE: "JUNGLE",
    MIDDLE: "MID",
    BOTTOM: "ADC",
    UTILITY: "SUPPORT"
};
const CHAMPION_SKILLS_TAG_LABELS = {
    Fighter: "ファイター",
    Mage: "メイジ",
    Assassin: "アサシン",
    Tank: "タンク",
    Marksman: "マークスマン",
    Support: "サポート"
};

const championSkillsCanvas = document.getElementById("overlay-canvas");
const championSkillsIndex = new Map();
const championSkillsData = new Map();
const championSkillsCatalogById = new Map();
let championSkillsCatalog = [];
let championSkillsManualLineup = loadChampionSkillsManualLineup();
let championSkillsRecentIds = loadChampionSkillsRecentIds();
let championSkillsUpdateInProgress = false;
let championSkillsBoardRendered = false;
let championSkillsEndPollFailures = 0;
let championSkillsCurrentMode = null;
let championSkillsCurrentTeams = null;
let championSkillsLiveSignature = null;
let championSkillsDescriptionsVisible = false;
let championSkillsSetupOpen = false;
let championSkillsPickerTarget = null;
let championSkillsSearchText = "";
let championSkillsSelectedTags = new Set();
let championSkillsManualRenderRevision = 0;
let championSkillsSetupNotice = "";

function createEmptyChampionSkillsLineup() {
    return Object.fromEntries(
        CHAMPION_SKILLS_TEAMS.map(team => [
            team,
            Object.fromEntries(CHAMPION_SKILLS_ROLES.map(role => [role, null]))
        ])
    );
}

function loadChampionSkillsManualLineup() {
    const lineup = createEmptyChampionSkillsLineup();
    try {
        const stored = JSON.parse(
            localStorage.getItem(CHAMPION_SKILLS_LINEUP_STORAGE_KEY) || "null"
        );
        for (const team of CHAMPION_SKILLS_TEAMS) {
            for (const role of CHAMPION_SKILLS_ROLES) {
                const championId = stored?.[team]?.[role];
                if (typeof championId === "string" && /^[A-Za-z0-9]+$/.test(championId)) {
                    lineup[team][role] = championId;
                }
            }
        }
    } catch (error) {
        console.error("failed to load saved champion skills lineup", error);
    }
    return lineup;
}

function loadChampionSkillsRecentIds() {
    try {
        const stored = JSON.parse(
            localStorage.getItem(CHAMPION_SKILLS_RECENT_STORAGE_KEY) || "[]"
        );
        if (Array.isArray(stored)) {
            return [...new Set(
                stored.filter(id => typeof id === "string" && /^[A-Za-z0-9]+$/.test(id))
            )].slice(0, 8);
        }
    } catch (error) {
        console.error("failed to load recent champion skills selections", error);
    }
    return [];
}

function saveChampionSkillsLineup() {
    try {
        localStorage.setItem(
            CHAMPION_SKILLS_LINEUP_STORAGE_KEY,
            JSON.stringify(championSkillsManualLineup)
        );
        return true;
    } catch (error) {
        console.error("failed to save champion skills lineup", error);
        return false;
    }
}

function saveChampionSkillsRecentIds() {
    try {
        localStorage.setItem(
            CHAMPION_SKILLS_RECENT_STORAGE_KEY,
            JSON.stringify(championSkillsRecentIds)
        );
    } catch (error) {
        console.error("failed to save recent champion skills selections", error);
    }
}

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

    championSkillsCatalog = [];
    championSkillsCatalogById.clear();
    championSkillsIndex.clear();
    for (const champion of Object.values(champions)) {
        if (!champion?.id) continue;
        const catalogEntry = {
            id: String(champion.id),
            name: String(champion.name ?? champion.id),
            tags: Array.isArray(champion.tags) ? champion.tags : []
        };
        championSkillsIndex.set(catalogEntry.id.toLowerCase(), catalogEntry.id);
        if (champion.name) {
            championSkillsIndex.set(catalogEntry.name.toLowerCase(), catalogEntry.id);
        }
        championSkillsCatalog.push(catalogEntry);
        championSkillsCatalogById.set(catalogEntry.id, catalogEntry);
    }
    championSkillsCatalog.sort((left, right) => left.name.localeCompare(right.name));
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

function getChampionSkillsDisplayName(championId) {
    return championSkillsCatalogById.get(championId)?.name ?? championId;
}

function createChampionSkillsManualTeams() {
    const teams = Object.fromEntries(
        CHAMPION_SKILLS_TEAMS.map(team => [team, new Map()])
    );
    for (const team of CHAMPION_SKILLS_TEAMS) {
        for (const role of CHAMPION_SKILLS_ROLES) {
            const championId = championSkillsManualLineup[team][role];
            if (championId) {
                teams[team].set(role, {
                    team,
                    position: role,
                    championName: championId
                });
            }
        }
    }
    return teams;
}

function createChampionSkillsChampionOption(champion) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "champion-skills-picker-option";

    const image = createChampionSkillsImage(
        `../assets/champion/${encodeURIComponent(champion.id)}.png`,
        "",
        "champion-skills-picker-icon"
    );
    image.onerror = () => {
        image.onerror = null;
        image.src = `https://ddragon.leagueoflegends.com/cdn/${CHAMPION_SKILLS_DATA_DRAGON_VERSION}/img/champion/${encodeURIComponent(champion.id)}.png`;
    };
    option.appendChild(image);

    const details = document.createElement("span");
    details.className = "champion-skills-picker-option-details";
    const name = document.createElement("strong");
    name.textContent = champion.name;
    details.appendChild(name);
    const id = document.createElement("span");
    id.className = "champion-skills-picker-option-id";
    id.textContent = champion.id;
    details.appendChild(id);
    option.appendChild(details);

    option.addEventListener("click", () => {
        void setChampionSkillsManualSelection(champion.id);
    });
    return option;
}

function refreshChampionSkillsPickerResults(searchInput, recentList, resultList, countLabel) {
    const searchText = searchInput.value.trim().toLowerCase();
    const recentChampions = championSkillsRecentIds
        .map(id => championSkillsCatalogById.get(id))
        .filter(Boolean);
    recentList.replaceChildren();
    for (const champion of recentChampions) {
        recentList.appendChild(createChampionSkillsChampionOption(champion));
    }
    recentList.hidden = recentChampions.length === 0;

    const matches = championSkillsCatalog.filter(champion => {
        const matchesText = !searchText ||
            `${champion.name} ${champion.id}`.toLowerCase().includes(searchText);
        const matchesTags = championSkillsSelectedTags.size === 0 ||
            champion.tags.some(tag => championSkillsSelectedTags.has(tag));
        return matchesText && matchesTags;
    });
    resultList.replaceChildren();
    for (const champion of matches) {
        resultList.appendChild(createChampionSkillsChampionOption(champion));
    }
    countLabel.textContent = `${matches.length}件`;
    if (matches.length === 0) {
        const empty = document.createElement("p");
        empty.className = "champion-skills-picker-empty";
        empty.textContent = "該当するチャンピオンがありません";
        resultList.appendChild(empty);
    }
}

function createChampionSkillsPickerPanel() {
    const target = championSkillsPickerTarget;
    if (!target) return null;

    const picker = document.createElement("section");
    picker.className = "champion-skills-picker";
    picker.setAttribute("aria-label", "チャンピオン選択");

    const heading = document.createElement("div");
    heading.className = "champion-skills-picker-heading";
    const title = document.createElement("h3");
    title.textContent = `${target.team} / ${CHAMPION_SKILLS_ROLE_LABELS[target.role]} のチャンピオン`;
    heading.appendChild(title);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "champion-skills-picker-close";
    closeButton.textContent = "閉じる";
    closeButton.addEventListener("click", () => {
        championSkillsPickerTarget = null;
        renderChampionSkillsBoard(championSkillsCurrentTeams, championSkillsCurrentMode);
    });
    heading.appendChild(closeButton);
    picker.appendChild(heading);

    const searchLabel = document.createElement("label");
    searchLabel.className = "champion-skills-picker-search-label";
    searchLabel.textContent = "名前または英語IDで検索";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "champion-skills-picker-search";
    searchInput.placeholder = "例: アーリ / Ahri";
    searchInput.autocomplete = "off";
    searchInput.value = championSkillsSearchText;
    searchInput.addEventListener("input", () => {
        championSkillsSearchText = searchInput.value;
        refreshChampionSkillsPickerResults(
            searchInput,
            recentList,
            resultList,
            countLabel
        );
    });
    searchLabel.appendChild(searchInput);
    picker.appendChild(searchLabel);

    const tagHeading = document.createElement("p");
    tagHeading.className = "champion-skills-picker-hint";
    tagHeading.textContent = "タグはレーンではなくチャンピオンの分類です";
    picker.appendChild(tagHeading);
    const tagFilters = document.createElement("div");
    tagFilters.className = "champion-skills-picker-tags";
    for (const [tag, label] of Object.entries(CHAMPION_SKILLS_TAG_LABELS)) {
        const tagButton = document.createElement("button");
        tagButton.type = "button";
        tagButton.className = "champion-skills-picker-tag";
        tagButton.textContent = label;
        tagButton.setAttribute(
            "aria-pressed",
            String(championSkillsSelectedTags.has(tag))
        );
        if (championSkillsSelectedTags.has(tag)) {
            tagButton.classList.add("champion-skills-picker-tag-selected");
        }
        tagButton.addEventListener("click", () => {
            if (championSkillsSelectedTags.has(tag)) {
                championSkillsSelectedTags.delete(tag);
            } else {
                championSkillsSelectedTags.add(tag);
            }
            const selected = championSkillsSelectedTags.has(tag);
            tagButton.classList.toggle(
                "champion-skills-picker-tag-selected",
                selected
            );
            tagButton.setAttribute("aria-pressed", String(selected));
            refreshChampionSkillsPickerResults(
                searchInput,
                recentList,
                resultList,
                countLabel
            );
        });
        tagFilters.appendChild(tagButton);
    }
    picker.appendChild(tagFilters);

    const selectedId = championSkillsManualLineup[target.team][target.role];
    if (selectedId) {
        const clearButton = document.createElement("button");
        clearButton.type = "button";
        clearButton.className = "champion-skills-picker-clear";
        clearButton.textContent = "この枠をクリア";
        clearButton.addEventListener("click", () => {
            void setChampionSkillsManualSelection(null);
        });
        picker.appendChild(clearButton);
    }

    const recentHeading = document.createElement("h4");
    recentHeading.className = "champion-skills-picker-section-title";
    recentHeading.textContent = "最近選択したチャンピオン";
    picker.appendChild(recentHeading);
    const recentList = document.createElement("div");
    recentList.className = "champion-skills-picker-options champion-skills-picker-recent";
    picker.appendChild(recentList);

    const resultHeading = document.createElement("div");
    resultHeading.className = "champion-skills-picker-result-heading";
    const resultTitle = document.createElement("h4");
    resultTitle.className = "champion-skills-picker-section-title";
    resultTitle.textContent = "チャンピオン";
    resultHeading.appendChild(resultTitle);
    const countLabel = document.createElement("span");
    countLabel.className = "champion-skills-picker-count";
    resultHeading.appendChild(countLabel);
    picker.appendChild(resultHeading);
    const resultList = document.createElement("div");
    resultList.className = "champion-skills-picker-options";
    picker.appendChild(resultList);

    refreshChampionSkillsPickerResults(
        searchInput,
        recentList,
        resultList,
        countLabel
    );
    return picker;
}

function createChampionSkillsSetupPanel() {
    const panel = document.createElement("section");
    panel.className = "champion-skills-setup-panel";
    panel.hidden = !championSkillsSetupOpen;

    const heading = document.createElement("h2");
    heading.textContent = "手動ラインナップ";
    panel.appendChild(heading);
    const hint = document.createElement("p");
    hint.className = "champion-skills-setup-hint";
    hint.textContent = "ゲーム中は実際の試合情報が優先されます";
    panel.appendChild(hint);

    const slots = document.createElement("div");
    slots.className = "champion-skills-setup-slots";
    for (const team of CHAMPION_SKILLS_TEAMS) {
        for (const role of CHAMPION_SKILLS_ROLES) {
            const slotButton = document.createElement("button");
            slotButton.type = "button";
            slotButton.className = `champion-skills-setup-slot champion-skills-setup-slot-${team.toLowerCase()}`;
            slotButton.setAttribute(
                "aria-label",
                `${team} ${CHAMPION_SKILLS_ROLE_LABELS[role]} のチャンピオンを選択`
            );

            const slotName = document.createElement("span");
            slotName.className = "champion-skills-setup-slot-name";
            slotName.textContent = `${team} / ${CHAMPION_SKILLS_ROLE_LABELS[role]}`;
            slotButton.appendChild(slotName);

            const championId = championSkillsManualLineup[team][role];
            const championInfo = document.createElement("span");
            championInfo.className = "champion-skills-setup-slot-champion";
            if (championId) {
                const image = createChampionSkillsImage(
                    `../assets/champion/${encodeURIComponent(championId)}.png`,
                    "",
                    "champion-skills-setup-slot-icon"
                );
                image.onerror = () => {
                    image.onerror = null;
                    image.src = `https://ddragon.leagueoflegends.com/cdn/${CHAMPION_SKILLS_DATA_DRAGON_VERSION}/img/champion/${encodeURIComponent(championId)}.png`;
                };
                championInfo.appendChild(image);
                const name = document.createElement("span");
                name.textContent = getChampionSkillsDisplayName(championId);
                championInfo.appendChild(name);
            } else {
                championInfo.textContent = "チャンピオンを選択";
            }
            slotButton.appendChild(championInfo);
            slotButton.addEventListener("click", () => {
                championSkillsPickerTarget = { team, role };
                championSkillsSearchText = "";
                championSkillsSelectedTags.clear();
                renderChampionSkillsBoard(
                    championSkillsCurrentTeams,
                    championSkillsCurrentMode
                );
            });
            slots.appendChild(slotButton);
        }
    }
    panel.appendChild(slots);

    const notice = document.createElement("p");
    notice.className = "champion-skills-setup-notice";
    notice.textContent = championSkillsSetupNotice;
    notice.hidden = !championSkillsSetupNotice;
    panel.appendChild(notice);

    if (championSkillsPickerTarget) {
        const picker = createChampionSkillsPickerPanel();
        if (picker) panel.appendChild(picker);
    }
    return panel;
}

async function setChampionSkillsManualSelection(championId) {
    if (!championSkillsPickerTarget) return;
    const { team, role } = championSkillsPickerTarget;
    championSkillsManualLineup[team][role] = championId;
    championSkillsPickerTarget = null;
    championSkillsSearchText = "";
    championSkillsSelectedTags.clear();

    const saved = saveChampionSkillsLineup();
    championSkillsSetupNotice = saved
        ? ""
        : "設定を保存できませんでした。再読み込み後に選択が消える可能性があります。";
    if (championId) {
        championSkillsRecentIds = [
            championId,
            ...championSkillsRecentIds.filter(id => id !== championId)
        ].slice(0, 8);
        saveChampionSkillsRecentIds();
    }

    if (championSkillsCurrentMode === "live") {
        renderChampionSkillsBoard(
            championSkillsCurrentTeams,
            championSkillsCurrentMode
        );
        return;
    }
    try {
        await renderManualChampionSkillsBoard();
    } catch (error) {
        console.error("failed to refresh manual champion lineup", error);
        showChampionSkillsMessage("チャンピオン情報の取得に失敗しました", true);
    }
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

function createChampionSkillsPlayerCard(player, team, role, mode) {
    const card = document.createElement("article");
    card.className = "champion-skills-player";

    if (!player) {
        card.classList.add("champion-skills-player-empty");
        if (mode === "manual") {
            const roleLabel = document.createElement("span");
            roleLabel.className = "champion-skills-manual-role";
            roleLabel.textContent = CHAMPION_SKILLS_ROLE_LABELS[role];
            card.appendChild(roleLabel);

            const selectButton = document.createElement("button");
            selectButton.type = "button";
            selectButton.className = "champion-skills-manual-edit";
            selectButton.textContent = "チャンピオンを選択";
            selectButton.setAttribute(
                "aria-label",
                `${team} ${CHAMPION_SKILLS_ROLE_LABELS[role]} のチャンピオンを選択`
            );
            selectButton.addEventListener("click", () => {
                championSkillsPickerTarget = { team, role };
                championSkillsSearchText = "";
                championSkillsSelectedTags.clear();
                championSkillsSetupOpen = true;
                renderChampionSkillsBoard(
                    championSkillsCurrentTeams,
                    championSkillsCurrentMode
                );
            });
            card.appendChild(selectButton);
        } else {
            card.textContent = "プレイヤー情報なし";
        }
        return card;
    }

    const championId = resolveChampionSkillsId(player.championName);
    const champion = championId ? championSkillsData.get(championId) : null;
    const championData = champion instanceof Promise ? null : champion;
    const championName = championData?.name ?? player.championName ?? "不明";
    const identity = document.createElement("div");
    identity.className = "champion-skills-identity";

    if (mode === "manual") {
        const roleLabel = document.createElement("span");
        roleLabel.className = "champion-skills-manual-role";
        roleLabel.textContent = CHAMPION_SKILLS_ROLE_LABELS[role];
        identity.appendChild(roleLabel);
    }

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
    if (mode === "manual") {
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "champion-skills-manual-edit";
        editButton.textContent = "変更";
        editButton.setAttribute(
            "aria-label",
            `${team} ${CHAMPION_SKILLS_ROLE_LABELS[role]} のチャンピオンを変更`
        );
        editButton.addEventListener("click", () => {
            championSkillsPickerTarget = { team, role };
            championSkillsSearchText = "";
            championSkillsSelectedTags.clear();
            championSkillsSetupOpen = true;
            renderChampionSkillsBoard(
                championSkillsCurrentTeams,
                championSkillsCurrentMode
            );
        });
        identity.appendChild(editButton);
    }
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

function renderChampionSkillsBoard(teams, mode = "live") {
    if (mode === "live") {
        championSkillsManualRenderRevision += 1;
    }
    championSkillsCurrentTeams = teams;
    championSkillsCurrentMode = mode;
    championSkillsBoardRendered = true;
    championSkillsCanvas.replaceChildren();
    championSkillsCanvas.classList.remove("champion-skills-unavailable");

    const board = document.createElement("main");
    board.className = "champion-skills-board";

    const toolbar = document.createElement("div");
    toolbar.className = "champion-skills-toolbar";
    const modeLabel = document.createElement("span");
    modeLabel.className = "champion-skills-mode-label";
    modeLabel.textContent = mode === "live"
        ? "ゲーム情報を表示中"
        : "手動ラインナップを表示中";
    toolbar.appendChild(modeLabel);

    const setupToggle = document.createElement("button");
    setupToggle.className = "champion-skills-setup-toggle";
    setupToggle.type = "button";
    setupToggle.textContent = championSkillsSetupOpen
        ? "設定を閉じる"
        : "チャンピオン設定";
    setupToggle.setAttribute("aria-expanded", String(championSkillsSetupOpen));
    setupToggle.addEventListener("click", () => {
        championSkillsSetupOpen = !championSkillsSetupOpen;
        if (!championSkillsSetupOpen) {
            championSkillsPickerTarget = null;
        }
        renderChampionSkillsBoard(
            championSkillsCurrentTeams,
            championSkillsCurrentMode
        );
    });
    toolbar.appendChild(setupToggle);
    board.appendChild(toolbar);

    board.appendChild(createChampionSkillsSetupPanel());

    const descriptionToggle = document.createElement("button");
    descriptionToggle.className = "champion-skills-description-toggle";
    descriptionToggle.type = "button";
    descriptionToggle.textContent = championSkillsDescriptionsVisible
        ? "スキル説明を隠す"
        : "スキル説明を表示";
    descriptionToggle.setAttribute(
        "aria-expanded",
        String(championSkillsDescriptionsVisible)
    );
    if (championSkillsDescriptionsVisible) {
        board.classList.add("champion-skills-descriptions-visible");
    }
    descriptionToggle.addEventListener("click", () => {
        championSkillsDescriptionsVisible = board.classList.toggle(
            "champion-skills-descriptions-visible"
        );
        descriptionToggle.textContent = championSkillsDescriptionsVisible
            ? "スキル説明を隠す"
            : "スキル説明を表示";
        descriptionToggle.setAttribute(
            "aria-expanded",
            String(championSkillsDescriptionsVisible)
        );
    });
    board.appendChild(descriptionToggle);

    for (const role of CHAMPION_SKILLS_ROLES) {
        for (const team of CHAMPION_SKILLS_TEAMS) {
            const card = createChampionSkillsPlayerCard(
                teams[team].get(role),
                team,
                role,
                mode
            );
            card.classList.add(`champion-skills-player-${team.toLowerCase()}`);
            board.appendChild(card);
        }
    }

    championSkillsCanvas.appendChild(board);
}

async function renderManualChampionSkillsBoard() {
    const revision = ++championSkillsManualRenderRevision;
    if (championSkillsCatalog.length === 0) {
        await loadChampionSkillsIndex();
    }
    if (revision !== championSkillsManualRenderRevision) return;

    const teams = createChampionSkillsManualTeams();
    const championIds = new Set(
        CHAMPION_SKILLS_TEAMS.flatMap(team =>
            CHAMPION_SKILLS_ROLES.map(role => championSkillsManualLineup[team][role])
        ).filter(Boolean)
    );
    await Promise.all([...championIds].map(loadChampionSkillsData));
    if (revision !== championSkillsManualRenderRevision) return;
    renderChampionSkillsBoard(teams, "manual");
}

async function handleChampionSkillsGameEnded() {
    championSkillsEndPollFailures = 0;
    championSkillsLiveSignature = null;
    await renderManualChampionSkillsBoard();
}

async function handleChampionSkillsGameUnavailable() {
    if (championSkillsCurrentMode !== "live") {
        if (championSkillsCurrentMode !== "manual") {
            await renderManualChampionSkillsBoard();
        }
        return;
    }

    championSkillsEndPollFailures += 1;
    if (championSkillsEndPollFailures >= 3) {
        await handleChampionSkillsGameEnded();
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
            await handleChampionSkillsGameUnavailable();
            return;
        }

        if (result?.ok !== true) {
            await handleChampionSkillsGameUnavailable();
            return;
        }

        const players = result?.data?.allPlayers;
        if (!Array.isArray(players)) {
            throw new Error("game data response has an invalid allPlayers field");
        }
        if (players.length === 0) {
            if (championSkillsCurrentMode === "live") {
                await handleChampionSkillsGameEnded();
            } else if (championSkillsCurrentMode !== "manual") {
                await renderManualChampionSkillsBoard();
            }
            return;
        }

        championSkillsEndPollFailures = 0;
        if (championSkillsCatalog.length === 0) {
            await loadChampionSkillsIndex();
        }

        const teams = groupChampionSkillsPlayers(players);
        const liveSignature = JSON.stringify(
            players.map(player => [
                player?.team,
                player?.position,
                player?.championName
            ])
        );
        if (
            championSkillsCurrentMode === "live" &&
            liveSignature === championSkillsLiveSignature
        ) {
            return;
        }

        const championIds = new Set();
        for (const team of CHAMPION_SKILLS_TEAMS) {
            for (const role of CHAMPION_SKILLS_ROLES) {
                const player = teams[team].get(role);
                const championId = resolveChampionSkillsId(player?.championName);
                if (championId && !championSkillsData.has(championId)) {
                    championIds.add(championId);
                }
            }
        }
        await Promise.all([...championIds].map(loadChampionSkillsData));
        renderChampionSkillsBoard(teams, "live");
        championSkillsLiveSignature = liveSignature;
    } catch (error) {
        console.error("failed to update champion skills overlay", error);
        if (championSkillsCurrentMode !== "manual" && !championSkillsBoardRendered) {
            showChampionSkillsMessage("チャンピオン情報の取得に失敗しました", true);
        }
    } finally {
        championSkillsUpdateInProgress = false;
    }
}

showChampionSkillsMessage("試合データを待っています");
updateChampionSkills();
window.setInterval(updateChampionSkills, 1000);
