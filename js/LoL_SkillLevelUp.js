const SKILL_LEVEL_UP_URL = "http://localhost:8888/allgamedata";
const SKILL_LEVEL_UP_DURATION = 3000;

const skillLevelUpWidget = document.createElement("div");
skillLevelUpWidget.className = "skill-level-up-widget";
skillLevelUpWidget.setAttribute("aria-label", "スキルレベルアップ");
skillLevelUpWidget.hidden = true;
document.getElementById("overlay-canvas").appendChild(skillLevelUpWidget);

let skillLevelUpAbilities = null;
let skillLevelUpLastGameTime = null;
let skillLevelUpIcons = new Map();
let isUpdatingSkillLevelUp = false;

function resetSkillLevelUp() {
    skillLevelUpAbilities = null;
    skillLevelUpLastGameTime = null;
    skillLevelUpWidget.replaceChildren();
    skillLevelUpIcons.clear();
    skillLevelUpWidget.hidden = true;
}

function renderSkillLevelUpIcons(now) {
    for (const [id, notification] of skillLevelUpIcons) {
        if (notification.expiresAt <= now) {
            notification.element.remove();
            skillLevelUpIcons.delete(id);
        }
    }

    skillLevelUpWidget.hidden = skillLevelUpIcons.size === 0;
}

function showSkillLevelUpIcon(id, now) {
    const notification = skillLevelUpIcons.get(id);
    if (notification) {
        notification.expiresAt = now + SKILL_LEVEL_UP_DURATION;
    } else {
        const icon = document.createElement("img");
        icon.src = `assets/spell/${id}.png`;
        icon.alt = id;
        skillLevelUpWidget.appendChild(icon);
        skillLevelUpIcons.set(id, {
            element: icon,
            expiresAt: now + SKILL_LEVEL_UP_DURATION
        });
    }
    skillLevelUpWidget.hidden = false;
}

async function updateSkillLevelUp() {
    if (isUpdatingSkillLevelUp) return;
    isUpdatingSkillLevelUp = true;

    try {
        const response = await fetch(SKILL_LEVEL_UP_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`status ${response.status}`);
        }

        const gameDataResponse = await response.json();
        const data = gameDataResponse?.data;
        const activePlayer = data?.activePlayer;
        const abilities = activePlayer?.abilities;
        if (gameDataResponse?.ok !== true || !activePlayer ||
            !abilities || typeof abilities !== "object") {
            resetSkillLevelUp();
            return;
        }

        const gameTime = Number(data?.gameData?.gameTime ?? data?.gameData?.gametime);
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
        }

        if (skillLevelUpAbilities !== null) {
            for (const [id, level] of currentAbilities) {
                if (level > (skillLevelUpAbilities.get(id) ?? level)) {
                    showSkillLevelUpIcon(id, now);
                }
            }
        }

        skillLevelUpAbilities = currentAbilities;
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
