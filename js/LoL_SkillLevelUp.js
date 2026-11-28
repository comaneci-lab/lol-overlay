const SKILL_LEVEL_UP_ALLOWED_GAME_MODES = ["CLASSIC", "PRACTICETOOL", "SPECTATOR", "ARAM"];
const SKILL_LEVEL_UP_DURATION = 3000;
const ITEM_PURCHASE_HOLD_DURATION = 5000;

const notificationWidgets = document.createElement("div");
notificationWidgets.className = "skill-item-notification-widgets";
document.getElementById("overlay-canvas").appendChild(notificationWidgets);
const itemPurchaseWidget = document.createElement("div");
itemPurchaseWidget.className = "item-purchase-widget";
itemPurchaseWidget.setAttribute("aria-label", "アイテム購入");
itemPurchaseWidget.hidden = true;
notificationWidgets.appendChild(itemPurchaseWidget);
const skillLevelUpWidget = document.createElement("div");
skillLevelUpWidget.className = "skill-level-up-widget";
skillLevelUpWidget.setAttribute("aria-label", "スキルレベルアップ");
skillLevelUpWidget.hidden = true;
notificationWidgets.appendChild(skillLevelUpWidget);

let skillLevelUpAbilities = null;
let skillLevelUpLastGameTime = null;
let skillLevelUpIcons = new Map();
let itemPurchaseIcons = new Map();
let itemPurchaseCounts = null;
let itemPurchasePlayer = null;
let pendingItemPurchases = new Map();
let isUpdatingSkillLevelUp = false;

function resetItemPurchases() {
    itemPurchaseCounts = null;
    itemPurchasePlayer = null;
    pendingItemPurchases.clear();
    itemPurchaseWidget.replaceChildren();
    itemPurchaseIcons.clear();
    itemPurchaseWidget.hidden = true;
}

function resetSkillLevelUp() {
    skillLevelUpAbilities = null;
    skillLevelUpLastGameTime = null;
    skillLevelUpWidget.replaceChildren();
    skillLevelUpIcons.clear();
    skillLevelUpWidget.hidden = true;
    resetItemPurchases();
}

function renderNotificationIcons(widget, icons, now) {
    for (const [id, notification] of icons) {
        if (notification.expiresAt <= now) {
            notification.element.remove();
            icons.delete(id);
        }
    }
    widget.hidden = icons.size === 0;
}

function renderSkillLevelUpIcons(now) {
    renderNotificationIcons(skillLevelUpWidget, skillLevelUpIcons, now);
    renderNotificationIcons(itemPurchaseWidget, itemPurchaseIcons, now);
}

function showNotificationIcon(widget, icons, id, src, now) {
    const notification = icons.get(id);
    if (notification) {
        notification.expiresAt = now + SKILL_LEVEL_UP_DURATION;
    } else {
        const icon = document.createElement("img");
        icon.src = src;
        icon.alt = String(id);
        widget.appendChild(icon);
        icons.set(id, {
            element: icon,
            expiresAt: now + SKILL_LEVEL_UP_DURATION
        });
    }
    widget.hidden = false;
}

function showSkillLevelUpIcon(id, now) {
    showNotificationIcon(skillLevelUpWidget, skillLevelUpIcons, id, `../assets/spell/${id}.png`, now);
}

function findItemPurchasePlayer(activePlayer, players) {
    const identityMatch = findActivePlayer({ activePlayer, allPlayers: players });
    if (identityMatch) return identityMatch;

    const team = String(activePlayer?.team ?? "").toUpperCase();
    const champion = String(activePlayer?.championName ?? "").trim().toLowerCase();
    if (!team || !champion) return null;
    const championMatches = players.filter(player =>
        String(player?.team ?? "").toUpperCase() === team &&
        String(player?.championName ?? "").trim().toLowerCase() === champion
    );
    return championMatches.length === 1 ? championMatches[0] : null;
}

function updateItemPurchases(activePlayer, players, now) {
    const player = Array.isArray(players) ? findItemPurchasePlayer(activePlayer, players) : null;
    if (!player || !Array.isArray(player.items)) {
        resetItemPurchases();
        return;
    }

    const playerKey = JSON.stringify([
        player.riotId, player.summonerName, player.riotIdGameName, player.team, player.championName
    ]);
    if (itemPurchasePlayer !== null && playerKey !== itemPurchasePlayer) {
        resetItemPurchases();
    }
    itemPurchasePlayer = playerKey;
    const counts = new Map();
    for (const item of player.items) {
        const id = Number(item?.itemID);
        const count = Number(item?.count ?? 1);
        if (Number.isInteger(id) && id > 0 && Number.isInteger(count) && count > 0) {
            counts.set(id, (counts.get(id) ?? 0) + count);
        }
    }

    if (itemPurchaseCounts !== null) {
        for (const id of new Set([...itemPurchaseCounts.keys(), ...counts.keys()])) {
            const previous = itemPurchaseCounts.get(id) ?? 0;
            const current = counts.get(id) ?? 0;
            const pending = pendingItemPurchases.get(id) ?? [];
            for (let added = previous; added < current; added += 1) pending.push(now);
            if (current < previous) pending.splice(Math.max(0, pending.length - (previous - current)));
            const ready = pending.filter(detectedAt => now - detectedAt >= ITEM_PURCHASE_HOLD_DURATION);
            if (ready.length > 0) {
                showNotificationIcon(itemPurchaseWidget, itemPurchaseIcons, id, `../assets/items/${id}.png`, now);
            }
            const remaining = pending.filter(detectedAt => now - detectedAt < ITEM_PURCHASE_HOLD_DURATION);
            if (remaining.length > 0) pendingItemPurchases.set(id, remaining);
            else pendingItemPurchases.delete(id);
        }
    }
    itemPurchaseCounts = counts;
}

async function updateSkillLevelUp() {
    if (isUpdatingSkillLevelUp) return;
    isUpdatingSkillLevelUp = true;

    try {
        const gameDataResponse = await fetchLiveGameData();
        const data = gameDataResponse?.data;
        const activePlayer = data?.activePlayer;
        const abilities = activePlayer?.abilities;
        if (gameDataResponse?.ok !== true || !activePlayer ||
            !abilities || typeof abilities !== "object" ||
            !isAllowedGameMode(data, SKILL_LEVEL_UP_ALLOWED_GAME_MODES)) {
            resetSkillLevelUp();
            return;
        }

        const gameTime = getGameTime(data);
        const now = Date.now();
        const currentAbilities = new Map();
        for (const ability of Object.values(abilities)) {
            const id = typeof ability?.id === "string" ? ability.id.trim() : "";
            const level = Number(ability?.abilityLevel);
            if (id && Number.isFinite(level)) {
                currentAbilities.set(id, level);
            }
        }

        if (currentAbilities.size === 0) {
            resetSkillLevelUp();
            return;
        }

        const gameWasReset = Number.isFinite(gameTime) &&
            skillLevelUpLastGameTime !== null &&
            gameTime < skillLevelUpLastGameTime - 5;
        if (gameWasReset) {
            skillLevelUpAbilities = null;
            skillLevelUpWidget.replaceChildren();
            skillLevelUpIcons.clear();
            resetItemPurchases();
        }

        if (skillLevelUpAbilities !== null) {
            for (const [id, level] of currentAbilities) {
                if (level > (skillLevelUpAbilities.get(id) ?? level)) {
                    showSkillLevelUpIcon(id, now);
                }
            }
        }

        skillLevelUpAbilities = currentAbilities;
        updateItemPurchases(activePlayer, data?.allPlayers, now);
        if (Number.isFinite(gameTime)) {
            skillLevelUpLastGameTime = gameTime;
        }
        renderSkillLevelUpIcons(now);
    } catch (error) {
        resetSkillLevelUp();
        console.error("failed to update skill level-up icons", error);
    } finally {
        isUpdatingSkillLevelUp = false;
    }
}

updateSkillLevelUp();
setInterval(updateSkillLevelUp, 1000);
setInterval(() => renderSkillLevelUpIcons(Date.now()), 250);
