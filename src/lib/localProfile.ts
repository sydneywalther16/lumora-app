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

export function loadCharacters(): LumoraCharacter[] {
  try {
    return JSON.parse(localStorage.getItem(CHAR_KEY) || "[]");
  } catch {
    return [];
  }
}

export function loadProfile(): LumoraProfile {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") || {
      displayName: "Lumora Creator",
      username: "@lumora",
      bio: "",
      avatar: "L",
      selfCapture: { completed: false, consent: false }
    };
  } catch {
    return {
      displayName: "Lumora Creator",
      username: "@lumora",
      bio: "",
      avatar: "L",
      selfCapture: { completed: false, consent: false }
    };
  }
}

export function saveProfile(profile: LumoraProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
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