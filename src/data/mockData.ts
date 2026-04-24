// src/data/mockData.ts

export const topChips = [
  'For You',
  'Cinematic',
  'Chaos',
  'Beauty',
  'Luxury',
  'Funny',
  'NPC Core',
] as const;

export type TopChip = (typeof topChips)[number];

export type Post = {
  id: string;
  title: string;
  prompt: string;
  imageUrl: string;
  createdAt: string;
};

export const posts: Post[] = [
  {
    id: '1',
    title: 'My Baby Mario',
    prompt:
      'a handsome mexican man mixed with a little middle eastern, glossy portrait, influencer aesthetic',
    imageUrl:
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Luxury Jet Goddess',
    prompt:
      'ultra-glossy luxury woman on private jet, champagne lighting, high-end editorial shoot',
    imageUrl:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Unhinged Energy Spiral',
    prompt:
      'chaotic glitchcore scene, high-energy movement, distorted lighting, emotional breakdown aesthetic',
    imageUrl:
      'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: '4',
    title: 'Cinematic Museum Walk',
    prompt:
      'cinematic slow walk through museum, dramatic shadows, golden hour lighting, artistic framing',
    imageUrl:
      'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: '5',
    title: 'Funny NPC Moment',
    prompt:
      'awkward NPC interaction, comedic timing, deadpan stare, slightly unhinged dialogue vibe',
    imageUrl:
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: '6',
    title: 'AI Beauty Muse',
    prompt:
      'beauty influencer portrait, flawless skin, soft lighting, high-end glam aesthetic',
    imageUrl:
      'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
];
