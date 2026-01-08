export const CONFIG = {
    PHYSICS_SCALE: 0.035,
    BASE_DASH_POWER: 500, // Very strong burst
    DASH_COOLDOWN: 500,

    IMPACT_VELOCITY: 1200, // Drastically reduced (was 4200)
    RECOIL_FACTOR: 0.5, // 50% knockback on attacker

    BOMB_TIMER: 2,
    BOMB_EXPLOSION_RADIUS: 200, // Increased from 180
    BOMB_EXPLOSION_FORCE: 8000, // Increased power

    HOT_POTATO_TIMER: 10,

    POWERFUL_PUSH_DASH_MULT: 2.16, // Increased by 20%
    POWERFUL_PUSH_IMPACT_MULT: 1.68, // Increased by 20%

    SHADOW_INTERVAL: 100,
    SLIPPERY_FRICTION: 0.975, // Lowered from 0.985 (Reduced slide)

    // CHAIN_LIGHTNING Removed

    BOMB_RAIN_DROP_INTERVAL: 1200, // 1.2 seconds between bombs (faster!)

    BLACK_HOLE_DEATH_RADIUS: 60, // Increased (Was 40, erroneous 20 fixed)
    BLACK_HOLE_TELEPORT_INTERVAL: 10000, // 10 seconds between teleports

    SIZE_CHANGE_DURATION: 10000,
    BIG_GOOBY_SPEED_MULT: 0.5,    // Big = very slow
    BIG_GOOBY_POWER_MULT: 3.5,
    BIG_GOOBY_DASH_FORCE: 4000,
    SMALL_GOOBY_SPEED_MULT: 2.0,   // Small = very fast

    SOCCER_WIN_SCORE: 5, // Play to 5
    COLORS: {
        GRASS: '#166534',
        RED_TEAM: '#ef4444',
        BLUE_TEAM: '#3b82f6'
    }
};

window.CONFIG = CONFIG; // Expose for legacy access if needed
