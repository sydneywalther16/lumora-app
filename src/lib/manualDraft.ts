export type ManualDraftSaveResult<T> =
  | {
      status: 'saved';
      draftId: string;
      createdDraft: boolean;
      value: T;
    }
  | {
      status: 'ignored';
      draftId: string | null;
    };

export type ManualDraftSaveSession = {
  adoptDraftId: (draftId: string | null | undefined) => void;
  currentDraftId: () => string | null;
  isSaving: () => boolean;
  save: <T>(persist: (draftId: string) => Promise<T>) => Promise<ManualDraftSaveResult<T>>;
};

export function exactManualDraftText(value: string): string {
  return value.trim();
}

export function createManualDraftSaveSession(
  initialDraftId: string | null | undefined,
  createDraftId: () => string,
): ManualDraftSaveSession {
  let draftId = initialDraftId?.trim() || null;
  let saving = false;

  return {
    adoptDraftId(nextDraftId) {
      const normalized = nextDraftId?.trim();
      if (normalized) draftId = normalized;
    },
    currentDraftId() {
      return draftId;
    },
    isSaving() {
      return saving;
    },
    async save<T>(persist: (stableDraftId: string) => Promise<T>): Promise<ManualDraftSaveResult<T>> {
      if (saving) {
        return {
          status: 'ignored',
          draftId,
        };
      }

      saving = true;
      const createdDraft = !draftId;
      draftId ||= createDraftId();

      try {
        const value = await persist(draftId);
        return {
          status: 'saved',
          draftId,
          createdDraft,
          value,
        };
      } finally {
        saving = false;
      }
    },
  };
}
