const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createElement() {
    return {
        children: [],
        listeners: {},
        classList: {
            add() {},
            remove() {},
            toggle() {}
        },
        append(...elements) { this.children.push(...elements); },
        appendChild(element) { this.children.push(element); return element; },
        addEventListener(type, listener) { this.listeners[type] = listener; },
        replaceChildren(...elements) { this.children = elements; },
        setAttribute() {}
    };
}

function findByClass(element, className) {
    if (element.className === className) return element;
    for (const child of element.children ?? []) {
        const found = findByClass(child, className);
        if (found) return found;
    }
    return null;
}

function createOverlay() {
    const canvas = createElement();
    const confirmationMessages = [];
    let confirmResult = true;
    let gameResponse = { ok: true, data: { allPlayers: [] } };
    let gameHttpOk = true;
    const stored = new Map([
        ["lol-overlay.champion-skills.lineup", JSON.stringify({
            ORDER: { TOP: "Ahri" },
            CHAOS: {}
        })]
    ]);
    const responseFor = url => {
        if (url === "/allgamedata") {
            return gameResponse;
        }
        if (url === "/champions") {
            return { ok: true, data: { data: {
                Ahri: { id: "Ahri", name: "Ahri", tags: ["Mage"] }
            } } };
        }
        if (url === "/champion/Ahri") {
            return { ok: true, data: { data: {
                Ahri: { name: "Ahri", spells: [] }
            } } };
        }
        throw new Error(`unexpected request: ${url}`);
    };
    const context = vm.createContext({
        document: {
            getElementById: () => canvas,
            createElement
        },
        window: {
            setInterval() {},
            confirm(message) {
                confirmationMessages.push(message);
                return confirmResult;
            }
        },
        localStorage: {
            getItem(key) { return stored.get(key) ?? null; },
            setItem(key, value) { stored.set(key, value); }
        },
        fetch: async url => ({
            ok: url !== "/allgamedata" || gameHttpOk,
            status: 503,
            json: async () => responseFor(url)
        }),
        console: { error() {} },
        setInterval() {}
    });
    const source = fs.readFileSync(
        path.join(__dirname, "..", "js", "LoL_ChampionSkills.js"),
        "utf8"
    );
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "LoL_Api.js"), "utf8"), context);
    vm.runInContext(source, context);
    return {
        canvas,
        context,
        stored,
        confirmationMessages,
        setGameResponse(value) { gameResponse = value; },
        setGameHttpOk(value) { gameHttpOk = value; },
        setConfirmResult(value) { confirmResult = value; }
    };
}

test("manual mode can reset all champions, while live mode has no reset button", async () => {
    const { canvas, context, stored, confirmationMessages, setConfirmResult } = createOverlay();
    await new Promise(resolve => setImmediate(resolve));

    const manualResetButton = findByClass(canvas, "champion-skills-reset");
    assert.ok(manualResetButton);
    assert.equal(manualResetButton.textContent, "リセット");
    assert.deepEqual(
        canvas.children[0].children[0].children.map(element => element.className),
        [
            "champion-skills-mode-label",
            "champion-skills-setup-toggle",
            "champion-skills-reset",
            "champion-skills-description-toggle"
        ]
    );
    assert.equal(vm.runInContext("championSkillsCurrentMode", context), "manual");

    setConfirmResult(false);
    await manualResetButton.listeners.click();
    assert.equal(
        JSON.parse(stored.get("lol-overlay.champion-skills.lineup")).ORDER.TOP,
        "Ahri"
    );

    setConfirmResult(true);
    await manualResetButton.listeners.click();
    assert.deepEqual(confirmationMessages, [
        "全チャンピオンの設定をリセットします。よろしいですか？",
        "全チャンピオンの設定をリセットします。よろしいですか？"
    ]);
    const lineup = JSON.parse(stored.get("lol-overlay.champion-skills.lineup"));
    for (const team of ["ORDER", "CHAOS"]) {
        for (const role of ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]) {
            assert.equal(lineup[team][role], null);
        }
    }
    assert.equal(
        vm.runInContext("championSkillsSetupNotice", context),
        "全チャンピオンをリセットしました"
    );

    vm.runInContext(
        'renderChampionSkillsBoard(createChampionSkillsManualTeams(), "live")',
        context
    );
    assert.equal(findByClass(canvas, "champion-skills-reset"), null);
});

test("live board survives two unavailable polls and resets after the third", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    vm.runInContext('championSkillsCurrentMode = "live"', overlay.context);
    overlay.setGameResponse({ ok: false });
    await vm.runInContext("updateChampionSkills()", overlay.context);
    overlay.setGameHttpOk(false);
    await vm.runInContext("updateChampionSkills()", overlay.context);
    assert.equal(vm.runInContext("championSkillsCurrentMode", overlay.context), "live");
    assert.equal(vm.runInContext("championSkillsEndPollFailures", overlay.context), 2);
    overlay.setGameHttpOk(true);
    await vm.runInContext("updateChampionSkills()", overlay.context);
    assert.equal(vm.runInContext("championSkillsCurrentMode", overlay.context), "manual");
    assert.equal(vm.runInContext("championSkillsEndPollFailures", overlay.context), 0);
});

test("empty players end the live board immediately but malformed players do not", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    vm.runInContext('championSkillsCurrentMode = "live"', overlay.context);
    overlay.setGameResponse({ ok: true, data: {} });
    await vm.runInContext("updateChampionSkills()", overlay.context);
    assert.equal(vm.runInContext("championSkillsCurrentMode", overlay.context), "live");
    assert.equal(vm.runInContext("championSkillsEndPollFailures", overlay.context), 0);
    overlay.setGameResponse({ ok: true, data: { allPlayers: [] } });
    await vm.runInContext("updateChampionSkills()", overlay.context);
    assert.equal(vm.runInContext("championSkillsCurrentMode", overlay.context), "manual");
});
