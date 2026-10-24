import {SupportError, nonblank, digest} from "./contracts.js";

// Synthetic-only. The mock provider supplies sender authentication, not From alone.
export function requireMailSandbox(env=process.env){
 if(env.NODE_ENV!=="test"||env.CI_SUPPORT_SYNTHETIC!=="1"||
    env.V79_SUPPORT_DESK_ENABLED!=="0")
  throw new Error("SUPPORT_MAIL_SYNTHETIC_ONLY");
 try{
  const uri=new URL(env.DATABASE_URL);
  if(!["localhost","127.0.0.1"].includes(uri.hostname) ||
      uri.pathname!=="/tiquet_support_test")
    throw new Error("SUPPORT_MAIL_DISPOSABLE_DB_REQUIRED");
 }catch{throw new Error("SUPPORT_MAIL_DISPOSABLE_DB_REQUIRED");}
}
export function mailAddress(value){
 const text=nonblank(value,254).toLowerCase();
 // No actual mailbox address can pass validation.
 if(!/^[a-z0-9][a-z0-9._+-]{0,62}@[a-z0-9.-]{1,100}\.invalid$/.test(text))
  throw new SupportError(400,"SYNTHETIC_ADDRESS_REQUIRED");
 return text;
}
export function rfcId(value){
 if(typeof value!=="string"||value.length>255||
    !/^<[A-Za-z0-9._+-]{1,100}@[A-Za-z0-9.-]{1,120}>$/.test(value))
  throw new SupportError(400,"INVALID_MESSAGE_ID");
 return value;
}
export function safeReferences(value){
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value)||value.length>20)throw new SupportError(400,"INVALID_REFERENCES");
 return [...new Set(value.map(rfcId))];
}
export function verifiedInbound(input){
 if(!input||typeof input!=="object"||Array.isArray(input))
  throw new SupportError(400,"INVALID_MAIL");
 // Production adapter would need explicit SPF/DKIM/DMARC alignment verification.
 if(input.authenticatedSender!==true) throw new SupportError(422,"UNVERIFIED_SENDER");
 if(input.autoSubmitted===true)throw new SupportError(422,"AUTOMATED_MAIL_REJECTED");
 const mailboxId=nonblank(input.mailboxId,128);
 const providerUid=nonblank(input.providerUid,160);
 const messageId=rfcId(input.messageId);
 const sender=mailAddress(input.from);
 const subject=nonblank(input.subject,200,3);
 const body=nonblank(input.body,10000);
 const references=safeReferences(input.references);
 return {mailboxId,providerUid,messageId,sender,subject,body,references};
}
export function outgoingInput(input){
 if(!input||typeof input!=="object"||Array.isArray(input))
  throw new SupportError(400,"INVALID_MAIL");
 const accountId=nonblank(input.accountId,128),actorId=nonblank(input.actorId,128);
 const ticketId=nonblank(input.ticketId,128),mailboxId=nonblank(input.mailboxId,128);
 const recipient=mailAddress(input.recipient);
 const body=nonblank(input.body,10000);
 const key=nonblank(input.idempotencyKey,128);
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new SupportError(400,"INVALID_IDEMPOTENCY_KEY");
 return {accountId,actorId,ticketId,mailboxId,recipient,body,key};
}
export function hashInbound(value){
 return digest({from:value.sender,subject:value.subject,body:value.body,messageId:value.messageId});
}
export function hashOutgoing(value){
 return digest({ticketId:value.ticketId,mailboxId:value.mailboxId,
  recipient:value.recipient,body:value.body});
}
