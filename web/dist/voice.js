export function parseCommand(text){
  const word=String(text).toLowerCase().replace(/[.,!?]/g,'').trim();
  return ['next','back','again','pause'].includes(word)?word:null;
}
export class VoiceCommands{
  constructor({Recognition,onCommand,onState,onError,now=()=>Date.now(),schedule=setTimeout,cancel=clearTimeout,extended=false}){
    Object.assign(this,{Recognition,onCommand,onState,onError,now,schedule,cancel,extended});this.enabled=false;this.generation=0;this.lastCommand=null;this.lastAt=-Infinity;this.restarts=[];
  }
  start(){
    if(!this.Recognition){this.onError('Voice commands are unavailable in this browser. Use the section buttons instead.');return;}
    if(this.enabled)return;
    this.enabled=true;this.lastAt=-Infinity;this.lastCommand=null;this.restarts=[];const generation=++this.generation;this.open(generation);
  }
  open(generation){
    if(!this.enabled||generation!==this.generation)return;
    const recognition=new this.Recognition();this.recognition=recognition;
    recognition.lang='en-US';recognition.continuous=true;recognition.interimResults=false;recognition.maxAlternatives=1;
    recognition.onstart=()=>{if(generation===this.generation&&this.enabled)this.onState('listening');};
    recognition.onresult=event=>{
      if(generation!==this.generation||!this.enabled)return;
      for(let i=event.resultIndex;i<event.results.length;i++){
        if(!event.results[i].isFinal)continue;
        const result=event.results[i][0],word=String(result.transcript).toLowerCase().replace(/[.,!?]/g,'').trim(),command=parseCommand(word)??(this.extended?({start:'resume',resume:'resume',slower:'slower',faster:'faster',loop:'loop'}[word]??null):null);
        if(!command||(result.confidence>0&&result.confidence<.5))continue;
        const now=this.now();if(command===this.lastCommand&&now-this.lastAt<900)continue;
        this.lastCommand=command;this.lastAt=now;this.onCommand(command);
      }
    };
    recognition.onerror=event=>{
      if(generation!==this.generation||!this.enabled||event.error==='aborted'||event.error==='no-speech')return;
      const messages={'not-allowed':'Microphone permission was denied. Allow microphone access, then enable voice control again.','service-not-allowed':'Speech recognition is blocked by this browser. Use the buttons or another supported browser.','audio-capture':'No microphone is available. Connect one or use the section buttons.','network':'The browser’s speech service could not connect. Check your internet connection or use the buttons.','language-not-supported':'English voice recognition is unavailable in this browser.'};
      this.stop();this.onError(messages[event.error]??`Voice recognition stopped (${event.error}). Use the buttons or enable it again.`);
    };
    recognition.onend=()=>{
      if(generation!==this.generation||!this.enabled)return;
      const now=this.now();this.restarts=this.restarts.filter(t=>now-t<30000);this.restarts.push(now);
      if(this.restarts.length>8){this.stop();this.onError('The browser keeps stopping voice recognition. Please use the buttons or enable voice control again.');return;}
      this.onState('reconnecting');this.timer=this.schedule(()=>this.open(generation),500);
    };
    this.onState('starting');try{recognition.start();}catch(error){this.stop();this.onError(`Voice recognition could not start: ${error.message}`);}
  }
  stop(){this.enabled=false;this.generation++;if(this.timer)this.cancel(this.timer);this.timer=null;try{this.recognition?.abort();}catch{}this.recognition=null;this.onState('off');}
}
