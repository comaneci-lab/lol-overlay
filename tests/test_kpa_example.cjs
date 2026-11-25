const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createOverlay() {
    const widget = { hidden: true };
    const players = { children: [], replaceChildren(...children) { this.children = children; } };
    const errors = [];
    let response = { ok: false, error: "not in game" };
    let fetches = 0;
    let fetchGate = null;
    const context = vm.createContext({
        document: {
            getElementById(id) { return id === "kpa-widget" ? widget : players; },
            createElement() {
                return {
                    textContent: "",
                    children: [],
                    append(...children) { this.children.push(...children); }
                };
            }
        },
        fetch: async () => {
            fetches++;
            if (fetchGate) await fetchGate;
            return { ok: true, json: async () => response };
        },
        setInterval() {},
        console: { error(...args) { errors.push(args); } }
    });
    const file = path.join(__dirname, "..", "examples", "kpa", "js", "Dev_KPA.js");
    vm.runInContext(fs.readFileSync(file, "utf8"), context);
    return {
        widget,
        errors,
        get fetches() { return fetches; },
        setResponse(value) { response = value; },
        blockFetch() {
            let release;
            fetchGate = new Promise(resolve => { release = resolve; });
            return () => { fetchGate = null; release(); };
        },
        async update() { await vm.runInContext("updateKpa()", context); },
        rows() { return players.children.map(row => row.children.map(cell => cell.textContent)); }
    };
}

function player(team, name, kills, assists) {
    return { team, riotId: name, scores: { kills, assists } };
}

function gameData() {
    return {
        ok: true,
        data: {
            isSpectatorMode: false,
            gameData: { gameMode: "CLASSIC" },
            activePlayer: { riotId: "Ally#1" },
            allPlayers: [
                player("ORDER", "Ally#1", 2, 3),
                player("ORDER", "Other#2", 8, 1),
                player("CHAOS", "Enemy#3", 9, 0)
            ]
        }
    };
}

test("KPA uses the active player's team and that team's kill total", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    overlay.setResponse(gameData());
    await overlay.update();
    assert.equal(overlay.widget.hidden, false);
    assert.deepEqual(overlay.rows(), [["Ally#1", "50.0%"], ["Other#2", "90.0%"]]);

    const data = gameData();
    data.data.activePlayer = { team: "CHAOS" };
    overlay.setResponse(data);
    await overlay.update();
    assert.deepEqual(overlay.rows(), [["Enemy#3", "100.0%"]]);
});

test("zero team kills displays 0% and unsupported modes hide the widget", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    const data = gameData();
    data.data.allPlayers[0].scores = { kills: 0, assists: 0 };
    data.data.allPlayers[1].scores = { kills: 0, assists: 0 };
    overlay.setResponse(data);
    await overlay.update();
    assert.deepEqual(overlay.rows(), [["Ally#1", "0%"], ["Other#2", "0%"]]);
    data.data.isSpectatorMode = true;
    await overlay.update();
    assert.equal(overlay.widget.hidden, true);
    data.data.isSpectatorMode = false;
    data.data.gameData.gameMode = "OTHER";
    await overlay.update();
    assert.equal(overlay.widget.hidden, true);
});

test("invalid or unavailable data hides the widget and reports errors", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    const data = gameData();
    overlay.setResponse(data);
    await overlay.update();
    assert.equal(overlay.widget.hidden, false);
    data.data.allPlayers[1].scores.kills = null;
    await overlay.update();
    assert.equal(overlay.widget.hidden, true);
    assert.match(String(overlay.errors.at(-1)[1]), /キル/);
    const errorCount = overlay.errors.length;
    await overlay.update();
    assert.equal(overlay.errors.length, errorCount);
    overlay.setResponse({ ok: false, error: "API unavailable" });
    await overlay.update();
    assert.equal(overlay.widget.hidden, true);
    assert.match(String(overlay.errors.at(-1)[1]), /API unavailable/);
    overlay.setResponse(gameData());
    await overlay.update();
    assert.equal(overlay.widget.hidden, false);
});

test("does not select an arbitrary team for ambiguous identities", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    const data = gameData();
    data.data.allPlayers[2].riotId = "Ally#1";
    overlay.setResponse(data);
    await overlay.update();
    assert.equal(overlay.widget.hidden, true);
    assert.match(String(overlay.errors.at(-1)[1]), /自チーム/);
});

test("missing spectator status hides the widget instead of assuming player mode", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    const data = gameData();
    delete data.data.isSpectatorMode;
    overlay.setResponse(data);
    await overlay.update();
    assert.equal(overlay.widget.hidden, true);
    assert.match(String(overlay.errors.at(-1)[1]), /観戦モード/);
});

test("does not start a second request while an update is in flight", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    overlay.setResponse(gameData());
    const release = overlay.blockFetch();
    const first = overlay.update();
    const fetches = overlay.fetches;
    await overlay.update();
    assert.equal(overlay.fetches, fetches);
    release();
    await first;
    assert.equal(overlay.widget.hidden, false);
});
