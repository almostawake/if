// Wait for a given number of seconds, plus/minus some randomness
export async function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
