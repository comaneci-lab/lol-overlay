const ACTIVE_PLAYER_CS_URL = "http://localhost:8888/allgamedata";
const activePlayerCsElement = document.getElementById("active-player-cs");

function getActivePlayerCs(playerData) {
    const data = playerData?.data;
    const activePlayer = data?.activePlayer;
    const allPlayers = data?.allPlayers;
    const gameTime = Number(data?.gameData?.gameTime ?? data?.gameData?.gametime);

    if (!activePlayer || !Array.isArray(allPlayers) || !Number.isFinite(gameTime) || gameTime <= 0) {
        return null;
    }

    const activePlayerIds = [
        activePlayer.riotId,
        activePlayer.riotIdGameName,
        activePlayer.summonerName
    ].filter(Boolean);
    const player = allPlayers.find(candidate =>
        activePlayerIds.some(id =>
            id === candidate.riotId ||
            id === candidate.riotIdGameName ||
            id === candidate.summonerName
        )
    );

    if (!player) {
        return null;
    }

    const scores = player.scores ?? {};
    const creepScore = Number(
        scores.creepScore ??
        scores.minionsKilled ??
        scores.cs ??
        player.creepScore ??
        player.minionsKilled ??
        player.cs
    );
    if (!Number.isFinite(creepScore)) {
        return null;
    }

    return creepScore / (gameTime / 60);
}

async function updateActivePlayerCs() {
    try {
        const response = await fetch(ACTIVE_PLAYER_CS_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`status ${response.status}`);
        }

        const playerData = await response.json();
        if (playerData?.ok !== true) {
            activePlayerCsElement.hidden = true;
            return;
        }

        const csPerMinute = getActivePlayerCs(playerData);
        if (csPerMinute === null) {
            activePlayerCsElement.hidden = true;
            return;
        }

        activePlayerCsElement.textContent = `${csPerMinute.toFixed(1)}CS/分`;
        activePlayerCsElement.hidden = false;
    } catch (error) {
        activePlayerCsElement.hidden = true;
        console.error("failed to update active player CS per minute", error);
    }
}

updateActivePlayerCs();
setInterval(updateActivePlayerCs, 1000);