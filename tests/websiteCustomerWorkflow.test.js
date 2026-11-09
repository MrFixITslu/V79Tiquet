import test from "node:test";
import assert from "node:assert/strict";
import { websiteTicketReference, isWebsiteEvent, validateContactOutcome,
  submitConfirmedCustomerToWebsite } from "../server/websiteCustomerWorkflow.js";

const jobId="f51ab246-1234-4a1d-bacd-111111111111";
const eventId="4a39196a-0e70-422a-9363-4e0000000001";
const env = {
  INTAKE_ACCOUNT_ID: "vision79-account",
  TIQUET_WEBSITE_CRM_CONVERT_URL: "https://v79sl.com/api/integrations/tiquet/customer-convert",
  TIQUET_WEBSITE_CRM_SECRET: "a_fresh_shared_secret_at_least_32_chars_987654",
};

test("ticket reference is stable, readable and not exposed as a portal credential", () => {
  assert.equal(websiteTicketReference(jobId),"TQ-F51AB2461234");
  assert.equal(isWebsiteEvent(eventId),true);
  assert.equal(isWebsiteEvent("hub-help:012345"),false);
  assert.throws(()=>websiteTicketReference("../../etc/passwd"),/Invalid/);
});

test("contact outcomes always require substantive call notes", () => {
  assert.deepEqual(validateContactOutcome("confirmed","  Customer approved the proposal  "),
    {outcome:"confirmed",notes:"Customer approved the proposal"});
  assert.throws(()=>validateContactOutcome("confirmed","yes"),/10/);
  assert.throws(()=>validateContactOutcome("paid","Customer confirmed by phone"),/Select/);
});

test("CRM integration requires secret, exact tenant and event correlation", async () => {
  const output=await submitConfirmedCustomerToWebsite({
    jobId,intakeEventId:eventId,accountId:"vision79-account",
    confirmationNotes:"Confirmed customer service by phone", confirmedBy:"admin@example.test",
    env,transport:async (url,options)=>{
      assert.equal(url,env.TIQUET_WEBSITE_CRM_CONVERT_URL);
      assert.equal(options.headers["X-V79-Tiquet-CRM-Secret"],env.TIQUET_WEBSITE_CRM_SECRET);
      const body=JSON.parse(options.body);
      assert.equal(body.sourceAccountId,"vision79-account");
      assert.equal(body.intakeEventId,eventId);
      return {ok:true,status:200,json:async()=>({success:true,crmLeadId:55,customerId:"V79-CLI-ABC123"})};
    }
  });
  assert.equal(output.crmLeadId,55);
  assert.equal(output.crmCustomerId,"V79-CLI-ABC123");
  await assert.rejects(()=>submitConfirmedCustomerToWebsite({
    jobId,intakeEventId:eventId,accountId:"another-business",
    confirmationNotes:"Customer has agreed to proceed",confirmedBy:"user",env,
    transport:()=>{throw new Error("Must not connect");}
  }),/not an authorised/);
  await assert.rejects(()=>submitConfirmedCustomerToWebsite({
    jobId,intakeEventId:eventId,accountId:"vision79-account",
    confirmationNotes:"Customer has agreed to proceed",confirmedBy:"user",
    env:{...env,TIQUET_WEBSITE_CRM_SECRET:""},
    transport:()=>{throw new Error("Must not connect");}
  }),/not configured/);
});

test("CRM failure cannot be presented as a conversion success", async () => {
  await assert.rejects(()=>submitConfirmedCustomerToWebsite({
    jobId,intakeEventId:eventId,accountId:"vision79-account",
    confirmationNotes:"Customer has agreed to proceed",confirmedBy:"user",
    env,transport:async()=>({ok:false,status:409,json:async()=>({error:"Ambiguous CRM lead"})})
  }),/Ambiguous CRM lead/);
  await assert.rejects(()=>submitConfirmedCustomerToWebsite({
    jobId,intakeEventId:eventId,accountId:"vision79-account",
    confirmationNotes:"Customer has agreed to proceed",confirmedBy:"user",
    env,transport:async()=>({ok:true,status:200,json:async()=>({success:true,crmLeadId:55})})
  }),/did not confirm/);
});
