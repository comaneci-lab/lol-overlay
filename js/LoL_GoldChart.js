const GOLD_CHART_ALLOWED_GAME_MODES = ["CLASSIC", "PRACTICETOOL", "SPECTATOR", "ARAM"];

// ゴールドチャート用変数
let timeData = [];
let goldDiffData = [];
let hadValidData = false;
let goldChartWarnings = new Set();

const INITIAL_TIME_WIDTH = 25 * 60;
const TIME_AXIS_STEP = 60;
const TIME_TICK_STEP = 5 * 60;
const INITIAL_Y_RANGE = 5000;
const GOLD_AXIS_STEP = 1000;
const GOLD_CHART_KILL_INTERVAL = 30;
const GOLD_CHART_EVENT_SIZE = 24;
const GOLD_CHART_EVENT_ICONS = {
    TurretKilled: "../assets/icon_tower.png",
    HordeKill: "../assets/icon_voidclub.png",
    DragonKill: "../assets/icon_dragon.png",
    HeraldKill: "../assets/icon_herald.png",
    BaronKill: "../assets/icon_baron.png"
};
const GOLD_CHART_EVENT_NAMES = {
    ChampionKill: "チャンピオンキル",
    TurretKilled: "タワー",
    HordeKill: "ヴォイドグラブ",
    DragonKill: "ドラゴン",
    HeraldKill: "ヘラルド",
    BaronKill: "バロン"
};
const PLOTLY_SCRIPT_URL = "https://cdn.plot.ly/plotly-2.26.0.min.js";
let plotlyLoadPromise = null;

function warnGoldChartOnce(key, message, value) {
    if (goldChartWarnings.has(key)) return;
    goldChartWarnings.add(key);
    console.warn(message, value);
}

function getGoldChartEventTeam(event, teams) {
    const killer = typeof event.KillerName === "string" ? event.KillerName.trim().toLowerCase() : "";
    const reportedTeam = event.KillerTeam;
    const team = reportedTeam === "ORDER" || reportedTeam === "CHAOS"
        ? reportedTeam
        : teams[killer] ?? teams[killer.split("#", 1)[0]];
    if (team === "ORDER" || team === "CHAOS") return team;

    if (event.EventName === "TurretKilled" && typeof event.TurretKilled === "string") {
        const turretTeam = event.TurretKilled.match(/^Turret_T(Order|Chaos)_/i)?.[1]?.toUpperCase();
        if (turretTeam === "ORDER") return "CHAOS";
        if (turretTeam === "CHAOS") return "ORDER";
    }
    return null;
}

function getGoldChartEvents(events, players) {
    const result = { ORDER: [], CHAOS: [] };
    const killGroups = new Map();
    const seen = new Set();
    const teams = makePlayerTeamMap(players);

    for (const [index, event] of events.entries()) {
        if (!Object.prototype.hasOwnProperty.call(GOLD_CHART_EVENT_NAMES, event?.EventName)) continue;
        const key = event.EventID != null ? `id:${event.EventID}` : `index:${index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const team = getGoldChartEventTeam(event, teams);
        const time = event.EventTime == null ? NaN : Number(event.EventTime);
        if (!team || !Number.isFinite(time) || time < 0) {
            warnGoldChartOnce(key, "ゴールドチャート: チームまたは時刻を特定できないイベントを表示できません", event);
            continue;
        }

        if (event.EventName === "ChampionKill") {
            const groupKey = `${team}:${Math.floor(time / GOLD_CHART_KILL_INTERVAL)}`;
            const group = killGroups.get(groupKey);
            if (group) {
                group.count++;
                group.time = Math.min(group.time, time);
            } else {
                const marker = { time, name: event.EventName, count: 1 };
                killGroups.set(groupKey, marker);
                result[team].push(marker);
            }
        } else {
            result[team].push({ time, name: event.EventName, count: 1 });
        }
    }
    return result;
}

function renderGoldChartEvents(events, players) {
    const container = document.getElementById("goldChartEvents");
    if (!container) return;

    const markersByTeam = getGoldChartEvents(events, players);
    const rangeEnd = chartLayout.xaxis.range[1];
    container.replaceChildren();

    for (const team of ["ORDER", "CHAOS"]) {
        const ally = isAllyTeam(team);
        const row = document.createElement("div");
        row.className = "gold-chart-event-row";
        row.style.background = ally
            ? getChartThemeColor('--chart-ally-fill', 'rgba(102,179,255,0.25)')
            : getChartThemeColor('--chart-enemy-fill', 'rgba(255,102,102,0.25)');

        const label = document.createElement("div");
        label.className = "gold-chart-event-label";
        label.textContent = team;
        const timeline = document.createElement("div");
        timeline.className = "gold-chart-event-timeline";
        row.append(label, timeline);
        container.appendChild(row);

        const width = timeline.clientWidth;
        if (width <= 0) continue;
        const markers = markersByTeam[team].sort((a, b) =>
            (a.name === "ChampionKill" ? 0 : 1) - (b.name === "ChampionKill" ? 0 : 1)
            || a.time - b.time
        );
        for (const marker of markers) {
            const x = Math.max(GOLD_CHART_EVENT_SIZE / 2,
                Math.min(width - GOLD_CHART_EVENT_SIZE / 2, marker.time / rangeEnd * width));

            const element = document.createElement("div");
            element.className = "gold-chart-event-marker";
            element.style.left = `${x}px`;
            element.style.top = "3px";
            const minutes = Math.floor(marker.time / 60);
            const seconds = Math.floor(marker.time % 60);
            element.title = `${minutes}:${String(seconds).padStart(2, "0")} ${GOLD_CHART_EVENT_NAMES[marker.name]}`
                + (marker.count > 1 ? ` ×${marker.count}（30秒間）` : "");

            if (marker.name === "ChampionKill") {
                const dot = document.createElement("span");
                dot.className = "gold-chart-kill-dot";
                const size = Math.min(6 + (marker.count - 1) * 2, 18);
                dot.style.width = `${size}px`;
                dot.style.height = `${size}px`;
                dot.style.background = ally
                    ? getChartThemeColor('--chart-ally-kill', '#0066b3')
                    : getChartThemeColor('--chart-enemy-kill', '#b42020');
                element.appendChild(dot);
            } else {
                const icon = document.createElement("img");
                icon.src = GOLD_CHART_EVENT_ICONS[marker.name];
                icon.alt = GOLD_CHART_EVENT_NAMES[marker.name];
                element.appendChild(icon);
            }
            timeline.appendChild(element);
        }
    }
}

function updateGoldChartTimeTicks(rangeEnd) {
    chartLayout.xaxis.tickvals = [];
    chartLayout.xaxis.ticktext = [];
    for (let time = 0; time <= rangeEnd; time += TIME_TICK_STEP) {
        chartLayout.xaxis.tickvals.push(time);
        chartLayout.xaxis.ticktext.push(`${time / 60}分`);
    }
}

function updateGoldChartGoldTicks(rangeEnd) {
    const labelStep = Math.ceil(2 * rangeEnd / GOLD_AXIS_STEP / 8) * GOLD_AXIS_STEP;
    chartLayout.yaxis.tickvals = [];
    chartLayout.yaxis.ticktext = [];
    for (let gold = -rangeEnd; gold <= rangeEnd; gold += GOLD_AXIS_STEP) {
        chartLayout.yaxis.tickvals.push(gold);
        chartLayout.yaxis.ticktext.push(gold % labelStep === 0
            ? (gold === 0 ? "0" : `${gold / GOLD_AXIS_STEP}k`)
            : "");
    }
}

function getChartThemeColor(name, fallback) {
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    return value || fallback;
}

function loadPlotly() {
    if (window.Plotly) return Promise.resolve(window.Plotly);
    if (plotlyLoadPromise) return plotlyLoadPromise;

    plotlyLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = PLOTLY_SCRIPT_URL;
        script.onload = () => {
            if (window.Plotly) {
                resolve(window.Plotly);
            } else {
                plotlyLoadPromise = null;
                reject(new Error("Plotly script loaded without exposing Plotly"));
            }
        };
        script.onerror = () => {
            plotlyLoadPromise = null;
            reject(new Error(`Failed to load Plotly from ${PLOTLY_SCRIPT_URL}`));
        };
        document.head.appendChild(script);
    });

    return plotlyLoadPromise;
}

let chartLayout = {
    margin: { t: 10, b: 20, l: 40, r: 10 },
    xaxis: { range: [0, INITIAL_TIME_WIDTH] },
    yaxis: { range: [-INITIAL_Y_RANGE, INITIAL_Y_RANGE] },
    shapes: [
                {
                    type: 'line',
                    x0: 0, y0: 0,
                    x1: INITIAL_TIME_WIDTH, y1: 0,
                    line: { color: '#888', width: 1 }
                }
            ]
};



// グラフの初期化
async function initializeChart() {
    const plotly = await loadPlotly();
    const gridColor = getChartThemeColor('--chart-grid', '#444');
    const axisColor = getChartThemeColor('--chart-axis', '#ccc');
    chartLayout = {
        xaxis: {
            gridcolor: gridColor,
            showgrid: true,
            zeroline: false,
            color: axisColor,
            tickmode: 'array',
            range: [0, INITIAL_TIME_WIDTH]
        },
        yaxis: {
            gridcolor: gridColor,
            showgrid: true,
            zeroline: true,
            color: axisColor,
            tickmode: 'array',
            dtick: GOLD_AXIS_STEP,
            range: [-INITIAL_Y_RANGE, INITIAL_Y_RANGE]
        },

        plot_bgcolor: 'rgba(0,0,0,0)',
        paper_bgcolor: 'rgba(0,0,0,0)',

        // ★ 余白を最小化
        margin: { l: 40, r: 20, t: 10, b: 30 },

        font: { color: '#fff' },

        showlegend: false,

        shapes: [
            {
                type: 'line',
                x0: 0,
                y0: 0,
                x1: INITIAL_TIME_WIDTH,
                y1: 0,
                xref: 'x',
                yref: 'y',
                line: {
                    color: getChartThemeColor('--chart-zero-line', '#666'),
                    width: 1,
                    dash: 'dot'
                }
            }
        ]
    };

    const config = {
        responsive: true,
        displayModeBar: false
    };

    updateGoldChartTimeTicks(INITIAL_TIME_WIDTH);
    updateGoldChartGoldTicks(INITIAL_Y_RANGE);
    await plotly.newPlot('goldChart', [], chartLayout, config);
}


// 区間トレースを作成（0 補間対応）
function makeTrace(start, end, sign, startZeroX = null, endZeroX = null) {
    let x = timeData.slice(start, end + 1);
    let y = goldDiffData.slice(start, end + 1);

    if (startZeroX !== null) {
        x = [startZeroX, ...x];
        y = [0, ...y];
    }
    if (endZeroX !== null) {
        x = [...x, endZeroX];
        y = [...y, 0];
    }

    const allyColor = getChartThemeColor('--chart-ally-line', 'rgba(102,179,255,1)');
    const allyFill = getChartThemeColor('--chart-ally-fill', 'rgba(102,179,255,0.25)');
    const enemyColor = getChartThemeColor('--chart-enemy-line', 'rgba(255,102,102,1)');
    const enemyFill = getChartThemeColor('--chart-enemy-fill', 'rgba(255,102,102,0.25)');

    // 観戦時は ORDER リードを青、CHAOS リードを赤に固定する。
    // 通常プレイ時は自チームのリードを青、相手のリードを赤にする。
    let color, fillColor;
    if (sign >= 0) {
        // ORDER がリード
        color = isAllyTeam("ORDER") ? allyColor : enemyColor;
        fillColor = isAllyTeam("ORDER") ? allyFill : enemyFill;
    } else {
        // CHAOS がリード
        color = isAllyTeam("CHAOS") ? allyColor : enemyColor;
        fillColor = isAllyTeam("CHAOS") ? allyFill : enemyFill;
    }

    return {
        x: x,
        y: y,
        mode: 'lines',
        line: {
            color: color,
            width: 3
        },
        fill: 'tozeroy',
        fillcolor: fillColor,
        hovertemplate: '<b>時間: %{x}秒</b><br>差: %{y:,}G<extra></extra>'
    };
}


function updateAxes() {
    if (timeData.length === 0) return;

    const maxTime = Math.max(...timeData);

    // X軸
    const xRange = [0, Math.max(INITIAL_TIME_WIDTH, (Math.floor(maxTime / TIME_AXIS_STEP) + 1) * TIME_AXIS_STEP)];
    chartLayout.xaxis.range = xRange;
    updateGoldChartTimeTicks(xRange[1]);

    // 0ライン
    chartLayout.shapes = chartLayout.shapes.map(shape => {
        if (shape.type === 'line' && shape.x0 === 0 && shape.y0 === 0) {
            return { ...shape, x1: xRange[1] };
        }
        return shape;
    });

    // Y軸
    const minGoldDiff = Math.min(...goldDiffData);
    const maxGoldDiff = Math.max(...goldDiffData);

    const absMax = Math.max(Math.abs(minGoldDiff), Math.abs(maxGoldDiff));
    const yMax = Math.max(INITIAL_Y_RANGE, (Math.floor(absMax / GOLD_AXIS_STEP) + 1) * GOLD_AXIS_STEP);
    chartLayout.yaxis.range = [-yMax, yMax];
    updateGoldChartGoldTicks(yMax);
}

function resetGoldChart() {
    if (!hadValidData) return;

    timeData = [];
    goldDiffData = [];
    hadValidData = false;
    goldChartWarnings.clear();
    document.getElementById("goldChartEvents")?.replaceChildren();
    chartLayout.xaxis.range = [0, INITIAL_TIME_WIDTH];
    updateGoldChartTimeTicks(INITIAL_TIME_WIDTH);
    chartLayout.yaxis.range = [-INITIAL_Y_RANGE, INITIAL_Y_RANGE];
    updateGoldChartGoldTicks(INITIAL_Y_RANGE);
    chartLayout.shapes = chartLayout.shapes.map(shape =>
        shape.type === "line" && shape.x0 === 0 && shape.y0 === 0
            ? { ...shape, x1: INITIAL_TIME_WIDTH }
            : shape
    );

    if (chartInitialized && window.Plotly) {
        window.Plotly.react("goldChart", [], chartLayout);
    }
}



// グラフを更新（1本の折れ線で常に連続させる）
function updateGoldChart(playerDict, gameData) {
    const gameTime = gameData?.gameData?.gameTime ?? gameData?.gameData?.gametime;
    const elapsed = getGameTime(gameData);
    if (!Number.isFinite(elapsed) || elapsed < 0) {
        warnGoldChartOnce("gameTime", "ゴールドチャート: 試合時刻を取得できません", gameTime);
        return;
    }
    if (timeData.length > 0 && elapsed < timeData[timeData.length - 1]) {
        resetGoldChart();
    }

    // ================================
    // ★ チーム合計ゴールド差（グラフ用）
    // ================================
    let orderTotal = 0;
    let chaosTotal = 0;

    for (const key in playerDict) {
        const p = playerDict[key];
        const gold = p.total_price ?? 0;

        if (p.team === "ORDER") orderTotal += gold;
        if (p.team === "CHAOS") chaosTotal += gold;
    }

    const diff = orderTotal - chaosTotal;

    // グラフデータ追加
    if (timeData.length && elapsed === timeData[timeData.length - 1]) {
        goldDiffData[goldDiffData.length - 1] = diff;
    } else {
        timeData.push(elapsed);
        goldDiffData.push(diff);
    }
    hadValidData = true;

    const traces = [];
    if (timeData.length === 0) return;

    let startIndex = 0;
    let currentSign = goldDiffData[0] >= 0 ? 1 : -1;
    let startZeroX = null;

    for (let i = 1; i < goldDiffData.length; i++) {
        const sign = goldDiffData[i] >= 0 ? 1 : -1;

        if (sign !== currentSign) {

            traces.push(makeTrace(startIndex, i - 1, currentSign, startZeroX, timeData[i]));
            startIndex = i;
            currentSign = sign;
            startZeroX = timeData[i];
        }
    }

    // 最後の区間
    traces.push(makeTrace(startIndex, goldDiffData.length - 1, currentSign, startZeroX));

    updateAxes();
    window.Plotly.react('goldChart', traces, chartLayout);
    if (Array.isArray(gameData.events?.Events)) {
        renderGoldChartEvents(gameData.events.Events, gameData.allPlayers);
    } else {
        warnGoldChartOnce("events", "ゴールドチャート: イベント履歴を取得できません", gameData.events);
        document.getElementById("goldChartEvents")?.replaceChildren();
    }
}

let chartInitialized = false;
let isUpdatingGoldChart = false;

window.addEventListener("playerdictupdated", async () => {
    const chart = document.getElementById("goldChartWidget");
    const allowed = GOLD_CHART_ALLOWED_GAME_MODES.includes(currentGameMode);
    if (chart) chart.hidden = !allowed;
    if (!allowed) {
        resetGoldChart();
        return;
    }
    if (!liveClientDataAvailable || !gameStarted) {
        resetGoldChart();
        return;
    }
    if (isUpdatingGoldChart) return;
    isUpdatingGoldChart = true;

    try {
        if (!chartInitialized) {
            await initializeChart();
            chartInitialized = true;
        }
        if (!liveClientDataAvailable || !gameStarted ||
            !GOLD_CHART_ALLOWED_GAME_MODES.includes(currentGameMode)) {
            resetGoldChart();
            return;
        }
        updateGoldChart(getPlayerDict(), latestGameData);
    } catch (error) {
        console.error("failed to update gold chart", error);
    } finally {
        isUpdatingGoldChart = false;
    }
});

window.addEventListener("resize", () => {
    if (hadValidData && Array.isArray(latestGameData?.events?.Events)) {
        renderGoldChartEvents(latestGameData.events.Events, latestGameData.allPlayers);
    }
});
