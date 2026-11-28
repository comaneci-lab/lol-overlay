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
        this.dataset = {};
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

    removeAttribute(name) {
        delete this[name];
    }

    get textContent() {
        return this.text ?? this.children.map(child => child.textContent).join("");
    }

    set textContent(value) {
        this.text = String(value);
        this.children = [];
    }
}

function createOverlay(options = {}) {
    const canvas = new Element("div");
    let response = { ok: false, error: "not available" };
    let httpStatus = 200;
    const errors = [];
    const context = vm.createContext({
        document: {
            getElementById: () => canvas,
            createElement: tagName => new Element(tagName)
        },
        window: { setInterval() {} },
        fetch: async url => {
            if (url === "/allgamedata") {
                return { ok: httpStatus === 200, status: httpStatus, json: async () => response };
            }
            if (url === "/runes") {
                if (options.runesUnavailable) return { ok: false, status: 500 };
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        data: [
                            { id: 8100, slots: [{ runes: [
                                { id: 8112, name: "Electrocute", icon: "perk-images/electrocute.png" },
                                { id: 8126, name: "Cheap Shot", icon: "perk-images/cheap-shot.png" }
                            ] }] },
                            { id: 8300, slots: [{ runes: [
                                { id: 8345, name: "Biscuit", icon: "perk-images/biscuit.png" }
                            ] }] }
                        ]
                    })
                };
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
                        data: {
                            data: {
                                Ahri: {
                                    spells: ["Q", "W", "E", "R"].map(key => ({
                                        image: { full: `${key}.png` }
                                    }))
                                }
                            }
                        }
                    })
                };
            }
            throw new Error(`unexpected request: ${url}`);
        },
        console: { error: (...args) => errors.push(args) }
    });

    vm.runInContext(fs.readFileSync(path.join(root, "js", "LoL_Api.js"), "utf8"), context);
    vm.runInContext(
        fs.readFileSync(path.join(root, "js", "LoL_PostGameThumbnail.js"), "utf8"),
        context
    );
    return {
        context,
        errors,
        setResponse(value) { response = value; },
        setHttpStatus(value) { httpStatus = value; },
        async update() {
            await vm.runInContext("updatePostGameThumbnail()", context);
        },
        isHidden() {
            return vm.runInContext("postGameThumbnailWidget.hidden", context);
        },
        widget() {
            return vm.runInContext("postGameThumbnailWidget", context);
        }
    };
}

function findElements(element, className) {
    return [
        ...(element.classNames.has(className) ? [element] : []),
        ...element.children.flatMap(child => findElements(child, className))
    ];
}

const activePlayer = {
    riotIdGameName: "Player",
    summonerName: "Player",
    team: "ORDER",
    championName: "Ahri",
    abilities: {
        Q: { abilityLevel: 0 },
        W: { abilityLevel: 0 },
        E: { abilityLevel: 0 },
        R: { abilityLevel: 0 }
    },
    fullRunes: {
        primaryRuneTree: { id: 8100, displayName: "Domination" },
        secondaryRuneTree: { id: 8300, displayName: "Inspiration" },
        keystone: { id: 8112, displayName: "Electrocute" },
        generalRunes: [
            { id: 8112, displayName: "Electrocute" },
            { id: 8126, displayName: "Cheap Shot" },
            { id: 8345, displayName: "Biscuit" }
        ],
        statRunes: [
            { id: 5008, rawDescription: "StatModAdaptiveForce" },
            { id: 5002, rawDescription: "StatModArmor" },
            { id: 5001, rawDescription: "StatModHealthScaling" }
        ]
    }
};

function gameData(events, options = {}) {
    const { championName, ...liveActivePlayer } = activePlayer;
    return {
        ok: true,
        data: {
            allPlayers: [
                {
                    ...activePlayer,
                    position: "TOP",
                    rawSkinName: options.playerSkin === undefined
                        ? "game_character_skin_displayname_Ahri_0" : options.playerSkin,
                    scores: options.playerScores ?? { kills: 4, deaths: 1, assists: 6 },
                    items: options.items ?? []
                },
                {
                    team: "CHAOS",
                    position: "TOP",
                    championName: "Garen",
                    scores: options.opponentScores ?? { kills: 0, deaths: 3, assists: 2 },
                    rawSkinName: "game_character_skin_displayname_Garen_5"
                }
            ],
            activePlayer: {
                ...liveActivePlayer,
                abilities: options.abilities ?? activePlayer.abilities
            },
            gameData: { gameTime: options.gameTime ?? 0, gameMode: "CLASSIC" },
            events: { Events: events }
        }
    };
}

test("shows matchup, shards, and recorded orders after GameEnd until API is unavailable", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));

    const gameStart = { EventID: 1, EventName: "GameStart" };
    overlay.setResponse(gameData([gameStart]));
    await overlay.update();
    assert.equal(overlay.isHidden(), true);

    overlay.setResponse(gameData(
        [gameStart, { EventID: 2, EventName: "GameEnd" }],
        {
            gameTime: 65,
            abilities: {
                Q: { abilityLevel: 1 },
                W: { abilityLevel: 1 },
                E: { abilityLevel: 0 },
                R: { abilityLevel: 0 }
            },
            items: [{ itemID: 1001, count: 1 }]
        }
    ));
    await overlay.update();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(overlay.isHidden(), false);
    const widget = overlay.widget();
    assert.equal(findElements(widget, "post-game-player-active")[0].textContent, "KDA：4/1/6");
    assert.equal(findElements(widget, "post-game-player-opponent")[0].textContent, "KDA：0/3/2");
    const images = findElements(widget, "post-game-player-image");
    assert.equal(images[0].src, "../assets/centered/Ahri_0.jpg");
    assert.equal(images[1].src, "../assets/centered/Garen_5.jpg");
    images[1].onerror();
    assert.equal(images[1].src, "../assets/centered/Garen_0.jpg");
    images[1].onerror();
    assert.equal(images[1].hidden, true);
    assert.equal(widget.textContent.includes("MATCH SUMMARY"), false);
    assert.equal(widget.textContent.includes("自分"), false);
    assert.equal(widget.textContent.includes("対面"), false);
    assert.equal(widget.textContent.includes("Ahri"), false);
    assert.equal(widget.textContent.includes("Garen"), false);
    const runeRows = findElements(widget, "post-game-rune-row");
    assert.equal(runeRows[0].textContent, "メインElectrocuteCheap Shot");
    assert.equal(runeRows[1].textContent, "サブBiscuit");
    assert.deepEqual(
        findElements(widget, "post-game-rune").map(item => item.children[0].src),
        ["../assets/perk-images/electrocute.png",
            "../assets/perk-images/cheap-shot.png",
            "../assets/perk-images/biscuit.png"]
    );
    assert.equal(findElements(widget, "post-game-shard").length, 3);
    assert.deepEqual(
        findElements(widget, "post-game-skill-icon").map(icon => icon.src),
        ["../assets/spell/Q.png", "../assets/spell/W.png",
            "../assets/spell/E.png", "../assets/spell/R.png"]
    );
    assert.deepEqual(
        findElements(widget, "post-game-skill-learned").map(cell => cell.textContent),
        ["1", "2"]
    );
    assert.equal(findElements(widget, "post-game-item-group").length, 1);

    overlay.setResponse({ ok: false, error: "Live Client Data API unavailable" });
    await overlay.update();
    await overlay.update();
    await overlay.update();
    assert.equal(overlay.isHidden(), true);
});

test("shows unavailable KDA values without inventing scores", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    overlay.setResponse(gameData([
        { EventID: 1, EventName: "GameStart" },
        { EventID: 2, EventName: "GameEnd" }
    ], { playerScores: { kills: 0, deaths: null, assists: 3 }, opponentScores: {} }));
    await overlay.update();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(findElements(overlay.widget(), "post-game-player-active")[0].textContent, "KDA：0/-/3");
    assert.equal(findElements(overlay.widget(), "post-game-player-opponent")[0].textContent, "KDA：-/-/-");
});

test("keeps header images across updates while reflecting KDA and skin changes", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    const events = [
        { EventID: 1, EventName: "GameStart" },
        { EventID: 2, EventName: "GameEnd" }
    ];
    overlay.setResponse(gameData(events));
    await overlay.update();
    await new Promise(resolve => setImmediate(resolve));

    const widget = overlay.widget();
    const images = findElements(widget, "post-game-player-image");
    images[0].onload();
    images[1].onload();
    overlay.setResponse(gameData(events, { playerScores: { kills: 5, deaths: 1, assists: 7 } }));
    await overlay.update();
    assert.equal(findElements(widget, "post-game-player-image")[0], images[0]);
    assert.equal(findElements(widget, "post-game-player-image")[1], images[1]);
    assert.equal(images[0].hidden, false);
    assert.equal(findElements(widget, "post-game-player-active")[0].textContent, "KDA：5/1/7");

    overlay.setResponse(gameData(events, { playerSkin: "game_character_skin_displayname_Ahri_2" }));
    await overlay.update();
    assert.equal(findElements(widget, "post-game-player-image")[0], images[0]);
    assert.equal(images[0].src, "../assets/centered/Ahri_2.jpg");
    assert.equal(images[0].hidden, true);
    images[0].onload();
    assert.equal(images[0].hidden, false);

    overlay.setResponse(gameData(events, { playerSkin: null }));
    await overlay.update();
    assert.equal(images[0].hidden, true);
    assert.equal(images[0].src, undefined);

    overlay.setResponse({ ok: false, error: "Live Client Data API unavailable" });
    await overlay.update();
    await overlay.update();
    await overlay.update();
    overlay.setResponse(gameData(events));
    await overlay.update();
    assert.notEqual(findElements(widget, "post-game-player-image")[0], images[0]);
});

test("keeps rune names visible when metadata cannot be loaded", async () => {
    const overlay = createOverlay({ runesUnavailable: true });
    await new Promise(resolve => setImmediate(resolve));
    const gameStart = { EventID: 1, EventName: "GameStart" };
    overlay.setResponse(gameData([gameStart, { EventID: 2, EventName: "GameEnd" }]));
    await overlay.update();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(overlay.isHidden(), false);
    assert.deepEqual(
        findElements(overlay.widget(), "post-game-rune").map(item => item.textContent),
        ["Electrocute", "Cheap Shot", "Biscuit"]
    );
    assert.equal(overlay.errors.some(args =>
        String(args[0]).includes("rune metadata")), true);
});

test("thumbnail tolerates transient HTTP errors before clearing on the third failure", async () => {
    const overlay = createOverlay();
    await new Promise(resolve => setImmediate(resolve));
    const events = [{ EventID: 1, EventName: "GameStart" }, { EventID: 2, EventName: "GameEnd" }];
    overlay.setResponse(gameData(events));
    await overlay.update();
    assert.equal(overlay.isHidden(), false);
    overlay.setHttpStatus(503);
    await overlay.update();
    await overlay.update();
    assert.equal(overlay.isHidden(), false);
    await overlay.update();
    assert.equal(overlay.isHidden(), true);
    overlay.setHttpStatus(200);
    await overlay.update();
    assert.equal(overlay.isHidden(), false);
});
