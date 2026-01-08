/**
 * Seeded Random Number Generator for Deterministic Multiplayer
 * All clients must use the same seed to ensure identical game state
 */
export class SeededRNG {
    constructor(seed = 12345) {
        this.seed = seed;
        this.state = seed;
    }

    // Park-Miller PRNG (LCG) - Simple and deterministic
    next() {
        this.state = (this.state * 48271) % 2147483647;
        return this.state / 2147483647;
    }

    // Random float [0, 1)
    random() {
        return this.next();
    }

    // Random integer [min, max)
    randomInt(min, max) {
        return Math.floor(this.random() * (max - min)) + min;
    }

    // Random choice from array
    choice(array) {
        if (array.length === 0) return null;
        return array[this.randomInt(0, array.length)];
    }

    // Shuffle array (Fisher-Yates)
    shuffle(array) {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.randomInt(0, i + 1);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    // Reset to initial state
    reset(newSeed) {
        this.seed = newSeed || this.seed;
        this.state = this.seed;
    }

    // Get current state (for sync verification)
    getState() {
        return this.state;
    }

    // Set state (for deserialization)
    setState(state) {
        this.state = state;
    }
}
