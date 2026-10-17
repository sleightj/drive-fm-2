import type { Mood } from './moods';

/**
 * District names shown on the blue overhead guide signs at forks. Each district is a
 * region of one mood; a fork's sign names the next district each branch reaches.
 * Fictional names in the style of real Japanese place names (kanji + Hepburn romaji).
 */
export interface Place { jp: string; romaji: string; mood: Mood }

export const PLACES: Place[] = [
  { jp: '中央', romaji: 'Chuo', mood: 'downtown' },
  { jp: '栄町', romaji: 'Sakaemachi', mood: 'downtown' },
  { jp: '駅前', romaji: 'Ekimae', mood: 'downtown' },
  { jp: '本町', romaji: 'Honmachi', mood: 'downtown' },
  { jp: '古町', romaji: 'Furumachi', mood: 'oldtown' },
  { jp: '寺町', romaji: 'Teramachi', mood: 'oldtown' },
  { jp: '坂下', romaji: 'Sakashita', mood: 'oldtown' },
  { jp: '鍛冶町', romaji: 'Kajimachi', mood: 'oldtown' },
  { jp: '中町', romaji: 'Nakamachi', mood: 'midtown' },
  { jp: '緑町', romaji: 'Midoricho', mood: 'midtown' },
  { jp: '新町', romaji: 'Shinmachi', mood: 'midtown' },
  { jp: '錦町', romaji: 'Nishikicho', mood: 'midtown' },
  { jp: '港町', romaji: 'Minatomachi', mood: 'docks' },
  { jp: '海岸通', romaji: 'Kaigan-dori', mood: 'docks' },
  { jp: '埠頭', romaji: 'Futo', mood: 'docks' },
  { jp: '浜町', romaji: 'Hamacho', mood: 'docks' },
  { jp: '桜台', romaji: 'Sakuradai', mood: 'suburbs' },
  { jp: '若葉', romaji: 'Wakaba', mood: 'suburbs' },
  { jp: '青葉台', romaji: 'Aobadai', mood: 'suburbs' },
  { jp: '星が丘', romaji: 'Hoshigaoka', mood: 'suburbs' },
  { jp: '松原', romaji: 'Matsubara', mood: 'edge' },
  { jp: '丘の上', romaji: 'Okanoue', mood: 'edge' },
  { jp: '北野', romaji: 'Kitano', mood: 'edge' },
  { jp: '野辺山', romaji: 'Nobeyama', mood: 'edge' },
];
