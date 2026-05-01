export type Post = {
  id: string;
  userHandle: string;
  caption: string;
  tags: string[];
  stats: { likes: string; remix: string; saves: string };
  stylePreset: string;
  prompt: string;
};

export type Trend = {
  id: string;
  title: string;
  uses: string;
  category: string;
  prompt: string;
};

export type Project = {
  id: string;
  title: string;
  status: 'Drafting' | 'Rendering' | 'Queued' | 'Published';
  updatedAt: string;
};

export const user = {
  handle: 'lumora.creator',
  bio: 'AI influencer studio for trend-native creators, soft chaos, and cinematic loops.',
  stats: {
    followers: '228K',
    following: '412',
    likes: '8.9M',
  },
  signatureDNA: ['glossy realism', 'pop chaos', 'micro-viral hooks', 'swipe-first storytelling'],
};

export const topChips = ['For You', 'Cinematic', 'Chaos', 'Beauty', 'Luxury', 'Funny', 'NPC Core'] as const;

export type TopChip = (typeof topChips)[number];

export const posts: Post[] = [
  {
    id: 'p1',
    userHandle: '@nova.velvet',
    caption: 'Airport glam but make it suspiciously divine.',
    tags: ['loopable', 'fashion', 'viral'],
    stats: { likes: '41.2K', remix: '3.1K', saves: '12K' },
    stylePreset: 'Cabin Fever Pop',
    prompt: 'A luxury flight attendant struts down a neon-lit aisle with playful eye contact, fast editorial cuts, glossy turbulence energy.',
  },
  {
    id: 'p2',
    userHandle: '@pixelpriestess',
    caption: 'POV: your soft-launch avatar got a manager.',
    tags: ['story', 'ai model', 'comedy'],
    stats: { likes: '28.7K', remix: '1.9K', saves: '9.4K' },
    stylePreset: 'Influencer Sitcom',
    prompt: 'A faux reality-show confessional where an AI influencer negotiates a brand deal with deadpan comedic timing.',
  },
  {
    id: 'p3',
    userHandle: '@chromehoney',
    caption: 'This sunset filter should honestly be arrested.',
    tags: ['sunset', 'editorial', 'dreamy'],
    stats: { likes: '65.4K', remix: '4.4K', saves: '20.8K' },
    stylePreset: 'Museum Sunset',
    prompt: 'Dramatic golden-hour portrait with art-gallery framing, wind movement, and a slow reveal to skyline glow.',
  },
];

export const trends: Trend[] = [
  {
    id: 't1',
    title: 'Fake paparazzi exit',
    uses: '1.8M uses',
    category: 'Fashion',
    prompt: 'A celebrity-style exit with flashbulbs, sunglasses, and a smirk right before the car door closes.',
  },
  {
    id: 't2',
    title: 'Confessional spiral',
    uses: '794K uses',
    category: 'Comedy',
    prompt: 'A direct-to-camera confession that gets increasingly unhinged while the lighting stays impossibly pretty.',
  },
  {
    id: 't3',
    title: 'Luxury POV reset',
    uses: '2.4M uses',
    category: 'Lifestyle',
    prompt: 'A first-person luxury morning sequence with tactile close-ups, dramatic coffee pour, and effortless confidence.',
  },
  {
    id: 't4',
    title: 'Soft villain reveal',
    uses: '991K uses',
    category: 'Story',
    prompt: 'Elegant entrance, subtle smile, then a final frame implying the character planned everything.',
  },
];

export const projects: Project[] = [
  { id: 'pr1', title: 'Virtual muse launch pack', status: 'Rendering', updatedAt: '2 min ago' },
  { id: 'pr2', title: 'Episode 01 teaser cut', status: 'Drafting', updatedAt: '18 min ago' },
  { id: 'pr3', title: 'Brand deal concept reel', status: 'Queued', updatedAt: '1 hr ago' },
  { id: 'pr4', title: 'Sunset museum portrait', status: 'Published', updatedAt: 'Yesterday' },
];

export const inboxThreads = [
  {
    id: 'm1',
    from: 'Brand Scout',
    subject: 'Campaign interest for Nova Velvet',
    preview: 'We love the surreal reality-TV tone. Could we discuss a 3-video package?',
    unread: true,
  },
  {
    id: 'm2',
    from: 'Creator Support',
    subject: 'Your render finished successfully',
    preview: 'Episode 01 teaser cut is ready for publishing and thumbnail selection.',
    unread: false,
  },
  {
    id: 'm3',
    from: 'Trend Desk',
    subject: '3 rising audio formats to watch',
    preview: 'Confessional spiral and soft villain reveal are accelerating this week.',
    unread: true,
  },
];
