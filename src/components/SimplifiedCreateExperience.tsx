import { useRef, useState } from 'react';
import {
  CREATOR_CREATE_STATE_COPY,
  CREATOR_PROGRESS_STEPS,
  type CreatorCreateState,
  type CreatorProgressStep,
} from '../lib/createExperience';
import GeneratedVideoPreview from './GeneratedVideoPreview';

export type CreatorFormat = 'Portrait' | 'Landscape' | 'Square';
export type CreatorLength = 'Short' | 'Standard';
export type CreatorStyle = 'Auto' | 'Cinematic' | 'Social' | 'Animated';

type SimplifiedCreateExperienceProps = {
  state: CreatorCreateState;
  castName: string | null;
  castAvatar: string | null;
  sceneIdea: string;
  format: CreatorFormat;
  length: CreatorLength;
  style: CreatorStyle;
  progressStep: CreatorProgressStep;
  generateDisabled: boolean;
  generateBusy: boolean;
  saveBusy: boolean;
  draftSaveMessage: string;
  resultItem: unknown;
  resultCaption: string;
  onSceneIdeaChange: (value: string) => void;
  onChangeCast: () => void;
  onFormatChange: (value: CreatorFormat) => void;
  onLengthChange: (value: CreatorLength) => void;
  onStyleChange: (value: CreatorStyle) => void;
  onGenerate: () => void;
  onSaveDraft: () => void;
  onTryAgain: () => void;
  onOpenDrafts: () => void;
};

const sceneIdeas = [
  'A quiet entrance into a candlelit room.',
  'A joyful walk through soft afternoon light.',
  'A dramatic pause as the city glows behind them.',
] as const;

const formatOptions: CreatorFormat[] = ['Portrait', 'Landscape', 'Square'];
const lengthOptions: CreatorLength[] = ['Short', 'Standard'];
const styleOptions: CreatorStyle[] = ['Auto', 'Cinematic', 'Social', 'Animated'];

export function SimplifiedCreateExperience({
  state,
  castName,
  castAvatar,
  sceneIdea,
  format,
  length,
  style,
  progressStep,
  generateDisabled,
  generateBusy,
  saveBusy,
  draftSaveMessage,
  resultItem,
  resultCaption,
  onSceneIdeaChange,
  onChangeCast,
  onFormatChange,
  onLengthChange,
  onStyleChange,
  onGenerate,
  onSaveDraft,
  onTryAgain,
  onOpenDrafts,
}: SimplifiedCreateExperienceProps) {
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const sceneFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const copy = CREATOR_CREATE_STATE_COPY[state];
  const castStatusCopy = state === 'INCOMPLETE_CAST'
    ? 'Finish setup to use this AI Cast'
    : state === 'ACCOUNT_UNAVAILABLE'
      ? 'Your saved AI Cast remains preserved'
      : 'Using your saved AI Cast';

  if (state === 'GENERATING') {
    const activeStepIndex = Math.max(0, CREATOR_PROGRESS_STEPS.indexOf(progressStep));
    return (
      <section className="simple-create simple-create-progress" aria-live="polite">
        <div className="lumora-directing-mark" aria-hidden="true"><span>L</span></div>
        <div className="simple-create-progress-copy">
          <h1>{copy.title}</h1>
          <p>{progressStep}</p>
        </div>
        <ol className="simple-progress-list" aria-label="Generation progress">
          {CREATOR_PROGRESS_STEPS.map((step, index) => (
            <li
              key={step}
              className={index < activeStepIndex ? 'complete' : index === activeStepIndex ? 'active' : ''}
            >
              <span aria-hidden="true" />
              {step}
            </li>
          ))}
        </ol>
        <button type="button" className="quiet-btn simple-secondary-action" onClick={onSaveDraft} disabled={saveBusy}>
          {saveBusy ? 'Saving…' : 'Save to Drafts'}
        </button>
        <p className="simple-create-helper">{copy.body}</p>
      </section>
    );
  }

  if (state === 'SAVED') {
    return (
      <section className="simple-create simple-create-result" aria-live="polite">
        <header>
          <span className="simple-kicker">Synthetic portrayal</span>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
        </header>
        <GeneratedVideoPreview
          item={resultItem}
          title={resultCaption || 'Lumora scene'}
          controls
          forceVideo
          fit="contain"
          className="simple-result-preview"
        />
        {resultCaption ? <p className="simple-result-caption">{resultCaption}</p> : null}
        <button type="button" className="primary-btn simple-primary-action" onClick={onOpenDrafts}>
          View in Drafts
        </button>
      </section>
    );
  }

  return (
    <section className="simple-create">
      <header className="simple-create-header">
        <span className="simple-kicker">Bring a moment to life</span>
        <h1>Create</h1>
      </header>

      <div className="simple-cast-row">
        <div className="simple-cast-identity">
          {castAvatar ? (
            <img src={castAvatar} alt="" />
          ) : (
            <span className="simple-cast-placeholder" aria-hidden="true">L</span>
          )}
          <div>
            <strong>{castName || 'Choose your AI Cast'}</strong>
            {castName ? <small>{castStatusCopy}</small> : null}
          </div>
        </div>
        <button type="button" className="text-btn simple-change-cast" onClick={onChangeCast}>
          {castName ? 'Change' : 'Choose'}
        </button>
      </div>

      <label className="simple-scene-field">
        <span>What happens?</span>
        <textarea
          ref={sceneFieldRef}
          value={sceneIdea}
          onChange={(event) => onSceneIdeaChange(event.target.value)}
          rows={6}
          placeholder="Describe the scene you want to create…"
        />
      </label>

      <button
        type="button"
        className="text-btn simple-idea-action"
        aria-expanded={ideasOpen}
        onClick={() => setIdeasOpen((current) => !current)}
      >
        Give me an idea
      </button>

      {ideasOpen ? (
        <div className="simple-idea-sheet" role="dialog" aria-label="Scene ideas">
          <div className="row-between">
            <strong>Try a starting point</strong>
            <button type="button" className="text-btn" onClick={() => setIdeasOpen(false)}>Close</button>
          </div>
          {sceneIdeas.map((idea) => (
            <button
              key={idea}
              type="button"
              className="simple-idea-option"
              onClick={() => {
                onSceneIdeaChange(idea);
                setIdeasOpen(false);
                window.requestAnimationFrame(() => sceneFieldRef.current?.focus());
              }}
            >
              {idea}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="simple-customize-trigger"
        aria-expanded={customizeOpen}
        onClick={() => setCustomizeOpen(true)}
      >
        Customize
        <span aria-hidden="true">+</span>
      </button>

      {customizeOpen ? (
        <div className="simple-sheet-backdrop" role="presentation" onClick={() => setCustomizeOpen(false)}>
          <section
            className="simple-customize-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Customize scene"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="row-between">
              <h2>Customize</h2>
              <button type="button" className="text-btn" onClick={() => setCustomizeOpen(false)}>Done</button>
            </header>
            <fieldset>
              <legend>Format</legend>
              <div className="simple-option-row">
                {formatOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={format === option ? 'active' : ''}
                    aria-pressed={format === option}
                    onClick={() => onFormatChange(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Length</legend>
              <div className="simple-option-row">
                {lengthOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={length === option ? 'active' : ''}
                    aria-pressed={length === option}
                    onClick={() => onLengthChange(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Style</legend>
              <div className="simple-option-row">
                {styleOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={style === option ? 'active' : ''}
                    aria-pressed={style === option}
                    onClick={() => onStyleChange(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>
        </div>
      ) : null}

      {state === 'TEMPORARILY_UNAVAILABLE' || state === 'ACCOUNT_UNAVAILABLE' || state === 'NEEDS_EDIT' ? (
        <div className="simple-create-notice" role="status">
          <strong>{copy.title}</strong>
          {copy.body ? <p>{copy.body}</p> : null}
        </div>
      ) : (state === 'NO_CAST' || state === 'INCOMPLETE_CAST') && copy.body ? (
        <p className="simple-create-helper">{copy.body}</p>
      ) : null}

      <div className="simple-create-actions">
        <button
          type="button"
          className="primary-btn simple-primary-action"
          onClick={() => {
            if (state === 'NO_CAST' || state === 'INCOMPLETE_CAST') {
              onChangeCast();
              return;
            }
            if (state === 'NEEDS_EDIT') {
              sceneFieldRef.current?.focus();
              return;
            }
            if (state === 'TEMPORARILY_UNAVAILABLE') {
              onSaveDraft();
              return;
            }
            if (state === 'ACCOUNT_UNAVAILABLE') {
              onTryAgain();
              return;
            }
            onGenerate();
          }}
          disabled={state === 'READY' ? generateDisabled : generateBusy}
          aria-busy={generateBusy}
        >
          {generateBusy ? (
            <span className="simple-button-loading">
              <span className="simple-activity-indicator" aria-hidden="true" />
              Preparing your scene…
            </span>
          ) : copy.primaryAction}
        </button>
        {state === 'TEMPORARILY_UNAVAILABLE' || state === 'ACCOUNT_UNAVAILABLE' ? null : (
          <button
            type="button"
            className="quiet-btn simple-secondary-action"
            onClick={onSaveDraft}
            disabled={saveBusy}
          >
            {saveBusy ? 'Saving…' : 'Save draft'}
          </button>
        )}
      </div>
      {draftSaveMessage ? (
        <p className="simple-draft-save-status" role="status" aria-live="polite">
          {draftSaveMessage}
        </p>
      ) : null}
    </section>
  );
}
