/** The six moods the roadside cycles through. */
export const MOODS = ['downtown', 'oldtown', 'midtown', 'docks', 'suburbs', 'edge'] as const;
export type Mood = (typeof MOODS)[number];
export const MOOD_INDEX: Record<Mood, number> = { downtown: 0, oldtown: 1, midtown: 2, docks: 3, suburbs: 4, edge: 5 };
