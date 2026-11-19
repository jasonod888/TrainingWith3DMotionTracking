import type {AssessmentPolicy} from '../../../../../packages/lesson-schema/index';
import {feedbackEligibility} from '../music-feedback';
import {Button} from '../../ui/controls';

export type FeedbackChoiceProps = {
  subject:string;
  assessment:AssessmentPolicy;
  referenceReviewed:boolean;
  inputSelected:boolean;
  inputMode:'midi'|'microphone';
  microphoneAvailable:boolean;
  enabled:boolean;
  active:boolean;
  lessonEnabled:boolean;
  onEnabledChange:(enabled:boolean)=>void;
};

/**
 * Always-visible practice feedback preference. On is the default and remains the
 * learner's choice while input, permissions, model, or reference evidence is
 * temporarily unavailable. Off is only set by the learner.
 */
export function FeedbackChoice(props:FeedbackChoiceProps) {
  const gate=feedbackEligibility({assessment:props.assessment,subject:props.subject,
    referenceReviewed:props.referenceReviewed,inputSelected:props.inputSelected,inputMode:props.inputMode,
    latencyMeasured:false,creatorEnabled:props.lessonEnabled});
  const reason=gate.reasons.find(item=>item!=='Feedback not enabled for this lesson.')
    ??'Feedback is ready for this reviewed reference.';
  const activeRun=props.lessonEnabled&&props.enabled&&props.active;
  const disabledByCreator=!props.lessonEnabled;
  const status=disabledByCreator?'Feedback not enabled for this lesson'
    :!props.enabled?'Off':gate.eligible?activeRun?'On · feedback run active':'On · ready'
    :`On · unavailable — ${reason}`;
  return <section className="feedback-choice" aria-label="Practice feedback"
    data-feedback-status={disabledByCreator?'lesson-off':props.enabled?'on':'off'}>
    <div className="feedback-choice-heading">
      <h3>Feedback</h3>
      <span className="small muted">Listen, then play back</span>
    </div>
    <div className="feedback-choice-buttons" role="group" aria-label="Feedback Off or On">
      <Button variant="settings-choice" type="button" aria-pressed={!props.enabled} disabled={disabledByCreator}
        className={!props.enabled?'is-selected':''} onClick={()=>props.onEnabledChange(false)}>Off</Button>
      <Button variant="settings-choice" type="button" aria-pressed={props.enabled} disabled={disabledByCreator}
        className={props.enabled?'is-selected':''} onClick={()=>props.onEnabledChange(true)}>On</Button>
    </div>
    <p className="small muted feedback-choice-status" role="status">{status}</p>
    <p className="small muted">{disabledByCreator
      ?'The lesson creator has not enabled practice feedback. Your saved preference is unchanged; ordinary playback still works.'
      :'Feedback is local and unscored. On is the default; Off is your explicit choice and keeps the reviewed reference and normal practice controls unchanged.'}</p>
    {!disabledByCreator&&!gate.eligible&&<p className="small muted" role="status">{reason}</p>}
  </section>;
}

/** On records the learner's preference even while setup is incomplete. */
export function setFeedbackChoice(value:boolean, context:{
  eligible:boolean; cancel:()=>void; setEnabled:(value:boolean)=>void; creatorEnabled:boolean;
}):void {
  if(!context.creatorEnabled)return;
  if(!value){context.cancel();context.setEnabled(false);return;}
  context.setEnabled(true);
}
