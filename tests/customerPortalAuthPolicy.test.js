import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCustomerEmail,
  normalizeCustomerName,
  issueCustomerVerification,
  verifyCustomerChallenge,
  issueCustomerSession,
  authorizeCustomerSession,
  customerSessionCookie,
  customerOwnsTicket,
  GENERIC_VERIFICATION_RESPONSE,
} from "../server/customerPortalAuthPolicy.js";

const now = 1_000_000;
const accountId = "account_v79";
const customerId = "customer_123";

test("canonicalise a valid email but not tenant identity", () => {
  assert.equal(normalizeCustomerEmail("  Hello.Example@Example.COM "), "hello.example@example.com");
  for (const email of ["", "abc", "x@@example.com", "x@example", "x@-example.com",
    "x@example..com", "x@e.com\nBcc:someone@example.com", "a".repeat(255)+"@example.com"]) {
    assert.equal(normalizeCustomerEmail(email), null, email);
  }
});
test("customer name bounds reject unsafe markup and control characters", () => {
  assert.equal(normalizeCustomerName("  Jane   Doe  "), "Jane Doe");
  for (const name of ["", "X", "<script>", "bad\rname", "A".repeat(121)]) {
    assert.equal(normalizeCustomerName(name), null);
  }
});
test("issue one-time high entropy email verification without plaintext in record", () => {
  const {token, record} = issueCustomerVerification({accountId,email:"a@example.com",now});
  assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(token in record,false);
  assert.ok(!JSON.stringify(record).includes(token));
  assert.equal(record.accountId,accountId);
  assert.equal(record.email,"a@example.com");
  assert.equal(record.expiresAt-now,15*60_000);
  assert.equal(verifyCustomerChallenge({token,record,accountId,now}),true);
  assert.equal(verifyCustomerChallenge({token,record,accountId,now:record.expiresAt-1}),true);
  assert.equal(verifyCustomerChallenge({token,record,accountId,now:record.expiresAt}),false);
});
test("verification rejects token replay, wrong business, corruption and absent records", () => {
  const {token,record}=issueCustomerVerification({accountId,email:"a@example.com",now});
  assert.equal(verifyCustomerChallenge({token,record:{...record,usedAt:now},accountId,now}),false);
  assert.equal(verifyCustomerChallenge({token,record,accountId:"account_other",now}),false);
  assert.equal(verifyCustomerChallenge({token:"bad",record,accountId,now}),false);
  assert.equal(verifyCustomerChallenge({token:"B".repeat(43),record,accountId,now}),false);
  assert.equal(verifyCustomerChallenge({token,record:null,accountId,now}),false);
});
test("reject client controlled or malformed business identifiers", () => {
  assert.throws(()=>issueCustomerVerification({accountId:"../",email:"a@example.com",now}),TypeError);
  assert.throws(()=>issueCustomerSession({accountId:"",customerId,emailVerifiedAt:now,now}),TypeError);
});
test("sessions require a previously verified email and use opaque tokens", () => {
  assert.throws(()=>issueCustomerSession({accountId,customerId,now}),TypeError);
  assert.throws(()=>issueCustomerSession({accountId,customerId,emailVerifiedAt:now+1,now}),TypeError);
  const {token,record}=issueCustomerSession({accountId,customerId,emailVerifiedAt:now-100,now});
  assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(record.tokenHash.length,64);
  assert.ok(!JSON.stringify(record).includes(token));
  assert.deepEqual(authorizeCustomerSession({token,record,accountId,now}),{
    accountId,customerId
  });
  assert.ok(Object.isFrozen(authorizeCustomerSession({token,record,accountId,now})));
  assert.equal(record.expiresAt-now,12*60*60*1000);
});
test("customer sessions reject cross-tenant, expired, revoked, missing and fake tokens",()=>{
  const {token,record}=issueCustomerSession({accountId,customerId,emailVerifiedAt:now,now});
  const auth=(x)=>authorizeCustomerSession({token,record,accountId,now,...x});
  assert.equal(auth({accountId:"account_other"}),null);
  assert.equal(auth({now:record.expiresAt}),null);
  assert.equal(auth({record:{...record,revokedAt:now}}),null);
  assert.equal(auth({record:{...record,revokedAt:undefined}}),null);
  assert.equal(auth({token:"A".repeat(43)}),null);
  assert.equal(auth({record:null}),null);
});
test("customer cookies are origin-bound and not accessible to JavaScript",()=>{
  const {token}=issueCustomerSession({accountId,customerId,emailVerifiedAt:now,now});
  const cookie=customerSessionCookie(token);
  assert.match(cookie,/^__Host-tiquet_customer=/);
  for(const part of ["Path=/","HttpOnly","Secure","SameSite=Lax","Max-Age=43200"]) assert.ok(cookie.includes(part));
  assert.ok(!cookie.includes("Domain="));
  assert.throws(()=>customerSessionCookie("bad"));
});
test("ticket ownership cannot cross accounts or customer identity",()=>{
  const session={accountId,customerId};
  const ticket={account_id:accountId,clientId:customerId};
  assert.equal(customerOwnsTicket({session,ticket}),true);
  assert.equal(customerOwnsTicket({session,ticket:{...ticket,account_id:"account_other"}}),false);
  assert.equal(customerOwnsTicket({session,ticket:{...ticket,clientId:"customer_other"}}),false);
  assert.equal(customerOwnsTicket({session:null,ticket}),false);
  assert.equal(customerOwnsTicket({session,ticket:null}),false);
});
test("account verification acknowledgement does not reveal account existence",()=>{
  assert.match(GENERIC_VERIFICATION_RESPONSE,/if this address is eligible/i);
  assert.ok(!GENERIC_VERIFICATION_RESPONSE.includes("already registered"));
});
