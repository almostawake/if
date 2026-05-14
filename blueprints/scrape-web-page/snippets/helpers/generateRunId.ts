export function generateRunId(): string {
    const chars = 'ACDEFGHJKLMNPQRTUVWXY34679';  // avoid visually similar characters
    return Array.from(
        { length: 5 },
        () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
} 