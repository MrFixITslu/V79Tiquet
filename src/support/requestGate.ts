// Cancel-by-generation guard for asynchronous UI requests. An old
// ticket/queue fetch must never replace a newer selection or disclose
// another conversation in the current panel.
export function createRequestGate(){
 let generation=0;
 return Object.freeze({
  begin(){generation+=1;return generation;},
  isCurrent(value:number){return value===generation;},
  invalidate(){generation+=1;}
 });
}
