// ゴールドチャート用変数
let timeData = [];
let goldDiffData = [];
let startTime = null;
let hadValidData = false;

const INITIAL_TIME_WIDTH = 120;
const MAX_TIME_FIXED = 600;
const INITIAL_Y_RANGE = 5000;
const PLOTLY_SCRIPT_URL = "https://cdn.plot.ly/plotly-2.26.0.min.js";
let plotlyLoadPromise = null;

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
    const chartBackground = getChartThemeColor('--chart-background', 'rgba(0,0,0,0.9)');
    chartLayout = {
        xaxis: {
            gridcolor: gridColor,
            showgrid: true,
            zeroline: false,
            color: axisColor,
            range: [0, INITIAL_TIME_WIDTH]
        },
        yaxis: {
            gridcolor: gridColor,
            showgrid: true,
            zeroline: true,
            color: axisColor,
            range: [-INITIAL_Y_RANGE, INITIAL_Y_RANGE]
        },

        // ★ 完全透明（OBS と馴染む）
        plot_bgcolor: chartBackground,
        paper_bgcolor: chartBackground,

        // ★ 余白を最小化
        margin: { l: 40, r: 20, t: 10, b: 30 },

        font: { color: '#fff' },

        showlegend: false,

        shapes: [
            {
                type: 'line',
                x0: 0,
                y0: 0,
                x1: MAX_TIME_FIXED,
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

    await plotly.newPlot('goldChart', [], chartLayout, config);
}


// 区間トレースを作成（0 補間対応）
function makeTrace(start, end, sign, zeroX = null, zeroY = null) {
    let x = timeData.slice(start, end + 1);
    let y = goldDiffData.slice(start, end + 1);

    // 0 補間点がある場合は追加
    if (zeroX !== null) {
        x = [...x, zeroX];
        y = [...y, zeroY];
    }

    const allyColor = getChartThemeColor('--chart-ally-line', 'rgba(102,179,255,1)');
    const allyFill = getChartThemeColor('--chart-ally-fill', 'rgba(102,179,255,0.25)');
    const enemyColor = getChartThemeColor('--chart-enemy-line', 'rgba(255,102,102,1)');
    const enemyFill = getChartThemeColor('--chart-enemy-fill', 'rgba(255,102,102,0.25)');

    // 観戦時は ORDER リードを青、CHAOS リードを赤に固定する。
    // 通常プレイ時は自チームのリードを青、相手のリードを赤にする。
    let color, fillColor;
    if (window.isSpectatorMode) {
        color = sign >= 0 ? allyColor : enemyColor;
        fillColor = sign >= 0 ? allyFill : enemyFill;
    } else if (sign >= 0) {
        // ORDER がリード
        color = (window.myTeam === 'ORDER') ? allyColor : enemyColor;
        fillColor = (window.myTeam === 'ORDER') ? allyFill : enemyFill;
    } else {
        // CHAOS がリード
        color = (window.myTeam === 'CHAOS') ? allyColor : enemyColor;
        fillColor = (window.myTeam === 'CHAOS') ? allyFill : enemyFill;
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
    let xRange;
    if (maxTime > MAX_TIME_FIXED) {
        xRange = [0, maxTime + 100];
    } else {
        xRange = [0, Math.max(maxTime + 60, INITIAL_TIME_WIDTH)];
    }
    chartLayout.xaxis.range = xRange;

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

    let yMin = -INITIAL_Y_RANGE ;
    let yMax = INITIAL_Y_RANGE ;

    if (minGoldDiff < yMin || maxGoldDiff > yMax) {
        const absMax = Math.max(Math.abs(minGoldDiff), Math.abs(maxGoldDiff));
        const expanded = Math.ceil(absMax / 5000) * 5000;
        yMin = -expanded;
        yMax = expanded;
    }
    chartLayout.yaxis.range = [yMin, yMax];
}

function resetGoldChart() {
    if (!hadValidData) return;

    timeData = [];
    goldDiffData = [];
    startTime = null;
    hadValidData = false;
    chartLayout.xaxis.range = [0, INITIAL_TIME_WIDTH];
    chartLayout.yaxis.range = [-INITIAL_Y_RANGE, INITIAL_Y_RANGE];
    chartLayout.shapes = chartLayout.shapes.map(shape =>
        shape.type === "line" && shape.x0 === 0 && shape.y0 === 0
            ? { ...shape, x1: MAX_TIME_FIXED }
            : shape
    );

    if (chartInitialized && window.Plotly) {
        window.Plotly.react("goldChart", [], chartLayout);
    }
}



// グラフを更新（1本の折れ線で常に連続させる）
function updateGoldChart(playerDict) {

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

    // 時間計測
    if (startTime === null) startTime = Date.now();
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    // グラフデータ追加
    timeData.push(elapsed);
    goldDiffData.push(diff);
    hadValidData = true;

    const traces = [];
    if (timeData.length === 0) return;

    let startIndex = 0;
    let currentSign = goldDiffData[0] >= 0 ? 1 : -1;

    for (let i = 1; i < goldDiffData.length; i++) {
        const sign = goldDiffData[i] >= 0 ? 1 : -1;

        if (sign !== currentSign) {

            const zeroX = timeData[i];
            const zeroY = 0;

            // ★ 1) 現在の区間を 0 まで補完して閉じる
            traces.push(makeTrace(startIndex, i - 1, currentSign, zeroX, zeroY));

            // ★ 2) 次の区間は 0 から開始するため、startIndex を「補完点」にする
            startIndex = i;
            currentSign = sign;

            // ★ 3) 次の区間の先頭にも 0 補完を入れる
            // これが「青側の 0 補完」
            timeData.splice(i, 0, zeroX);
            goldDiffData.splice(i, 0, zeroY);

            // インデックス調整
            i++;
        }
    }

    // 最後の区間
    traces.push(makeTrace(startIndex, goldDiffData.length - 1, currentSign));

    updateAxes();
    window.Plotly.react('goldChart', traces, chartLayout);
}

let chartInitialized = false;
let isUpdatingGoldChart = false;

window.addEventListener("playerdictupdated", async () => {
    if (!liveClientDataAvailable) {
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
        if (!liveClientDataAvailable) {
            resetGoldChart();
            return;
        }
        updateGoldChart(getPlayerDict());
    } catch (error) {
        console.error("failed to update gold chart", error);
    } finally {
        isUpdatingGoldChart = false;
    }
});
