const roleGoldDiffPositions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

const roleGoldDiffPositionAliases = {
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

function normalizeRoleGoldDiffPosition(position) {
    return roleGoldDiffPositionAliases[String(position ?? "").toUpperCase()] ?? null;
}

function formatRoleGoldDiff(value) {
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${(Math.abs(value) / 1000).toFixed(1)}K`;
}

function createRoleGoldDiffChampion(player, sideClass) {
    const side = document.createElement("div");
    side.className = `rgd-champion ${sideClass}`;

    if (!player) return side;

    const icon = document.createElement("img");
    icon.className = "gd-champ-icon";
    icon.src = `assets/champion/${player.championIcon || "Unknown"}.png`;
    icon.alt = player.championName || player.championIcon || "Champion";
    side.appendChild(icon);

    return side;
}

function updateRoleGoldDiff(playerDict) {
    const container = document.getElementById("RoleGoldDiff");
    if (!container) {
        throw new Error('Role gold difference container "#RoleGoldDiff" was not found');
    }

    const myTeam = window.myTeam;
    const enemyTeam = myTeam === "ORDER" ? "CHAOS" : myTeam === "CHAOS" ? "ORDER" : null;
    const playersByRole = new Map();

    for (const player of Object.values(playerDict ?? {})) {
        const position = normalizeRoleGoldDiffPosition(player.position);
        if (!position || !["ORDER", "CHAOS"].includes(player.team)) continue;

        const rolePlayers = playersByRole.get(position) ?? {};
        if (!rolePlayers[player.team]) rolePlayers[player.team] = player;
        playersByRole.set(position, rolePlayers);
    }

    container.replaceChildren();

    for (const position of roleGoldDiffPositions) {
        const players = playersByRole.get(position) ?? {};
        const ally = myTeam ? players[myTeam] : null;
        const enemy = enemyTeam ? players[enemyTeam] : null;
        const row = document.createElement("div");
        row.className = "rgd-row";

        row.appendChild(createRoleGoldDiffChampion(ally, "rgd-ally"));

        const difference = document.createElement("div");
        difference.className = "rgd-diff rgd-neutral";
        if (ally && enemy) {
            const allyGold = Number(ally.total_price ?? 0);
            const enemyGold = Number(enemy.total_price ?? 0);
            const diff = allyGold - enemyGold;

            difference.textContent = formatRoleGoldDiff(diff);
            difference.classList.remove("rgd-neutral");
            difference.classList.add(diff > 0 ? "rgd-ahead" : diff < 0 ? "rgd-behind" : "rgd-neutral");
        } else {
            difference.textContent = "--";
        }
        row.appendChild(difference);
        row.appendChild(createRoleGoldDiffChampion(enemy, "rgd-enemy"));

        container.appendChild(row);
    }
}

window.addEventListener("playerdictupdated", () => {
    if (!liveClientDataAvailable) return;
    updateRoleGoldDiff(getPlayerDict());
});
