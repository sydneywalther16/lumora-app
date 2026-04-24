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

export type Trend = {
  id: string;
  title: string;
  category: TopChip;
  uses: string;
  prompt: string;
};

export const posts: Post[] = [
  {
    id: '1',
    title: 'Luxury Jet Goddess',
    prompt: 'ultra-glossy luxury woman on private jet, champagne lighting, high-end editorial shoot',
    imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Unhinged Energy Spiral',
    prompt: 'chaotic glitchcore scene, high-energy movement, distorted lighting, emotional breakdown aesthetic',
    imageUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Cinematic Museum Walk',
    prompt: 'cinematic slow walk through museum, dramatic shadows, golden hour lighting, artistic framing',
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: '4',
    title: 'Funny NPC Moment',
    prompt: 'awkward NPC interaction, comedic timing, deadpan stare, virtual persona NPC core vibe',
    imageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
  {
    id: '5',
    title: 'AI Beauty Muse',
    prompt: 'beauty influencer portrait, flawless skin, soft lighting, high-end glam aesthetic',
    imageUrl: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?q=80&w=800&auto=format&fit=crop',
    createdAt: new Date().toISOString(),
  },
];

export const trends: Trend[] = [
  {
    id: 'trend-1',
    title: 'Paparazzi Reveal',
    category: 'Cinematic',
    uses: '24.8K',
    prompt: 'Build a glossy AI influencer reveal with paparazzi flash frames, ultra-smooth motion, and a final hook that feels instantly repostable.',
  },
  {
    id: 'trend-2',
    title: 'Luxury POV',
    category: 'Luxury',
    uses: '18.2K',
    prompt: 'Create a luxury POV persona clip with private jet lighting, glossy editorial styling, and high-end social media energy.',
  },
  {
    id: 'trend-3',
    title: 'NPC Core Loop',
    category: 'NPC Core',
    uses: '31.4K',
    prompt: 'Make an NPC-style virtual persona loop with deadpan timing, repeated catchphrases, and surreal social livestream energy.',
  },
  {
    id: 'trend-4',
    title: 'Chaos Confessional',
    category: 'Chaos',
    uses: '12.9K',
    prompt: 'Create a chaotic influencer confessional with fast cuts, dramatic zooms, glitchy captions, and unhinged comedic tension.',
  },
  {
    id: 'trend-5',
    title: 'Beauty Muse Closeup',
    category: 'Beauty',
    uses: '16.7K',
    prompt: 'Generate a beauty muse portrait moment with soft glam lighting, face-forward framing, flawless skin, and viral reveal energy.',
  },
  {
    id: 'trend-6',
    title: 'Virtual Sitcom Moment',
    category: 'Funny',
    uses: '9.6K',
    prompt: 'Create a funny virtual sitcom persona scene with awkward timing, expressive reactions, and a punchy social-media ending.',
  },
];
