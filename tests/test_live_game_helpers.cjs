const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function setup(fetch) {
    const timers = new Map();
    let timerId = 0;
    const context = vm.createContext({
        window: {}, document: { getElementById() { return null; } },
        console, fetch,
        setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/LoL_Api.js"), "utf8"), context);
    return {
        context,
        async next() {
            const [id, callback] = timers.entries().next().value;
            timers.delete(id);
            callback();
            await flush();
        },
        timers
    };
}

async function flush() {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
}

test("shared helpers normalize modes, events, identities and teams", () => {
    const { context: c } = setup();
    assert.equal(c.getGameTime({ gameData: { gametime: "12.5" } }), 12.5);
    assert.ok(Number.isNaN(c.getGameTime({})));
    assert.equal(c.getGameMode({ gameData: { gameMode: " classic " } }), "CLASSIC");
    assert.equal(c.isAllowedGameMode({ gameData: { gameMode: " classic " } }, ["CLASSIC"]), true);
    const events = [{ EventName: "GameStart" }, { EventName: "GameEnd" }];
    assert.equal(c.findGameEvent(events, "GameEnd"), events[1]);
    assert.equal(c.hasGameEvent(null, "GameStart"), false);
    assert.equal(c.isGameStarted({ events: { Events: events } }), true);
    assert.equal(c.isGameEnded({ events: { Events: events } }), true);
    assert.deepEqual(Array.from(c.getPlayerIdentities({ riotId: " Player#TAG ", summonerName: "PLAYER" })).sort(), ["player", "player#tag"]);
    assert.equal(c.isSamePlayer({ riotId: "Player#tag" }, { riotIdGameName: "player" }), true);
    assert.equal(c.isSamePlayer({}, {}), false);
    const player = { riotId: "Player#tag", team: "CHAOS" };
    const data = { activePlayer: { riotIdGameName: "player" }, allPlayers: [player] };
    assert.equal(c.findActivePlayer(data), player);
    assert.equal(c.getMyTeam(data), "CHAOS");
    assert.equal(c.getMyTeam({ ...data, gameData: { gameMode: " spectator " } }), "ORDER");
    assert.equal(c.isSpectatorGameData({ activePlayer: { riotId: "missing" } }), true);
    assert.equal(c.getEnemyTeam(" chaos "), "ORDER");
    assert.equal(c.getEnemyTeam("unknown"), undefined);
    c.window.myTeam = null;
    assert.equal(c.isAllyTeam("ORDER"), false);
    assert.equal(c.isAllyTeam("CHAOS"), false);
    c.window.myTeam = "CHAOS";
    assert.equal(c.isAllyTeam("chaos"), true);
    c.window.isSpectatorMode = true;
    assert.equal(c.isAllyTeam("ORDER"), true);
    c.initPlayerTeamMap({ data });
    assert.equal(c.window.myTeam, "CHAOS");
});

test("active player matching prefers full IDs and rejects ambiguous or conflicting names", () => {
    const { context: c } = setup();
    const one = { riotId: "Player#ONE", riotIdGameName: "Player" };
    const two = { riotId: "Player#TWO", riotIdGameName: "Player" };
    const partial = { riotIdGameName: "Player" };
    assert.equal(c.findActivePlayer({ activePlayer: { riotId: " player#TWO ", riotIdGameName: "Player" }, allPlayers: [one, partial, two] }), two);
    assert.equal(c.findActivePlayer({ activePlayer: partial, allPlayers: [one, two] }), undefined);
    assert.equal(c.findActivePlayer({ activePlayer: { riotId: "Player#THREE" }, allPlayers: [one, two] }), undefined);
    assert.equal(c.findActivePlayer({ activePlayer: { riotId: "Player#ONE" }, allPlayers: [partial] }), partial);
    assert.equal(c.findActivePlayer({ activePlayer: partial, allPlayers: [one] }), one);
    assert.equal(c.findActivePlayer({ activePlayer: one, allPlayers: [one, { ...one }] }), undefined);
    assert.equal(c.isSamePlayer(one, two), false);
    assert.equal(c.isSamePlayer(one, partial), true);
});

test("fetchLiveGameData returns raw unavailable payload and rejects HTTP failures", async () => {
    let response = { ok: true, json: async () => ({ ok: false }) };
    let args;
    const { context: c } = setup(async (...value) => { args = value; return response; });
    assert.equal((await c.fetchLiveGameData()).ok, false);
    assert.equal(args[0], "/allgamedata");
    assert.equal(args[1].cache, "no-store");
    response = { ok: false, status: 503 };
    await assert.rejects(c.fetchLiveGameData(), /503/);
});

test("watcher deduplicates events, recovers from outages, resets for new games and stops", async () => {
    let root;
    const game = (time, events) => ({ ok: true, data: { gameData: { gameTime: time }, events: { Events: events } } });
    const start = { EventID: 0, EventName: "GameStart" };
    const kill = { EventID: 1, EventName: "ChampionKill" };
    const end = { EventID: 2, EventName: "GameEnd" };
    root = game(10, [start, kill, kill]);
    const calls = [];
    const env = setup(async () => ({ ok: true, json: async () => root }));
    const watcher = env.context.createGameLifecycleWatcher({
        onStart: data => calls.push(`start:${data.gameData.gameTime}`),
        onEvent: event => calls.push(event.EventName),
        onEnd: () => calls.push("end"),
        onUnavailable: () => calls.push("unavailable")
    });
    await flush();
    root = { ok: false };
    await env.next();
    await env.next();
    root = game(20, [start, kill, end]);
    await env.next();
    await env.next();
    root = game(1, [start]);
    await env.next();
    assert.deepEqual(calls, ["start:10", "GameStart", "ChampionKill", "unavailable", "GameEnd", "end", "start:1", "GameStart"]);
    watcher.stop();
    assert.equal(env.timers.size, 0);
    watcher.start();
    await flush();
    assert.equal(calls.length, 8);
    watcher.stop();
});

test("watcher never overlaps fetches, even if stopped and restarted during a request", async () => {
    let resolve;
    let requests = 0;
    const env = setup(() => {
        requests++;
        return new Promise(done => { resolve = done; });
    });

    const watcher = env.context.createGameLifecycleWatcher();
    assert.equal(requests, 1);
    watcher.stop();
    watcher.start();
    assert.equal(requests, 1);
    resolve({ ok: true, json: async () => ({ ok: true, data: {} }) });
    await flush();
    assert.equal(env.timers.size, 1);
    await env.next();
    assert.equal(requests, 2);
    watcher.stop();
    resolve({ ok: true, json: async () => ({ ok: true, data: {} }) });
    await flush();
    assert.equal(env.timers.size, 0);
});

test("watcher reports each valid poll and preserves lifecycle through missing events", async () => {
    let data = { gameData: { gameTime: 1 }, events: { Events: [{ EventID: 0, EventName: "GameStart" }] } };
    const calls = [];
    const env = setup(async () => ({ ok: true, json: async () => ({ ok: true, data }) }));
    const watcher = env.context.createGameLifecycleWatcher({
        onData: () => calls.push("data"),
        onStart: () => calls.push("start"),
        onEvent: () => calls.push("event")
    });
    await flush();
    data = { gameData: { gameTime: 2 } };
    await env.next();
    data = { gameData: { gameTime: 3 }, events: { Events: [{ EventID: 0, EventName: "GameStart" }] } };
    await env.next();
    assert.deepEqual(calls, ["data", "start", "event", "data", "data"]);
    watcher.stop();
});

test("watcher detects a new started game after end and outage even with increasing time and reused IDs", async () => {
    const start = { EventID: 0, EventName: "GameStart", EventTime: 0 };
    const end = { EventID: 1, EventName: "GameEnd" };
    let root = { ok: true, data: { gameData: { gameTime: 10 }, events: { Events: [start, end] } } };
    const calls = [];
    const env = setup(async () => ({ ok: true, json: async () => root }));
    const watcher = env.context.createGameLifecycleWatcher({
        onStart: () => calls.push("start"),
        onEnd: () => calls.push("end"),
        onEvent: event => calls.push(event.EventName),
        onUnavailable: () => calls.push("unavailable")
    });
    await flush();
    root = { ok: false };
    await env.next();
    root = { ok: true, data: { gameData: { gameTime: 20 }, events: { Events: [start] } } };
    await env.next();
    await env.next();
    assert.deepEqual(calls, ["start", "GameStart", "GameEnd", "end", "unavailable", "start", "GameStart"]);
    watcher.stop();
});

test("watcher resets when GameStart ID or time changes", async () => {
    let event = { EventID: 0, EventName: "GameStart", EventTime: 0 };
    const calls = [];
    const env = setup(async () => ({
        ok: true,
        json: async () => ({ ok: true, data: { gameData: { gameTime: 100 }, events: { Events: [event] } } })
    }));
    const watcher = env.context.createGameLifecycleWatcher({
        onStart: () => calls.push("start"),
        onEvent: () => calls.push("event")
    });
    await flush();
    event = { ...event, EventTime: 1 };
    await env.next();
    event = { ...event, EventID: 1 };
    await env.next();
    assert.deepEqual(calls, ["start", "event", "start", "event", "start", "event"]);
    watcher.stop();
});
