export function roughly(base: number, factor: number): number {
    // Calculate the range
    const range = base * factor;

    // Generate random number between -range and +range
    const adjustment = (Math.random() * 2 - 1) * range;

    // Add the adjustment to the base number and round to integer
    return Math.round(base + adjustment);
}
