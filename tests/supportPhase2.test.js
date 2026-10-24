import test from "node:test";
import assert from "node:assert/strict";
import {SupportError} from "../server/support/contracts.js";
import {requireMailSandbox,mailAddress,rfcId,safeReferences,verifiedInbound,
 outgoingInput} from "../server/support/mailContracts.js";

const fixture={
 NODE_ENV:"test",CI_SUPPORT_SYNTHETIC:"1",V79_SUPPORT_DESK_ENABLED:"0",
 DATABASE_URL:"postgres://synthetic:synthetic@127.0.0.1:5432/tiquet_support_test"
};
test("synthetic mail engine is restricted to disposable localhost",()=>{
 assert.doesNotThrow(()=>requireMailSandbox(fixture));
 for(const changed of [
  {NODE_ENV:"production"},{CI_SUPPORT_SYNTHETIC:"0"},
  {V79_SUPPORT_DESK_ENABLED:"1"},
  {DATABASE_URL:"postgres://synthetic@db.internal/tiquet_support_test"},
  {DATABASE_URL:"postgres://synthetic@127.0.0.1:5432/tiquet"}]){
  assert.throws(()=>requireMailSandbox({...fixture,...changed}));
 }
});
test("real addresses, malformed IDs and unknown sender authenticity are refused",()=>{
 assert.equal(mailAddress("User@Example.invalid"),"user@example.invalid");
 for(const email of ["person@gmail.com","support@v79sl.com","bad@evil.test",
  "name\r\nBcc:someone@example.invalid"]){
  assert.throws(()=>mailAddress(email),e=>e instanceof SupportError);
 }
 assert.equal(rfcId("<synthetic.123@example.invalid>"),"<synthetic.123@example.invalid>");
 assert.throws(()=>rfcId("not-rfc"),/INVALID_MESSAGE_ID/);
 assert.deepEqual(safeReferences(["<a@example.invalid>","<a@example.invalid>"]),
  ["<a@example.invalid>"]);
 assert.throws(()=>safeReferences(Array(21).fill("<a@example.invalid>")),/INVALID_REFERENCES/);
 const base={mailboxId:"support",providerUid:"uid1",messageId:"<m1@example.invalid>",
   from:"customer@example.invalid",subject:"My synthetic ticket",body:"Hello"};
 assert.throws(()=>verifiedInbound(base),/UNVERIFIED_SENDER/);
 assert.throws(()=>verifiedInbound({...base,authenticatedSender:true,autoSubmitted:true}),
  /AUTOMATED_MAIL_REJECTED/);
 assert.equal(verifiedInbound({...base,authenticatedSender:true}).sender,"customer@example.invalid");
});
test("outgoing validates recipient, identity and idempotency",()=>{
 const x=outgoingInput({accountId:"a",actorId:"u",ticketId:"t",
  mailboxId:"inbox",recipient:"one@example.invalid",body:"Draft reply",
  idempotencyKey:"unique-test-key"});
 assert.equal(x.recipient,"one@example.invalid");
 assert.throws(()=>outgoingInput({...x,idempotencyKey:"bad"}),/INVALID_IDEMPOTENCY_KEY/);
 assert.throws(()=>outgoingInput({...x,recipient:"x@real.com"}),/SYNTHETIC_ADDRESS_REQUIRED/);
});
