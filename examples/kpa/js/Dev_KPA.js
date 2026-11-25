const KPA_API_URL = "/allgamedata";
const KPA_ALLOWED_GAME_MODES = ["CLASSIC", "PRACTICETOOL", "ARAM"];
const KPA_REFRESH_INTERVAL_MS = 1000;
const kpaWidget = document.getElementById("kpa-widget");
const kpaPlayers = document.getElementById("kpa-players");

let kpaUpdating = false;
let kpaLastError = "";

function kpaIdentities(player) {
    return [player?.riotId, player?.riotIdGameName, player?.summonerName]
        .filter(value => typeof value === "string" && value.trim())
        .map(value => value.trim().toLowerCase());
}

function getKpaTeam(data) {
    const activePlayer = data.activePlayer;
    if (!activePlayer) throw new Error("activePlayer がありません");

    const team = String(activePlayer.team ?? "").toUpperCase();
    if (team === "ORDER" || team === "CHAOS") return team;

    const identities = kpaIdentities(activePlayer);
    const teams = new Set(data.allPlayers
        .filter(player => kpaIdentities(player).some(id => identities.includes(id)))
        .map(player => player.team));
    if (teams.size !== 1) throw new Error("自チームを特定できません");
    const [matchedTeam] = teams;
    if (matchedTeam !== "ORDER" && matchedTeam !== "CHAOS") {
        throw new Error("自チームの値が不正です");
    }
    return matchedTeam;
}

function getKpaRows(data) {
    if (!Array.isArray(data?.allPlayers)) throw new Error("選手一覧がありません");
    if (data.isSpectatorMode === true) return null;
    if (data.isSpectatorMode !== false) throw new Error("観戦モードを判定できません");

    const mode = String(data.gameData?.gameMode ?? "").trim().toUpperCase();
    if (!mode) throw new Error("ゲームモードがありません");
    if (!KPA_ALLOWED_GAME_MODES.includes(mode)) return null;

    if (data.allPlayers.some(player => !player || !["ORDER", "CHAOS"].includes(player.team))) {
        throw new Error("選手のチーム情報が不正です");
    }
    const team = getKpaTeam(data);
    const players = data.allPlayers.filter(player => player.team === team);
    if (players.length === 0) throw new Error("自チームの選手がいません");

    const scores = players.map(player => {
        const kills = player.scores?.kills;
        const assists = player.scores?.assists;
        if (!Number.isInteger(kills) || kills < 0 || !Number.isInteger(assists) || assists < 0) {
            throw new Error("選手のキルまたはアシストが不正です");
        }
        const name = [player.riotIdGameName, player.riotId, player.summonerName, player.championName]
            .find(value => typeof value === "string" && value.trim());
        if (!name) throw new Error("選手名がありません");
        return { name, kills, assists };
    });
    const teamKills = scores.reduce((total, player) => total + player.kills, 0);
    return scores.map(player => ({
        name: player.name,
        value: teamKills === 0
            ? "0%"
            : `${((player.kills + player.assists) / teamKills * 100).toFixed(1)}%`
    }));
}

function renderKpaRows(rows) {
    const elements = rows.map(row => {
        const tr = document.createElement("tr");
        const name = document.createElement("td");
        const value = document.createElement("td");
        name.textContent = row.name;
        value.textContent = row.value;
        tr.append(name, value);
        return tr;
    });
    kpaPlayers.replaceChildren(...elements);
}

async function updateKpa() {
    if (kpaUpdating) return;
    kpaUpdating = true;
    try {
        const response = await fetch(KPA_API_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result?.ok !== true) throw new Error(result?.error || "ゲームデータを取得できません");

        const rows = getKpaRows(result.data);
        if (rows === null) {
            kpaWidget.hidden = true;
        } else {
            renderKpaRows(rows);
            kpaWidget.hidden = false;
        }
        kpaLastError = "";
    } catch (error) {
        kpaWidget.hidden = true;
        const message = String(error);
        if (message !== kpaLastError) console.error("KPAの更新に失敗しました:", error);
        kpaLastError = message;
    } finally {
        kpaUpdating = false;
    }
}

updateKpa();
setInterval(updateKpa, KPA_REFRESH_INTERVAL_MS);
