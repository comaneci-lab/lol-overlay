const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function createOverlay() {
    const classes = new Set(["live-client-data-unavailable", "game-start-pending"]);
    const canvas = {
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            }
        }
    };
    const scoreboard = { innerHTML: "" };
    const chart = { hidden: false };
    const chartWidget = { hidden: false };
    const roleGoldDiff = { hidden: false, replaceChildren() {}, appendChild() {} };
    const listeners = new Map();
    const plots = [];
    let response;
    const window = {
        playerDict: {},
        Plotly: {
            async newPlot(...args) { plots.push(["newPlot", ...args]); },
            react(...args) { plots.push(["react", ...args]); }
        },
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(callback);
        },
        dispatchEvent(event) {
            for (const callback of listeners.get(event.type) ?? []) callback(event);
        }
    };
    const context = vm.createContext({
        window,
        document: {
            documentElement: {},
            createElement() {
                return {
                    classList: { add() {}, remove() {} },
                    appendChild() {}
                };
            },
            getElementById(id) {
                return id === "overlay-canvas" ? canvas : id === "ScoreBord" ? scoreboard
                    : id === "goldChart" ? chart : id === "goldChartWidget" ? chartWidget
                        : id === "RoleGoldDiff" ? roleGoldDiff : null;
            }
        },
        getComputedStyle: () => ({ getPropertyValue: () => "" }),
        Event: class { constructor(type) { this.type = type; } },
        fetch: async () => response,
        console
    });
    for (const file of ["LoL_Api.js", "LoL_ScoreBord.js", "LoL_GoldChart.js", "LoL_RoleGoldDiff.js"]) {
        vm.runInContext(fs.readFileSync(path.join(root, "js", file), "utf8"), context);
    }

    return {
        classes,
        scoreboard,
        chart: chartWidget,
        roleGoldDiff,
        plots,
        context,
        setResponse(value) { response = value; },
        async refresh(data) {
            response = { ok: true, json: async () => ({ ok: true, data }) };
            await vm.runInContext("fetchGameData()", context);
            vm.runInContext("setPlayerDict({})", context);
            await new Promise(resolve => setImmediate(resolve));
        }
    };
}

function gameData(events) {
    return { allPlayers: [], gameData: { gameMode: "CLASSIC", gameTime: 0 }, events: { Events: events }, activePlayer: { team: "ORDER" } };
}

test("overlays wait for GameStart and reset before the next game", async () => {
    const overlay = createOverlay();
    await overlay.refresh(gameData([{ EventName: "OtherEvent" }]));
    assert.equal(overlay.classes.has("game-start-pending"), true);
    assert.equal(overlay.classes.has("live-client-data-unavailable"), false);
    assert.equal(overlay.scoreboard.innerHTML, "");
    assert.equal(overlay.plots.length, 0);

    await overlay.refresh(gameData([{ EventName: "GameStart" }]));
    assert.equal(overlay.classes.has("game-start-pending"), false);
    assert.match(overlay.scoreboard.innerHTML, /sb-row/);
    assert.deepEqual(overlay.plots.map(plot => plot[0]), ["newPlot", "react"]);
    assert.equal(vm.runInContext("timeData.length", overlay.context), 1);

    await overlay.refresh(gameData([]));
    assert.equal(overlay.classes.has("game-start-pending"), true);
    assert.equal(vm.runInContext("timeData.length", overlay.context), 0);

    await overlay.refresh(gameData([{ EventName: "GameStart" }]));
    assert.equal(overlay.classes.has("game-start-pending"), false);
    assert.equal(vm.runInContext("timeData.length", overlay.context), 1);
});

test("missing events or unavailable game data hide the overlays", async () => {
    const overlay = createOverlay();
    await overlay.refresh(gameData([{ EventName: "GameStart" }]));
    await overlay.refresh({ allPlayers: [], activePlayer: { team: "ORDER" } });
    assert.equal(overlay.classes.has("game-start-pending"), true);

    await overlay.refresh(gameData([{ EventName: "GameStart" }]));
    overlay.setResponse({ ok: true, json: async () => ({ ok: false }) });
    await vm.runInContext("fetchGameData()", overlay.context);
    assert.equal(overlay.classes.has("game-start-pending"), true);
    assert.equal(overlay.classes.has("live-client-data-unavailable"), true);
});

test("each widget independently hides unsupported modes and restores allowed modes", async () => {
    const overlay = createOverlay();
    const data = gameData([{ EventName: "GameStart" }]);
    data.gameData.gameMode = "ARAM";
    await overlay.refresh(data);
    assert.equal(overlay.scoreboard.hidden, false);
    assert.equal(overlay.chart.hidden, false);
    assert.equal(overlay.roleGoldDiff.hidden, true);

    data.gameData.gameMode = "NEW_MODE";
    await overlay.refresh(data);
    assert.equal(overlay.scoreboard.hidden, true);
    assert.equal(overlay.chart.hidden, true);
    assert.equal(overlay.roleGoldDiff.hidden, true);
    assert.equal(vm.runInContext("timeData.length", overlay.context), 0);

    data.gameData.gameMode = "CLASSIC";
    await overlay.refresh(data);
    assert.equal(overlay.scoreboard.hidden, false);
    assert.equal(overlay.chart.hidden, false);
    assert.equal(overlay.roleGoldDiff.hidden, false);
});
