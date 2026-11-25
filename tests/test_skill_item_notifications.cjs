const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class Element {
    constructor() {
        this.children = [];
        this.hidden = false;
        this.parent = null;
    }

    setAttribute() {}
    appendChild(child) {
        child.parent = this;
        this.children.push(child);
    }
    replaceChildren() {
        this.children = [];
    }
    remove() {
        this.parent.children = this.parent.children.filter(child => child !== this);
    }
}

async function createOverlay() {
    let now = 0;
    let response = { ok: false };
    const canvas = new Element();
    const context = vm.createContext({
        document: {
            getElementById: () => canvas,
            createElement: () => new Element()
        },
        Date: { now: () => now },
        setInterval() {},
        fetch: async () => ({ ok: true, json: async () => response }),
        console: { error() {} }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, "..", "js", "LoL_SkillLevelUp.js"), "utf8"),
        context
    );
    await new Promise(resolve => setImmediate(resolve));
    return {
        canvas,
        context,
        async update(items, time, options = {}) {
            now = time;
            response = {
                ok: true,
                data: {
                    gameData: { gameMode: options.mode ?? "CLASSIC", gameTime: options.gameTime ?? time / 1000 },
                    activePlayer: {
                        riotId: "Player#TEST",
                        abilities: { Q: { id: "spell", abilityLevel: options.level ?? 1 } }
                    },
                    allPlayers: [
                        { riotId: "Other#TEST", items: [{ itemID: 9999 }] },
                        { riotId: "Player#TEST", items }
                    ]
                }
            };
            await vm.runInContext("updateSkillLevelUp()", context);
        },
        itemWidget() { return vm.runInContext("itemPurchaseWidget", context); },
        skillWidget() { return vm.runInContext("skillLevelUpWidget", context); }
    };
}

test("shows a held item after five seconds above the independently displayed skill", async () => {
    const overlay = await createOverlay();
    const initial = [{ itemID: 1001, count: 1 }];
    const purchased = [...initial, { itemID: 2003, count: 1 }];
    await overlay.update(initial, 0);
    await overlay.update(purchased, 1000, { level: 2 });
    assert.equal(overlay.itemWidget().hidden, true);
    assert.equal(overlay.skillWidget().hidden, false);
    await overlay.update(purchased, 5999);
    assert.equal(overlay.itemWidget().hidden, true);
    await overlay.update(purchased, 6000);
    assert.equal(overlay.itemWidget().hidden, false);
    assert.equal(overlay.itemWidget().children[0].src, "../assets/items/2003.png");
    assert.equal(overlay.canvas.children[0].children[0], overlay.itemWidget());
    assert.equal(overlay.canvas.children[0].children[1], overlay.skillWidget());
    await overlay.update(purchased, 9000);
    assert.equal(overlay.itemWidget().hidden, true);
});

test("cancels returned items and keeps separate timers for stacked purchases", async () => {
    const overlay = await createOverlay();
    const items = count => count ? [{ itemID: 2003, count }] : [];
    await overlay.update(items(0), 0);
    await overlay.update(items(1), 1000);
    await overlay.update(items(2), 2000);
    await overlay.update(items(1), 3000);
    await overlay.update(items(1), 6000);
    assert.equal(overlay.itemWidget().hidden, false);
    await overlay.update(items(1), 9000);
    assert.equal(overlay.itemWidget().hidden, true);
    await overlay.update(items(2), 10000);
    await overlay.update(items(1), 11000);
    await overlay.update(items(1), 16000);
    assert.equal(overlay.itemWidget().hidden, true);
});

test("discards pending purchases on missing inventory, game reset, or unsupported mode", async () => {
    const overlay = await createOverlay();
    const items = [{ itemID: 1001 }];
    await overlay.update([], 0, { gameTime: 100 });
    await overlay.update(items, 1000, { gameTime: 101 });
    await overlay.update(undefined, 2000, { gameTime: 102 });
    await overlay.update(items, 7000, { gameTime: 107 });
    assert.equal(overlay.itemWidget().hidden, true);
    await overlay.update([], 8000, { gameTime: 108 });
    await overlay.update(items, 9000, { gameTime: 109 });
    await overlay.update(items, 15000, { gameTime: 1 });
    assert.equal(overlay.itemWidget().hidden, true);
    await overlay.update([], 16000, { gameTime: 2 });
    await overlay.update(items, 17000, { gameTime: 3 });
    await overlay.update(items, 18000, { gameTime: 4, mode: "BRAWL" });
    await overlay.update(items, 24000, { gameTime: 10 });
    assert.equal(overlay.itemWidget().hidden, true);
});

test("matches the active player without confusing players with the same game name", async () => {
    const overlay = await createOverlay();
    const result = vm.runInContext(`findItemPurchasePlayer(
        { riotId: "Player#TWO" },
        [{ riotId: "Player#ONE" }, { riotId: "Player#TWO" }]
    ).riotId`, overlay.context);
    assert.equal(result, "Player#TWO");
    const ambiguous = vm.runInContext(`findItemPurchasePlayer(
        { riotIdGameName: "Player" },
        [{ riotId: "Player#ONE" }, { riotId: "Player#TWO" }]
    )`, overlay.context);
    assert.equal(ambiguous, null);
});
