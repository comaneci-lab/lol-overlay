const topbarMarkup = `
    <div class="topbar-widget" hidden>
        <div class="topbar">
            <div class="side order" id="orderSide">
                <div class="entry"><div class="label">VoidClub</div><div class="value" id="order-void">0</div></div>
                <div class="entry"><div class="label">Herald</div><div class="value" id="order-herald">0</div></div>
                <div class="entry"><div class="label">Dragon</div><div class="value" id="order-dragon">0</div></div>
                <div class="entry"><div class="label">Baron</div><div class="value" id="order-baron">0</div></div>
                <div class="entry"><div class="label">Tower</div><div class="value" id="order-tower">0</div></div>
                <div class="entry"><div class="label">Kills</div><div class="value" id="order-teamkills">0</div></div>
                <div class="entry"><div class="label">Gold</div><div class="value" id="order-teamgold">0K</div></div>
            </div>
            <div class="topbar-center">
                <div class="diff" id="goldDiff">+0K</div>
                <div class="game-time" id="gameTime">00:00</div>
            </div>
            <div class="side chaos" id="chaosSide">
                <div class="entry"><div class="label">Gold</div><div class="value" id="chaos-teamgold">0K</div></div>
                <div class="entry"><div class="label">Kills</div><div class="value" id="chaos-teamkills">0</div></div>
                <div class="entry"><div class="label">Tower</div><div class="value" id="chaos-tower">0</div></div>
                <div class="entry"><div class="label">Baron</div><div class="value" id="chaos-baron">0</div></div>
                <div class="entry"><div class="label">Dragon</div><div class="value" id="chaos-dragon">0</div></div>
                <div class="entry"><div class="label">Herald</div><div class="value" id="chaos-herald">0</div></div>
                <div class="entry"><div class="label">VoidClub</div><div class="value" id="chaos-void">0</div></div>
            </div>
        </div>
        <div class="team-block">
            <div id="own-buffs" class="team-buffs own-buffs"></div>
            <div id="order-dragons" class="dragons"></div>
            <div id="dragon-feat" class="dragon-feat-slot"></div>
            <div id="chaos-dragons" class="dragons"></div>
            <div id="enemy-buffs" class="team-buffs enemy-buffs"></div>
        </div>
    </div>
`;

document.getElementById('overlay-canvas').insertAdjacentHTML('afterbegin', topbarMarkup);
const topbarWidget = document.querySelector(".topbar-widget");
const objectiveStatIds = [
    "order-void", "order-herald", "order-dragon", "order-baron",
    "chaos-void", "chaos-herald", "chaos-dragon", "chaos-baron"
];

function updateTopbar(data) {
    topbarWidget.classList.toggle("spectator-mode", window.isSpectatorMode);

    for (const id of objectiveStatIds) {
        document.getElementById(id).parentElement.style.display =
            window.isSpectatorMode ? "none" : "";
    }

    document.getElementById('order-void').textContent = data.order.voidClub;
    document.getElementById('order-herald').textContent = data.order.herald;
    document.getElementById('order-dragon').textContent = data.order.dragon;
    document.getElementById('order-baron').textContent = data.order.baron;
    document.getElementById('order-tower').textContent = data.order.tower;
    document.getElementById('order-teamkills').textContent = data.order.teamKills;
    document.getElementById('order-teamgold').textContent = data.order.teamGold.toFixed(1) + 'K';

    document.getElementById('chaos-void').textContent = data.chaos.voidClub;
    document.getElementById('chaos-herald').textContent = data.chaos.herald;
    document.getElementById('chaos-dragon').textContent = data.chaos.dragon;
    document.getElementById('chaos-baron').textContent = data.chaos.baron;
    document.getElementById('chaos-tower').textContent = data.chaos.tower;
    document.getElementById('chaos-teamkills').textContent = data.chaos.teamKills;
    document.getElementById('chaos-teamgold').textContent = data.chaos.teamGold.toFixed(1) + 'K';

    const diff = data.order.teamGold - data.chaos.teamGold;
    const diffEl = document.getElementById('goldDiff');
    const myTeamGoldDiff = window.isSpectatorMode || window.myTeam === 'ORDER'
        ? diff
        : window.myTeam === 'CHAOS'
            ? -diff
            : null;
    const displayedDiff = myTeamGoldDiff ?? diff;
    const diffFormatted = displayedDiff.toFixed(1);
    diffEl.textContent = `${displayedDiff > 0 ? '+' : ''}${diffFormatted}K`;
    diffEl.classList.toggle('blue', displayedDiff > 0);
    diffEl.classList.toggle('red', displayedDiff < 0);
}

window.addEventListener("playerdictupdated", updateTeamClass);

function formatGameTime(seconds) {
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function renderBuffTimers(team, containerId, gameTime) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    if (!Number.isFinite(gameTime)) return;

    const buffs = [
        { label: "Baron", expiresAt: team.BaronBuffUntil },
        { label: "Elder", expiresAt: team.ElderBuffUntil }
    ]
        .map(buff => ({ ...buff, remainingTime: buff.expiresAt - gameTime }))
        .filter(buff => Number.isFinite(buff.expiresAt) && buff.remainingTime > 0)
        .sort((a, b) => a.remainingTime - b.remainingTime);

    for (const buff of buffs) {
        const timer = document.createElement("div");
        timer.className = "team-buff-timer";
        timer.classList.add(buff.label.toLowerCase() + "-buff");

        const label = document.createElement("span");
        label.className = "team-buff-label";
        label.textContent = buff.label;

        const time = document.createElement("span");
        time.className = "team-buff-time";
        time.textContent = formatGameTime(Math.ceil(buff.remainingTime));

        timer.append(label, time);
        container.appendChild(timer);
    }
}

updateTopbar({
    order: { voidClub: 0, herald: 0, dragon: 0, baron: 0, tower: 0, teamKills: 0, teamGold: 0 },
    chaos: { voidClub: 0, herald: 0, dragon: 0, baron: 0, tower: 0, teamKills: 0, teamGold: 0 }
});

function renderDragons(dragonData, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    for (let i = 1; i <= 4; i++) {
        const slot = document.createElement("div");
        slot.className = "dragon-slot";

        const name = dragonData?.[i];

        if (name) {
            const img = document.createElement("img");
            img.src = `assets/dragon/${name}.png`;
            img.alt = name;
            slot.appendChild(img);
        }

        container.appendChild(slot);
    }
}

function renderDragonFeat(orderDragons, chaosDragons) {
    const featContainer = document.getElementById("dragon-feat");
    featContainer.innerHTML = "";

    let featDragon = null;

    if (Object.values(orderDragons).filter(v => v).length >= 4) {
        featDragon = orderDragons[4];
    }

    if (Object.values(chaosDragons).filter(v => v).length >= 4) {
        featDragon = chaosDragons[4];
    }

    if (featDragon) {
        const img = document.createElement("img");
        img.src = `assets/dragon/${featDragon}_feat.png`;
        img.alt = featDragon + "_feat";
        featContainer.appendChild(img);
    }
}

function updateTeamClass() {
    document.body.classList.remove('myteam-order', 'myteam-chaos');
    if (window.myTeam === 'ORDER') {
        document.body.classList.add('myteam-order');
    } else if (window.myTeam === 'CHAOS') {
        document.body.classList.add('myteam-chaos');
    }
}

async function updateTopbarFromGameData(gameTime) {
    await updateEvents();
    if (!liveClientDataAvailable) return;
    const playerDict = getPlayerDict();

    const getTeamStats = (team, stats) => {
        const players = Object.values(playerDict).filter(player => player.team === team);
        return {
            voidClub: stats.HordeKill || 0,
            herald: stats.HeraldKill || 0,
            dragon: stats.DragonKill || 0,
            baron: stats.BaronKill || 0,
            tower: stats.TurretKilled || 0,
            teamKills: players.reduce((total, player) => total + (player.scores.kills || 0), 0),
            teamGold: players.reduce((total, player) => total + (player.total_price || 0), 0) / 1000
        };
    };

    updateTopbar({
        order: getTeamStats("ORDER", teamStats.ORDER),
        chaos: getTeamStats("CHAOS", teamStats.CHAOS)
    });
    const ownTeam = window.myTeam === "CHAOS" ? teamStats.CHAOS : teamStats.ORDER;
    const enemyTeam = window.myTeam === "CHAOS" ? teamStats.ORDER : teamStats.CHAOS;
    renderBuffTimers(ownTeam, "own-buffs", gameTime);
    renderBuffTimers(enemyTeam, "enemy-buffs", gameTime);
    renderDragons(teamStats.ORDER.Dragons, "order-dragons");
    renderDragons(teamStats.CHAOS.Dragons, "chaos-dragons");
    renderDragonFeat(teamStats.ORDER.Dragons, teamStats.CHAOS.Dragons);
}

let isUpdatingTopbar = false;

async function refreshTopbar() {
    if (isUpdatingTopbar) return;
    isUpdatingTopbar = true;

    try {
        let gameTime;
        try {
            const gameDataResp = await fetch("http://localhost:8888/allgamedata", { cache: "no-store" });
            if (!gameDataResp.ok) throw new Error(`status ${gameDataResp.status}`);
            const gameDataResponse = await gameDataResp.json();
            if (gameDataResponse?.ok !== true || !Array.isArray(gameDataResponse.data?.allPlayers)) {
                topbarWidget.hidden = true;
                setOverlayDataAvailable(false);
                return;
            }

            const gameMode = String(gameDataResponse.data?.gameData?.gameMode ?? "").toUpperCase();
            window.isSpectatorMode = isSpectatorGameData(gameDataResponse.data);
            topbarWidget.hidden = !["CLASSIC", "PRACTICETOOL", "SPECTATOR"].includes(gameMode);
            if (topbarWidget.hidden) return;

            gameTime = gameDataResponse.data?.gameData?.gametime
                ?? gameDataResponse.data?.gameData?.gameTime;
            if (Number.isFinite(gameTime)) {
                document.getElementById("gameTime").textContent = formatGameTime(gameTime);
            }
        } catch (e) {
            topbarWidget.hidden = true;
            setOverlayDataAvailable(false);
            console.error('failed to fetch game time', e);
            return;
        }

        await updateTopbarFromGameData(gameTime);

    } catch (e) {
        console.error('failed to update topbar', e);
    } finally {
        isUpdatingTopbar = false;
    }
}

refreshTopbar();
setInterval(refreshTopbar, 1000);
