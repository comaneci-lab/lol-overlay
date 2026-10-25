function initializeScoreBoard() {
    // 初期表示
    const initialHtml = `
    <div class="row">
        <div class="team order"></div>
        <div class="diff" style="color:#ccc">0.0K</div>
        <div class="team chaos"></div>
    </div>
    `.repeat(5); // 5行分  
}

// ゴールド差表示用の JS
function formatGoldShort(value) {
    const abs = Math.abs(value);
    const sign = value < 0 ? "-" : value > 0 ? "+" : "";

    // 1000 未満も K 表記に統一
    return `${sign}${(abs / 1000).toFixed(1)}K`;
}

// Position ごとに ORDER → diff → CHAOS
function buildPositionRows(playerDict) {
    const positions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
    const rows = [];

    for (const pos of positions) {
        const order = Object.values(playerDict).find(p => p.position === pos && p.team === "ORDER");
        const chaos = Object.values(playerDict).find(p => p.position === pos && p.team === "CHAOS");

        const orderGold = order?.total_price ?? 0;
        const chaosGold = chaos?.total_price ?? 0;
        const diff = orderGold - chaosGold;

        rows.push({
            position: pos,
            order,
            diff,
            chaos
        });
    }

    return rows;
}

function renderChampionIcon(player) {
    if (!player) return "";

    const level = Number(player.level);
    const levelBadge = Number.isFinite(level) && level > 0
        ? `<span class="sb-champ-level">${Math.trunc(level)}</span>`
        : "";
    const deadClass = player.isDead ? " sb-champ-dead" : "";
    const respawnTimer = Number(player.respawnTimer);
    const respawnTimerBadge = player.isDead && player.respawnTimer != null && Number.isFinite(respawnTimer)
        ? `<span class="sb-champ-respawn-timer">${Math.ceil(respawnTimer)}</span>`
        : "";

    return `
        <span class="sb-champ-portrait">
            <img class="sb-champ-icon${deadClass}" src="assets/champion/${player.championIcon}.png">
            ${levelBadge}
            ${respawnTimerBadge}
        </span>
    `;
}

// rows → HTML
// ScoreBoard 用 rows → HTML
function renderScoreBoardRows(rows) {
    let html = "";
    const getCreepScore = (player) => {
        const scores = player?.scores ?? {};
        return scores.creepScore ?? scores.minionsKilled ?? scores.cs ??
            player?.creepScore ?? player?.minionsKilled ?? player?.cs ?? 0;
    };

    for (const row of rows) {
        const order = row.order;
        const chaos = row.chaos;

        // --- アイテム ---
        const orderItems = order ? order.items
            .sort((a, b) => a.slot - b.slot)
            .map(i => `<img class="sb-item-icon" src="assets/items/${i.itemID}.png">`)
            .join("") : "";

        const orderScores = order?.scores ?? {};
        const orderStats = `
            <div class="sb-order-stats">
                ${order ? `<span>${orderScores.kills ?? 0}/${orderScores.deaths ?? 0}/${orderScores.assists ?? 0}</span>
                <span>${getCreepScore(order)}</span>` : ""}
            </div>
        `;

        const chaosItems = chaos ? chaos.items
            .sort((a, b) => a.slot - b.slot)
            .map(i => `<img class="sb-item-icon" src="assets/items/${i.itemID}.png">`)
            .join("") : "";

        const chaosScores = chaos?.scores ?? {};
        const chaosStats = `
            <div class="sb-chaos-stats">
                ${chaos ? `<span>${chaosScores.kills ?? 0}/${chaosScores.deaths ?? 0}/${chaosScores.assists ?? 0}</span>
                <span>${getCreepScore(chaos)}</span>` : ""}
            </div>
        `;

        // --- ルーン（縦並び） ---
        const getRuneIcon = (name) => {
            const icon = runeIconMap?.[name];
            return icon ? icon : "assets/runes/Unknown.png";
        };

        const orderRunes = order ? `
            <div class="sb-runes">
                <img class="sb-rune-icon" src="${getRuneIcon(order.runes.keystone)}">
                <img class="sb-rune-icon" src="${getRuneIcon(order.runes.secondaryRuneTree)}">
            </div>
        ` : "";

        const chaosRunes = chaos ? `
            <div class="sb-runes">
                <img class="sb-rune-icon" src="${getRuneIcon(chaos.runes.keystone)}">
                <img class="sb-rune-icon" src="${getRuneIcon(chaos.runes.secondaryRuneTree)}">
            </div>
        ` : "";


        // --- サモナースペル（縦並び） ---
        const orderSpells = order ? `
            <div class="sb-spells">
                <img class="sb-spell-icon" src="${getSpellIcon(order.summonerSpells.summonerSpellOne, order.summonerSpells.summonerSpellOneRawDescription)}">
                <img class="sb-spell-icon" src="${getSpellIcon(order.summonerSpells.summonerSpellTwo, order.summonerSpells.summonerSpellTwoRawDescription)}">
            </div>
        ` : "";


        const chaosSpells = chaos ? `
            <div class="sb-spells">
                <img class="sb-spell-icon" src="${getSpellIcon(chaos.summonerSpells.summonerSpellOne, chaos.summonerSpells.summonerSpellOneRawDescription)}">
                <img class="sb-spell-icon" src="${getSpellIcon(chaos.summonerSpells.summonerSpellTwo, chaos.summonerSpells.summonerSpellTwoRawDescription)}">
            </div>
        ` : "";

        // --- チャンピオン ---
        const orderIcon = renderChampionIcon(order);
        const chaosIcon = renderChampionIcon(chaos);

        // --- diff ---
        const diff = row.diff;
        const displayedDiff = window.myTeam === 'CHAOS' ? -diff : diff;
        let diffClass = 'diff-neutral';

        if (diff > 0) {
            // ORDER がリード
            diffClass = window.myTeam === 'ORDER' ? 'diff-ally' : 'diff-enemy';
        } else if (diff < 0) {
            // CHAOS がリード
            diffClass = window.myTeam === 'CHAOS' ? 'diff-ally' : 'diff-enemy';
        }

        // --- HTML 生成 ---
        html += `
        <div class="sb-row">
            <div class="sb-order-items">${orderItems}</div>
            ${orderStats}
            <div class="sb-order-runes">${orderRunes}</div>
            <div class="sb-order-spells">${orderSpells}</div>
            <div class="sb-order-champ">${orderIcon}</div>
            <div class="sb-diff ${diffClass}">${formatGoldShort(displayedDiff)}</div>
            <div class="sb-chaos-champ">${chaosIcon}</div>
            <div class="sb-chaos-spells">${chaosSpells}</div>
            <div class="sb-chaos-runes">${chaosRunes}</div>
            ${chaosStats}
            <div class="sb-chaos-items">${chaosItems}</div>
        </div>
        `;
    }

    return html;
}




function updateScoreBoard(playerDict) {
    // Position ごとの差（UI 用）
    const rows = buildPositionRows(playerDict);

    // HTML作成
    const html = renderScoreBoardRows(rows);

    // HTML反映
    document.getElementById("ScoreBord").innerHTML = html;
}

window.addEventListener("playerdictupdated", () => {
    if (!liveClientDataAvailable) return;
    updateScoreBoard(getPlayerDict());
});

const spellAliases = {
    "真テレポート": "SummonerTeleport",
    "アンリーシュド・スマイト": "SummonerSmite",
    "プライマル・スマイト": "SummonerSmite"
};

const spellIconsByRawDescription = {
    "GeneratedTip_SummonerSpell_SummonerTeleport_Description": "SummonerTeleport.png",
    "GeneratedTip_SummonerSpell_S12_SummonerTeleportUpgrade_Description": "UnleashedTeleport.png",
    "GeneratedTip_SummonerSpell_SummonerSmite_Description": "SummonerSmite.png",
    "GeneratedTip_SummonerSpell_SummonerSmiteAvatarUtility_Description": "GustwalkerPrimalSmite.png",
    "GeneratedTip_SummonerSpell_SummonerSmiteAvatarOffensive_Description": "ScorchclawPrimalSmite.png",
    "GeneratedTip_SummonerSpell_SummonerSmiteAvatarDefensive_Description": "MosstomperPrimalSmite.png",
    "GeneratedTip_SummonerSpell_S5_SummonerSmitePlayerGanker_Description": "UnleashedSmite.png"
};

const getSpellIcon = (name, rawDescription) => {
    const icon = spellIconsByRawDescription[rawDescription];
    if (icon) return `assets/spell/${icon}`;

    const id = summonerSpellMap?.nameToId?.[name] ?? spellAliases[name];
    return id ? `assets/spell/${id}.png` : "assets/spell/Unknown.png";
};

const getRuneIcon = (name) => {
    const icon = runeIconMap?.[name];
    return icon ? icon : "assets/runes/Unknown.png";
};
