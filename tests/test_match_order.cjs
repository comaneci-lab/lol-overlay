const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

class Element {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.hidden = false;
        this.attributes = {};
        this.classNames = new Set();
        this.classList = {
            add: name => this.classNames.add(name),
            toggle: (name, enabled) => enabled
                ? this.classNames.add(name)
                : this.classNames.delete(name)
        };
    }

    set className(value) {
        this.classNames = new Set(String(value).split(/\s+/).filter(Boolean));
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    append(...children) {
        this.children.push(...children);
    }

    replaceChildren(...children) {
        this.children = children;
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    get textContent() {
        return this.text ?? this.children.map(child => child.textContent).join("");
    }

    set textContent(value) {
        this.text = String(value);
        this.children = [];
    }
}

function createOverlay() {
    const canvas = new Element("div");
    let response = { ok: false, error: "not available" };
    let httpStatus = 200;
    let fetchError = null;
    const errors = [];
    const context = vm.createContext({
        document: {
            getElementById: () => canvas,
            createElement: tagName => new Element(tagName)
        },
        window: { setInterval() {} },
        fetch: async url => {
            if (url === "/allgamedata") {
                if (fetchError) throw fetchError;
                return { ok: httpStatus === 200, status: httpStatus, json: async () => response };
            }
            if (url === "/champions") {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        data: { data: { Ahri: { id: "Ahri", name: "Ahri" } } }
                    })
                };
            }
            if (url === "/champion/Ahri") {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        data: { data: { Ahri: { spells: [] } } }
                    })
                };
            }
            throw new Error(`unexpected request: ${url}`);
        },
        console: { error: (...args) => errors.push(args) }
    });

    vm.runInContext(fs.readFileSync(path.join(root, "js", "LoL_Api.js"), "utf8"), context);
    vm.runInContext(
        fs.readFileSync(path.join(root, "js", "LoL_MatchOrder.js"), "utf8"),
        context
    );

    return {
        context,
        errors,
        setResponse(value) { response = value; },
        setHttpStatus(value) { httpStatus = value; },
        setFetchError(value) { fetchError = value; },
        async update() {
            await vm.runInContext("updateMatchOrder()", context);
        },
        isHidden() {
            return vm.runInContext("matchOrderWidget.hidden", context);
        },
        widget() {
            return vm.runInContext("matchOrderWidget", context);
        }
    };
}

function findElements(element, className) {
    return [
        ...(element.classNames.has(className) ? [element] : []),
        ...element.children.flatMap(child => findElements(child, className))
    ];
}

const player = {
    riotIdGameName: "Player",
    summonerName: "Player",
    team: "ORDER",
    championName: "Ahri"
};
const gameStart = { EventID: 1, EventName: "GameStart" };

function gameData(events, levels, items = [], gameTime = 0) {
    return {
        ok: true,
        data: {
            allPlayers: [{ ...player, items }],
            activePlayer: {
                ...player,
                abilities: Object.fromEntries(
                    ["Q", "W", "E", "R"].map(key => [
                        key,
                        { abilityLevel: levels[key] ?? 0 }
                    ])
                )
            },
            gameData: { gameTime, gameMode: "CLASSIC" },
            events: { Events: events }
        }
    };
}

test("records the active player's skill and item orders until GameEnd", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));

    overlay.setResponse(gameData([gameStart], {}));
    await overlay.update();
    assert.equal(overlay.isHidden(), true);

    overlay.setResponse(gameData([gameStart], { Q: 1 }, [], 30));
    await overlay.update();
    overlay.setResponse(gameData(
        [gameStart],
        { Q: 1, W: 1 },
        [{ itemID: 1001, count: 1 }],
        65
    ));
    await overlay.update();
    overlay.setResponse(gameData([
        gameStart,
        { EventID: 3, EventName: "GameEnd" }
    ], { Q: 1, W: 1 }, [{ itemID: 1001, count: 1 }], 100));
    await overlay.update();

    assert.equal(overlay.isHidden(), false);
    const widget = overlay.widget();
    assert.deepEqual(
        findElements(widget, "match-order-skill-learned").map(cell => cell.textContent),
        ["1", "2"]
    );
    assert.deepEqual(
        findElements(widget, "match-order-item-time").map(label => label.textContent),
        ["1 min"]
    );

    overlay.setResponse({ ok: false, error: "Live Client Data API unavailable" });
    await overlay.update();
    await overlay.update();
    await overlay.update();
    assert.equal(overlay.isHidden(), true);

    overlay.setResponse(gameData([gameStart], {}));
    await overlay.update();
    assert.equal(overlay.isHidden(), true);
    overlay.setResponse(gameData(
        [gameStart],
        {},
        [{ itemID: 3006, count: 1 }],
        20
    ));
    await overlay.update();
    assert.deepEqual(
        Array.from(vm.runInContext("matchOrderPurchases.map(item => item.itemId)", overlay.context)),
        [3006]
    );
    assert.deepEqual(
        Array.from(vm.runInContext("matchOrderSkillSequence", overlay.context)),
        []
    );
});

test("unsupported modes clear match history and do not display the result", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    const data = gameData([gameStart], { Q: 1 });
    data.data.gameData.gameMode = "ARAM";
    overlay.setResponse(data);
    await overlay.update();
    assert.equal(vm.runInContext("matchOrderStarted", overlay.context), true);

    data.data.gameData.gameMode = "NEW_MODE";
    data.data.events.Events.push({ EventID: 2, EventName: "GameEnd" });
    await overlay.update();
    assert.equal(overlay.isHidden(), true);
    assert.equal(vm.runInContext("matchOrderStarted", overlay.context), false);

    data.data.gameData.gameMode = "CLASSIC";
    data.data.events.Events.pop();
    await overlay.update();
    assert.equal(vm.runInContext("matchOrderStarted", overlay.context), true);
    assert.equal(overlay.isHidden(), true);
});

test("transient fetch failures preserve history, and team/champion fallback finds inventory", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    const data = gameData([gameStart], {}, [], 0);
    data.data.activePlayer.riotIdGameName = "";
    data.data.activePlayer.summonerName = "";
    overlay.setResponse(data);
    await overlay.update();
    const fetchErrorsBefore = overlay.errors.filter(args => args[0] === "failed to fetch match order game data").length;
    overlay.setHttpStatus(503);
    await overlay.update();
    overlay.setHttpStatus(200);
    overlay.setFetchError(new Error("network"));
    await overlay.update();
    assert.equal(vm.runInContext("matchOrderStarted", overlay.context), true);
    assert.equal(overlay.errors.filter(args => args[0] === "failed to fetch match order game data").length, fetchErrorsBefore + 1);
    overlay.setFetchError(null);
    data.data.allPlayers[0].items = [{ itemID: 1001 }];
    data.data.gameData.gameTime = 65;
    await overlay.update();
    assert.deepEqual(Array.from(vm.runInContext("matchOrderPurchases.map(item => item.itemId)", overlay.context)), [1001]);
    assert.equal(vm.runInContext("matchOrderUnavailableCount", overlay.context), 0);
});

test("tagless identity matches and a new start event resets the recorded order", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    const data = gameData([gameStart], {}, [], 0);
    data.data.activePlayer = { riotId: " Player#NA1 " };
    overlay.setResponse(data);
    await overlay.update();
    data.data.allPlayers[0].items = [{ itemID: 1001 }];
    data.data.gameData.gametime = 60;
    delete data.data.gameData.gameTime;
    await overlay.update();
    assert.deepEqual(Array.from(vm.runInContext("matchOrderPurchases.map(item => item.itemId)", overlay.context)), [1001]);
    data.data.events.Events = [{ EventID: 2, EventName: "GameStart" }];
    await overlay.update();
    assert.deepEqual(Array.from(vm.runInContext("matchOrderPurchases", overlay.context)), []);
});
