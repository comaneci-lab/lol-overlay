const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createOverlay(file) {
    const classes = new Set();
    const canvas = {
        hidden: false,
        children: [],
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            }
        },
        appendChild(child) { this.children.push(child); },
        replaceChildren() { this.children = []; }
    };
    const element = () => ({
        hidden: false,
        classList: { add() {}, remove() {}, toggle() {} },
        append() {},
        appendChild() {},
        replaceChildren() {},
        setAttribute() {}
    });
    let response = { ok: false };
    const context = vm.createContext({
        document: {
            getElementById: () => canvas,
            createElement: element
        },
        window: { setInterval() {}, clearInterval() {}, setTimeout() {} },
        setInterval() {},
        localStorage: { getItem() { return null; } },
        fetch: async () => ({ ok: true, json: async () => response }),
        console: { error() {}, log() {}, warn() {}, groupCollapsed() {}, table() {}, groupEnd() {} }
    });
    const api = fs.readFileSync(path.join(__dirname, "..", "js", "LoL_Api.js"), "utf8");
    vm.runInContext(api, context);
    const source = fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8");
    vm.runInContext(source, context);
    return {
        canvas, classes, context,
        setResponse(value) { response = value; },
        async update(expression) { await vm.runInContext(expression, context); }
    };
}

function gameData(mode) {
    return {
        ok: true,
        data: {
            gameData: { gameMode: mode, gameTime: 180 },
            events: { Events: [{ EventName: "GameStart" }] },
            allPlayers: [{ team: "ORDER", riotId: "player", scores: { creepScore: 30 } }],
            activePlayer: { team: "ORDER", riotId: "player" }
        }
    };
}

test("CS is shown only in configured modes and can reappear", async () => {
    const overlay = createOverlay("LoL_CSPerMinute.js");
    await new Promise(resolve => setImmediate(resolve));
    for (const [mode, hidden] of [["ARAM", false], ["BRAWL", true], ["CLASSIC", false]]) {
        overlay.setResponse(gameData(mode));
        await overlay.update("updateActivePlayerCs()");
        assert.equal(overlay.canvas.hidden, hidden);
    }
});

test("CS matches normalized active player identities", async () => {
    const overlay = createOverlay("LoL_CSPerMinute.js");
    await new Promise(resolve => setImmediate(resolve));
    const data = gameData("CLASSIC");
    data.data.activePlayer = { riotIdGameName: " Player " };
    data.data.allPlayers[0].riotId = "player#JP1";
    overlay.setResponse(data);
    await overlay.update("updateActivePlayerCs()");
    assert.equal(overlay.canvas.textContent, "10.0CS/分");
    assert.equal(overlay.canvas.hidden, false);
    data.data.activePlayer.riotIdGameName = "someone else";
    await overlay.update("updateActivePlayerCs()");
    assert.equal(overlay.canvas.hidden, true);
});

test("object timer hides unsupported modes and starts fresh in a supported mode", async () => {
    const overlay = createOverlay("LoL_ObjectTimer.js");
    await new Promise(resolve => setImmediate(resolve));
    overlay.setResponse(gameData("CLASSIC"));
    await overlay.update("updateObjectTimers()");
    assert.equal(vm.runInContext("objectTimerWidget.hidden", overlay.context), false);
    overlay.setResponse(gameData("ARAM"));
    await overlay.update("updateObjectTimers()");
    assert.equal(vm.runInContext("objectTimerWidget.hidden", overlay.context), true);
    assert.equal(vm.runInContext("objectTimerGameStarted", overlay.context), false);
    overlay.setResponse(gameData("CLASSIC"));
    await overlay.update("updateObjectTimers()");
    assert.equal(vm.runInContext("objectTimerWidget.hidden", overlay.context), false);
});

test("runes and splash remain hidden in unsupported modes before starting", async () => {
    for (const [file, update, started] of [
        ["LoL_PlayerRunes.js", "updatePlayerRunes()", "playerRunesShown"],
        ["LoL_GameStartSplash.js", "updateGameStartSplash()", "gameStartSplashStarted"]
    ]) {
        const overlay = createOverlay(file);
        await new Promise(resolve => setImmediate(resolve));
        overlay.setResponse(gameData("BRAWL"));
        await overlay.update(update);
        assert.equal(overlay.classes.has("game-mode-disallowed"), true);
        assert.equal(vm.runInContext(started, overlay.context), false);
        const allowed = gameData("CLASSIC");
        allowed.data.events.Events = [];
        overlay.setResponse(allowed);
        await overlay.update(update);
        assert.equal(overlay.classes.has("game-mode-disallowed"), false);
    }
});

test("runes and splash hide during an active display when the mode changes", async () => {
    for (const [file, update, started] of [
        ["LoL_PlayerRunes.js", "updatePlayerRunes()", "playerRunesShown"],
        ["LoL_GameStartSplash.js", "updateGameStartSplash()", "gameStartSplashStarted"]
    ]) {
        const overlay = createOverlay(file);
        await new Promise(resolve => setImmediate(resolve));
        vm.runInContext(`${started} = true`, overlay.context);
        overlay.setResponse(gameData("BRAWL"));
        await overlay.update(update);
        assert.equal(overlay.classes.has("game-mode-disallowed"), true);
        overlay.setResponse(gameData("CLASSIC"));
        await overlay.update(update);
        assert.equal(overlay.classes.has("game-mode-disallowed"), false);
    }
});

test("skill level-up clears notifications in unsupported modes", async () => {
    const overlay = createOverlay("LoL_SkillLevelUp.js");
    await new Promise(resolve => setImmediate(resolve));
    const data = gameData("ARAM");
    data.data.activePlayer.abilities = { Q: { id: "spell", abilityLevel: 1 } };
    overlay.setResponse(data);
    await overlay.update("updateSkillLevelUp()");
    data.data.activePlayer.abilities.Q.abilityLevel = 2;
    await overlay.update("updateSkillLevelUp()");
    assert.equal(vm.runInContext("skillLevelUpWidget.hidden", overlay.context), false);
    data.data.gameData.gameMode = "BRAWL";
    await overlay.update("updateSkillLevelUp()");
    assert.equal(vm.runInContext("skillLevelUpWidget.hidden", overlay.context), true);
    assert.equal(vm.runInContext("skillLevelUpAbilities", overlay.context), null);
});

test("champion skills restores manual mode when game data becomes unavailable", async () => {
    const overlay = createOverlay("LoL_ChampionSkills.js");
    await new Promise(resolve => setImmediate(resolve));
    vm.runInContext('championSkillsCurrentMode = "manual"', overlay.context);
    overlay.setResponse(gameData("BRAWL"));
    await overlay.update("updateChampionSkills()");
    assert.equal(overlay.canvas.hidden, true);
    overlay.setResponse({ ok: false });
    await overlay.update("updateChampionSkills()");
    assert.equal(overlay.canvas.hidden, false);
    assert.equal(vm.runInContext("championSkillsCurrentMode", overlay.context), "manual");
});
