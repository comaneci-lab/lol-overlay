const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createOverlay() {
    class Element {
        constructor() {
            this.children = [];
            this.style = {};
            this.classList = { toggle() {} };
            this.hidden = false;
        }
        append(...elements) { this.children.push(...elements); }
        appendChild(element) { this.children.push(element); }
        replaceChildren(...elements) { this.children = elements; }
        get clientWidth() { return this.className === "gold-chart-event-timeline" ? 444 : 504; }
    }

    const canvas = new Element();
    const widget = new Element();
    const chart = new Element();
    const events = new Element();
    const elements = { "overlay-canvas": canvas, goldChartWidget: widget, goldChart: chart, goldChartEvents: events };
    const listeners = new Map();
    const plots = [];
    const warnings = [];
    let response;
    const window = {
        Plotly: {
            async newPlot() {},
            react(id, traces, layout) {
                plots.push(JSON.parse(JSON.stringify({
                    traces, xaxis: layout.xaxis, yaxis: layout.yaxis, shapes: layout.shapes,
                    plot_bgcolor: layout.plot_bgcolor, paper_bgcolor: layout.paper_bgcolor
                })));
            }
        },
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(callback);
        },
        dispatchEvent(event) {
            for (const listener of listeners.get(event.type) ?? []) listener(event);
        }
    };
    const context = vm.createContext({
        window,
        document: {
            documentElement: {},
            getElementById: id => elements[id] ?? null,
            createElement: () => new Element()
        },
        getComputedStyle: () => ({
            getPropertyValue: name => ({
                "--chart-ally-fill": "ally-color",
                "--chart-enemy-fill": "enemy-color",
                "--chart-ally-kill": "ally-kill",
                "--chart-enemy-kill": "enemy-kill"
            })[name] ?? ""
        }),
        Event: class { constructor(type) { this.type = type; } },
        fetch: async () => ({ ok: true, json: async () => response }),
        console: { error: (...args) => { throw new Error(args.join(" ")); }, warn: (...args) => warnings.push(args) }
    });
    for (const name of ["LoL_Api.js", "LoL_GoldChart.js"]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", name), "utf8"), context);
    }

    return {
        context, widget, events, plots, warnings,
        async refresh(data, players = {}) {
            response = { ok: true, data };
            await vm.runInContext("fetchGameData()", context);
            context.snapshot = response;
            context.players = players;
            vm.runInContext("initPlayerTeamMap(snapshot); setPlayerDict(players)", context);
            await new Promise(resolve => setImmediate(resolve));
        },
        row(team) { return events.children.find(row => row.children[0].textContent === team); },
        markers(team) { return this.row(team).children[1].children; }
    };
}

function gameData(time, events, activeTeam = "ORDER") {
    return {
        gameData: { gameMode: "CLASSIC", gameTime: time },
        allPlayers: [
            { riotId: "Blue#one", summonerName: "Blue", team: "ORDER" },
            { riotId: "Red#two", summonerName: "Red", team: "CHAOS" }
        ],
        activePlayer: { team: activeTeam },
        events: { Events: [{ EventID: 0, EventName: "GameStart" }, ...events] }
    };
}

test("event rows use game time, team attribution, 30-second groups and objective icons", async () => {
    const overlay = createOverlay();
    const events = [
        { EventID: 1, EventName: "ChampionKill", EventTime: 60, KillerName: "Blue#one" },
        { EventID: 2, EventName: "ChampionKill", EventTime: 89, KillerName: "Blue" },
        { EventID: 2, EventName: "ChampionKill", EventTime: 89, KillerName: "Blue" },
        { EventID: 3, EventName: "ChampionKill", EventTime: 90, KillerName: "Blue" },
        { EventID: 4, EventName: "ChampionKill", EventTime: 70, KillerName: "Red#two" },
        { EventID: 5, EventName: "TurretKilled", EventTime: 95, KillerName: "Minion", TurretKilled: "Turret_TChaos_L0_P1" },
        ...["HordeKill", "DragonKill", "HeraldKill", "BaronKill"].map((name, i) => ({
            EventID: 6 + i, EventName: name, EventTime: 100 + i, KillerTeam: "CHAOS"
        }))
    ];
    await overlay.refresh(gameData(150, events, "CHAOS"));
    assert.deepEqual(overlay.plots.at(-1).traces[0].x, [150]);
    assert.deepEqual(overlay.plots.at(-1).xaxis.range, [0, 1500]);
    assert.equal(overlay.plots.at(-1).plot_bgcolor, "rgba(0,0,0,0)");
    assert.equal(overlay.plots.at(-1).paper_bgcolor, "rgba(0,0,0,0)");
    assert.equal(overlay.row("ORDER").style.background, "enemy-color");
    assert.equal(overlay.row("CHAOS").style.background, "ally-color");

    const order = overlay.markers("ORDER");
    assert.equal(order.length, 3);
    assert.equal(order[0].children[0].style.width, "8px");
    assert.equal(order[0].children[0].style.background, "enemy-kill");
    assert.equal(order[1].children[0].style.width, "6px");
    assert.equal(overlay.markers("CHAOS")[0].children[0].style.background, "ally-kill");
    assert.match(order[0].title, /×2/);
    assert.equal(order[2].children[0].src, "../assets/icon_tower.png");
    assert.equal(Number.parseFloat(order[0].style.left), 60 / 1500 * 444);
    assert.deepEqual(overlay.markers("CHAOS").slice(1).map(marker => marker.children[0].src), [
        "../assets/icon_voidclub.png", "../assets/icon_dragon.png",
        "../assets/icon_herald.png", "../assets/icon_baron.png"
    ]);
    assert.equal(overlay.row("CHAOS").style.height, undefined);
    assert.equal(overlay.markers("CHAOS")[1].style.top, overlay.markers("CHAOS")[2].style.top);
});

test("snapshot refresh, time rewind and unavailable data reset event history", async () => {
    const overlay = createOverlay();
    const kill = { EventID: 1, EventName: "ChampionKill", EventTime: 25, KillerName: "Blue" };
    await overlay.refresh(gameData(100, [kill]));
    await overlay.refresh(gameData(100, [kill]));
    assert.equal(overlay.markers("ORDER").length, 1);
    assert.equal(vm.runInContext("timeData.length", overlay.context), 1);

    await overlay.refresh(gameData(5, []));
    assert.deepEqual(overlay.plots.at(-1).traces[0].x, [5]);
    assert.equal(overlay.markers("ORDER").length, 0);

    await overlay.refresh({ allPlayers: [], gameData: { gameMode: "CLASSIC", gameTime: 0 }, events: { Events: [] } });
    assert.equal(overlay.events.children.length, 0);
    assert.equal(vm.runInContext("timeData.length", overlay.context), 0);
});

test("spectator colors and invalid event or game times are handled explicitly", async () => {
    const overlay = createOverlay();
    const data = gameData(100, [
        { EventID: 1, EventName: "DragonKill", EventTime: 50, KillerName: "unknown" },
        { EventID: 2, EventName: "BaronKill", KillerTeam: "ORDER" }
    ]);
    delete data.activePlayer;
    await overlay.refresh(data);
    assert.equal(overlay.row("ORDER").style.background, "ally-color");
    assert.equal(overlay.row("CHAOS").style.background, "enemy-color");
    assert.equal(overlay.warnings.length, 2);
    assert.equal(overlay.markers("ORDER").length, 0);
    await overlay.refresh(data);
    assert.equal(overlay.warnings.length, 2);
    data.gameData.gameTime = null;
    await overlay.refresh(data);
    assert.equal(overlay.warnings.length, 3);
});

test("sign changes do not mutate samples when a game-time point is refreshed", async () => {
    const overlay = createOverlay();
    await overlay.refresh(gameData(10, []), { a: { team: "ORDER", total_price: 100 } });
    await overlay.refresh(gameData(11, []), { b: { team: "CHAOS", total_price: 100 } });
    await overlay.refresh(gameData(11, []), { b: { team: "CHAOS", total_price: 200 } });
    assert.deepEqual(Array.from(vm.runInContext("timeData", overlay.context)), [10, 11]);
    assert.deepEqual(Array.from(vm.runInContext("goldDiffData", overlay.context)), [100, -200]);
});

test("event attribution uses the current player list after a new game", async () => {
    const overlay = createOverlay();
    const kill = { EventID: 1, EventName: "ChampionKill", EventTime: 3, KillerName: "Blue#one" };
    await overlay.refresh(gameData(100, [kill]));
    const next = gameData(5, [kill]);
    next.allPlayers[0].team = "CHAOS";
    await overlay.refresh(next);
    assert.equal(overlay.markers("ORDER").length, 0);
    assert.equal(overlay.markers("CHAOS").length, 1);
});

test("objectives are rendered above champion kills and later objectives above earlier ones", async () => {
    const overlay = createOverlay();
    await overlay.refresh(gameData(200, [
        { EventID: 1, EventName: "DragonKill", EventTime: 101, KillerTeam: "ORDER" },
        { EventID: 2, EventName: "ChampionKill", EventTime: 102, KillerTeam: "ORDER" },
        { EventID: 3, EventName: "TurretKilled", EventTime: 100, KillerTeam: "ORDER" }
    ]));
    const markers = overlay.markers("ORDER");
    assert.equal(markers[0].children[0].className, "gold-chart-kill-dot");
    assert.equal(markers[1].children[0].alt, "タワー");
    assert.equal(markers[2].children[0].alt, "ドラゴン");
    assert.equal(markers[0].style.top, markers[2].style.top);
    assert.ok(Math.abs(parseFloat(markers[0].style.left) - parseFloat(markers[2].style.left)) < 22);
});

test("time axis starts at 25 minutes and grows by a minute at each minute after 24", async () => {
    const overlay = createOverlay();
    for (const [time, end] of [[0, 1500], [1439, 1500], [1440, 1500], [1499.9, 1500],
        [1500, 1560], [1559.9, 1560], [1560, 1620], [1850, 1860]]) {
        await overlay.refresh(gameData(time, []));
        const plot = overlay.plots.at(-1);
        assert.deepEqual(plot.xaxis.range, [0, end]);
        assert.equal(plot.shapes[0].x1, end);
        assert.equal(plot.xaxis.ticktext[5], "25分");
    }
    assert.equal(overlay.plots.at(-1).xaxis.ticktext[6], "30分");
});

test("gold axis has 1k grid spacing and expands symmetrically at each boundary", async () => {
    const overlay = createOverlay();
    for (const [time, diff, limit] of [[1, 4999, 5000], [2, 5000, 6000], [3, 5001, 6000],
        [4, 10500, 11000], [5, -11000, 12000], [6, 200, 12000]]) {
        const players = diff >= 0
            ? { p: { team: "ORDER", total_price: diff } }
            : { p: { team: "CHAOS", total_price: -diff } };
        await overlay.refresh(gameData(time, []), players);
        const axis = overlay.plots.at(-1).yaxis;
        assert.equal(axis.dtick, 1000);
        assert.deepEqual(axis.range, [-limit, limit]);
        assert.deepEqual(axis.tickvals, Array.from({ length: 2 * limit / 1000 + 1 }, (_, index) => -limit + index * 1000));
        assert.ok(axis.ticktext.filter(Boolean).length <= 9);
    }
    await overlay.refresh(gameData(0, []));
    assert.deepEqual(overlay.plots.at(-1).yaxis.range, [-5000, 5000]);
});
