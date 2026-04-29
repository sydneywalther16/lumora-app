export type LumoraCharacter = {
  id: string;
  name?: string;
  avatar?: string;
};

export type SelfCapture = {
  videoUrl?: string;
  numbers?: string;
  completed: boolean;
  consent: boolean;
  capturedAt?: string;
};

export type LumoraProfile = {
  displayName: string;
  username: string;
  bio: string;
  avatar: string;

  defaultSelfCharacterId?: string;
  defaultSelfCharacterName?: string;
  defaultSelfCharacterAvatar?: string;

  selfCapture: SelfCapture;
};

const PROFILE_KEY = "lumora_profile";
const CHAR_KEY = "lumora_characters";

const defaultProfile: LumoraProfile = {
  displayName: "Lumora Creator",
  username: "@lumora",
  bio: "",
  avatar: "L",
  selfCapture: { completed: false, consent: false }
};

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadCharacters(): LumoraCharacter[] {
  if (!canUseBrowserStorage()) return [];

  try {
    return JSON.parse(window.localStorage.getItem(CHAR_KEY) || "[]");
  } catch {
    return [];
  }
}

export function loadProfile(): LumoraProfile {
  if (!canUseBrowserStorage()) return defaultProfile;

  try {
    return JSON.parse(window.localStorage.getItem(PROFILE_KEY) || "null") || defaultProfile;
  } catch {
    return defaultProfile;
  }
}

export function saveProfile(profile: LumoraProfile) {
  if (!canUseBrowserStorage()) return;

  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new Event("lumoraProfileUpdated"));
}

export function isSelfReady(profile: LumoraProfile): boolean {
  return Boolean(
    profile.defaultSelfCharacterId &&
      profile.selfCapture.videoUrl &&
      profile.selfCapture.consent &&
      profile.selfCapture.completed
  );
}