const CS_PER_MINUTE_ALLOWED_GAME_MODES = ["CLASSIC", "PRACTICETOOL", "SPECTATOR", "ARAM"];
const activePlayerCsElement = document.getElementById("active-player-cs");

function getActivePlayerCs(playerData) {
    const data = playerData?.data;
    const activePlayer = data?.activePlayer;
    const allPlayers = data?.allPlayers;
    const gameTime = getGameTime(data);

    if (!activePlayer || !Array.isArray(allPlayers) || !Number.isFinite(gameTime) || gameTime <= 0) {
        return null;
    }

    const player = findActivePlayer(data);

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
        const playerData = await fetchLiveGameData();
        if (playerData?.ok !== true || !isAllowedGameMode(playerData.data, CS_PER_MINUTE_ALLOWED_GAME_MODES)) {
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